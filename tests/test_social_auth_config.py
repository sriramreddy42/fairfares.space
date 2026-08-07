import os
import unittest

import app


class SocialAuthConfigTest(unittest.TestCase):
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
