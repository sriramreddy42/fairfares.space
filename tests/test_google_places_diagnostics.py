import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

import app


class GooglePlacesDiagnosticsTest(unittest.TestCase):
    def setUp(self):
        app._GOOGLE_PLACES_ISSUE_LOGGED_AT.clear()

    def tearDown(self):
        app._GOOGLE_PLACES_ISSUE_LOGGED_AT.clear()

    def test_autocomplete_denial_logs_status_not_key_or_search(self):
        payload = {
            "status": "REQUEST_DENIED",
            "error_message": "API key private-key has a referrer restriction for Dayton",
        }
        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_accommodation_geocode", return_value=None
        ), patch.object(app, "google_api_get", return_value=payload), patch("builtins.print") as log:
            self.assertEqual(app.google_accommodation_place_predictions("San Francisco, CA", "Dayton"), [])
        line = log.call_args.args[0]
        self.assertIn("status=REQUEST_DENIED", line)
        self.assertIn("category=key_restriction", line)
        self.assertNotIn("private-key", line)
        self.assertNotIn("Dayton", line)

    def test_details_denial_logs_status_without_place_id(self):
        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_api_get", return_value={"status": "OVER_QUERY_LIMIT", "error_message": "billing problem"}
        ), patch("builtins.print") as log:
            self.assertEqual(app.google_ride_place_details("ChIJ1234567890Dayton"), {})
        line = log.call_args.args[0]
        self.assertIn("status=OVER_QUERY_LIMIT", line)
        self.assertIn("category=billing", line)
        self.assertNotIn("ChIJ1234567890Dayton", line)

    def test_issue_logging_is_rate_limited_but_first_event_is_not_suppressed(self):
        with patch.object(app.time, "monotonic", side_effect=[10, 20, 71]), patch("builtins.print") as log:
            app.log_google_places_issue("autocomplete", "ZERO_RESULTS")
            app.log_google_places_issue("autocomplete", "ZERO_RESULTS")
            app.log_google_places_issue("autocomplete", "ZERO_RESULTS")
        self.assertEqual(log.call_count, 2)

    def test_http_error_logs_only_status_code(self):
        error = urllib.error.HTTPError("https://example.com/?key=private-key", 403, "Forbidden Dayton", {}, None)
        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_accommodation_geocode", return_value=None
        ), patch.object(app, "google_api_get", side_effect=error), patch("builtins.print") as log:
            self.assertEqual(app.google_accommodation_place_predictions("San Francisco, CA", "Dayton"), [])
        line = log.call_args.args[0]
        self.assertIn("status=HTTP_403", line)
        self.assertNotIn("private-key", line)
        self.assertNotIn("Dayton", line)

    def test_unbiased_autocomplete_skips_unused_city_geocode(self):
        payload = {
            "status": "OK",
            "predictions": [{"description": "Denver International Airport, Denver, CO", "place_id": "ChIJDenverAirport01"}],
        }
        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_accommodation_geocode"
        ) as geocode, patch.object(app, "google_api_get", return_value=payload) as get:
            results = app.google_accommodation_place_predictions(
                "Denver, CO", "Denver International Airport", use_city_bias=False
            )
        self.assertEqual(results[0]["placeId"], "ChIJDenverAirport01")
        geocode.assert_not_called()
        self.assertNotIn("location=", get.call_args.args[0])

    def test_ride_place_session_token_pairs_autocomplete_and_selected_details(self):
        urls = []

        def google_response(url):
            urls.append(url)
            if "/autocomplete/" in url:
                return {"status": "OK", "predictions": [{"description": "Union Station, Denver, CO", "place_id": "ChIJ1234567890"}]}
            return {
                "status": "OK",
                "result": {
                    "name": "Union Station",
                    "formatted_address": "Denver, CO",
                    "geometry": {"location": {"lat": 39.7527, "lng": -105.0002}},
                },
            }

        token = "ride_abc123456789"
        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "accommodation_location_point", return_value={}
        ), patch.object(app, "google_api_get", side_effect=google_response):
            suggestions = app.google_accommodation_place_predictions("Denver, CO", "Union Station", session_token=token)
            details = app.google_ride_place_details(suggestions[0]["placeId"], token)

        self.assertEqual(details["lat"], 39.7527)
        self.assertEqual(
            [urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("sessiontoken", [""])[0] for url in urls],
            [token, token],
        )

    def test_explorer_uses_alternate_text_search_only_when_primary_has_no_stop(self):
        calls = []

        def google_response(url):
            calls.append(url)
            return {
                "status": "OK",
                "results": [{
                    "place_id": f"place-{len(calls)}",
                    "name": "Useful stop",
                    "formatted_address": "Denver, CO",
                    "geometry": {"location": {"lat": 39.7392, "lng": -104.9903}},
                }],
            }

        with patch.dict(app.os.environ, {"GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_api_get", side_effect=google_response
        ):
            app.fetch_google_explorer_stops("Denver, CO", ["Food"], 39.7392, -104.9903)

        # Food, Hidden Gems, and Surprise Me each use their primary query.
        self.assertEqual(len(calls), 3)

    def test_listing_city_rail_avoids_google_when_local_listings_fill_it(self):
        local_cities = [
            {"label": f"City {index}, USA", "lat": 30 + index, "lng": -90 - index, "imageUrl": ""}
            for index in range(8)
        ]
        with patch.object(app, "ride_listing_popular_cities", return_value=local_cities), patch.object(
            app, "google_api_get", side_effect=AssertionError("Google must not be called")
        ):
            cities = app.google_ride_popular_cities("Denver, CO", limit=8)
        self.assertEqual(cities, local_cities)

    def test_city_rail_uses_country_fallback_without_places_when_listings_are_sparse(self):
        with patch.object(app, "ride_listing_popular_cities", return_value=[]), patch.object(
            app, "google_api_get", side_effect=AssertionError("Google must not be called")
        ):
            cities = app.google_ride_popular_cities("Denver, CO", limit=4)
        self.assertEqual([city["main"] if "main" in city else city["label"].split(",", 1)[0] for city in cities], [
            "New York", "Los Angeles", "Chicago", "Denver"
        ])

    def test_mobile_city_rail_path_never_reaches_google(self):
        with patch.object(app, "ride_listing_popular_cities", return_value=[]), patch.object(
            app, "google_api_get", side_effect=AssertionError("Google must not be called")
        ):
            suggestions = app.ride_place_suggestions("Denver, CO", "", cities_only=True)
        self.assertEqual(len(suggestions), 4)
        self.assertTrue(all(item["source"] == "static-popular" for item in suggestions))

    def test_country_fallback_cards_do_not_trigger_city_photo_lookups(self):
        with patch.object(app, "google_api_get", side_effect=AssertionError("Google must not be called")):
            india = app.india_ride_popular_city_fallbacks()
            united_states = app.us_ride_popular_city_fallbacks()
        self.assertTrue(all(not place["imageUrl"] for place in india + united_states))




if __name__ == "__main__":
    unittest.main()
