import os
import json
import re
from pathlib import Path
import unittest

import app


class SocialAuthConfigTest(unittest.TestCase):
    def test_render_allows_every_google_client_used_by_android(self):
        root = Path(__file__).resolve().parents[1]
        google_services = json.loads((root / "mobile" / "google-services.json").read_text())
        android_clients = {
            oauth["client_id"]
            for client in google_services.get("client", [])
            if client.get("client_info", {}).get("android_client_info", {}).get("package_name") == "com.fairfares.mobile"
            for oauth in client.get("oauth_client", [])
            if oauth.get("client_type") in {1, 3} and oauth.get("client_id")
        }
        render_config = (root / "render.yaml").read_text()
        match = re.search(r"- key: GOOGLE_OAUTH_CLIENT_IDS\s+value: [\"']([^\"']+)[\"']", render_config)
        website_match = re.search(r"- key: GOOGLE_WEB_CLIENT_ID\s+value: [\"']([^\"']+)[\"']", render_config)

        self.assertTrue(android_clients, "FairFares Android has no Google OAuth clients configured")
        self.assertIsNotNone(match, "Render must explicitly declare the Google OAuth audience allow-list")
        render_clients = {value.strip() for value in match.group(1).split(",") if value.strip()}
        self.assertTrue(
            android_clients.issubset(render_clients),
            "Render's Google audience allow-list drifted from mobile/google-services.json",
        )
        self.assertIsNotNone(website_match, "Render must explicitly preserve the website Google client")
        self.assertTrue(website_match.group(1).endswith(".apps.googleusercontent.com"))
        self.assertNotIn(website_match.group(1), android_clients)

    def test_owned_apple_bundle_ids_survive_stale_environment_override(self):
        previous = os.environ.get("APPLE_SIGN_IN_CLIENT_IDS")
        os.environ["APPLE_SIGN_IN_CLIENT_IDS"] = "com.example.stale"
        try:
            allowed = app.configured_apple_client_ids()
        finally:
            if previous is None:
                os.environ.pop("APPLE_SIGN_IN_CLIENT_IDS", None)
            else:
                os.environ["APPLE_SIGN_IN_CLIENT_IDS"] = previous

        self.assertIn("com.fairfares.mobile", allowed)
        self.assertIn("com.fairfares.app", allowed)
        self.assertIn("com.example.stale", allowed)

    def test_apple_audience_error_identifies_received_app(self):
        # The audience is not a secret; surfacing it makes App Store/EAS bundle
        # mismatches actionable without exposing the identity token.
        claims = {"aud": "com.fairfares.unexpected"}
        audience = app.clean_text_value(claims.get("aud"), 200)
        message = f"Apple sign-in audience '{audience or 'missing'}' is not configured for this FairFares app."
        self.assertIn("com.fairfares.unexpected", message)

    def test_email_recovery_hint_never_exposes_full_address(self):
        hint = app.masked_email_hint("person@example.com")
        self.assertEqual(hint, "pe***on@example.com")
        self.assertNotIn("person", hint)

    def test_gmail_recovery_hint_is_recognizable_but_masked(self):
        hint = app.masked_email_hint("sriramreddy42@gmail.com")
        self.assertEqual(hint, "sr***42@gmail.com")
        self.assertNotIn("sriramreddy42", hint)


if __name__ == "__main__":
    unittest.main()
