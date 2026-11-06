import os
import tempfile
import unittest
import json
import threading
import urllib.request
from unittest import mock
from pathlib import Path

import app


class HousingMoveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = {key: os.environ.get(key) for key in ("FAIRFARES_DB_PATH", "FAIRFARES_SEED_DEFAULTS")}
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp.name) / "test.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute("INSERT INTO users (name, email, password_hash, is_verified, local_city, relocation_company) VALUES ('Mover', 'mover@example.com', 'unused', 1, 'Houston, TX', 'Amazon')")
            self.uid = con.execute("SELECT last_insert_rowid()").fetchone()[0]

    def tearDown(self):
        for key, value in self.old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        app.refresh_storage_paths()
        self.temp.cleanup()

    def intent(self, moving=True, visible=True):
        return app.housing_post_location_intent({"housingLocation": {
            "currentCity": "Houston, TX", "moving": moving,
            "showOnMap": visible, "moveMonth": "2027-01",
        }}, "NEED_PLACE", "Denver, CO")

    def test_confirmed_move_preserves_home_and_is_visible_only_with_consent(self):
        with app.db() as con:
            app.apply_housing_post_location(con, self.uid, self.intent(visible=False))
        self.assertEqual(app.people_map_city_pool(0, "Denver, CO")["total"], 0)
        with app.db() as con:
            app.apply_housing_post_location(con, self.uid, self.intent())
            user = con.execute("SELECT * FROM users WHERE id = ?", (self.uid,)).fetchone()
        self.assertEqual(user["local_city"], "Houston, TX")
        pool = app.people_map_city_pool(0, "Denver, CO", "Amazon")
        self.assertEqual(pool["total"], 1)
        self.assertEqual(pool["companyMatches"], 1)
        self.assertTrue(pool["people"][0]["moving"])
        self.assertEqual(pool["people"][0]["fromCity"], "Houston, TX")

    def test_no_answer_and_old_clients_do_not_overwrite_move(self):
        with app.db() as con:
            app.apply_housing_post_location(con, self.uid, self.intent())
            app.apply_housing_post_location(con, self.uid, self.intent(moving=False))
            app.apply_housing_post_location(con, self.uid, None)
            self.assertEqual(con.execute("SELECT relocation_city FROM users WHERE id = ?", (self.uid,)).fetchone()[0], "Denver, CO")
        self.assertIsNone(app.housing_post_location_intent({}, "GENERAL", "Denver, CO"))

    def test_hidden_members_stay_hidden_and_users_are_not_counted_twice(self):
        with app.db() as con:
            app.apply_housing_post_location(con, self.uid, self.intent())
            con.execute("UPDATE users SET local_city = 'Denver, CO', local_connection_discoverable = 1 WHERE id = ?", (self.uid,))
        self.assertEqual(app.people_map_city_pool(0, "Denver, CO")["total"], 1)
        with app.db() as con:
            con.execute("UPDATE users SET people_discovery_configured = 1, people_discoverable = 0 WHERE id = ?", (self.uid,))
        self.assertEqual(app.people_map_city_pool(0, "Denver, CO")["total"], 0)

    def test_invalid_intent_rejected(self):
        with self.assertRaises(ValueError):
            app.housing_post_location_intent({"housingLocation": {"currentCity": "Houston, TX", "moving": "yes", "showOnMap": True}}, "NEED_PLACE", "Denver, CO")
        with self.assertRaises(ValueError):
            app.housing_post_location_intent({"housingLocation": {"currentCity": "Houston, TX", "moving": True, "showOnMap": True, "moveMonth": "2027-13"}}, "HAVE_PLACE", "Denver, CO")
        with self.assertRaises(ValueError):
            app.housing_post_location_intent({"housingLocation": {}}, "GENERAL", "Denver, CO")

    def test_housing_publish_saves_move_and_returns_updated_profile(self):
        class Handler(app.FairFaresHandler):
            suppress_operational_alerts = True
            def log_message(self, *_args):
                pass
        with app.db() as con:
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('move-test', ?)", (self.uid,))
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        payload = {
            "postMode": "NEED_PLACE", "category": "single_room", "title": "Need a room",
            "description": "Looking near campus", "city": "Denver, CO", "zipCode": "80203",
            "area": "Capitol Hill", "moveInDate": "2099-09-15", "rentMin": "700",
            "rentPeriod": "MONTH", "accommodates": "1", "contactName": "Mover",
            "contactEmail": "mover@example.com", "contactPhone": "+13035550123",
            "housingLocation": {"currentCity": "Houston, TX", "moving": True, "moveMonth": "2027-01", "showOnMap": True},
        }
        try:
            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(app, "accommodation_location_point", return_value={"lat": 39.7392, "lng": -104.9903, "label": "Denver, CO"}), mock.patch.object(app, "schedule_housing_community_projection_sync"):
                req = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                    data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer move-test"}, method="POST")
                with urllib.request.urlopen(req) as response:
                    result = json.load(response)
                self.assertEqual(result["user"]["localCity"], "Houston, TX")
                self.assertEqual(result["user"]["relocationCity"], "Denver, CO")
                self.assertTrue(result["user"]["relocationDiscoverable"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_existing_listing_backfill_uses_latest_city_once_and_preserves_consent(self):
        with app.db() as con:
            con.execute("DELETE FROM app_data_migrations WHERE migration_key = 'existing_housing_member_cities_v1'")
            con.execute("UPDATE users SET local_city = '', relocation_city = '', relocation_discoverable = 0 WHERE id = ?", (self.uid,))
            for key, city, date in [("old", "Houston, TX", "2026-01-01"), ("latest", "Denver, CO", "2026-02-01")]:
                con.execute("INSERT INTO accommodation_posts (public_id, user_id, post_mode, city, created_at) VALUES (?, ?, 'NEED_PLACE', ?, ?)", (key, self.uid, city, date))
            self.assertEqual(app.backfill_existing_housing_member_cities(con), 1)
            user = con.execute("SELECT * FROM users WHERE id = ?", (self.uid,)).fetchone()
            self.assertEqual((user["local_city"], user["relocation_city"]), ("Denver, CO", "Denver, CO"))
            self.assertEqual(user["relocation_discoverable"], 0)
            con.execute("UPDATE users SET local_city = 'Austin, TX' WHERE id = ?", (self.uid,))
            self.assertEqual(app.backfill_existing_housing_member_cities(con), 0)
            self.assertEqual(con.execute("SELECT local_city FROM users WHERE id = ?", (self.uid,)).fetchone()[0], "Austin, TX")

    def test_existing_listing_backfill_preserves_known_origin(self):
        with app.db() as con:
            con.execute("DELETE FROM app_data_migrations WHERE migration_key = 'existing_housing_member_cities_v1'")
            con.execute("INSERT INTO ask_community_posts (public_id, author_id, title, body, category, city) VALUES ('move-ask', ?, 'Need a place', 'Looking for a home', 'NEED_ROOMMATE', 'Denver, CO')", (self.uid,))
            self.assertEqual(app.backfill_existing_housing_member_cities(con), 1)
            user = con.execute("SELECT * FROM users WHERE id = ?", (self.uid,)).fetchone()
            self.assertEqual((user["local_city"], user["relocation_city"]), ("Houston, TX", "Denver, CO"))
            audit = con.execute("SELECT * FROM housing_member_city_backfill_audit WHERE user_id = ?", (self.uid,)).fetchone()
            self.assertEqual(audit["old_current_city"], "Houston, TX")
            self.assertEqual(audit["source_kind"], "ASK")

    def test_transaction_rollback_does_not_save_move(self):
        with self.assertRaises(RuntimeError):
            with app.db() as con:
                app.apply_housing_post_location(con, self.uid, self.intent())
                raise RuntimeError("Post failed")
        self.assertEqual(app.people_map_city_pool(0, "Denver, CO")["total"], 0)


if __name__ == "__main__":
    unittest.main()
