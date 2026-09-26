import os
import json
import sqlite3
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import unittest
from concurrent.futures import ThreadPoolExecutor
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

    def test_database_enforces_declared_foreign_keys(self):
        with app.db() as con:
            self.assertEqual(con.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("INSERT INTO sessions (token, user_id) VALUES ('orphan-session', 999999999)")

    def test_public_inventory_schedules_hold_cleanup_off_response_path(self):
        with patch.object(app, "schedule_stale_booking_hold_expiry") as schedule_cleanup, patch.object(
            app, "expire_stale_booking_holds", side_effect=AssertionError("rental inventory read must not run synchronous cleanup")
        ):
            cars = app.get_cars()

        self.assertTrue(cars)
        schedule_cleanup.assert_called_once_with()

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

    def test_mobile_customer_pickup_and_return_require_staff_approval(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                "UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'PAID', security_deposit_status = 'AUTHORIZED', security_deposit_payment_intent_id = 'pi_handoff_test' WHERE id = ?",
                (booking["id"],),
            )
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, role, is_admin) VALUES ('Handoff Admin', 'handoff-admin@example.com', ?, 1, 'ADMIN', 1)",
                (app.hash_password("Password123!"),),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            customer = con.execute("SELECT * FROM users WHERE id = ?", (self.user_id,)).fetchone()
            admin = con.execute("SELECT * FROM users WHERE id = ?", (admin_id,)).fetchone()

        photo = "data:image/jpeg;base64,dGVzdA=="
        photos = {key: photo for key in ("front", "back", "left", "right", "odometer", "fuel", "interiorFront", "interiorRear")}

        class Handler:
            def __init__(self, current_user, payload):
                self._user = current_user
                self._payload = payload
                self.response = None

            def current_user(self):
                return self._user

            def read_json_body(self):
                return self._payload

            def public_origin(self):
                return "https://fairfare.space"

            def send_json(self, payload, status=200, headers=None):
                self.response = (status, payload)

            def require_mobile_admin(self):
                return self._user if int(app.row_value(self._user, "is_admin") or 0) else None

        pickup = Handler(customer, {
            "bookingId": booking["booking_id"], "odometer": "12000", "fuelLevel": "FULL",
            "conditionStatus": "ACCEPTABLE", "signature": "Hold Tester", "acknowledged": True, "photos": photos,
        })
        app.FairFaresHandler.api_mobile_rental_handoff_submit(pickup, "pickup")
        self.assertEqual(pickup.response[0], 403)
        self.assertIn("staff completes the pickup inspection", pickup.response[1]["error"])
        with app.db() as con:
            self.assertEqual(con.execute("SELECT booking_status FROM bookings WHERE id = ?", (booking["id"],)).fetchone()["booking_status"], "CONFIRMED")
        identity_start = Handler(admin, {"bookingId": booking["id"]})
        with patch.object(app, "stripe_identity_enabled", return_value=True), patch.object(
            app,
            "resumable_stripe_identity_session",
            return_value=({}, "No resumable session."),
        ), patch.object(
            app,
            "create_stripe_identity_session_for",
            return_value=({"id": "vs_mobile_start", "url": "https://verify.stripe.com/mobile-test"}, "ok"),
        ):
            app.FairFaresHandler.api_mobile_admin_stripe_identity_session(identity_start)
        self.assertEqual(identity_start.response[0], 200)
        self.assertTrue(identity_start.response[1]["requested"])
        self.assertNotIn("url", identity_start.response[1])
        renter_identity = Handler(customer, {"bookingId": booking["booking_id"]})
        with patch.object(
            app,
            "resumable_stripe_identity_session",
            return_value=({"id": "vs_mobile_start", "url": "https://verify.stripe.com/mobile-test", "status": "requires_input"}, "ok"),
        ):
            app.FairFaresHandler.api_mobile_rental_identity_session(renter_identity)
        self.assertEqual(renter_identity.response[0], 200)
        self.assertEqual(renter_identity.response[1]["url"], "https://verify.stripe.com/mobile-test")
        with app.db() as con:
            con.execute(
                """UPDATE bookings SET actual_pickup_date = '2026-09-25', actual_pickup_time = '10:00 AM',
                   pickup_odometer = 12000, pickup_fuel_level = 'FULL', pickup_customer_signature = 'Hold Tester',
                   pickup_staff_signature = 'Handoff Admin', pickup_front_image = 'drive://front', pickup_back_image = 'drive://back',
                   pickup_left_image = 'drive://left', pickup_right_image = 'drive://right', pickup_odometer_image = 'drive://odometer',
                   pickup_fuel_image = 'drive://fuel', pickup_interior_front_image = 'drive://interior-front', pickup_interior_rear_image = 'drive://interior-rear'
                   WHERE id = ?""",
                (booking["id"],),
            )
        ready, message = app.complete_staff_pickup_if_ready(int(booking["id"]))
        self.assertFalse(ready)
        self.assertIn("Verified Stripe Identity", message)
        app.save_identity_verification_from_session({
            "id": "vs_handoff_unit", "status": "verified",
            "metadata": {"user_id": str(self.user_id), "booking_id": str(booking["id"])},
        })
        ready, message = app.complete_staff_pickup_if_ready(int(booking["id"]))
        self.assertTrue(ready, message)
        with app.db() as con:
            self.assertEqual(con.execute("SELECT booking_status FROM bookings WHERE id = ?", (booking["id"],)).fetchone()["booking_status"], "PICKED_UP")

        returned = Handler(customer, {
            "bookingId": booking["booking_id"], "odometer": "12150", "fuelLevel": "FULL",
            "conditionStatus": "ACCEPTABLE", "signature": "Hold Tester", "acknowledged": True, "photos": photos,
        })
        with patch.object(app, "upload_data_url_to_drive", side_effect=lambda _con, **kwargs: f"drive://{kwargs['file_scope']}"):
            app.FairFaresHandler.api_mobile_rental_handoff_submit(returned, "return")
        self.assertEqual(returned.response[0], 200)
        with app.db() as con:
            self.assertEqual(con.execute("SELECT booking_status FROM bookings WHERE id = ?", (booking["id"],)).fetchone()["booking_status"], "RETURN_SUBMITTED")

        return_review = Handler(admin, {"bookingId": booking["id"], "action": "APPROVE_RETURN"})
        with patch.object(app, "stripe_api_request", return_value=({"status": "canceled"}, "ok")):
            app.FairFaresHandler.api_mobile_admin_handoff_review(return_review)
        self.assertEqual(return_review.response[0], 200)
        with app.db() as con:
            completed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(completed["booking_status"], "RETURNED")
        self.assertEqual(completed["security_deposit_status"], "RELEASED")

    def test_admin_can_reconcile_past_offline_return_without_fake_inspection(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                """UPDATE bookings
                   SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'PAID',
                       pickup_date = '2026-09-15', pickup_time = '10:00 AM',
                       dropoff_date = '2026-09-18', dropoff_time = '05:00 PM',
                       security_deposit_status = 'AUTHORIZED', security_deposit_payment_intent_id = 'pi_offline_return'
                   WHERE id = ?""",
                (booking["id"],),
            )
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, role, is_admin) VALUES ('Return Admin', 'return-admin@example.com', ?, 1, 'ADMIN', 1)",
                (app.hash_password("Password123!"),),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            admin = con.execute("SELECT * FROM users WHERE id = ?", (admin_id,)).fetchone()
            current = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()

        reason = "Vehicle was returned outside the app; the digital inspection was not captured."
        with patch.object(app, "stripe_api_request", return_value=({"status": "canceled"}, "ok")), patch.object(
            app, "send_rental_booking_push"
        ):
            reconciled, message = app.reconcile_offline_return_and_release_deposit(current, admin, reason)

        self.assertTrue(reconciled, message)
        with app.db() as con:
            completed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(completed["booking_status"], "RETURNED")
        self.assertEqual(completed["security_deposit_status"], "RELEASED")
        self.assertEqual(completed["return_review_status"], "RELEASED")
        self.assertIn("No digital pickup/return inspection was captured", completed["post_return_charge_notes"])
        self.assertEqual(completed["return_customer_signature"], "")
        self.assertEqual(completed["return_staff_signature"], "")
        self.assertEqual(completed["actual_return_date"], "")
        self.assertEqual(completed["return_odometer"], 0)
        self.assertEqual(completed["return_front_image"], "")
        self.assertEqual(app.get_car(car["id"])["status"], "AVAILABLE")

    def test_staff_can_find_booking_by_exact_number(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        matches = app.get_admin_bookings(booking["booking_id"])
        self.assertEqual([row["booking_id"] for row in matches], [booking["booking_id"]])
        self.assertEqual(app.get_admin_bookings("FF-NOT-A-BOOKING"), [])

    def test_mobile_pickup_to_return_http_end_to_end(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                "UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'PAID', security_deposit_status = 'AUTHORIZED', security_deposit_payment_intent_id = 'pi_http_handoff' WHERE id = ?",
                (booking["id"],),
            )
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('handoff-customer', ?)", (self.user_id,))
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, role, is_admin) VALUES ('HTTP Handoff Admin', 'http-handoff-admin@example.com', ?, 1, 'ADMIN', 1)",
                (app.hash_password("Password123!"),),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('handoff-admin', ?)", (admin_id,))

        class QuietHandler(app.FairFaresHandler):
            suppress_operational_alerts = True

            def log_message(self, _format, *_args):
                return

        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"

        def request_json(path, token, payload=None):
            body = json.dumps(payload).encode() if payload is not None else None
            request = urllib.request.Request(
                f"{origin}{path}", data=body, method="POST" if payload is not None else "GET",
                headers={"Accept": "application/json", "Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status, json.loads(response.read().decode())
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read().decode())

        photo = "data:image/jpeg;base64,dGVzdA=="
        photos = {key: photo for key in ("front", "back", "left", "right", "odometer", "fuel", "interiorFront", "interiorRear")}
        try:
            _, initial = request_json("/api/mobile/rentals/bookings", "handoff-customer")
            self.assertEqual(initial["bookings"][0]["handoff"]["phase"], "pickup")

            status, pickup = request_json("/api/mobile/rentals/pickup-submit", "handoff-customer", {
                "bookingId": booking["booking_id"], "odometer": "22000", "fuelLevel": "FULL",
                "conditionStatus": "ACCEPTABLE", "signature": "Hold Tester", "acknowledged": True, "photos": photos,
            })
            self.assertEqual(status, 403)
            self.assertIn("staff completes the pickup inspection", pickup["error"])

            _, staff_pickups = request_json("/api/mobile/admin/pickups", "handoff-admin")
            queued_pickup = next(item for item in staff_pickups["pickups"] if item["id"] == booking["id"])
            self.assertFalse(queued_pickup["pickupEvidenceComplete"])
            self.assertEqual(queued_pickup["identityStatus"], "NOT_STARTED")
            _, exact_pickup = request_json(
                f"/api/mobile/admin/pickups?bookingId={booking['booking_id']}", "handoff-admin"
            )
            self.assertEqual([item["bookingId"] for item in exact_pickup["pickups"]], [booking["booking_id"]])
            self.assertEqual(exact_pickup["lookup"]["bookingId"], booking["booking_id"])
            self.assertTrue(exact_pickup["lookup"]["found"])
            app.save_identity_verification_from_session({
                "id": "vs_handoff_http", "status": "verified",
                "metadata": {"user_id": str(self.user_id), "booking_id": str(booking["id"])},
            })
            with app.db() as con:
                con.execute(
                    """UPDATE bookings SET actual_pickup_date = '2026-09-25', actual_pickup_time = '10:00 AM',
                       pickup_odometer = 22000, pickup_fuel_level = 'FULL', pickup_customer_signature = 'Hold Tester',
                       pickup_staff_signature = 'HTTP Handoff Admin', pickup_front_image = 'drive://front', pickup_back_image = 'drive://back',
                       pickup_left_image = 'drive://left', pickup_right_image = 'drive://right', pickup_odometer_image = 'drive://odometer',
                       pickup_fuel_image = 'drive://fuel', pickup_interior_front_image = 'drive://interior-front', pickup_interior_rear_image = 'drive://interior-rear'
                       WHERE id = ?""",
                    (booking["id"],),
                )
            ready, message = app.complete_staff_pickup_if_ready(int(booking["id"]))
            self.assertTrue(ready, message)
            _, active = request_json("/api/mobile/rentals/bookings", "handoff-customer")
            self.assertEqual(active["bookings"][0]["handoff"]["phase"], "return")

            with patch.object(app, "upload_data_url_to_drive", side_effect=lambda _con, **kwargs: f"drive://{kwargs['file_scope']}"):
                status, returned = request_json("/api/mobile/rentals/return-submit", "handoff-customer", {
                    "bookingId": booking["booking_id"], "odometer": "22175", "fuelLevel": "FULL",
                    "conditionStatus": "ACCEPTABLE", "signature": "Hold Tester", "acknowledged": True, "photos": photos,
                })
            self.assertEqual(status, 200)
            self.assertEqual(returned["booking"]["handoff"]["phase"], "return_review")

            _, staff_returns = request_json("/api/mobile/admin/pickups", "handoff-admin")
            queued_return = next(item for item in staff_returns["pickups"] if item["id"] == booking["id"])
            self.assertTrue(queued_return["returnEvidenceComplete"])
            with patch.object(app, "stripe_api_request", return_value=({"status": "canceled"}, "ok")):
                status, return_review = request_json("/api/mobile/admin/handoff-review", "handoff-admin", {
                    "bookingId": booking["id"], "action": "APPROVE_RETURN",
                })
            self.assertEqual((status, return_review["ok"]), (200, True))
            _, completed_payload = request_json("/api/mobile/rentals/bookings", "handoff-customer")
            completed = completed_payload["bookings"][0]
            self.assertEqual(completed["handoff"]["phase"], "complete")
            self.assertEqual(completed["depositStatus"], "RELEASED")
            self.assertEqual(app.get_car(car["id"])["status"], "AVAILABLE")
        finally:
            server.shutdown()
            server.server_close()

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
        self.assertIn("booking_is_immutable", source)
        self.assertIn("$booking_history_cards", template)
        self.assertIn("$mutable_booking_link_class", template)
        self.assertIn('name="booking_id" value="$selected_booking_identifier"', template)

    def test_website_cancellation_targets_selected_booking_and_original_payment_method(self):
        server_source = Path("app.py").read_text()
        client_source = Path("static/js/app.js").read_text()
        template = Path("templates/dashboard.html").read_text()
        self.assertIn('payload.set("booking_id", cancelForm.querySelector', client_source)
        self.assertIn('payload.set("refund_method", "Original payment method")', client_source)
        self.assertIn('get_booking_for_user_by_identifier(user["id"], form.get("booking_id"))', server_source)
        self.assertIn("Refunds can only return to the original Stripe payment method.", server_source)
        self.assertIn("original Stripe payment method", template)
        self.assertNotIn("FairFares travel credit", template)

    def test_search_hides_cars_when_requested_window_overlaps_booking(self):
        server_source = Path("app.py").read_text()
        client_source = Path("static/js/app.js").read_text()
        self.assertIn("active.pickup_date AS booked_from_date", server_source)
        self.assertIn('data-booked-from-date="{escape(booked_from_date)}"', server_source)
        self.assertIn("const overlapsBookedWindow", client_source)
        self.assertIn("selectedPickup < availableAfter", client_source)
        self.assertIn("selectedReturn > bookedFrom", client_source)
        self.assertIn("availabilityMatch = false", client_source)

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
        earlier_pickup = date.today() + timedelta(days=10)
        earlier_return = earlier_pickup + timedelta(days=4)
        future_pickup = date.today() + timedelta(days=20)
        future_return = future_pickup + timedelta(days=10)
        overlap_pickup = future_pickup + timedelta(days=2)
        overlap_return = future_pickup + timedelta(days=4)
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
            pickup_date=future_pickup.isoformat(),
            return_date=future_return.isoformat(),
            pickup_time="10:00 AM",
            return_time="10:00 AM",
        )
        earlier_booking = app.create_booking_for_user(
            earlier_user_id,
            car["id"],
            pickup_date=earlier_pickup.isoformat(),
            return_date=earlier_return.isoformat(),
            pickup_time="10:00 AM",
            return_time="10:00 AM",
        )

        self.assertEqual(future_booking["car_id"], car["id"])
        self.assertEqual(earlier_booking["car_id"], car["id"])
        with self.assertRaises(RuntimeError):
            app.create_booking_for_user(
                overlap_user_id,
                car["id"],
                pickup_date=overlap_pickup.isoformat(),
                return_date=overlap_return.isoformat(),
                pickup_time="10:00 AM",
                return_time="10:00 AM",
            )

    def test_concurrent_overlapping_holds_create_only_one_booking(self):
        car = app.get_cars()[0]
        pickup = date.today() + timedelta(days=30)
        dropoff = pickup + timedelta(days=3)
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES ('Concurrent Tester', 'concurrent@example.com', '5557778888', ?, 1)",
                (app.hash_password("Password123!"),),
            )
            second_user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
        barrier = threading.Barrier(2)
        original_check = app.active_booking_conflict_for_car

        def synchronized_initial_check(*args, **kwargs):
            result = original_check(*args, **kwargs)
            barrier.wait(timeout=5)
            return result

        def reserve(user_id):
            try:
                booking = app.create_booking_for_user(
                    user_id, car["id"], pickup_date=pickup.isoformat(), return_date=dropoff.isoformat(),
                )
                return "created", int(booking["id"])
            except RuntimeError as exc:
                return "rejected", str(exc)

        with patch.object(app, "active_booking_conflict_for_car", side_effect=synchronized_initial_check), \
             ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(reserve, (self.user_id, second_user_id)))
        self.assertEqual([status for status, _ in results].count("created"), 1)
        self.assertEqual([status for status, _ in results].count("rejected"), 1)
        with app.db() as con:
            active_count = con.execute(
                "SELECT COUNT(*) FROM bookings WHERE car_id = ? AND booking_status = 'PENDING_HOLD'",
                (car["id"],),
            ).fetchone()[0]
        self.assertEqual(active_count, 1)

    def test_mobile_rental_search_filters_requested_window_and_listing_bounds(self):
        cars = app.get_cars()
        booked_car = cars[0]
        bounded_car = cars[1]
        pickup = date.today() + timedelta(days=30)
        dropoff = pickup + timedelta(days=3)
        app.create_booking_for_user(
            self.user_id,
            booked_car["id"],
            pickup_date=pickup.isoformat(),
            return_date=dropoff.isoformat(),
        )
        with app.db() as con:
            con.execute(
                "UPDATE cars SET available_from_date = ?, available_to_date = ? WHERE id = ?",
                ((pickup + timedelta(days=1)).isoformat(), (dropoff + timedelta(days=5)).isoformat(), bounded_car["id"]),
            )

        results = app.rental_search_cars(
            pickup_date=pickup.isoformat(),
            return_date=dropoff.isoformat(),
        )
        returned_ids = {int(row["id"]) for row in results}

        self.assertNotIn(int(booked_car["id"]), returned_ids)
        self.assertNotIn(int(bounded_car["id"]), returned_ids)
        self.assertGreater(len(returned_ids), 0)

    def test_owner_listing_requires_plate_and_valid_availability_dates(self):
        valid = {
            "name": "Owner Sedan",
            "location": "Denver, CO",
            "dailyPrice": 45,
            "licensePlate": "CO TEST1",
            "availableFrom": (date.today() + timedelta(days=10)).isoformat(),
            "availableTo": (date.today() + timedelta(days=20)).isoformat(),
        }
        row = app.create_owner_car_listing(self.user_id, valid)
        self.assertEqual(row["review_status"], "PENDING_REVIEW")

        with self.assertRaisesRegex(ValueError, "license plate"):
            app.create_owner_car_listing(self.user_id, {**valid, "licensePlate": ""})
        with self.assertRaisesRegex(ValueError, "Available-to"):
            app.create_owner_car_listing(
                self.user_id,
                {**valid, "availableFrom": valid["availableTo"], "availableTo": valid["availableFrom"]},
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

    def test_approved_cancellation_releases_authorized_deposit_and_audits_transaction(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        app.record_security_deposit_authorization(
            {
                "id": "pi_cancelled_deposit",
                "amount_capturable": 25000,
                "metadata": {
                    "payment_option": "security_deposit",
                    "booking_id": str(booking["id"]),
                    "public_booking_id": booking["booking_id"],
                    "user_id": str(self.user_id),
                },
            }
        )
        authorized = app.get_booking_by_id(int(booking["id"]))

        with patch.object(
            app,
            "stripe_api_request",
            return_value=({"id": "pi_cancelled_deposit", "status": "canceled"}, "ok"),
        ) as stripe_request, patch.object(app, "send_rental_booking_push"):
            released, message = app.release_security_deposit_after_cancellation(authorized)

        self.assertTrue(released)
        self.assertEqual(message, "pi_cancelled_deposit")
        path, params = stripe_request.call_args.args[:2]
        self.assertEqual(path, "payment_intents/pi_cancelled_deposit/cancel")
        self.assertEqual(params["cancellation_reason"], "requested_by_customer")
        with app.db() as con:
            refreshed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            transaction = con.execute(
                "SELECT * FROM transactions WHERE invoice_number = 'pi_cancelled_deposit'"
            ).fetchone()
        self.assertEqual(refreshed["security_deposit_status"], "RELEASED")
        self.assertEqual(transaction["transaction_status"], "SECURITY_DEPOSIT_RELEASED")
        self.assertEqual(transaction["billing_verification_status"], "RELEASED")

    def test_cancellation_deposit_release_is_idempotent_when_no_authorization_exists(self):
        released, message = app.release_security_deposit_after_cancellation(
            {"id": 123, "security_deposit_status": "NOT_AUTHORIZED"}
        )
        self.assertTrue(released)
        self.assertIn("No authorized", message)

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

    def test_modification_is_applied_only_after_admin_confirmation(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        hold_amount = app.booking_price_breakdown(booking)["booking_hold"]
        app.confirm_booking_hold_payment(booking["id"], hold_amount, payment_option="hold")
        with app.db() as con:
            user = con.execute("SELECT * FROM users WHERE id = ?", (self.user_id,)).fetchone()

        class CustomerRequest:
            def __init__(self):
                self.response = None

            def current_user(self):
                return user

            def read_json_body(self):
                return {
                    "bookingId": booking["booking_id"],
                    "vehicleId": car["id"],
                    "pickupLocation": "Approval test pickup",
                    "returnLocation": "Approval test return",
                }

            def public_origin(self):
                return "https://example.test"

            def send_json(self, response, status=200):
                self.response = (response, status)

        customer_request = CustomerRequest()
        with patch.object(app, "send_rental_booking_push"):
            app.FairFaresHandler.api_mobile_rental_modify_request(customer_request)
        self.assertEqual(customer_request.response[1], 200)
        with app.db() as con:
            pending = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(pending["booking_status"], "MODIFIED")
        self.assertEqual(pending["pickup_location"], booking["pickup_location"])
        self.assertEqual(app.pending_booking_modification(pending)["pickupLocation"], "Approval test pickup")

        class AdminConfirmation:
            def __init__(self):
                self.redirected_to = ""

            def require_admin(self):
                return user

            def read_form(self):
                return {"booking_id": str(booking["id"]), "booking_status": "CONFIRMED", "payment_status": "HOLD_PAID"}

            def public_origin(self):
                return "https://example.test"

            def redirect(self, location):
                self.redirected_to = location

            def send_error(self, status, message):
                raise AssertionError(f"Unexpected admin error {status}: {message}")

        confirmation = AdminConfirmation()
        with patch.object(app, "send_rental_booking_push"), patch.object(app, "notify_slack_payment"):
            app.FairFaresHandler.update_admin_booking_status(confirmation)
        self.assertEqual(confirmation.redirected_to, "/admin/bookings")
        with app.db() as con:
            approved = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(approved["booking_status"], "CONFIRMED")
        self.assertEqual(approved["pickup_location"], "Approval test pickup")
        self.assertEqual(approved["modification_request_json"], "")

    def test_approved_in_progress_extension_keeps_pickup_state_until_paid(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'PICKED_UP', status = 'PICKED_UP', payment_status = 'PAID',
                    extension_payment_due_amount = 42.50, extension_payment_status = 'PENDING'
                WHERE id = ?
                """,
                (booking["id"],),
            )
        ok, reference = app.confirm_rental_extension_payment(
            booking["id"], 42.50, payment_reference="pi_extension_paid"
        )
        self.assertTrue(ok)
        self.assertEqual(reference, "pi_extension_paid")
        with app.db() as con:
            refreshed = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            transaction = con.execute("SELECT * FROM transactions WHERE invoice_number = 'pi_extension_paid'").fetchone()
        self.assertEqual(refreshed["booking_status"], "PICKED_UP")
        self.assertEqual(refreshed["extension_payment_status"], "PAID")
        self.assertEqual(float(refreshed["extension_payment_due_amount"]), 0.0)
        self.assertEqual(transaction["transaction_status"], "EXTENSION_PAID")

    def test_in_progress_extension_reserves_new_return_window_after_approval(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute(
                "UPDATE bookings SET booking_status = 'PICKED_UP', status = 'PICKED_UP', payment_status = 'PAID' WHERE id = ?",
                (booking["id"],),
            )
            user = con.execute("SELECT * FROM users WHERE id = ?", (self.user_id,)).fetchone()
        pickup = app.parse_booking_datetime(booking["pickup_date"], booking["pickup_time"])
        current_return = app.parse_booking_datetime(booking["dropoff_date"], booking["dropoff_time"])
        self.assertIsNotNone(pickup)
        self.assertIsNotNone(current_return)

        class ExtensionRequest:
            def __init__(self):
                self.response = None

            def current_user(self):
                return user

            def read_json_body(self):
                return {
                    "bookingId": booking["booking_id"], "vehicleId": car["id"],
                    "pickupDate": pickup.strftime("%Y-%m-%d"), "pickupTime": booking["pickup_time"],
                    "returnDate": (current_return + timedelta(days=1)).strftime("%Y-%m-%d"), "returnTime": booking["dropoff_time"],
                    "pickupLocation": booking["pickup_location"], "returnLocation": booking["dropoff_location"],
                }

            def public_origin(self):
                return "https://example.test"

            def send_json(self, response, status=200):
                self.response = (response, status)

        request = ExtensionRequest()
        with patch.object(app, "send_rental_booking_push"):
            app.FairFaresHandler.api_mobile_rental_modify_request(request)
        self.assertEqual(request.response[1], 200)
        with app.db() as con:
            pending = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        proposal = app.pending_booking_modification(pending)
        self.assertEqual(proposal["originalStatus"], "PICKED_UP")
        self.assertGreater(float(proposal["extensionAmount"]), 0)

        class AdminApproval:
            def require_admin(self):
                return user

            def read_form(self):
                return {"booking_id": str(booking["id"]), "booking_status": "CONFIRMED", "payment_status": "PAID"}

            def public_origin(self):
                return "https://example.test"

            def redirect(self, _location):
                pass

            def send_error(self, status, message):
                raise AssertionError(f"Unexpected admin error {status}: {message}")

        with patch.object(app, "send_rental_booking_push"), patch.object(app, "notify_slack_payment"):
            app.FairFaresHandler.update_admin_booking_status(AdminApproval())
        with app.db() as con:
            approved = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
        self.assertEqual(approved["booking_status"], "PICKED_UP")
        self.assertEqual(approved["extension_payment_status"], "PENDING")
        self.assertGreater(float(approved["extension_payment_due_amount"]), 0)
        self.assertEqual(
            app.parse_booking_datetime(approved["dropoff_date"], approved["dropoff_time"]),
            current_return + timedelta(days=1),
        )

    def test_extension_mobile_api_to_admin_approval_to_stripe_completion(self):
        car = app.get_cars()[0]
        booking = app.create_booking_for_user(self.user_id, car["id"], days=3)
        with app.db() as con:
            con.execute("UPDATE bookings SET booking_status = 'PICKED_UP', status = 'PICKED_UP', payment_status = 'PAID' WHERE id = ?", (booking["id"],))
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('extension-customer', ?)", (self.user_id,))
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, role, is_admin) VALUES ('Extension Admin', 'extension-admin@example.com', ?, 1, 'ADMIN', 1)",
                (app.hash_password("Password123!"),),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('extension-admin', ?)", (admin_id,))

        class QuietHandler(app.FairFaresHandler):
            suppress_operational_alerts = True

            def log_message(self, _format, *_args):
                return

        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"

        def post_json(path, payload, token):
            request = urllib.request.Request(
                f"{origin}{path}", data=json.dumps(payload).encode(), method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode())

        try:
            current_return = app.parse_booking_datetime(booking["dropoff_date"], booking["dropoff_time"])
            pickup = app.parse_booking_datetime(booking["pickup_date"], booking["pickup_time"])
            self.assertIsNotNone(current_return)
            self.assertIsNotNone(pickup)
            with patch.object(app, "send_rental_booking_push"):
                status, requested = post_json(
                    "/api/mobile/rentals/modify-request",
                    {
                        "bookingId": booking["booking_id"], "vehicleId": car["id"],
                        "pickupDate": pickup.strftime("%Y-%m-%d"), "pickupTime": booking["pickup_time"],
                        "returnDate": (current_return + timedelta(days=1)).strftime("%Y-%m-%d"), "returnTime": booking["dropoff_time"],
                        "pickupLocation": booking["pickup_location"], "returnLocation": booking["dropoff_location"],
                    },
                    "extension-customer",
                )
            self.assertEqual(status, 200)
            self.assertEqual(requested["booking"]["status"], "MODIFIED")

            form = urllib.parse.urlencode({"booking_id": booking["id"], "booking_status": "CONFIRMED", "payment_status": "PAID"}).encode()
            admin_request = urllib.request.Request(
                f"{origin}/admin/bookings/status", data=form, method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": "Bearer extension-admin"},
            )
            no_redirect = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
            with patch.object(app, "send_rental_booking_push"), patch.object(app, "notify_slack_payment"):
                with no_redirect.open(admin_request, timeout=5) as response:
                    self.assertEqual(response.status, 200)

            with app.db() as con:
                approved = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            self.assertEqual(approved["booking_status"], "PICKED_UP")
            self.assertEqual(approved["extension_payment_status"], "PENDING")
            self.assertGreater(float(approved["extension_payment_due_amount"]), 0)

            stripe_session = {"id": "cs_extension", "url": "https://checkout.stripe.test/extension"}
            with patch.object(app, "stripe_api_request", return_value=(stripe_session, "ok")) as stripe_create:
                status, checkout = post_json(
                    "/api/mobile/rentals/checkout-session",
                    {"bookingId": booking["booking_id"], "paymentOption": "extension"},
                    "extension-customer",
                )
            self.assertEqual(status, 200)
            self.assertEqual(checkout["paymentOption"], "extension")
            self.assertEqual(stripe_create.call_args.args[0], "checkout/sessions")
            self.assertEqual(stripe_create.call_args.args[1]["metadata[payment_option]"], "extension")

            paid_session = {
                "metadata": {"booking_id": str(booking["id"]), "user_id": str(self.user_id), "payment_option": "extension"},
                "payment_status": "paid", "amount_total": int(round(float(approved["extension_payment_due_amount"]) * 100)),
                "payment_intent": "pi_extension_e2e", "customer_email": "hold@example.com",
            }
            payment_request = urllib.request.Request(
                f"{origin}/payment/success?session_id=cs_extension", headers={"Authorization": "Bearer extension-customer"}
            )
            with patch.object(app, "stripe_api_get", return_value=(paid_session, "ok")), patch.object(app, "send_rental_booking_push"):
                with urllib.request.urlopen(payment_request, timeout=5) as response:
                    self.assertEqual(response.status, 200)
            with app.db() as con:
                paid = con.execute("SELECT * FROM bookings WHERE id = ?", (booking["id"],)).fetchone()
            self.assertEqual(paid["booking_status"], "PICKED_UP")
            self.assertEqual(paid["extension_payment_status"], "PAID")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

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
