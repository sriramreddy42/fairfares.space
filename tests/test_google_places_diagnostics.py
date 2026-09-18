import unittest
import urllib.error
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


if __name__ == "__main__":
    unittest.main()
