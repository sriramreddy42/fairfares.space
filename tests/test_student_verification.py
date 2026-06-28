import unittest
from pathlib import Path

import app


class StudentVerificationTest(unittest.TestCase):
    def test_student_email_must_match_profile_name(self):
        self.assertTrue(app.student_email_matches_profile_name("Sriram Reddy Bandari", "sreddy@du.edu"))
        self.assertTrue(app.student_email_matches_profile_name("Sriram Reddy Bandari", "bandari42@university.edu"))
        self.assertFalse(app.student_email_matches_profile_name("Sriram Reddy Bandari", "randomstudent@university.edu"))
        self.assertFalse(app.student_email_matches_profile_name("", "sreddy@du.edu"))

    def test_student_delivery_status_is_visible_without_leaking_secrets(self):
        self.assertIn("sent", app.student_verification_delivery_message("sent through Resend (200)").lower())
        self.assertIn("RESEND_API_KEY", app.student_verification_delivery_message("not configured"))
        self.assertIn("Email provider status", app.student_verification_delivery_message("Resend rejected the email (403): domain not verified"))
        message = app.student_verification_delivery_message("Resend rejected re_supersecretapikey1234567890")
        self.assertIn("[redacted]", message)
        self.assertNotIn("supersecretapikey", message)

    def test_home_discount_box_suggests_student_verification_for_future_bookings(self):
        template = Path("templates/index.html").read_text()
        self.assertIn("Verify .edu for 15% off", template)
        self.assertIn("15% off", template)


if __name__ == "__main__":
    unittest.main()
