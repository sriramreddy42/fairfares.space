import os
import tempfile
import unittest
from pathlib import Path

import app


class RentalAgreementTest(unittest.TestCase):
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
                INSERT INTO users (name, email, phone, address, password_hash, is_verified)
                VALUES ('Agreement Tester', 'agreement@example.com', '5558889999', '1665 Logan St, Denver, CO', ?, 1)
                """,
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

    def test_generated_rental_agreement_includes_master_terms_and_booking_facts(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(
            self.user_id,
            car["id"],
            days=3,
            pickup_date="2026-07-02",
            return_date="2026-07-05",
            pickup_location="1665 Logan St, Denver, CO",
            return_location="1665 Logan St, Denver, CO",
        )
        admin_booking = next(row for row in app.get_admin_bookings() if int(row["id"]) == int(booking["id"]))
        values = app.agreement_default_values(admin_booking)

        text = app.build_rental_agreement_text(admin_booking, values)

        self.assertIn("FAIRFARES VEHICLE RENTAL AGREEMENT", text)
        self.assertIn(f"Booking ID: {booking['booking_id']}", text)
        self.assertIn("GOVERNING LAW (COLORADO)", text)
        self.assertIn("STRIPE PAYMENT AUTHORIZATION", text)
        self.assertIn("GPS / VEHICLE TRACKING DISCLOSURE", text)
        self.assertIn("AI AND IDENTITY VERIFICATION", text)
        self.assertIn("PICKUP CHECKLIST", text)
        self.assertIn("RETURN CHECKLIST", text)
        self.assertIn("valid auto insurance policy that extends coverage to rental vehicles", text)
        self.assertIn("Security Deposit/Authorization: $250.00", text)
        self.assertIn("Deposit Status:", text)
        self.assertIn("Return Review Status:", text)
        self.assertIn("Post-return Charge Review:", text)
        self.assertIn("release the authorization after the Vehicle is returned and reviewed", text)
        self.assertIn("Minimum inspection photos should include", text)
        self.assertIn("Current post-return fee defaults:", text)
        self.assertIn("Cleaning fee: $50.00", text)
        self.assertIn("Smoking fee: $200.00", text)
        self.assertIn("deposit release/capture decision", text)
        self.assertNotIn("laws of Texas", text)

    def test_agreement_customer_flow_routes_and_split_fields_exist(self):
        py = Path("app.py").read_text()
        css = Path("static/css/sections/20-admin.css").read_text()
        customer_fields = app.render_agreement_fields_for_role(
            {
                "lessee_name": "Agreement Tester",
                "customer_signature": "Agreement Tester",
                "issuer_name": "FairFares Rep",
            },
            "customer",
        )
        issuer_fields = app.render_agreement_fields_for_role(
            {
                "lessee_name": "Agreement Tester",
                "issuer_name": "FairFares Rep",
            },
            "issuer",
        )

        self.assertIn("/admin/agreement/customer", py)
        self.assertIn("Open customer form", py)
        self.assertIn("electronic_consent", py)
        self.assertIn("agreement-customer-page", css)
        self.assertIn("agreement_lessee_name", customer_fields)
        self.assertIn("agreement_customer_signature", customer_fields)
        self.assertNotIn("agreement_issuer_name", customer_fields)
        self.assertIn("agreement_issuer_name", issuer_fields)
        self.assertNotIn("agreement_lessee_name", issuer_fields)

    def test_customer_agreement_page_renders_for_admin(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=2)

        class TestHandler(app.FairFaresHandler):
            def __init__(self):
                pass

            def require_admin(self):
                with app.db() as con:
                    return con.execute("SELECT * FROM users WHERE email = ?", (app.DEFAULT_ADMIN_EMAIL,)).fetchone()

            def send_html(self, body, status=200):
                self.rendered_body = body.decode("utf-8") if isinstance(body, bytes) else body
                self.rendered_status = status

            def not_found(self):
                self.rendered_body = "not found"
                self.rendered_status = 404

        handler = TestHandler()
        handler.path = f"/admin/agreement/customer?booking_id={booking['id']}"
        handler.admin_customer_agreement_page()

        self.assertEqual(handler.rendered_status, 200)
        self.assertIn("Customer form", handler.rendered_body)
        self.assertIn("electronic_consent", handler.rendered_body)


if __name__ == "__main__":
    unittest.main()
