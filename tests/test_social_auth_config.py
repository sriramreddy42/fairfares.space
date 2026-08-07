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


if __name__ == "__main__":
    unittest.main()
