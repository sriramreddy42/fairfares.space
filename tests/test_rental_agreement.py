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
        self.assertNotIn("laws of Texas", text)


if __name__ == "__main__":
    unittest.main()
