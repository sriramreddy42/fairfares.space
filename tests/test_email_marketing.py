import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

import app


class EmailMarketingTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        self.old_public_base_url = os.environ.get("PUBLIC_BASE_URL")
        self.old_outbox_dir = app.OUTBOX_DIR
        self.old_send_with_resend = app.send_with_resend
        self.sent_messages = []

        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "1"
        os.environ["PUBLIC_BASE_URL"] = "https://fairfares.test"
        app.OUTBOX_DIR = Path(self.temp_dir.name) / "outbox"
        app.refresh_storage_paths()
        app.init_db()

        def capture_send(email, subject, text_body, html_body):
            self.sent_messages.append(
                {
                    "email": email,
                    "subject": subject,
                    "text": text_body,
                    "html": html_body,
                }
            )
            return "sent through test capture"

        app.send_with_resend = capture_send

    def tearDown(self):
        app.send_with_resend = self.old_send_with_resend
        app.OUTBOX_DIR = self.old_outbox_dir
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        if self.old_public_base_url is None:
            os.environ.pop("PUBLIC_BASE_URL", None)
        else:
            os.environ["PUBLIC_BASE_URL"] = self.old_public_base_url
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def create_campaign(self):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO email_campaigns
                (campaign_date, campaign_type, audience, trigger_rule, subject_line, headline, message_body, cta_label, status, notes)
                VALUES ('2026-06-28', 'Seasonal', 'All customers', '', 'FairFares deal for {first_name}', 'Spring deal', 'Book smarter with FairFares.', 'Book now', 'READY', '')
                """
            )
            return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    def create_marketing_user(self, email="subscriber@example.com"):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, phone, password_hash, is_verified, role, promo_email_opt_in)
                VALUES ('Promo Customer', ?, '5551234567', ?, 1, 'CUSTOMER', 1)
                """,
                (email, app.hash_password("Password123!")),
            )
            return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    def test_marketing_test_email_contains_poster_and_unsubscribe(self):
        campaign_id = self.create_campaign()

        result = app.send_marketing_campaign(campaign_id, "https://fairfares.test", test_email="test@example.com")

        self.assertTrue(result["ok"])
        self.assertEqual(result["sent"], 1)
        self.assertEqual(len(self.sent_messages), 1)
        message = self.sent_messages[0]
        self.assertEqual(message["email"], "test@example.com")
        self.assertIn("FairFares deal", message["subject"])
        self.assertIn("<img", message["html"])
        self.assertIn("https://fairfares.test/static/img/booking-confirmation-promise.png", message["html"])
        self.assertIn("Unsubscribe:", message["text"])
        outbox_text = Path(result["outbox_file"]).read_text()
        self.assertIn("Poster: https://fairfares.test/static/img/booking-confirmation-promise.png", outbox_text)

    def test_marketing_campaign_sends_to_opted_in_users_and_logs_status(self):
        campaign_id = self.create_campaign()
        user_id = self.create_marketing_user()

        result = app.send_marketing_campaign(campaign_id, "https://fairfares.test")

        self.assertTrue(result["ok"])
        self.assertEqual(result["sent"], 1)
        self.assertEqual(len(self.sent_messages), 1)
        self.assertIn("<img", self.sent_messages[0]["html"])
        with app.db() as con:
            send_row = con.execute("SELECT * FROM marketing_email_sends WHERE campaign_id = ? AND user_id = ?", (campaign_id, user_id)).fetchone()
            campaign = con.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        self.assertIsNotNone(send_row)
        self.assertEqual(send_row["delivery_status"], "sent through test capture")
        self.assertEqual(campaign["sent_count"], 1)
        self.assertEqual(campaign["status"], "SENT")

    def test_marketing_campaign_failure_does_not_mark_sent(self):
        app.send_with_resend = lambda *_args: "Resend rejected the email (403): domain not verified"
        campaign_id = self.create_campaign()
        user_id = self.create_marketing_user()

        result = app.send_marketing_campaign(campaign_id, "https://fairfares.test")

        self.assertFalse(result["ok"])
        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["attempted"], 1)
        self.assertEqual(result["failed"], 1)
        with app.db() as con:
            send_row = con.execute("SELECT * FROM marketing_email_sends WHERE campaign_id = ? AND user_id = ?", (campaign_id, user_id)).fetchone()
            campaign = con.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        self.assertIsNotNone(send_row)
        self.assertIn("Resend rejected", send_row["delivery_status"])
        self.assertEqual(campaign["sent_count"], 0)
        self.assertEqual(campaign["status"], "FAILED")

    def test_marketing_campaign_reports_no_subscribers(self):
        campaign_id = self.create_campaign()

        result = app.send_marketing_campaign(campaign_id, "https://fairfares.test")

        self.assertFalse(result["ok"])
        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["attempted"], 0)
        self.assertIn("No opted-in", result["message"])

    def test_main_email_builders_pass_html_posters_to_delivery(self):
        car = app.get_cars()[0]
        user_id = self.create_marketing_user("booking@example.com")
        booking = app.create_booking_for_user(user_id, car["id"], days=3)
        documents = {"Invoice": {"title": "Invoice", "content": "Receipt body", "status": "Generated"}}

        app.send_activation_email("new@example.com", "New User", "https://fairfares.test/activate?token=abc")
        app.send_student_verification_email("student@example.edu", "Student User", "https://fairfares.test/student-verification?token=abc")
        app.send_student_verified_email("student@example.edu", "Student User", "STUDENT15", "https://fairfares.test")
        app.send_password_reset_email("reset@example.com", "Reset User", "https://fairfares.test/reset-password?token=abc")
        app.send_booking_confirmation_email("booking@example.com", "Booking User", booking, "https://fairfares.test")
        app.send_booking_documents_email("docs@example.com", "Docs User", booking, documents, "https://fairfares.test")

        self.assertEqual(len(self.sent_messages), 6)
        for message in self.sent_messages[:5]:
            self.assertIn("<img", message["html"])
            self.assertIn("/static/img/booking-confirmation-promise.png", message["html"])
            self.assertIn("poster", message["text"].lower())
        self.assertIn("<img", self.sent_messages[5]["html"])
        self.assertIn("/static/img/download-documents-poster.png", self.sent_messages[5]["html"])
        self.assertIn("documents poster", self.sent_messages[5]["text"].lower())

    def test_pickup_reminder_automation_sends_once(self):
        car = app.get_cars()[0]
        user_id = self.create_marketing_user("reminder@example.com")
        pickup = date.today() + timedelta(days=2)
        booking = app.create_booking_for_user(
            user_id,
            car["id"],
            days=3,
            pickup_date=pickup.isoformat(),
            return_date=(pickup + timedelta(days=3)).isoformat(),
        )
        with app.db() as con:
            con.execute(
                """
                UPDATE users SET promo_email_opt_in = 0 WHERE id = ?
                """,
                (user_id,),
            )
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'CONFIRMED',
                    payment_status = 'HOLD_PAID',
                    status = 'CONFIRMED'
                WHERE id = ?
                """,
                (booking["id"],),
            )
        pickup_at = app.parse_booking_datetime(app.format_booking_date(pickup.isoformat(), ""), "10:00 AM")

        first = app.run_email_automations("https://fairfares.test", now=pickup_at - timedelta(hours=23))
        second = app.run_email_automations("https://fairfares.test", now=pickup_at - timedelta(hours=22))

        self.assertEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        with app.db() as con:
            rows = con.execute("SELECT * FROM email_automation_sends WHERE event_key = 'pickup_24h'").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertIn("sent through test capture", rows[0]["delivery_status"])

    def test_abandoned_booking_waits_for_expired_hold(self):
        car = app.get_cars()[0]
        user_id = self.create_marketing_user("abandoned@example.com")
        with app.db() as con:
            con.execute("UPDATE users SET promo_email_opt_in = 0 WHERE id = ?", (user_id,))
        booking = app.create_booking_for_user(user_id, car["id"], days=2)

        early = app.run_email_automations("https://fairfares.test", now=datetime.now())
        self.assertEqual(early["sent"], 0)

        with app.db() as con:
            con.execute(
                """
                UPDATE bookings
                SET hold_expires_at = datetime('now', '-5 minutes')
                WHERE id = ?
                """,
                (booking["id"],),
            )
        expired = app.run_email_automations("https://fairfares.test", now=datetime.now())

        self.assertEqual(expired["sent"], 1)
        self.assertIn("Complete your FairFares booking", self.sent_messages[-1]["subject"])

    def test_reengagement_automation_sends_highest_due_interval_once(self):
        car = app.get_cars()[0]
        user_id = self.create_marketing_user("inactive@example.com")
        future_pickup = date.today() + timedelta(days=5)
        old_pickup = date.today() - timedelta(days=96)
        old_return = date.today() - timedelta(days=92)
        booking = app.create_booking_for_user(
            user_id,
            car["id"],
            days=4,
            pickup_date=future_pickup.isoformat(),
            return_date=(future_pickup + timedelta(days=4)).isoformat(),
        )
        with app.db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'RETURNED',
                    payment_status = 'PAID',
                    status = 'RETURNED',
                    pickup_date = ?,
                    dropoff_date = ?
                WHERE id = ?
                """,
                (app.format_booking_date(old_pickup.isoformat(), ""), app.format_booking_date(old_return.isoformat(), ""), booking["id"]),
            )
            con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ?", (car["id"],))

        first = app.run_email_automations("https://fairfares.test", now=datetime.now())
        second = app.run_email_automations("https://fairfares.test", now=datetime.now())

        self.assertGreaterEqual(first["sent"], 1)
        self.assertEqual(second["sent"], 0)
        with app.db() as con:
            rows = con.execute("SELECT event_key FROM email_automation_sends WHERE user_id = ? ORDER BY event_key", (user_id,)).fetchall()
        event_keys = [row["event_key"] for row in rows]
        self.assertIn("reengagement_90d", event_keys)
        self.assertNotIn("reengagement_30d", event_keys)
        self.assertNotIn("reengagement_60d", event_keys)


if __name__ == "__main__":
    unittest.main()
