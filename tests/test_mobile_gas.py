import os
import unittest
import urllib.parse
from unittest.mock import patch

import app


class MobileGasPriceTests(unittest.TestCase):
    def make_handler(self):
        handler = object.__new__(app.FairFaresHandler)
        handler.headers = {}
        handler.client_address = ("127.0.0.1", 12345)
        handler.send_json = unittest.mock.Mock()
        return handler

    def test_endpoint_converts_provider_failure_to_json(self):
        handler = self.make_handler()
        parsed = urllib.parse.urlparse(
            "/api/mobile/gas-prices?lat=39.7392&lng=-104.9903&radiusMiles=10&fuel=regular"
        )
        with patch.object(app, "api_rate_limit_retry_after", return_value=0), patch.object(
            app, "google_nearby_gas_prices", side_effect=app.requests.ConnectionError("provider reset")
        ):
            handler.api_mobile_gas_prices(parsed)
        payload, status = handler.send_json.call_args.args[:2]
        self.assertEqual(status, 502)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["stations"], [])

    def test_google_post_uses_bounded_requests_transport(self):
        response = unittest.mock.Mock()
        response.json.return_value = {"places": []}
        with patch.object(app.requests, "post", return_value=response) as post:
            result = app.google_api_post_json(
                "https://places.googleapis.com/v1/places:searchNearby",
                {"includedTypes": ["gas_station"]},
                {"X-Goog-Api-Key": "test-key"},
                timeout=3.5,
            )
        self.assertEqual(result, {"places": []})
        response.raise_for_status.assert_called_once_with()
        self.assertEqual(post.call_args.kwargs["timeout"], 3.5)
        self.assertEqual(post.call_args.kwargs["json"]["includedTypes"], ["gas_station"])

    def test_normalizes_requested_fuel_price_and_distance(self):
        station = app.normalize_google_gas_station(
            {
                "id": "station-1",
                "displayName": {"text": "Neighborhood Fuel"},
                "formattedAddress": "123 Main St, Denver, CO",
                "location": {"latitude": 39.7395, "longitude": -104.9901},
                "fuelOptions": {
                    "fuelPrices": [
                        {"type": "PREMIUM", "price": {"currencyCode": "USD", "units": "4", "nanos": 199_000_000}},
                        {"type": "REGULAR_UNLEADED", "price": {"currencyCode": "USD", "units": "3", "nanos": 159_000_000}, "updateTime": "2026-08-26T12:00:00Z"},
                    ]
                },
                "googleMapsUri": "https://maps.google.com/example",
            },
            39.7392,
            -104.9903,
            "REGULAR_UNLEADED",
        )
        self.assertIsNotNone(station)
        self.assertEqual(station["name"], "Neighborhood Fuel")
        self.assertEqual(station["price"], 3.159)
        self.assertEqual(station["currency"], "USD")
        self.assertLess(station["distanceMiles"], 0.1)

    def test_nearby_search_sorts_prices_without_storing_places_content(self):
        response = {
            "places": [
                {"id": "high", "displayName": {"text": "High"}, "formattedAddress": "A", "location": {"latitude": 39.74, "longitude": -104.99}, "fuelOptions": {"fuelPrices": [{"type": "REGULAR_UNLEADED", "price": {"currencyCode": "USD", "units": "4"}}]}},
                {"id": "low", "displayName": {"text": "Low"}, "formattedAddress": "B", "location": {"latitude": 39.75, "longitude": -104.98}, "fuelOptions": {"fuelPrices": [{"type": "REGULAR_UNLEADED", "price": {"currencyCode": "USD", "units": "3", "nanos": 100_000_000}}]}},
                {"id": "unknown", "displayName": {"text": "Unknown"}, "formattedAddress": "C", "location": {"latitude": 39.76, "longitude": -104.97}},
            ]
        }
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test-key"}), patch.object(app, "google_api_post_json", return_value=response) as request:
            first = app.google_nearby_gas_prices(39.7392, -104.9903, 10, "regular")
            second = app.google_nearby_gas_prices(39.7392, -104.9903, 10, "regular")
        self.assertEqual([row["id"] for row in first["stations"]], ["low", "high", "unknown"])
        self.assertNotIn("cache", first)
        self.assertNotIn("cache", second)
        self.assertEqual(request.call_count, 2)
        headers = request.call_args.args[2]
        self.assertIn("places.fuelOptions", headers["X-Goog-FieldMask"])

    def test_twenty_five_mile_search_does_not_silently_shrink_radius(self):
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "test-key"}), patch.object(app, "google_api_post_json", return_value={"places": []}) as request:
            app.google_nearby_gas_prices(39.7392, -104.9903, 25, "regular")
        radius = request.call_args.args[1]["locationRestriction"]["circle"]["radius"]
        self.assertAlmostEqual(radius, 25 * 1609.344)

    def test_missing_key_returns_safe_unconfigured_payload(self):
        with patch.dict(os.environ, {"GOOGLE_PLACES_API_KEY": "", "GOOGLE_MAPS_API_KEY": ""}, clear=False):
            result = app.google_nearby_gas_prices(39.7392, -104.9903, 10, "regular")
        self.assertFalse(result["configured"])
        self.assertEqual(result["stations"], [])


if __name__ == "__main__":
    unittest.main()
