import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
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
        roommate_intent=0,
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
                 roommate_intent, contact_name, contact_phone, contact_email, visibility_status, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Central', 39.7392, -104.9903, ?, ?, ?, ?,
                        'Poster', '3035550100', 'poster@example.com', ?, ?)
                """,
                (public_id, self.user_id, mode, category, public_id, description, city, city, rent_min, rent_max, gender, roommate_intent, status, expires_at),
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

    def test_international_city_region_feeds_group_suggestions(self):
        self.assertEqual(app.chat_suggestion_city("Bengaluru, Karnataka"), "Bengaluru, Karnataka")
        names = {row["name"] for row in app.get_chat_communities_for_user(self.user_id, "Bengaluru, Karnataka")}
        self.assertIn("Bengaluru Housing & Roommates", names)
        self.assertIn("Bengaluru Ride Share", names)
        self.assertIn("Bengaluru Community", names)

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

    def test_city_and_carpool_autocomplete_are_not_restricted_to_us(self):
        google_payload = {
            "status": "OK",
            "predictions": [
                {
                    "description": "Bengaluru, Karnataka, India",
                    "types": ["locality", "political"],
                }
            ],
        }
        requested_urls = []

        def google_response(url):
            requested_urls.append(url)
            return google_payload

        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test-key"}), patch.object(
            app, "google_api_get", side_effect=google_response
        ), patch.object(app, "google_accommodation_geocode", return_value=None):
            cities = app.accommodation_city_suggestions("Beng", limit=8)
            rides = app.google_accommodation_place_suggestions(
                "Bengaluru, Karnataka, India", "Kempegowda International Airport", limit=8
            )

        self.assertEqual(cities, ["Bengaluru, Karnataka, India"])
        self.assertEqual(rides, ["Bengaluru, Karnataka, India"])
        self.assertTrue(requested_urls)
        self.assertTrue(all("country%3Aus" not in url and "country:us" not in url for url in requested_urls))

    def test_carpool_popular_places_follow_selected_country(self):
        google_payload = {
            "status": "OK",
            "results": [
                {
                    "name": "Kempegowda International Airport",
                    "formatted_address": "Bengaluru, Karnataka, India",
                    "geometry": {"location": {"lat": 13.1986, "lng": 77.7066}},
                },
                {
                    "name": "Bengaluru City Railway Station",
                    "formatted_address": "Bengaluru, Karnataka, India",
                    "geometry": {"location": {"lat": 12.9788, "lng": 77.5727}},
                },
            ],
        }
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test-key"}), patch.object(
            app, "google_api_get", return_value=google_payload
        ) as google_call:
            places = app.google_ride_popular_places("Bengaluru, Karnataka, India", 12.9716, 77.5946)

        self.assertEqual(len(places), 2)
        self.assertTrue(all("India" in str(place["label"]) for place in places))
        self.assertEqual(places[0]["lat"], 13.1986)
        requested_url = google_call.call_args.args[0]
        self.assertIn("Bengaluru", requested_url)
        self.assertNotIn("country%3Aus", requested_url)

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
        self.insert_filter_post("ROOMMATE-REQUEST", mode="NEED_PLACE", gender="open", rent_min=800, roommate_intent=1)
        self.insert_filter_post("ROOMMATE-OFFER", mode="HAVE_PLACE", category="shared_room", gender="open", rent_min=950, roommate_intent=1)
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
        controlled_ids = {"OPEN-SINGLE", "FEMALE-SHARED", "MALE-SINGLE", "OVER-BUDGET", "TENANT-REQUEST", "ROOMMATE-REQUEST", "ROOMMATE-OFFER", "WRONG-CITY", "EXPIRED"}
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
        self.assertEqual(request_real_ids, {"TENANT-REQUEST", "ROOMMATE-REQUEST"})
        self.assertTrue(all(item["mode"] == "NEED_PLACE" for item in tenant_requests))

        roommate_requests = app.mobile_housing_posts(city="Denver, CO", need="need_roommates", limit=30)
        roommate_real_ids = {item["id"] for item in roommate_requests} & controlled_ids
        self.assertEqual(roommate_real_ids, {"ROOMMATE-REQUEST", "ROOMMATE-OFFER"})
        self.assertTrue(all(item["roommateIntent"] for item in roommate_requests))

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "source": "test"},
    )
    def test_large_area_search_does_not_lose_nearby_matches_behind_newer_far_rows(self, _mock_point):
        with app.db() as con:
            rows = []
            # Insert the valid nearby inventory first so it is older than the
            # hundreds of irrelevant rows that follow it.
            for index in range(180):
                rows.append((
                    f"NEAR-{index:03d}", self.user_id, "HAVE_PLACE", "single_room",
                    f"Near room {index}", "Capitol Hill", "Denver, CO", "Denver, CO",
                    "Capitol Hill", 39.7392 + (index % 12) * 0.001,
                    -104.9903 + (index // 12) * 0.001, 850 + (index % 6) * 20,
                    0, ("open", "female", "male")[index % 3], 0,
                ))
            for index in range(420):
                rows.append((
                    f"FAR-{index:03d}", self.user_id, "HAVE_PLACE", "single_room",
                    f"Far room {index}", "Colorado Springs", "Denver, CO", "Denver, CO",
                    "Far away", 38.8339, -104.8214, 700, 0, "open", 0,
                ))
            con.executemany(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, city_area_zip,
                 area_or_apartment, lat, lng, rent_min, rent_max, gender_preference,
                 roommate_intent, contact_name, contact_phone, contact_email, visibility_status,
                 expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        'Poster', '3035550100', 'poster@example.com', 'ACTIVE', '2099-12-31 23:59:59')
                """,
                rows,
            )

        results = app.mobile_housing_posts(
            city="Denver, CO",
            area="Capitol Hill, Denver, CO",
            need="need_place",
            category="single_room",
            gender="female",
            budget="900",
            radius=5,
            limit=50,
        )
        real_results = [item for item in results if item["id"].startswith("NEAR-")]
        self.assertEqual(len(real_results), 50)
        self.assertTrue(all(item["mode"] == "HAVE_PLACE" for item in real_results))
        self.assertTrue(all(item["category"] == "single_room" for item in real_results))
        self.assertTrue(all(int(item["id"].rsplit("-", 1)[1]) % 3 != 2 for item in real_results))
        self.assertTrue(all(item["rentValue"] <= 900 for item in real_results))
        self.assertTrue(all(item["distanceMiles"] is not None and item["distanceMiles"] <= 5 for item in real_results))
        self.assertFalse(any(item["id"].startswith("FAR-") for item in results))
        distances = [float(item["distanceMiles"]) for item in real_results]
        self.assertEqual(distances, sorted(distances))
        expected_ids = [item["id"] for item in results]
        with ThreadPoolExecutor(max_workers=12) as executor:
            repeated = list(executor.map(
                lambda _: app.mobile_housing_posts(
                    city="Denver, CO",
                    area="Capitol Hill, Denver, CO",
                    need="need_place",
                    category="single_room",
                    gender="female",
                    budget="900",
                    radius=5,
                    limit=50,
                ),
                range(48),
            ))
        self.assertTrue(all([item["id"] for item in batch] == expected_ids for batch in repeated))

    def test_nationwide_city_state_zip_and_address_radius_matrix(self):
        metros = (
            ("Seattle, WA", "98101", 47.6062, -122.3321),
            ("Los Angeles, CA", "90012", 34.0522, -118.2437),
            ("Phoenix, AZ", "85004", 33.4484, -112.0740),
            ("Denver, CO", "80202", 39.7392, -104.9903),
            ("Austin, TX", "78701", 30.2672, -97.7431),
            ("Miami, FL", "33130", 25.7617, -80.1918),
            ("Chicago, IL", "60601", 41.8781, -87.6298),
            ("New York, NY", "10001", 40.7128, -74.0060),
            ("Boston, MA", "02108", 42.3601, -71.0589),
            ("Portland, OR", "97205", 45.5152, -122.6784),
            ("Portland, ME", "04101", 43.6591, -70.2568),
            ("Springfield, MO", "65806", 37.2090, -93.2923),
            ("Springfield, IL", "62701", 39.7817, -89.6501),
            ("Boise, ID", "83702", 43.6150, -116.2023),
            ("Minneapolis, MN", "55401", 44.9778, -93.2650),
            ("Atlanta, GA", "30303", 33.7490, -84.3880),
        )
        with app.db() as con:
            rows = []
            for index, (city_label, zip_code, lat, lng) in enumerate(metros):
                other_city = metros[(index + 1) % len(metros)][0]
                rows.extend((
                    (f"USA-NEAR-{index:02d}", self.user_id, city_label, zip_code, lat + 0.01, lng + 0.01),
                    (f"USA-EDGE-{index:02d}", self.user_id, city_label, zip_code, lat + 0.08, lng, ),
                    (f"USA-FAR-{index:02d}", self.user_id, city_label, zip_code, lat + 0.35, lng),
                    # Deliberately stale coordinates in the searched location,
                    # but a different saved city/state.
                    (f"USA-WRONG-{index:02d}", self.user_id, other_city, zip_code, lat + 0.005, lng),
                ))
            con.executemany(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, zip_code,
                 city_area_zip, area_or_apartment, street_address, lat, lng, rent_min,
                 gender_preference, contact_name, contact_phone, contact_email,
                 visibility_status, expires_at)
                VALUES (?, ?, 'HAVE_PLACE', 'single_room', ?, 'Nationwide radius test', ?, ?,
                        ?, 'Downtown', '100 Main Street', ?, ?, 900, 'open', 'Poster',
                        '3035550100', 'poster@example.com', 'ACTIVE', '2099-12-31 23:59:59')
                """,
                [
                    (public_id, user_id, public_id, city_label, zip_code, f"{city_label} {zip_code}", lat, lng)
                    for public_id, user_id, city_label, zip_code, lat, lng in rows
                ],
            )

        points = {city_label.lower(): {"label": city_label, "lat": lat, "lng": lng, "source": "test"} for city_label, _, lat, lng in metros}

        def resolve_point(query, *_args, **_kwargs):
            clean_query = str(query or "").lower()
            for city_label, point in points.items():
                if city_label in clean_query:
                    return point
            return {"label": str(query or ""), "lat": 0, "lng": 0, "source": "test"}

        with patch.object(app, "accommodation_location_point", side_effect=resolve_point):
            for index, (city_label, zip_code, _lat, _lng) in enumerate(metros):
                results = app.mobile_housing_posts(
                    city=city_label,
                    area=f"100 Main Street, {city_label} {zip_code}",
                    need="need_place",
                    category="single_room",
                    budget="1000",
                    radius=10,
                    limit=20,
                )
                controlled_ids = {item["id"] for item in results if item["id"].startswith("USA-")}
                self.assertEqual(controlled_ids, {f"USA-NEAR-{index:02d}", f"USA-EDGE-{index:02d}"})
                controlled = [item for item in results if item["id"] in controlled_ids]
                self.assertEqual([item["id"] for item in controlled], [f"USA-NEAR-{index:02d}", f"USA-EDGE-{index:02d}"])
                self.assertTrue(all(item["distanceMiles"] is not None and item["distanceMiles"] <= 10 for item in controlled))

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
