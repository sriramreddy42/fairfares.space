import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import app


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


class ProductAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()

    def tearDown(self):
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def start_server(self):
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    def post_event(self, server, payload, token=""):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/api/mobile/analytics/events",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_event_ingestion_is_allow_listed_private_and_idempotent(self):
        server, thread = self.start_server()
        try:
            payload = {
                "eventName": "rental_search",
                "anonymousId": "install-1",
                "platform": "ios",
                "appVersion": "0.1.11",
                "buildVersion": "39",
                "sessionId": "session-1",
                "eventId": "event-1",
                "occurredAt": "2026-08-30T12:34:56.000Z",
                "metadata": {
                    "resultCount": 4,
                    "source": "rental_search",
                    "address": "123 Private Street",
                    "message": "private message",
                },
            }
            self.assertEqual(self.post_event(server, payload)[0], 202)
            self.assertEqual(self.post_event(server, payload)[0], 202)
            with app.db() as con:
                rows = con.execute("SELECT * FROM product_analytics_events").fetchall()
            self.assertEqual(len(rows), 1)
            metadata = json.loads(rows[0]["metadata_json"])
            self.assertEqual(metadata, {"resultCount": "4", "source": "rental_search"})
            self.assertNotIn("Private", rows[0]["metadata_json"])
            self.assertEqual(rows[0]["occurred_at"], "2026-08-30 12:34:56")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_unknown_event_is_rejected(self):
        server, thread = self.start_server()
        try:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                self.post_event(server, {"eventName": "email_address_captured", "anonymousId": "install-1"})
            self.assertEqual(raised.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_summary_counts_unique_actors_repeat_users_and_event_signups(self):
        with app.db() as con:
            con.execute("INSERT INTO users (name, email, password_hash, role, guest_account) VALUES ('Member', 'member@example.com', 'x', 'CUSTOMER', 0)")
            con.executemany(
                """INSERT INTO product_analytics_events
                   (event_name, anonymous_id, platform, session_id, dedupe_key, occurred_at)
                   VALUES (?, 'install-1', 'ios', ?, ?, ?)""",
                [
                    ("app_first_open", "s1", "e1", "2026-08-31 10:00:00"),
                    ("app_open", "s1", "e2", "2026-08-31 10:00:00"),
                    ("app_open", "s2", "e3", "2026-09-01 10:00:00"),
                    ("signup_completed", "s2", "e-signup", "2026-09-01 10:00:30"),
                    ("rental_search", "s2", "e4", "2026-09-01 10:01:00"),
                    ("rental_car_view", "s2", "e5", "2026-09-01 10:02:00"),
                    ("message_sent", "s2", "e6", "2026-09-01 10:03:00"),
                    ("rental_booking_completed", "s2", "e7", "2026-09-01 10:04:00"),
                ],
            )
        summary = app.product_analytics_summary(7)
        self.assertEqual(summary["stages"]["installs"], 1)
        self.assertEqual(summary["stages"]["opens"], 1)
        self.assertEqual(summary["stages"]["searches"], 1)
        self.assertEqual(summary["stages"]["car_views"], 1)
        self.assertEqual(summary["stages"]["signups"], 1)
        self.assertEqual(summary["stages"]["messages"], 1)
        self.assertEqual(summary["stages"]["bookings"], 1)
        self.assertEqual(summary["stages"]["repeat_users"], 1)

    def test_sign_in_merges_prior_anonymous_events_into_one_actor(self):
        with app.db() as con:
            user_id = con.execute(
                "INSERT INTO users (name, email, password_hash, role, guest_account) VALUES ('Member', 'merge@example.com', 'x', 'CUSTOMER', 0)"
            ).lastrowid
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('analytics-session', ?)", (user_id,))
        server, thread = self.start_server()
        try:
            self.post_event(server, {
                "eventName": "app_open", "anonymousId": "merge-install", "eventId": "merge-1"
            })
            self.post_event(server, {
                "eventName": "signup_completed", "anonymousId": "merge-install", "eventId": "merge-2"
            }, token="analytics-session")
            with app.db() as con:
                actors = con.execute(
                    "SELECT DISTINCT user_id FROM product_analytics_events WHERE anonymous_id = 'merge-install'"
                ).fetchall()
            self.assertEqual([row["user_id"] for row in actors], [user_id])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_dashboard_template_explains_first_open_and_privacy(self):
        template = Path("templates/admin_analytics.html").read_text(encoding="utf-8")
        self.assertIn("first successful app open", template)
        self.assertIn("common baseline", template)
        self.assertIn("never collected", template)
        self.assertIn("$funnel_rows", template)


if __name__ == "__main__":
    unittest.main()
