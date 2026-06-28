import os
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
