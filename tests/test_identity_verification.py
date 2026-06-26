import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app


class IdentityVerificationTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "1"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, phone, password_hash, is_verified)
                VALUES ('Identity Tester', 'identity@example.com', '5551237777', ?, 1)
                """,
                (app.hash_password("Password123!"),),
            )
            self.user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        car = app.get_cars()[0]
        self.booking = app.create_booking_for_user(self.user_id, car["id"], days=2)

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

    def test_save_stripe_identity_session_result(self):
        session = {
            "id": "vs_test_123",
            "status": "verified",
            "metadata": {
                "user_id": str(self.user_id),
                "booking_id": str(self.booking["id"]),
                "public_booking_id": self.booking["booking_id"],
            },
            "verified_outputs": {
                "first_name": "Identity",
                "last_name": "Tester",
                "dob": "2000-01-02",
                "address": {
                    "line1": "1665 Logan St",
                    "city": "Denver",
                    "state": "CO",
                    "postal_code": "80203",
                    "country": "US",
                },
            },
        }

        app.save_identity_verification_from_session(session)

        row = app.latest_identity_verification(self.user_id, int(self.booking["id"]))
        self.assertIsNotNone(row)
        self.assertEqual(row["provider"], "STRIPE_IDENTITY")
        self.assertEqual(row["provider_session_id"], "vs_test_123")
        self.assertEqual(row["status"], "VERIFIED")
        self.assertEqual(row["verified_name"], "Identity Tester")
        self.assertEqual(row["verified_dob"], "2000-01-02")
        self.assertIn("1665 Logan St", row["verified_address"])

    def test_identity_status_copy_and_external_status_are_honest(self):
        title, body = app.identity_status_copy("PENDING")
        self.assertIn("not verified", title.lower())
        self.assertIn("Stripe Identity", body)

        external_title, external_body = app.external_identity_status_copy(None)
        self.assertIn("not configured", external_title.lower())
        self.assertIn("Entrust", external_body)
        self.assertIn("IDScan.net", external_body)

    def test_idscan_result_parser_is_strict(self):
        status, summary = app.parse_idscan_result(
            {
                "documentValid": True,
                "ocrSuccessful": True,
                "expired": False,
                "faceMatch": True,
                "dmvMatch": True,
            }
        )
        self.assertEqual(status, "VERIFIED")
        self.assertIn("dmvMatch=True", summary)

        status, summary = app.parse_idscan_result(
            {
                "documentValid": True,
                "ocrSuccessful": True,
                "expired": True,
            }
        )
        self.assertEqual(status, "FAILED")
        self.assertIn("expired=True", summary)

        status, _summary = app.parse_idscan_result({"ocrSuccessful": True})
        self.assertEqual(status, "REVIEW_REQUIRED")

    def test_idscan_not_configured_is_logged_without_network_call(self):
        with mock.patch.object(app, "idscan_api_key", return_value=""), mock.patch.object(app, "idscan_verify_url", return_value=""):
            ok, status, message = app.run_idscan_verification(
                self.user_id,
                int(self.booking["id"]),
                "data:image/jpeg;base64,front",
                "data:image/jpeg;base64,back",
                self.user_id,
            )

        self.assertFalse(ok)
        self.assertEqual(status, "NOT_CONFIGURED")
        self.assertIn("IDSCAN_API_KEY", message)
        row = app.latest_external_identity_check(self.user_id, int(self.booking["id"]))
        self.assertIsNotNone(row)
        self.assertEqual(row["provider"], "IDSCAN")
        self.assertEqual(row["status"], "NOT_CONFIGURED")

    def test_frontend_and_routes_include_identity_providers(self):
        js = Path("static/js/app.js").read_text()
        py = Path("app.py").read_text()
        self.assertIn("/identity/stripe-session", js)
        self.assertIn("stripeIdentityButton", js)
        self.assertIn("/identity/stripe-session", py)
        self.assertIn("identity.verification_session.", py)
        self.assertIn("/admin/identity/stripe-session", js)
        self.assertIn("/admin/identity/stripe-session", py)
        self.assertIn("data-admin-stripe-identity-button", py)
        self.assertIn("Stripe Identity at pickup", py)
        self.assertIn("Staff will start Stripe Identity during pickup", py)
        self.assertIn("/admin/identity/idscan", js)
        self.assertIn("/admin/identity/idscan", py)
        self.assertIn("data-idscan-check-button", py)
        self.assertIn("IDSCAN_API_KEY", py)
        self.assertIn("IDSCAN_VERIFY_URL", py)


if __name__ == "__main__":
    unittest.main()
