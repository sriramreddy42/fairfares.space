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
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                (app.SAMPLE_HOUSING_OWNER_NAME, app.SAMPLE_HOUSING_OWNER_EMAIL, app.hash_password("Password123!")),
            )
            self.sample_owner_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
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

        self.assertEqual(results[0]["id"], "NEAR-DAYTON")
        self.assertFalse(results[0].get("sample", False))
        self.assertEqual(len(results), 11)
        self.assertTrue(all(item.get("sample") is False for item in results[1:]))
        self.assertTrue(all(item.get("posterName") == app.SAMPLE_HOUSING_OWNER_NAME for item in results[1:]))
        self.assertTrue(all(item.get("posterEmail") == app.SAMPLE_HOUSING_OWNER_EMAIL for item in results[1:]))
        self.assertTrue(all(item.get("posterUserId") == self.sample_owner_id for item in results[1:]))
        self.assertLessEqual(results[0]["distanceMiles"], 10)

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Madison, WI", "lat": 43.0731, "lng": -89.4012, "source": "test"},
    )
    def test_empty_location_returns_ten_local_contactable_seeded_posts(self, _mock_point):
        results = app.mobile_housing_posts(
            city="Madison, WI",
            area="University of Wisconsin–Madison",
            need="need_place",
            radius=5,
            limit=30,
        )

        self.assertEqual(len(results), 10)
        self.assertTrue(all(item["sample"] is False for item in results))
        self.assertTrue(all(item["posterName"] == app.SAMPLE_HOUSING_OWNER_NAME for item in results))
        self.assertTrue(all(item["posterEmail"] == app.SAMPLE_HOUSING_OWNER_EMAIL for item in results))
        self.assertTrue(all(item["posterUserId"] == self.sample_owner_id for item in results))
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

    def test_full_address_and_uploaded_photo_feed_website_map_and_cards(self):
        with app.db() as con:
            cursor = con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, street_address,
                 city, zip_code, city_area_zip, lat, lng, rent_min, contact_name, contact_phone,
                 contact_email, visibility_status)
                VALUES ('PHOTO-PIN', ?, 'HAVE_PLACE', 'ROOM', 'Photo room', 'Room with photo',
                        '1665 Logan St', 'Denver, CO', '80203', 'Denver, CO, 80203', 1, 2, 950,
                        'Poster', '3035550100', 'poster@example.com', 'ACTIVE')
                """,
                (self.user_id,),
            )
            post_id = int(cursor.lastrowid)
            con.execute(
                """
                INSERT INTO accommodation_post_images (post_id, image_url, sort_order)
                VALUES (?, 'local://uploads/accommodations/room.webp', 1)
                """,
                (post_id,),
            )
            post = con.execute(
                """
                SELECT posts.*,
                       (SELECT image_url FROM accommodation_post_images
                        WHERE post_id = posts.id ORDER BY sort_order, id LIMIT 1) AS preview_image_url
                FROM accommodation_posts posts WHERE posts.id = ?
                """,
                (post_id,),
            ).fetchone()

        self.assertEqual(
            app.accommodation_form_location_query(
                {"street_address": "1665 Logan St", "city": "Denver, CO", "zip_code": "80203"}
            ),
            "1665 Logan St, Denver, CO, 80203",
        )
        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test-key"}), patch.object(
            app,
            "accommodation_location_point",
            return_value={"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "source": "test"},
        ):
            payload = app.accommodation_post_map_payload([post], "Denver, CO", "Denver Metro Area")

        mapped = payload["posts"][0]
        self.assertEqual(mapped["location"], "1665 Logan St, Denver, CO, 80203")
        self.assertEqual(mapped["images"], ["/uploads/accommodations/room.webp"])
        self.assertEqual((mapped["lat"], mapped["lng"]), (0, 0))
        self.assertEqual(mapped["source"], "full_address_geocode")
        self.assertIn('src="/uploads/accommodations/room.webp"', app.render_accommodation_posts([post]))
        self.assertIn("background-image:url('/uploads/accommodations/room.webp')", app.render_mobile_accommodation_cards([post]))


if __name__ == "__main__":
    unittest.main()
