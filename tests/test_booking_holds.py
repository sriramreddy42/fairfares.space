import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

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
        cars = app.get_cars()
        car = cars[0]

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

    def test_unpaid_hold_is_hidden_until_ten_percent_or_full_payment(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)

        self.assertEqual(app.get_bookings_for_user(self.user_id), [])

        with app.db() as con:
            con.execute(
                "UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'HOLD_PAID' WHERE id = ?",
                (booking["id"],),
            )
        visible = app.get_bookings_for_user(self.user_id)
        self.assertEqual([row["id"] for row in visible], [booking["id"]])

        with app.db() as con:
            con.execute("UPDATE bookings SET payment_status = 'REFUNDED', booking_status = 'CANCELLED' WHERE id = ?", (booking["id"],))
        self.assertEqual([row["id"] for row in app.get_bookings_for_user(self.user_id)], [booking["id"]])

    def test_customer_pickup_return_tools_unlock_only_after_payment(self):
        self.assertFalse(app.booking_customer_tools_unlocked({"payment_status": "HOLD_PENDING"}))
        self.assertFalse(app.booking_customer_tools_unlocked({"payment_status": "HOLD_EXPIRED"}))
        self.assertTrue(app.booking_customer_tools_unlocked({"payment_status": "HOLD_PAID"}))
        self.assertTrue(app.booking_customer_tools_unlocked({"payment_status": "PAID"}))
        self.assertFalse(app.booking_customer_tools_unlocked({"payment_status": "REFUNDED"}))

    def test_vehicle_release_requires_confirmed_payment_and_authorized_deposit(self):
        booking = {
            "booking_status": "CONFIRMED",
            "payment_status": "HOLD_PAID",
            "security_deposit_status": "NOT_AUTHORIZED",
        }
        self.assertTrue(app.booking_ready_for_pickup(booking))
        self.assertFalse(app.booking_releasable_at_pickup(booking))

        booking["security_deposit_status"] = "AUTHORIZED"
        self.assertTrue(app.booking_releasable_at_pickup(booking))

        booking["booking_status"] = "MODIFIED"
        self.assertFalse(app.booking_releasable_at_pickup(booking))

    def test_paid_manage_booking_keeps_deposit_panel_visible(self):
        source = Path("app.py").read_text()
        self.assertIn(
            "selected_car_id or hold_pending or hold_expired or customer_tools_unlocked",
            source,
        )
        self.assertIn("Pickup requirement", source)
        self.assertIn("Your rental payment is confirmed. Authorize the separate refundable card hold before pickup.", source)
        self.assertIn('id="securityDepositForm"', source)

    def test_manage_booking_guides_balance_before_refundable_deposit(self):
        source = Path("app.py").read_text()
        self.assertIn("Pay remaining rental balance", source)
        self.assertIn("Step 1 of 2: finish the rental payment", source)
        self.assertIn("if full_paid:", source)
        self.assertIn("Authorize {escape(format_money(SECURITY_DEPOSIT_AMOUNT))} refundable deposit", source)

    def test_manage_booking_supports_history_selection_and_read_only_returns(self):
        source = Path("app.py").read_text()
        template = Path("templates/dashboard.html").read_text()
        self.assertIn('query.get("booking_id", [""])[0]', source)
        self.assertIn("get_booking_for_user_by_identifier(user[\"id\"], booking_identifier)", source)
        self.assertIn("Active and past trips", source)
        self.assertIn("is_returned_booking", source)
        self.assertIn("$booking_history_cards", template)
        self.assertIn("$mutable_booking_link_class", template)
        self.assertIn('name="booking_id" value="$selected_booking_identifier"', template)

    def test_profile_purge_removes_related_booking_data_only(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Keep User', 'keep@example.com', ?, 1)",
                (app.hash_password("Password123!"),),
            )
            con.execute(
                "INSERT INTO transactions (booking_id, payment_method, amount, transaction_status, invoice_number) VALUES (?, 'Test', 10, 'HOLD_PAID', 'PURGE-TEST')",
                (booking["id"],),
            )
            result = app.purge_user_accounts(con, {"hold@example.com"})

        self.assertEqual(result["users"], 1)
        with app.db() as con:
            self.assertIsNone(con.execute("SELECT 1 FROM users WHERE id = ?", (self.user_id,)).fetchone())
            self.assertIsNone(con.execute("SELECT 1 FROM bookings WHERE id = ?", (booking["id"],)).fetchone())
            self.assertIsNone(con.execute("SELECT 1 FROM transactions WHERE booking_id = ?", (booking["id"],)).fetchone())
            self.assertIsNotNone(con.execute("SELECT 1 FROM users WHERE email = 'keep@example.com'").fetchone())

    def test_booking_cleanup_keeps_only_requested_booking_and_profiles(self):
        cars = app.get_cars()
        kept = app.create_booking_for_user(self.user_id, cars[0]["id"], days=3)
        with app.db() as con:
            con.execute("UPDATE bookings SET booking_id = 'FF428555938' WHERE id = ?", (kept["id"],))
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Other User', 'other@example.com', ?, 1)",
                (app.hash_password("Password123!"),),
            )
            other_user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        removed = app.create_booking_for_user(other_user_id, cars[1]["id"], days=4)
        with app.db() as con:
            con.execute(
                "INSERT INTO transactions (booking_id, payment_method, amount, transaction_status, invoice_number) VALUES (?, 'Test', 10, 'HOLD_PAID', 'KEEP-TEST')",
                (kept["id"],),
            )
            con.execute(
                "INSERT INTO transactions (booking_id, payment_method, amount, transaction_status, invoice_number) VALUES (?, 'Test', 10, 'HOLD_PAID', 'REMOVE-TEST')",
                (removed["id"],),
            )
            result = app.purge_bookings_except(con, "FF428555938")

        self.assertEqual(result["bookings"], 1)
        with app.db() as con:
            self.assertIsNotNone(con.execute("SELECT 1 FROM bookings WHERE id = ?", (kept["id"],)).fetchone())
            self.assertIsNotNone(con.execute("SELECT 1 FROM transactions WHERE booking_id = ?", (kept["id"],)).fetchone())
            self.assertIsNone(con.execute("SELECT 1 FROM bookings WHERE id = ?", (removed["id"],)).fetchone())
            self.assertIsNone(con.execute("SELECT 1 FROM transactions WHERE booking_id = ?", (removed["id"],)).fetchone())
            self.assertIsNotNone(con.execute("SELECT 1 FROM users WHERE id = ?", (self.user_id,)).fetchone())
            self.assertIsNotNone(con.execute("SELECT 1 FROM users WHERE id = ?", (other_user_id,)).fetchone())

    def test_admin_pickup_calendar_excludes_unpaid_checkout_holds(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute("UPDATE bookings SET pickup_date = ?, dropoff_date = ? WHERE id = ?", (date.today().isoformat(), (date.today() + timedelta(days=3)).isoformat(), booking["id"]))

        handler = app.FairFaresHandler.__new__(app.FairFaresHandler)
        unpaid_html = handler.render_admin_booking_calendar(app.get_admin_bookings(), "today", "ALL")
        self.assertIn("0 pickups shown", unpaid_html)
        self.assertNotIn(booking["booking_id"], unpaid_html)

        with app.db() as con:
            con.execute("UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'PAID' WHERE id = ?", (booking["id"],))
        paid_html = handler.render_admin_booking_calendar(app.get_admin_bookings(), "today", "ALL")
        self.assertIn("1 pickup shown", paid_html)
        self.assertIn(booking["booking_id"], paid_html)

    def test_pickup_surfaces_only_include_paid_confirmed_bookings(self):
        cars = app.get_cars()
        car = cars[0]
        pickup_day = date.today() + timedelta(days=1)
        confirmed = app.create_booking_for_user(
            self.user_id,
            car["id"],
            days=3,
            pickup_date=pickup_day.isoformat(),
        )
        modified = app.create_booking_for_user(
            self.user_id,
            cars[1]["id"],
            days=3,
            pickup_date=pickup_day.isoformat(),
        )
        with app.db() as con:
            con.execute(
                "UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'HOLD_PAID' WHERE id = ?",
                (confirmed["id"],),
            )
            con.execute(
                "UPDATE bookings SET booking_status = 'MODIFIED', status = 'MODIFIED', payment_status = 'PAID' WHERE id = ?",
                (modified["id"],),
            )

        rows = app.get_admin_bookings()
        confirmed_row = next(row for row in rows if row["id"] == confirmed["id"])
        modified_row = next(row for row in rows if row["id"] == modified["id"])
        self.assertTrue(app.booking_ready_for_pickup(confirmed_row))
        self.assertFalse(app.booking_ready_for_pickup(modified_row))

        metrics = app.employee_operations_metrics()
        pickup_ids = {row["id"] for row in metrics["tomorrow_pickups"]}
        self.assertIn(confirmed["id"], pickup_ids)
        self.assertNotIn(modified["id"], pickup_ids)

        handler = app.FairFaresHandler.__new__(app.FairFaresHandler)
        calendar_html = handler.render_admin_booking_calendar(rows, "tomorrow", "ALL")
        self.assertIn(confirmed["booking_id"], calendar_html)
        self.assertNotIn(modified["booking_id"], calendar_html)

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

    def test_weekly_duration_rate_lowers_effective_daily_price(self):
        breakdown = app.rental_price_breakdown(100, 7, 0)

        self.assertAlmostEqual(float(breakdown["standard_base"]), 700.0)
        self.assertAlmostEqual(float(breakdown["duration_discount_amount"]), 105.0)
        self.assertAlmostEqual(float(breakdown["base"]), 595.0)
        self.assertEqual(breakdown["duration_discount_label"], "Weekly rate")
        self.assertAlmostEqual(float(breakdown["effective_daily"]), 85.0)

    def test_monthly_duration_rate_lowers_effective_daily_price(self):
        breakdown = app.rental_price_breakdown(100, 30, 0)

        self.assertAlmostEqual(float(breakdown["standard_base"]), 3000.0)
        self.assertAlmostEqual(float(breakdown["duration_discount_amount"]), 900.0)
        self.assertAlmostEqual(float(breakdown["base"]), 2100.0)
        self.assertEqual(breakdown["duration_discount_label"], "Monthly rate")
        self.assertAlmostEqual(float(breakdown["effective_daily"]), 70.0)

    def test_tax_fee_breakdown_html_lists_calculated_lines(self):
        breakdown = app.rental_price_breakdown(49.99, 4, 0)
        html = app.tax_fee_breakdown_html(breakdown)

        self.assertIn(app.format_money(breakdown["tax_fee_amount"]), html)
        self.assertIn("CO road safety fee", html)
        self.assertIn("CO congestion impact fee", html)
        self.assertIn("Ownership tax", html)
        self.assertIn("Sales tax", html)
        self.assertIn("Rental tax items", html)

    def test_daily_price_range_is_centered_on_admin_price_and_ascending(self):
        self.assertEqual(app.daily_price_range(47), (42, 52))
        self.assertEqual(app.daily_price_range(68), (63, 73))
        low, high = app.daily_price_range(200)
        self.assertLessEqual(low, high)
        self.assertEqual((low + high) / 2, 200)

    def test_public_cars_are_sorted_by_admin_daily_price(self):
        cars = app.get_cars()
        prices = [float(car["daily_price"]) for car in cars]

        self.assertEqual(prices, sorted(prices))

    def test_car_card_exposes_server_price_range_for_frontend(self):
        handler = object.__new__(app.FairFaresHandler)
        car = app.get_cars()[0]
        low, high = app.daily_price_range(car["daily_price"])

        html = handler.render_car_card(car)

        self.assertIn(f'data-price-low="{low}"', html)
        self.assertIn(f'data-price-high="{high}"', html)
        self.assertIn(f'<span class="price-range" data-price-range>${low}-{high}</span>', html)

    def test_inventory_locations_split_multiple_car_locations(self):
        with app.db() as con:
            con.execute(
                "UPDATE cars SET location = ? WHERE id = (SELECT id FROM cars ORDER BY id LIMIT 1)",
                ("Denver International Airport (DEN), Downtown Denver\nColorado Springs",),
            )

        locations = app.get_inventory_locations()

        self.assertIn("Denver International Airport (DEN)", locations)
        self.assertIn("Downtown Denver", locations)
        self.assertIn("Colorado Springs", locations)

    def test_inventory_locations_preserve_address_commas(self):
        location = "1665 Logan St, Denver, CO\nDenver International Airport (DEN)"

        locations = app.split_inventory_locations(location)

        self.assertEqual(locations, ["1665 Logan St, Denver, CO", "Denver International Airport (DEN)"])

    def test_car_card_exposes_multiple_locations_for_frontend_filter(self):
        handler = object.__new__(app.FairFaresHandler)
        car = dict(app.get_cars()[0])
        car["location"] = "Denver International Airport (DEN), Downtown Denver"

        html = handler.render_car_card(car)

        self.assertIn('data-locations="Denver International Airport (DEN)|Downtown Denver"', html)

    def test_tax_fee_rules_are_loaded_from_database(self):
        with app.db() as con:
            con.execute("DELETE FROM tax_fee_rules")
            con.executemany(
                """
                INSERT INTO tax_fee_rules (label, rule_type, value, status, sort_order)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    ("Custom daily", "DAILY", 1.50, "ACTIVE", 1),
                    ("Custom percent", "PERCENT", 10.00, "ACTIVE", 2),
                    ("Custom flat", "FLAT", 5.00, "ACTIVE", 3),
                    ("Inactive fee", "FLAT", 99.00, "INACTIVE", 4),
                ],
            )

        breakdown = app.rental_price_breakdown(100, 2, 0)

        self.assertEqual(
            breakdown["tax_fee_lines"],
            [("Custom daily", 3.0), ("Custom percent", 20.0), ("Custom flat", 5.0)],
        )
        self.assertAlmostEqual(float(breakdown["tax_fee_amount"]), 28.0)

    def test_default_tax_fee_rules_apply_when_database_has_no_active_rules(self):
        with app.db() as con:
            con.execute("DELETE FROM tax_fee_rules")
            con.execute(
                """
                INSERT INTO tax_fee_rules (label, rule_type, value, status, sort_order)
                VALUES ('Disabled fee', 'FLAT', 99.00, 'INACTIVE', 1)
                """
            )

        breakdown = app.rental_price_breakdown(100, 2, 0)

        self.assertGreater(float(breakdown["tax_fee_amount"]), 0)
        self.assertIn("CO road safety fee", [label for label, _amount in breakdown["tax_fee_lines"]])

    def test_default_post_return_fee_rules_are_seeded(self):
        rules = app.get_active_post_return_fee_rules()
        labels = [app.tax_fee_rule_value(rule, "label") for rule in rules]

        self.assertIn("Cleaning fee", labels)
        self.assertIn("Smoking fee", labels)
        self.assertIn("Extra mileage", labels)
        self.assertIn("Cleaning fee: $50.00", app.post_return_fee_rule_summary())
        self.assertIn("Extra mileage: $0.15/mile", app.post_return_fee_rule_summary())

    def test_post_return_fee_admin_controls_exist(self):
        py = Path("app.py").read_text()
        template = Path("templates/admin_discounts.html").read_text()

        self.assertIn("/admin/post-return-fees", py)
        self.assertIn("create_admin_post_return_fee_rule", py)
        self.assertIn("Post-return Fee Rules", template)
        self.assertIn("$post_return_fee_rules", template)

    def test_percent_coupon_applies_to_full_checkout_estimate(self):
        car = app.get_cars()[0]
        with app.db() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO discounts
                (code, description, discount_type, value, valid_through, status, max_uses, used_count)
                VALUES ('SAVE20', '20 percent test', 'PERCENT', 20, '2099-12-31', 'ACTIVE', 0, 0)
                """
            )

        booking = app.create_booking_for_user(self.user_id, car["id"], discount_code="SAVE20", days=3)
        undiscounted = app.rental_price_breakdown(car["daily_price"], 3, 0)
        expected_discount = round(float(undiscounted["total"]) * 0.20, 2)
        expected = app.rental_price_breakdown(car["daily_price"], 3, expected_discount)

        self.assertEqual(booking["discount_code"], "SAVE20")
        self.assertAlmostEqual(float(booking["discount_amount"]), expected_discount)
        self.assertAlmostEqual(float(booking["total_price"]), float(expected["total"]))
        self.assertAlmostEqual(float(booking["booking_hold_amount"]), float(expected["booking_hold"]))
        self.assertAlmostEqual(float(booking["due_at_pickup_amount"]), float(expected["due_at_pickup"]))

    def test_amount_coupon_reduces_checkout_and_payment_totals(self):
        car = app.get_cars()[0]
        with app.db() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO discounts
                (code, description, discount_type, value, valid_through, status, max_uses, used_count)
                VALUES ('TAKE50', '50 dollar test', 'AMOUNT', 50, '2099-12-31', 'ACTIVE', 0, 0)
                """
            )

        booking = app.create_booking_for_user(self.user_id, car["id"], discount_code="TAKE50", days=2)
        expected = app.rental_price_breakdown(car["daily_price"], 2, 50)

        self.assertEqual(booking["discount_code"], "TAKE50")
        self.assertAlmostEqual(float(booking["discount_amount"]), 50.0)
        self.assertAlmostEqual(float(booking["total_price"]), float(expected["total"]))
        self.assertAlmostEqual(float(booking["booking_hold_amount"]), float(expected["booking_hold"]))

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
        self.assertEqual(app.booking_status_label("CONFIRMED", "PAY_AT_PICKUP"), "Payment pending")
        self.assertEqual(app.booking_status_label("CONFIRMED", "HOLD_PENDING"), "Payment pending")
        self.assertEqual(app.booking_status_class("CONFIRMED", "PAY_AT_PICKUP"), "status-pending")
        self.assertEqual(app.payment_status_label("HOLD_PENDING"), "Payment pending")
        self.assertEqual(app.payment_status_label("PAY_AT_PICKUP"), "Payment pending")
        self.assertEqual(app.payment_status_label("HOLD_PAID"), "10% paid")

    def test_public_booking_id_hidden_until_payment_received(self):
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_PENDING"}), "Pending confirmation")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_EXPIRED"}), "Pending confirmation")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "PAY_AT_PICKUP"}), "Pending confirmation")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "HOLD_PAID"}), "FF123456789")
        self.assertEqual(app.public_booking_id_label({"booking_id": "FF123456789", "payment_status": "PAID"}), "FF123456789")

    def test_unpaid_modified_booking_keeps_payment_window_timer(self):
        expires_at = (datetime.now() + timedelta(minutes=8)).strftime("%Y-%m-%d %H:%M:%S")
        booking = {
            "booking_status": "MODIFIED",
            "payment_status": "HOLD_PENDING",
            "hold_expires_at": expires_at,
        }

        self.assertGreater(app.booking_hold_remaining_seconds(booking), 0)

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

    def test_pickup_balance_payment_intent_requires_hold_paid_booking(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        admin = {"id": 99, "email": "admin@fairfares.com"}
        payment_intent, status = app.create_pickup_balance_payment_intent(booking, admin)

        self.assertEqual(payment_intent, {})
        self.assertIn("10% hold", status)

        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        with app.db() as con:
            hold_paid_booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        due = app.booking_price_breakdown(hold_paid_booking)["due_at_pickup"]

        with patch("app.stripe_api_request") as stripe_request:
            stripe_request.return_value = (
                {"id": "pi_pickup_balance", "client_secret": "pi_secret", "amount": int(round(due * 100))},
                "ok",
            )
            payment_intent, status = app.create_pickup_balance_payment_intent(hold_paid_booking, admin)

        self.assertEqual(status, "ok")
        self.assertEqual(payment_intent["id"], "pi_pickup_balance")
        stripe_request.assert_called_once()
        path, params = stripe_request.call_args.args[:2]
        self.assertEqual(path, "payment_intents")
        self.assertEqual(params["payment_method_types[]"], "card_present")
        self.assertEqual(params["metadata[payment_option]"], "pickup_balance")
        self.assertEqual(params["metadata[booking_id]"], str(booking["id"]))

    def test_pickup_balance_payment_intent_webhook_marks_booking_paid(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=4)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        with app.db() as con:
            hold_paid_booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        due = app.booking_price_breakdown(hold_paid_booking)["due_at_pickup"]

        ok, message = app.confirm_pickup_balance_payment_intent(
            {
                "id": "pi_terminal_paid",
                "amount_received": int(round(due * 100)),
                "metadata": {
                    "payment_option": "pickup_balance",
                    "booking_id": str(booking["id"]),
                    "public_booking_id": booking["booking_id"],
                    "user_id": str(self.user_id),
                },
            },
            "https://fairfares.example",
        )

        self.assertTrue(ok)
        self.assertEqual(message, "pi_terminal_paid")
        with app.db() as con:
            paid_booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            terminal_transaction = con.execute(
                "SELECT * FROM transactions WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                (booking["id"],),
            ).fetchone()
        self.assertEqual(paid_booking["payment_status"], "PAID")
        self.assertAlmostEqual(float(paid_booking["due_at_pickup_amount"]), 0.0)
        self.assertEqual(terminal_transaction["payment_method"], "Stripe Terminal / Tap to Pay")
        self.assertEqual(terminal_transaction["invoice_number"], "pi_terminal_paid")

    def test_security_deposit_checkout_requires_paid_booking_and_manual_capture(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        admin = {"id": 99, "email": "admin@fairfares.com"}
        session, status = app.create_security_deposit_checkout_session(booking, admin, "https://www.fairfare.space")

        self.assertEqual(session, {})
        self.assertIn("10% hold", status)

        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        with app.db() as con:
            hold_paid_booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()

        with patch("app.stripe_api_request") as stripe_request:
            stripe_request.return_value = (
                {"id": "cs_security_deposit", "url": "https://checkout.stripe.com/example"},
                "ok",
            )
            session, status = app.create_security_deposit_checkout_session(
                hold_paid_booking,
                admin,
                "https://www.fairfare.space",
            )

        self.assertEqual(status, "ok")
        self.assertEqual(session["id"], "cs_security_deposit")
        path, params = stripe_request.call_args.args[:2]
        self.assertEqual(path, "checkout/sessions")
        self.assertEqual(params["payment_intent_data[capture_method]"], "manual")
        self.assertEqual(params["payment_method_types[]"], "card")
        self.assertEqual(params["payment_method_options[card][request_extended_authorization]"], "if_available")
        self.assertEqual(params["line_items[0][price_data][unit_amount]"], 25000)
        self.assertEqual(params["metadata[payment_option]"], "security_deposit")
        self.assertEqual(params["payment_intent_data[metadata][payment_option]"], "security_deposit")

    def test_security_deposit_falls_back_when_extended_authorization_is_unavailable(self):
        car = app.get_cars()[0]
        created = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                "UPDATE bookings SET payment_status = 'PAID', booking_status = 'CONFIRMED' WHERE id = ?",
                (created["id"],),
            )
        booking = app.get_booking_by_id(int(created["id"]))
        admin = {"id": 99, "email": "admin@fairfares.com"}
        calls = []

        def fake_stripe_request(path, params, idempotency_key=""):
            calls.append((dict(params), idempotency_key))
            if len(calls) == 1:
                return {}, "Stripe rejected the request: payment_intent_invalid_parameter; account is not eligible for the requested card features"
            return {"id": "cs_standard_deposit", "url": "https://checkout.stripe.com/standard"}, "ok"

        with patch.object(app, "stripe_api_request", side_effect=fake_stripe_request):
            session, status = app.create_security_deposit_checkout_session(
                booking, admin, "https://www.fairfare.space"
            )

        self.assertEqual(status, "ok")
        self.assertEqual(session["id"], "cs_standard_deposit")
        self.assertIn("payment_method_options[card][request_extended_authorization]", calls[0][0])
        self.assertNotIn("payment_method_options[card][request_extended_authorization]", calls[1][0])
        self.assertTrue(calls[0][1].endswith("-extended"))
        self.assertTrue(calls[1][1].endswith("-standard"))

    def test_security_deposit_webhook_records_authorization_without_marking_booking_paid(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")

        ok, message = app.record_security_deposit_authorization(
            {
                "id": "pi_deposit_auth",
                "amount_capturable": 25000,
                "metadata": {
                    "payment_option": "security_deposit",
                    "booking_id": str(booking["id"]),
                    "public_booking_id": booking["booking_id"],
                    "user_id": str(self.user_id),
                },
            }
        )

        self.assertTrue(ok)
        self.assertEqual(message, "pi_deposit_auth")
        with app.db() as con:
            refreshed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            deposit_transaction = con.execute(
                "SELECT * FROM transactions WHERE invoice_number = ?",
                ("pi_deposit_auth",),
            ).fetchone()
        self.assertEqual(refreshed["payment_status"], "HOLD_PAID")
        self.assertEqual(refreshed["security_deposit_status"], "AUTHORIZED")
        self.assertAlmostEqual(float(refreshed["security_deposit_amount"]), app.SECURITY_DEPOSIT_AMOUNT)
        self.assertEqual(refreshed["security_deposit_payment_intent_id"], "pi_deposit_auth")
        self.assertEqual(deposit_transaction["transaction_status"], "SECURITY_DEPOSIT_AUTHORIZED")
        self.assertAlmostEqual(float(deposit_transaction["amount"]), app.SECURITY_DEPOSIT_AMOUNT)
        self.assertIn("Release after vehicle return review", deposit_transaction["billing_verification_notes"])

    def test_security_deposit_rejects_paid_booking_under_modification_review(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        with app.db() as con:
            con.execute("UPDATE bookings SET booking_status = 'MODIFIED', status = 'MODIFIED' WHERE id = ?", (booking["id"],))
            modified = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()

        session, status = app.create_security_deposit_checkout_session(
            modified,
            {"id": 99, "email": "admin@fairfares.com"},
            "https://www.fairfare.space",
        )

        self.assertEqual(session, {})
        self.assertIn("confirmed booking", status.lower())

    def test_checkout_confirmation_verifies_stripe_before_recording_deposit(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        stripe_intent = {
            "id": "pi_terminal_verified",
            "status": "requires_capture",
            "amount": 25000,
            "amount_capturable": 25000,
            "currency": "usd",
            "metadata": {
                "payment_option": "security_deposit",
                "booking_id": str(booking["id"]),
                "public_booking_id": booking["booking_id"],
                "user_id": str(self.user_id),
            },
        }
        with patch("app.stripe_api_get", return_value=(stripe_intent, "ok")) as stripe_get:
            ok, message = app.verify_and_record_security_deposit("pi_terminal_verified", booking["id"])

        self.assertTrue(ok)
        self.assertEqual(message, "pi_terminal_verified")
        stripe_get.assert_called_once_with("payment_intents/pi_terminal_verified")
        with app.db() as con:
            refreshed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(refreshed["security_deposit_status"], "AUTHORIZED")

    def test_checkout_confirmation_rejects_wrong_booking_metadata(self):
        stripe_intent = {
            "id": "pi_terminal_wrong_booking",
            "status": "requires_capture",
            "amount": 25000,
            "currency": "usd",
            "amount_capturable": 25000,
            "metadata": {"payment_option": "security_deposit", "booking_id": "9999"},
        }
        with patch("app.stripe_api_get", return_value=(stripe_intent, "ok")):
            ok, message = app.verify_and_record_security_deposit("pi_terminal_wrong_booking", 42)

        self.assertFalse(ok)
        self.assertIn("does not belong", message)

    def test_checkout_confirmation_rejects_wrong_deposit_amount(self):
        stripe_intent = {
            "id": "pi_terminal_wrong_amount",
            "status": "requires_capture",
            "amount": 100,
            "currency": "usd",
            "amount_capturable": 100,
            "metadata": {"payment_option": "security_deposit", "booking_id": "42"},
        }
        with patch("app.stripe_api_get", return_value=(stripe_intent, "ok")):
            ok, message = app.verify_and_record_security_deposit("pi_terminal_wrong_amount", 42)

        self.assertFalse(ok)
        self.assertIn("amount or currency", message)

    def test_clear_return_releases_stripe_deposit_hold(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        app.record_security_deposit_authorization(
            {
                "id": "pi_release_after_return",
                "amount": 25000,
                "amount_capturable": 25000,
                "metadata": {"payment_option": "security_deposit", "booking_id": str(booking["id"])},
            }
        )
        return_photos = (
            "return_front_image", "return_back_image", "return_left_image", "return_right_image",
            "return_odometer_image", "return_fuel_image", "return_interior_front_image", "return_interior_rear_image",
        )
        with app.db() as con:
            con.execute(
                """
                UPDATE bookings
                SET actual_return_date = '2026-07-30', actual_return_time = '10:00 AM',
                    return_odometer = 12500, return_fuel_level = 'Full',
                    return_condition_status = 'ACCEPTABLE', new_damage_found = 'NO',
                    post_return_charge_amount = 0, return_review_status = 'CLEAR_TO_RELEASE',
                    return_customer_signature = 'Customer', return_staff_signature = 'Staff'
                WHERE id = ?
                """,
                (booking["id"],),
            )
            for field in return_photos:
                con.execute(f"UPDATE bookings SET {field} = ? WHERE id = ?", (f"/uploads/{field}.jpg", booking["id"]))
        ready = app.get_booking_by_id(booking["id"])

        with patch("app.stripe_api_request", return_value=({"id": "pi_release_after_return", "status": "canceled"}, "ok")) as stripe_request:
            ok, message = app.release_security_deposit_after_clear_return(ready)

        self.assertTrue(ok)
        self.assertEqual(message, "pi_release_after_return")
        self.assertIn("payment_intents/pi_release_after_return/cancel", stripe_request.call_args.args[0])
        released = app.get_booking_by_id(booking["id"])
        self.assertEqual(released["security_deposit_status"], "RELEASED")
        self.assertEqual(released["return_review_status"], "RELEASED")

    def test_checkout_timer_frontend_hook_exists(self):
        js = Path("static/js/app.js").read_text()
        self.assertIn("startBookingCountdown", js)
        self.assertIn("data-hold-seconds", js)
        self.assertIn("Complete payment in", Path("app.py").read_text())


if __name__ == "__main__":
    unittest.main()
