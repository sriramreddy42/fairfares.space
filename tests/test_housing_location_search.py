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

    def insert_filter_post(
        self,
        public_id,
        *,
        mode="HAVE_PLACE",
        category="single_room",
        city="Denver, CO",
        gender="open",
        rent_min=900,
        rent_max=0,
        description="Housing listing",
        status="ACTIVE",
        expires_at="2099-12-31 23:59:59",
    ):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, city_area_zip,
                 area_or_apartment, lat, lng, rent_min, rent_max, gender_preference,
                 contact_name, contact_phone, contact_email, visibility_status, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Central', 39.7392, -104.9903, ?, ?, ?,
                        'Poster', '3035550100', 'poster@example.com', ?, ?)
                """,
                (public_id, self.user_id, mode, category, public_id, description, city, city, rent_min, rent_max, gender, status, expires_at),
            )

    def test_plain_miami_does_not_resolve_to_miamisburg(self):
        options = app.accommodation_location_options("Miami")
        self.assertNotIn("Miamisburg", options["selectedLocation"])
        self.assertNotEqual(app.cached_accommodation_metro_for_place("Miami"), "Dayton Metro Area")

    def test_geocoded_us_city_dynamically_feeds_group_suggestions(self):
        geocode = {
            "formatted_address": "Boise, ID, USA",
            "address_components": [
                {"long_name": "Boise", "short_name": "Boise", "types": ["locality"]},
                {"long_name": "Idaho", "short_name": "ID", "types": ["administrative_area_level_1"]},
                {"long_name": "United States", "short_name": "US", "types": ["country"]},
            ],
            "geometry": {"location": {"lat": 43.615, "lng": -116.2023}},
        }
        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test-key"}), patch.object(
            app, "google_accommodation_geocode", return_value=geocode
        ), patch.object(app, "google_accommodation_nearby_areas", return_value=[]):
            point = app.accommodation_location_point("Boise")

        self.assertEqual(point["label"], "Boise, ID")
        self.assertEqual(app.chat_suggestion_city("Boise"), "Boise, ID")
        names = {row["name"] for row in app.get_chat_communities_for_user(self.user_id, "Boise")}
        self.assertIn("Boise Community", names)

    def test_city_autocomplete_combines_verified_places_and_cache(self):
        with app.db() as con:
            metro_id = app.upsert_accommodation_metro(con, "St. Louis Metro Area", country="US", state="MO", center_city="St. Louis")
            app.upsert_accommodation_local_area(con, metro_id, "St. Louis, MO", city="St. Louis", state="MO")
        google_payload = {
            "status": "OK",
            "predictions": [{"description": "St. Petersburg, FL, USA", "types": ["locality", "political"]}],
        }
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test-key"}), patch.object(
            app, "google_api_get", return_value=google_payload
        ):
            suggestions = app.accommodation_city_suggestions("St", limit=8)

        self.assertEqual(suggestions[0], "St. Petersburg, FL")
        self.assertIn("St. Louis, MO", suggestions)

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

    def test_housing_filter_matrix_returns_only_compatible_real_posts(self):
        self.insert_filter_post("OPEN-SINGLE", gender="open", rent_min=900)
        self.insert_filter_post("FEMALE-SHARED", category="shared_room", gender="female", rent_min=1100)
        self.insert_filter_post("MALE-SINGLE", gender="male", rent_min=850)
        self.insert_filter_post("OVER-BUDGET", gender="open", rent_min=1500, rent_max=1800)
        self.insert_filter_post("TENANT-REQUEST", mode="NEED_PLACE", gender="open", rent_min=800)
        self.insert_filter_post("WRONG-CITY", city="Dayton, OH", description="Moving from Denver and looking locally")
        self.insert_filter_post("EXPIRED", expires_at="2020-01-01 00:00:00")

        female_single_results = app.mobile_housing_posts(
            city="Denver, CO",
            need="need_place",
            category="single_room",
            gender="female",
            budget="1000",
            limit=30,
        )
        controlled_ids = {"OPEN-SINGLE", "FEMALE-SHARED", "MALE-SINGLE", "OVER-BUDGET", "TENANT-REQUEST", "WRONG-CITY", "EXPIRED"}
        real_ids = {item["id"] for item in female_single_results} & controlled_ids
        self.assertEqual(real_ids, {"OPEN-SINGLE"})
        self.assertTrue(all(item["mode"] == "HAVE_PLACE" for item in female_single_results))
        self.assertTrue(all(item["category"] == "single_room" for item in female_single_results))
        self.assertTrue(all(int(item["rentValue"]) <= 1000 for item in female_single_results))

        female_results = app.mobile_housing_posts(
            city="Denver, CO",
            need="need_place",
            gender="female",
            limit=30,
        )
        female_real_ids = {item["id"] for item in female_results} & controlled_ids
        self.assertIn("OPEN-SINGLE", female_real_ids)
        self.assertIn("FEMALE-SHARED", female_real_ids)
        self.assertNotIn("MALE-SINGLE", female_real_ids)
        self.assertNotIn("WRONG-CITY", female_real_ids)
        self.assertNotIn("EXPIRED", female_real_ids)

        tenant_requests = app.mobile_housing_posts(city="Denver, CO", need="have_place", limit=30)
        request_real_ids = {item["id"] for item in tenant_requests} & controlled_ids
        self.assertEqual(request_real_ids, {"TENANT-REQUEST"})
        self.assertTrue(all(item["mode"] == "NEED_PLACE" for item in tenant_requests))

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

        post_without_image = dict(post)
        post_without_image["preview_image_url"] = ""
        desktop_without_image = app.render_accommodation_posts([post_without_image])
        mobile_without_image = app.render_mobile_accommodation_cards([post_without_image])
        self.assertIn("Photos coming soon", desktop_without_image)
        self.assertIn("housing-post-media-empty", desktop_without_image)
        self.assertIn("No image found", mobile_without_image)
        self.assertIn("housing-mobile-card-image-empty", mobile_without_image)
        self.assertNotIn("trivago.com", mobile_without_image)


if __name__ == "__main__":
    unittest.main()
