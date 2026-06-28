import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
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

    def test_booking_days_are_calculated_from_selected_dates(self):
        car = app.get_cars()[0]
        pickup = date.today() + timedelta(days=5)
        return_date = pickup + timedelta(days=15)

        booking = app.create_booking_for_user(
            self.user_id,
            car["id"],
            days=10,
            pickup_date=pickup.isoformat(),
            return_date=return_date.isoformat(),
            pickup_time="10:00 AM",
            return_time="10:00 AM",
        )

        expected = app.rental_price_breakdown(car["daily_price"], 15, 0)
        self.assertEqual(booking["days"], 15)
        self.assertAlmostEqual(float(booking["subtotal_price"]), float(expected["base"]))
        self.assertAlmostEqual(float(booking["total_price"]), float(expected["total"]))

    def test_past_pickup_date_is_rejected(self):
        car = app.get_cars()[0]
        pickup = date.today() - timedelta(days=1)
        return_date = date.today() + timedelta(days=3)

        with self.assertRaises(ValueError):
            app.create_booking_for_user(
                self.user_id,
                car["id"],
                pickup_date=pickup.isoformat(),
                return_date=return_date.isoformat(),
            )

    def test_reselecting_pending_hold_refreshes_dates_and_total(self):
        car = app.get_cars()[0]
        first_pickup = date.today() + timedelta(days=4)
        first_return = first_pickup + timedelta(days=10)
        next_pickup = date.today() + timedelta(days=20)
        next_return = next_pickup + timedelta(days=15)

        first = app.ensure_booking_for_user(
            self.user_id,
            car["id"],
            days=10,
            pickup_date=first_pickup.isoformat(),
            return_date=first_return.isoformat(),
        )
        second = app.ensure_booking_for_user(
            self.user_id,
            car["id"],
            days=10,
            pickup_date=next_pickup.isoformat(),
            return_date=next_return.isoformat(),
        )

        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(second["days"], 15)
        self.assertEqual(second["pickup_date"], app.format_booking_date(next_pickup.isoformat(), ""))

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

    def test_future_booking_does_not_block_earlier_available_window(self):
        car = app.get_cars()[0]
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, phone, password_hash, is_verified)
                VALUES ('Earlier Tester', 'earlier@example.com', '5552223333', ?, 1)
                """,
                (app.hash_password("Password123!"),),
            )
            earlier_user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                """
                INSERT INTO users (name, email, phone, password_hash, is_verified)
                VALUES ('Overlap Tester', 'overlap@example.com', '5553334444', ?, 1)
                """,
                (app.hash_password("Password123!"),),
            )
            overlap_user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

        future_booking = app.create_booking_for_user(
            self.user_id,
            car["id"],
            pickup_date="2026-08-10",
            return_date="2026-08-20",
            pickup_time="10:00 AM",
            return_time="10:00 AM",
        )
        earlier_booking = app.create_booking_for_user(
            earlier_user_id,
            car["id"],
            pickup_date="2026-08-01",
            return_date="2026-08-05",
            pickup_time="10:00 AM",
            return_time="10:00 AM",
        )

        self.assertEqual(future_booking["car_id"], car["id"])
        self.assertEqual(earlier_booking["car_id"], car["id"])
        with self.assertRaises(RuntimeError):
            app.create_booking_for_user(
                overlap_user_id,
                car["id"],
                pickup_date="2026-08-12",
                return_date="2026-08-14",
                pickup_time="10:00 AM",
                return_time="10:00 AM",
            )

    def test_customer_checkout_labels_are_clean(self):
        self.assertEqual(app.booking_status_label("PENDING_HOLD", "HOLD_PENDING"), "Payment window")
        self.assertEqual(app.booking_status_label("EXPIRED_HOLD", "HOLD_EXPIRED"), "Expired")
        self.assertEqual(app.payment_status_label("HOLD_PENDING"), "Payment pending")
        self.assertEqual(app.payment_status_label("HOLD_PAID"), "10% paid")

    def test_public_booking_id_hidden_until_payment_received(self):
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_PENDING"}), "Pending confirmation")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_EXPIRED"}), "Pending confirmation")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_PAID"}), "FF123456789")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "PAID"}), "FF123456789")

    def test_paid_in_full_cancellation_requires_admin_review_before_cutoff(self):
        booking = {
            "payment_status": "PAID",
            "pickup_date": "Jun 30, 2026",
            "pickup_time": "10:00 AM",
        }

        self.assertTrue(app.cancellation_requires_admin_review(booking, now=datetime(2026, 6, 27, 10, 0)))

    def test_hold_paid_cancellation_can_auto_cancel_before_cutoff(self):
        booking = {
            "payment_status": "HOLD_PAID",
            "pickup_date": "Jun 30, 2026",
            "pickup_time": "10:00 AM",
        }

        self.assertFalse(app.cancellation_requires_admin_review(booking, now=datetime(2026, 6, 27, 10, 0)))

    def test_cancellation_inside_cutoff_requires_admin_review(self):
        booking = {
            "payment_status": "HOLD_PAID",
            "pickup_date": "Jun 27, 2026",
            "pickup_time": "11:00 AM",
        }

        self.assertTrue(app.cancellation_requires_admin_review(booking, now=datetime(2026, 6, 27, 10, 0)))

    def test_checkout_timer_frontend_hook_exists(self):
        js = Path("static/js/app.js").read_text()
        self.assertIn("startBookingCountdown", js)
        self.assertIn("data-hold-seconds", js)
        self.assertIn("Complete payment in", Path("app.py").read_text())


if __name__ == "__main__":
    unittest.main()
