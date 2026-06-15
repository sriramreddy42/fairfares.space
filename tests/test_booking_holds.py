import os
import tempfile
import unittest
from pathlib import Path

import app


class BookingHoldTest(unittest.TestCase):
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
                VALUES ('Hold Tester', 'hold@example.com', '5551234567', ?, 1)
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

    def test_select_creates_pending_hold_with_daily_rate_pricing(self):
        car = app.get_cars()[0]

        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)

        expected = app.rental_price_breakdown(car["daily_price"], 3, 0)
        self.assertEqual(booking["booking_status"], "PENDING_HOLD")
        self.assertEqual(booking["payment_status"], "HOLD_PENDING")
        self.assertEqual(booking["status"], "PENDING_HOLD")
        self.assertAlmostEqual(float(booking["subtotal_price"]), float(expected["base"]))
        self.assertAlmostEqual(float(booking["total_price"]), float(expected["total"]))
        self.assertAlmostEqual(float(booking["booking_hold_amount"]), float(expected["booking_hold"]))
        self.assertIsNotNone(booking["hold_expires_at"])

        held_car = app.get_car(car["id"])
        self.assertEqual(held_car["status"], "HOLD")

    def test_expired_hold_releases_car(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=2)

        with app.db() as con:
            con.execute(
                "UPDATE bookings SET hold_expires_at = datetime('now', '-1 minute') WHERE id = ?",
                (booking["id"],),
            )

        app.expire_stale_booking_holds()

        refreshed = app.get_booking_for_user(self.user_id)
        released_car = app.get_car(car["id"])
        self.assertEqual(refreshed["booking_status"], "EXPIRED_HOLD")
        self.assertEqual(refreshed["payment_status"], "HOLD_EXPIRED")
        self.assertEqual(released_car["status"], "AVAILABLE")

    def test_customer_checkout_labels_are_clean(self):
        self.assertEqual(app.booking_status_label("PENDING_HOLD", "HOLD_PENDING"), "Payment window")
        self.assertEqual(app.booking_status_label("EXPIRED_HOLD", "HOLD_EXPIRED"), "Expired")
        self.assertEqual(app.payment_status_label("HOLD_PENDING"), "Payment pending")
        self.assertEqual(app.payment_status_label("HOLD_PAID"), "10% paid")

    def test_checkout_timer_frontend_hook_exists(self):
        js = Path("static/js/app.js").read_text()
        self.assertIn("startBookingCountdown", js)
        self.assertIn("data-hold-seconds", js)
        self.assertIn("Complete payment in", Path("app.py").read_text())


if __name__ == "__main__":
    unittest.main()
