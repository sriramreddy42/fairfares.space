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
        with app._POPULAR_CITY_CACHE_LOCK:
            app._POPULAR_CITY_CACHE.clear()
            app._POPULAR_CITY_KEY_LOCKS.clear()
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
        country = app.accommodation_country_code(city)
        with app.db() as con:
            con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, country, city_area_zip,
                 area_or_apartment, lat, lng, rent_min, contact_name, contact_phone, contact_email,
                 visibility_status)
                VALUES (?, ?, 'HAVE_PLACE', 'ROOM', ?, 'Test room', ?, ?, ?, ?, ?, ?, 900,
                        'Poster', '3035550100', 'poster@example.com', 'ACTIVE')
                """,
                (public_id, self.user_id, title, city, country, f"{city}, 45420", area, lat, lng),
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
        country = app.accommodation_country_code(city)
        with app.db() as con:
            con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, category, title, description, city, country, city_area_zip,
                 area_or_apartment, lat, lng, rent_min, rent_max, gender_preference,
                 roommate_intent, contact_name, contact_phone, contact_email, visibility_status, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Central', 39.7392, -104.9903, ?, ?, ?, ?,
                        'Poster', '3035550100', 'poster@example.com', ?, ?)
                """,
                (public_id, self.user_id, mode, category, public_id, description, city, country, city, rent_min, rent_max, gender, roommate_intent, status, expires_at),
            )

    def test_housing_payload_uses_posters_current_profile_photo(self):
        self.insert_post("PROFILE-PHOTO", "Room with poster avatar", "Denver, CO", "Capitol Hill", 39.7392, -104.9903)
        first_photo = "https://cdn.example.test/avatar-v1.jpg"
        updated_photo = "https://cdn.example.test/avatar-v2.jpg"
        with app.db() as con:
            con.execute("UPDATE users SET profile_photo_url = ? WHERE id = ?", (first_photo, self.user_id))

        first = app.mobile_housing_posts(city="Denver, CO", limit=10)
        first_listing = next(item for item in first if item["id"] == "PROFILE-PHOTO")
        self.assertEqual(first_listing["photoUrl"], first_photo)

        with app.db() as con:
            con.execute("UPDATE users SET profile_photo_url = ? WHERE id = ?", (updated_photo, self.user_id))

        refreshed = app.mobile_housing_posts(city="Denver, CO", limit=10)
        refreshed_listing = next(item for item in refreshed if item["id"] == "PROFILE-PHOTO")
        self.assertEqual(refreshed_listing["photoUrl"], updated_photo)

    def test_formatted_street_address_is_not_repeated_with_city_and_zip(self):
        self.assertEqual(
            app.accommodation_address_label({
                "street_address": "Dayton Street, Aurora, CO 80010",
                "city": "Aurora, CO",
                "zip_code": "80010",
            }),
            "Dayton Street, Aurora, CO 80010",
        )
        self.assertEqual(
            app.accommodation_address_label({
                "street_address": "2018 South Xenia Way",
                "city": "Denver, CO",
                "zip_code": "80231",
            }),
            "2018 South Xenia Way, Denver, CO, 80231",
        )
        self.assertEqual(
            app.accommodation_address_label({
                "street_address": "",
                "city": "Bridgeport, CT",
                "city_area_zip": "Bridgeport, CT",
                "area_or_apartment": "Downtown Bridgeport",
            }),
            "Downtown Bridgeport, Bridgeport, CT",
        )

    def test_plain_miami_does_not_resolve_to_miamisburg(self):
        options = app.accommodation_location_options("Miami")
        self.assertNotIn("Miamisburg", options["selectedLocation"])
        self.assertNotEqual(app.cached_accommodation_metro_for_place("Miami"), "Dayton Metro Area")

    def test_state_qualified_denver_never_uses_colorado_static_point(self):
        colorado = app.static_accommodation_point("Denver, CO")
        self.assertNotEqual(colorado, (0.0, 0.0))

        for selected in ("Denver, NC", "Denver, PA"):
            with self.subTest(selected=selected):
                self.assertEqual(app.static_accommodation_point(selected), (0.0, 0.0))
                point = app.accommodation_location_point(selected, allow_refresh=False)
                self.assertFalse(
                    point.get("lat") == colorado[0] and point.get("lng") == colorado[1],
                    f"{selected} incorrectly reused Denver, CO coordinates",
                )

    def test_brookville_oh_static_point_wins_over_poisoned_cache(self):
        with app.db() as con:
            metro_id = app.upsert_accommodation_metro(
                con,
                "Wrong Brookville",
                country="US",
                state="IN",
                center_city="Brookville",
                lat=39.407,
                lng=-85.0187,
            )
            app.upsert_accommodation_local_area(
                con,
                metro_id,
                "Brookville, OH",
                city="Brookville",
                state="IN",
                lat=39.407,
                lng=-85.0187,
            )

        point = app.accommodation_location_point("Brookville, OH", allow_refresh=False)

        self.assertEqual(point["source"], "static")
        self.assertAlmostEqual(point["lat"], 39.8367, places=4)
        self.assertAlmostEqual(point["lng"], -84.4113, places=4)

    def test_state_mismatched_geocode_is_not_cached(self):
        wrong_geocode = {
            "formatted_address": "Brookville, IN, USA",
            "address_components": [
                {"long_name": "Brookville", "short_name": "Brookville", "types": ["locality"]},
                {"long_name": "Indiana", "short_name": "IN", "types": ["administrative_area_level_1"]},
                {"long_name": "United States", "short_name": "US", "types": ["country"]},
            ],
            "geometry": {"location": {"lat": 39.407, "lng": -85.0187}},
        }
        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test-key"}), patch.object(
            app, "google_accommodation_geocode", return_value=wrong_geocode
        ):
            metro = app.refresh_accommodation_location_cache("Brookville, OH", force=True)

        self.assertEqual(metro, "")
        with app.db() as con:
            poisoned = con.execute(
                "SELECT 1 FROM accommodation_local_areas WHERE lower(name) = lower('Brookville, OH')"
            ).fetchone()
        self.assertIsNone(poisoned)

    def test_state_qualified_lookup_ignores_same_label_cached_for_another_state(self):
        with app.db() as con:
            wrong_metro_id = app.upsert_accommodation_metro(
                con, "Portland OR", country="US", state="OR", center_city="Portland"
            )
            app.upsert_accommodation_local_area(
                con,
                wrong_metro_id,
                "Portland, ME",
                city="Portland",
                state="OR",
                lat=45.5152,
                lng=-122.6784,
            )

        correct_geocode = {
            "formatted_address": "Portland, ME, USA",
            "address_components": [
                {"long_name": "Portland", "short_name": "Portland", "types": ["locality"]},
                {"long_name": "Maine", "short_name": "ME", "types": ["administrative_area_level_1"]},
                {"long_name": "United States", "short_name": "US", "types": ["country"]},
            ],
            "geometry": {"location": {"lat": 43.6591, "lng": -70.2568}},
        }
        with patch.object(app, "google_accommodation_geocode", return_value=correct_geocode), patch.object(
            app, "google_accommodation_nearby_areas", return_value=[]
        ):
            point = app.accommodation_location_point("Portland, ME")

        self.assertEqual(point["label"], "Portland, ME")
        self.assertAlmostEqual(point["lat"], 43.6591, places=4)
        self.assertAlmostEqual(point["lng"], -70.2568, places=4)
        self.assertEqual(app.cached_accommodation_country_for_place("Portland, ME"), "US")
        with app.db() as con:
            states = {
                row["state"]
                for row in con.execute(
                    "SELECT state FROM accommodation_local_areas WHERE lower(name) = lower('Portland, ME')"
                ).fetchall()
            }
        self.assertEqual(states, {"OR", "ME"})

    def test_location_cache_saves_state_matched_results_for_every_us_state_and_dc(self):
        state_codes = (
            "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
            "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
            "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
            "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
            "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
        )

        def matching_geocode(query):
            city, state = app.split_city_state(query)
            index = state_codes.index(state)
            return {
                "formatted_address": f"{city}, {state}, USA",
                "address_components": [
                    {"long_name": city, "short_name": city, "types": ["locality"]},
                    {"long_name": state, "short_name": state, "types": ["administrative_area_level_1"]},
                    {"long_name": "United States", "short_name": "US", "types": ["country"]},
                ],
                "geometry": {"location": {"lat": 25.0 + index * 0.4, "lng": -124.0 + index * 0.8}},
            }

        with patch.object(app, "google_accommodation_geocode", side_effect=matching_geocode), patch.object(
            app, "google_accommodation_nearby_areas", return_value=[]
        ):
            for state in state_codes:
                city = f"Regression{state}"
                self.assertTrue(app.refresh_accommodation_location_cache(f"{city}, {state}", force=True))

        with app.db() as con:
            saved = con.execute(
                """
                SELECT area.city, area.state, area.lat, area.lng, metro.country
                FROM accommodation_local_areas area
                JOIN accommodation_metros metro ON metro.id = area.metro_id
                WHERE area.city LIKE 'Regression%'
                """
            ).fetchall()

        self.assertEqual(len(saved), len(state_codes))
        self.assertEqual({row["state"] for row in saved}, set(state_codes))
        self.assertTrue(all(row["country"] == "US" for row in saved))
        self.assertTrue(all(float(row["lat"]) and float(row["lng"]) for row in saved))

    @patch.object(
        app,
        "accommodation_location_point",
        side_effect=lambda query, *args, **kwargs: (
            {"label": "Brookville, OH", "lat": 39.8367, "lng": -84.4113, "source": "test"}
            if "Brookville" in query
            else {"label": "Dayton, OH", "lat": 39.7589, "lng": -84.1916, "source": "test"}
        ),
    )
    def test_area_search_recovers_listing_with_foreign_stale_coordinates(self, _mock_point):
        self.insert_post(
            "STALE-DAYTON",
            "Dayton listing with bad geocode",
            "Dayton",
            "Brookville",
            51.4805847,
            -0.2655634,
        )

        results = app.mobile_housing_posts(
            city="Dayton, OH",
            area="Brookville, OH",
            need="need_place",
            radius=25,
            limit=30,
        )

        listing = next(item for item in results if item["id"] == "STALE-DAYTON")
        self.assertTrue(listing["locationApproximate"])
        self.assertAlmostEqual(listing["lat"], 39.7589, places=4)
        self.assertLessEqual(listing["distanceMiles"], 25)

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "source": "test"},
    )
    @patch.object(
        app,
        "precise_accommodation_location_point",
        return_value={"label": "2018 South Xenia Way, Denver, CO 80231", "lat": 39.6821, "lng": -104.8862, "source": "google-address"},
    )
    def test_stale_listing_coordinates_are_repaired_from_full_street_address(self, _mock_precise, _mock_city):
        self.insert_post(
            "STALE-STREET",
            "Room with exact address",
            "Denver, CO",
            "Indian Creek",
            51.4805847,
            -0.2655634,
        )
        with app.db() as con:
            con.execute(
                "UPDATE accommodation_posts SET street_address = '2018 South Xenia Way', zip_code = '80231' WHERE public_id = 'STALE-STREET'"
            )

        results = app.mobile_housing_posts(city="Denver, CO", need="need_place", limit=30)

        listing = next(item for item in results if item["id"] == "STALE-STREET")
        self.assertNotIn("locationApproximate", listing)
        self.assertAlmostEqual(listing["lat"], 39.6821, places=4)
        self.assertAlmostEqual(listing["lng"], -104.8862, places=4)
        self.assertGreater(listing["distanceMiles"], 0)
        with app.db() as con:
            saved = con.execute("SELECT lat, lng FROM accommodation_posts WHERE public_id = 'STALE-STREET'").fetchone()
        self.assertAlmostEqual(float(saved["lat"]), 39.6821, places=4)
        self.assertAlmostEqual(float(saved["lng"]), -104.8862, places=4)

    @patch.object(
        app,
        "accommodation_location_point",
        side_effect=lambda query, *args, **kwargs: (
            {"label": "Parker, CO", "lat": 39.5186, "lng": -104.7614, "source": "test"}
            if "Parker" in str(query)
            else {"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "source": "test"}
        ),
    )
    def test_metro_city_search_admits_selected_suburb_listing_with_missing_coordinates(self, _mock_point):
        self.insert_post(
            "FFH-B854C0F7",
            "PG Room is available",
            "Parker, CO",
            "Black Rose Circle",
            0,
            0,
        )

        results = app.mobile_housing_posts(
            city="Denver, CO",
            area="Parker, CO",
            need="need_place",
            radius=25,
            limit=30,
        )

        listing = next(item for item in results if item["id"] == "FFH-B854C0F7")
        self.assertTrue(listing["locationApproximate"])
        self.assertAlmostEqual(listing["lat"], 39.5186, places=4)
        self.assertLessEqual(listing["distanceMiles"], 25)

    @patch.object(
        app,
        "accommodation_location_point",
        side_effect=lambda query, *args, **kwargs: (
            {"label": "Parker, CO", "lat": 39.5186, "lng": -104.7614, "source": "test"}
            if "Parker" in str(query)
            else {"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "source": "test"}
        ),
    )
    def test_city_radius_search_includes_nearby_suburb_without_city_text_match(self, _mock_point):
        self.insert_post(
            "PARKER-IN-DENVER-RADIUS",
            "Parker room inside Denver radius",
            "Parker, CO",
            "Black Rose Circle",
            0,
            0,
        )

        results = app.mobile_housing_posts(
            city="Denver, CO",
            need="need_place",
            radius=60,
            limit=30,
            center_lat=39.7392,
            center_lng=-104.9903,
        )

        listing = next(item for item in results if item["id"] == "PARKER-IN-DENVER-RADIUS")
        self.assertTrue(listing["locationApproximate"])
        self.assertLessEqual(listing["distanceMiles"], 60)

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

        def google_response(url, *args, **kwargs):
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
        self.assertTrue(all("posterEmail" not in item for item in results))
        self.assertTrue(all(item.get("posterUserId") == self.sample_owner_id for item in results[1:]))
        self.assertLessEqual(results[0]["distanceMiles"], 10)

    @patch.object(
        app,
        "accommodation_location_point",
        return_value={"label": "Madison, WI", "lat": 43.0731, "lng": -89.4012, "source": "test"},
    )
    def test_empty_location_returns_ten_local_contactable_seeded_posts(self, _mock_point):
        profile_photo = "https://cdn.example.test/sample-owner-current.jpg"
        with app.db() as con:
            con.execute("UPDATE users SET profile_photo_url = ? WHERE id = ?", (profile_photo, self.sample_owner_id))
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
        self.assertTrue(all("posterEmail" not in item for item in results))
        self.assertTrue(all(item["posterUserId"] == self.sample_owner_id for item in results))
        self.assertTrue(all(item["photoUrl"] == profile_photo for item in results))
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

    def test_popular_ride_cities_stay_inside_selected_country(self):
        origin = {
            "address_components": [
                {"long_name": "India", "short_name": "IN", "types": ["country"]}
            ]
        }
        places = {
            "status": "OK",
            "results": [
                {"name": "Pune", "formatted_address": "Pune, Maharashtra, India", "types": ["locality"], "geometry": {"location": {"lat": 18.5204, "lng": 73.8567}}, "photos": [{"photo_reference": "pune-photo-ref"}]},
                {"name": "Dubai", "formatted_address": "Dubai, United Arab Emirates", "types": ["locality"], "geometry": {"location": {"lat": 25.2048, "lng": 55.2708}}},
                {"name": "Gateway of India", "formatted_address": "Mumbai, India", "types": ["tourist_attraction"], "geometry": {"location": {"lat": 18.9219, "lng": 72.8347}}},
            ],
        }
        def google_response(url, *args, **kwargs):
            if "countriesnow.space" in url:
                return {"error": False, "data": [{"city": "Pune"}, {"city": "Dubai"}]}
            return places

        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test"}), patch.object(
            app, "google_accommodation_geocode", return_value=origin
        ), patch.object(app, "google_api_get", side_effect=google_response):
            results = app.google_ride_popular_cities("Mumbai, India")
        self.assertEqual([item["label"] for item in results], ["Pune, Maharashtra, India"])
        self.assertEqual(results[0]["imageUrl"], "/api/explorer/place-photo?ref=pune-photo-ref")

    def test_popular_ride_cities_cache_country_result(self):
        origin = {
            "address_components": [
                {"long_name": "United States", "short_name": "US", "types": ["country"]}
            ]
        }
        denver = {
            "status": "OK",
            "results": [{
                "name": "Denver", "formatted_address": "Denver, CO, USA", "types": ["locality"],
                "geometry": {"location": {"lat": 39.7392, "lng": -104.9903}},
                "photos": [{"photo_reference": "denver-photo"}],
            }],
        }
        seattle = {
            "status": "OK",
            "results": [{
                "name": "Seattle", "formatted_address": "Seattle, WA, USA", "types": ["locality"],
                "geometry": {"location": {"lat": 47.6062, "lng": -122.3321}},
                "photos": [{"photo_reference": "seattle-photo"}],
            }],
        }

        def google_response(url, *args, **kwargs):
            if "countriesnow.space" in url:
                return {"error": False, "data": [{"city": "Seattle"}]}
            if "Seattle+city" in url:
                return seattle
            if "Denver+city" in url:
                return denver
            return {"status": "ZERO_RESULTS", "results": []}

        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test"}), patch.object(
            app, "google_accommodation_geocode", return_value=origin
        ), patch.object(app, "google_api_get", side_effect=google_response) as google_call:
            results = app.google_ride_popular_cities("Denver, CO")
            first_call_count = google_call.call_count
            cached_results = app.google_ride_popular_cities("Denver, CO")
        self.assertIn("Seattle, WA, USA", [item["label"] for item in results])
        self.assertEqual(results, cached_results)
        self.assertEqual(google_call.call_count, first_call_count)

    def test_popular_ride_cities_prefer_population_ranked_dynamic_source(self):
        origin = {
            "address_components": [
                {"long_name": "United States", "short_name": "US", "types": ["country"]}
            ]
        }
        new_york = {
            "status": "OK",
            "results": [{
                "name": "New York", "formatted_address": "New York, NY, USA", "types": ["locality"],
                "geometry": {"location": {"lat": 40.7128, "lng": -74.006}},
                "photos": [{"photo_reference": "new-york-photo"}],
            }],
        }

        def google_response(url, *args, **kwargs):
            if "countriesnow.space" in url:
                return {"error": False, "data": [{"city": "New York (NY)"}]}
            if "New+York+city" in url:
                return new_york
            return {"status": "ZERO_RESULTS", "results": []}

        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test"}), patch.object(
            app, "google_accommodation_geocode", return_value=origin
        ), patch.object(app, "google_api_get", side_effect=google_response) as google_call:
            results = app.google_ride_popular_cities("Denver, CO")
        self.assertIn("New York, NY, USA", [item["label"] for item in results])
        self.assertFalse(any("/autocomplete/" in call.args[0] for call in google_call.call_args_list))

    def test_housing_rent_uses_location_country_currency(self):
        india = {"city_area_zip": "Mumbai, Maharashtra, India", "rent_min": 18000, "rent_max": 24000, "rent_period": "MONTH"}
        us = {"city_area_zip": "Denver, CO", "rent_min": 900, "rent_max": 1200, "rent_period": "MONTH"}
        self.assertEqual(app.format_accommodation_rent(india), "₹18,000-₹24,000 / monthly")
        self.assertEqual(app.format_accommodation_rent(us), "$900-$1,200 / monthly")

    def test_india_sample_housing_uses_rupees(self):
        result = app.mobile_sample_housing_posts(city="Bengaluru, India", limit=1)[0]
        self.assertTrue(str(result["rent"]).startswith("₹"))
        self.assertEqual(result["country"], "IN")
        self.assertEqual(result["currencyCode"], "INR")

    def test_listing_country_is_structured_and_drives_payload_currency(self):
        with app.db() as con:
            columns = {row["name"] for row in con.execute("PRAGMA table_info(accommodation_posts)").fetchall()}
        self.assertIn("country", columns)
        self.insert_filter_post("FFH-IN-COUNTRY", city="Mumbai, India", rent_min=18000)
        with app.db() as con:
            con.execute("UPDATE accommodation_posts SET country = 'IN' WHERE public_id = 'FFH-IN-COUNTRY'")
            row = con.execute(
                """
                SELECT accommodation_posts.*, users.name AS owner_name, '' AS preview_image_url
                FROM accommodation_posts LEFT JOIN users ON users.id = accommodation_posts.user_id
                WHERE public_id = 'FFH-IN-COUNTRY'
                """
            ).fetchone()
        payload = app.mobile_housing_post_payload(row)
        self.assertEqual(payload["country"], "IN")
        self.assertEqual(payload["currencySymbol"], "₹")
        self.assertIn("₹18,000", str(payload["rent"]))

    def test_housing_feed_is_isolated_by_stored_country(self):
        with app.db() as con:
            india_metro = app.upsert_accommodation_metro(con, "Kamareddy", country="IN", state="Telangana", center_city="Kamareddy")
            app.upsert_accommodation_local_area(con, india_metro, "Kamareddy, Telangana, India", city="Kamareddy", state="Telangana")
            us_metro = app.upsert_accommodation_metro(con, "Denver Metro Area", country="US", state="CO", center_city="Denver")
            app.upsert_accommodation_local_area(con, us_metro, "Denver, CO", city="Denver", state="CO")
        self.insert_filter_post("FFH-IN-ONLY", city="Kamareddy", rent_min=18000)
        self.insert_filter_post("FFH-US-ONLY", city="Denver", rent_min=900)
        with app.db() as con:
            con.execute("UPDATE accommodation_posts SET country = 'IN' WHERE public_id = 'FFH-IN-ONLY'")
            con.execute("UPDATE accommodation_posts SET country = 'US' WHERE public_id = 'FFH-US-ONLY'")
        india_ids = {item["id"] for item in app.mobile_housing_posts(city="Kamareddy", limit=30)}
        denver_ids = {item["id"] for item in app.mobile_housing_posts(city="Denver", limit=30)}
        self.assertIn("FFH-IN-ONLY", india_ids)
        self.assertNotIn("FFH-US-ONLY", india_ids)
        self.assertIn("FFH-US-ONLY", denver_ids)
        self.assertNotIn("FFH-IN-ONLY", denver_ids)

    def test_housing_country_isolation_supports_countries_without_hardcoded_hints(self):
        with app.db() as con:
            china_metro = app.upsert_accommodation_metro(con, "Shanghai", country="CN", center_city="Shanghai")
            app.upsert_accommodation_local_area(con, china_metro, "Shanghai, China", city="Shanghai")
            turkey_metro = app.upsert_accommodation_metro(con, "Istanbul", country="TR", center_city="Istanbul")
            app.upsert_accommodation_local_area(con, turkey_metro, "Istanbul, Turkey", city="Istanbul")
        self.insert_filter_post("FFH-CN-ONLY", city="Shanghai", rent_min=6000)
        self.insert_filter_post("FFH-TR-ONLY", city="Istanbul", rent_min=20000)
        with app.db() as con:
            con.execute("UPDATE accommodation_posts SET country = 'CN' WHERE public_id = 'FFH-CN-ONLY'")
            con.execute("UPDATE accommodation_posts SET country = 'TR' WHERE public_id = 'FFH-TR-ONLY'")
        china_ids = {item["id"] for item in app.mobile_housing_posts(city="Shanghai, China", limit=30)}
        turkey_ids = {item["id"] for item in app.mobile_housing_posts(city="Istanbul, Turkey", limit=30)}
        self.assertIn("FFH-CN-ONLY", china_ids)
        self.assertNotIn("FFH-TR-ONLY", china_ids)
        self.assertIn("FFH-TR-ONLY", turkey_ids)
        self.assertNotIn("FFH-CN-ONLY", turkey_ids)

    def test_unresolved_housing_country_fails_closed(self):
        self.insert_filter_post("FFH-STRUCTURED-US", city="Denver", rent_min=900)
        with app.db() as con:
            con.execute("UPDATE accommodation_posts SET country = 'US' WHERE public_id = 'FFH-STRUCTURED-US'")
        with patch.object(app, "cached_accommodation_country_for_place", return_value=""), patch.object(
            app, "google_accommodation_geocode", return_value=None
        ):
            self.assertEqual(app.mobile_housing_posts(city="Unknown place", limit=30), [])

    def test_city_only_ride_fallback_never_injects_denver_landmarks(self):
        with patch.object(app, "google_ride_popular_cities", return_value=[]), patch.object(
            app, "ride_point", return_value={"label": "Mumbai, India", "lat": 19.076, "lng": 72.8777}
        ):
            results = app.ride_place_suggestions("Mumbai, India", "", cities_only=True)
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
