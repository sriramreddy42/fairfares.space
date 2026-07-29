import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class HousingLocationSearchTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Poster', 'poster@example.com', ?, 1)",
                (app.hash_password("Password123!"),),
            )
            self.user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

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

    def insert_post(self, public_id, title, city, area, lat, lng):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, city_area_zip,
                 area_or_apartment, lat, lng, rent_min, contact_name, contact_phone, contact_email,
                 visibility_status)
                VALUES (?, ?, 'HAVE_PLACE', 'ROOM', ?, 'Test room', ?, ?, ?, ?, ?, 900,
                        'Poster', '3035550100', 'poster@example.com', 'ACTIVE')
                """,
                (public_id, self.user_id, title, city, f"{city}, 45420", area, lat, lng),
            )

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Wilmington Pike, Dayton, OH", "lat": 39.665, "lng": -84.195, "source": "test"},
    )
    def test_specific_place_search_enforces_radius_and_city(self, _mock_point):
        self.insert_post("NEAR-DAYTON", "Nearby Dayton room", "Dayton", "Near Wilmington Pike", 39.672, -84.198)
        self.insert_post("FAR-DAYTON", "Far Dayton room", "Dayton", "North Dayton", 40.05, -84.20)
        self.insert_post("BAD-DENVER", "Denver record with stale coordinates", "Denver", "Wilmington Avenue", 39.668, -84.196)

        results = app.mobile_housing_posts(
            city="Dayton, OH",
            area="Wilmington Pike, Dayton, OH",
            need="need_place",
            radius=10,
            limit=30,
        )

        self.assertEqual([item["id"] for item in results], ["NEAR-DAYTON"])
        self.assertLessEqual(results[0]["distanceMiles"], 10)

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Madison, WI", "lat": 43.0731, "lng": -89.4012, "source": "test"},
    )
    def test_empty_location_returns_ten_local_non_contactable_samples(self, _mock_point):
        results = app.mobile_housing_posts(
            city="Madison, WI",
            area="University of Wisconsin–Madison",
            need="need_place",
            radius=5,
            limit=30,
        )

        self.assertEqual(len(results), 10)
        self.assertTrue(all(item["sample"] is True for item in results))
        self.assertTrue(all("University of Wisconsin" in item["location"] for item in results))
        self.assertTrue(all(item["mode"] == "HAVE_PLACE" for item in results))
        self.assertTrue(all(float(item["distanceMiles"]) <= 5 for item in results))
        self.assertGreaterEqual(len({item["category"] for item in results}), 6)
        self.assertIn("Shared Room", {item["categoryLabel"] for item in results})
        self.assertTrue(all(str(item["imageUrl"]).startswith("/static/demo-housing/") for item in results))

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Madison, WI", "lat": 43.0731, "lng": -89.4012, "source": "test"},
    )
    def test_selected_category_and_intent_are_reflected_in_samples(self, _mock_point):
        results = app.mobile_housing_posts(
            city="Madison, WI",
            need="have_place",
            category="shared_room",
            budget="600",
            limit=30,
        )

        self.assertEqual(len(results), 10)
        self.assertTrue(all(item["category"] == "shared_room" for item in results))
        self.assertTrue(all(item["mode"] == "NEED_PLACE" for item in results))
        self.assertTrue(all(int(item["rentValue"]) <= 600 for item in results))


if __name__ == "__main__":
    unittest.main()
