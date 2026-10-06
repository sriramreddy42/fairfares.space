import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import Mock, patch

import app


class GooglePlacesDiagnosticsTest(unittest.TestCase):
    def setUp(self):
        app._GOOGLE_PLACES_ISSUE_LOGGED_AT.clear()

    def tearDown(self):
        app._GOOGLE_PLACES_ISSUE_LOGGED_AT.clear()

    def test_text_search_uses_places_new_only_for_one_submitted_location(self):
        payload = {
            "places": [{
                "formattedAddress": "Union Station, Denver, CO, USA",
                "location": {"latitude": 39.7527, "longitude": -105.0002},
            }]
        }
        with patch.dict(app.os.environ, {"FAIRFARES_ENABLE_GOOGLE_LOCATION_FALLBACK": "1", "GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "accommodation_location_point", return_value={}
        ), patch.object(app, "google_api_post_json", return_value=payload) as request:
            result = app.google_ride_place_text_search("Denver, CO", "Union Station")

        self.assertEqual((result["lat"], result["lng"]), (39.7527, -105.0002))
        self.assertEqual(request.call_count, 1)
        url, body, headers = request.call_args.args[:3]
        self.assertEqual(url, "https://places.googleapis.com/v1/places:searchText")
        self.assertEqual(body["textQuery"], "Union Station")
        self.assertEqual(headers["X-Goog-FieldMask"], "places.formattedAddress,places.location")
        self.assertNotIn("private-key", str(body))

    def test_text_search_only_runs_after_exact_resolution_and_not_while_typing(self):
        with patch.object(app, "google_ride_place_text_search", return_value={}) as search:
            app.ride_place_suggestions("Denver, CO", "Arapahoe", resolve_exact=False)
        search.assert_not_called()

        resolved = {"label": "Arapahoe Road, Centennial, CO", "lat": 39.5801, "lng": -104.8762}
        with patch.object(app, "ride_point", return_value={}), patch.object(
            app, "ride_known_popular_cities", return_value=[]
        ), patch.object(app, "google_ride_place_text_search", return_value=resolved) as search:
            result = app.ride_place_suggestions("Denver, CO", "Arapahoe Road", resolve_exact=True)
        search.assert_called_once_with("Denver, CO", "Arapahoe Road", use_city_bias=True)
        self.assertEqual((result[0]["lat"], result[0]["lng"]), (39.5801, -104.8762))

    def test_text_search_does_not_use_general_maps_key(self):
        with patch.dict(
            app.os.environ,
            {"FAIRFARES_ENABLE_GOOGLE_LOCATION_FALLBACK": "1", "GOOGLE_PLACES_API_KEY": "", "GOOGLE_MAPS_API_KEY": "maps-only-key"},
            clear=False,
        ), patch.object(app, "google_api_post_json", side_effect=AssertionError("Places must not be called")) as request:
            result = app.google_ride_place_text_search("Denver, CO", "Union Station")
        self.assertEqual(result, {})
        request.assert_not_called()

    def test_text_search_denial_logs_status_not_key_or_location(self):
        failure = app.GoogleApiError("authorization", 403, "API key private-key has a referrer restriction for Dayton")
        with patch.dict(app.os.environ, {"FAIRFARES_ENABLE_GOOGLE_LOCATION_FALLBACK": "1", "GOOGLE_PLACES_API_KEY": "private-key"}), patch.object(
            app, "google_api_post_json", side_effect=failure
        ), patch("builtins.print") as log:
            self.assertEqual(app.google_ride_place_text_search("San Francisco, CA", "Dayton"), {})
        line = log.call_args.args[0]
        self.assertIn("status=HTTP_403", line)
        self.assertIn("category=key_restriction", line)
        self.assertNotIn("private-key", line)
        self.assertNotIn("Dayton", line)

    def test_issue_logging_is_rate_limited_but_first_event_is_not_suppressed(self):
        with patch.object(app.time, "monotonic", side_effect=[10, 20, 71]), patch("builtins.print") as log:
            app.log_google_places_issue("search", "ZERO_RESULTS")
            app.log_google_places_issue("search", "ZERO_RESULTS")
            app.log_google_places_issue("search", "ZERO_RESULTS")
        self.assertEqual(log.call_count, 2)

    def test_listing_city_rail_avoids_google_when_local_listings_fill_it(self):
        local_cities = [
            {"label": f"City {index}, USA", "lat": 30 + index, "lng": -90 - index, "imageUrl": ""}
            for index in range(8)
        ]
        with patch.object(app, "ride_listing_popular_cities", return_value=local_cities), patch.object(
            app, "google_api_post_json", side_effect=AssertionError("Google must not be called")
        ):
            cities = app.google_ride_popular_cities("Denver, CO", limit=8)
        self.assertEqual(cities, local_cities)

    def test_mobile_city_rail_path_never_reaches_google(self):
        with patch.object(app, "ride_listing_popular_cities", return_value=[]), patch.object(
            app, "google_api_post_json", side_effect=AssertionError("Google must not be called")
        ):
            suggestions = app.ride_place_suggestions("Denver, CO", "", cities_only=True)
        self.assertEqual(len(suggestions), 4)
        self.assertTrue(all(item["source"] == "static-popular" for item in suggestions))

    def test_places_service_is_declared_only_for_carpool_text_resolution(self):
        source = Path(app.__file__).read_text(encoding="utf-8")
        self.assertEqual(source.count("https://places.googleapis.com/"), 1)
        self.assertIn("https://places.googleapis.com/v1/places:searchText", source)
        self.assertNotIn("places.googleapis.com/v1/places:searchNearby", source)

    def test_exact_resolution_is_rate_limited_before_places_can_run(self):
        handler = object.__new__(app.FairFaresHandler)
        handler.headers = {}
        handler.client_address = ("127.0.0.1", 12345)
        handler.send_json = Mock()
        handler.request_rate_limit_identity = Mock(return_value="guest")
        parsed = urllib.parse.urlparse("/api/mobile/ride-places?city=Denver%2C%20CO&q=Unknown%20Address&resolve=1")
        with patch.object(app, "api_rate_limit_retry_after", return_value=8), patch.object(
            app, "ride_place_suggestions", side_effect=AssertionError("Places resolution must not run after a rate limit")
        ):
            handler.api_mobile_ride_places(parsed)
        payload, status, headers = handler.send_json.call_args.args
        self.assertEqual(status, 429)
        self.assertTrue(payload["retryable"])
        self.assertEqual(headers["Retry-After"], "8")


if __name__ == "__main__":
    unittest.main()
