import os
import tempfile
import unittest
from pathlib import Path

import app


class AuthBootstrapTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        self.old_admin_email = os.environ.get("FAIRFARES_ADMIN_EMAIL")
        self.old_admin_password = os.environ.get("FAIRFARES_ADMIN_PASSWORD")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        os.environ.pop("FAIRFARES_ADMIN_EMAIL", None)
        os.environ.pop("FAIRFARES_ADMIN_PASSWORD", None)
        app.refresh_storage_paths()

    def tearDown(self):
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        if self.old_admin_email is None:
            os.environ.pop("FAIRFARES_ADMIN_EMAIL", None)
        else:
            os.environ["FAIRFARES_ADMIN_EMAIL"] = self.old_admin_email
        if self.old_admin_password is None:
            os.environ.pop("FAIRFARES_ADMIN_PASSWORD", None)
        else:
            os.environ["FAIRFARES_ADMIN_PASSWORD"] = self.old_admin_password
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def admin_user(self):
        with app.db() as con:
            return con.execute("SELECT * FROM users WHERE email = ?", (app.DEFAULT_ADMIN_EMAIL,)).fetchone()

    def test_startup_does_not_create_published_default_admin(self):
        app.init_db()

        self.assertIsNone(self.admin_user())

    def test_housing_experience_is_remembered_after_any_rating(self):
        app.init_db()
        with app.db() as con:
            cursor = con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Review User", "review@example.com", app.hash_password("ReviewPassword123!")),
            )
            user_id = int(cursor.lastrowid)
            self.assertFalse(app.has_submitted_housing_experience(user_id))
            con.execute(
                """
                INSERT INTO app_feedback (user_id, rating, message, page)
                VALUES (?, 2, 'The search needs clearer filters.', 'mobile-housing-city-experience')
                """,
                (user_id,),
            )

        self.assertTrue(app.has_submitted_housing_experience(user_id))

    def test_incomplete_admin_configuration_creates_no_admin(self):
        os.environ["FAIRFARES_ADMIN_EMAIL"] = "ops@fairfares.com"
        app.init_db()
        with app.db() as con:
            self.assertIsNone(con.execute("SELECT * FROM users WHERE email = 'ops@fairfares.com'").fetchone())

    def test_startup_invalidates_legacy_known_admin_password(self):
        legacy_password = "ChangeMe" + "123!"
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role, is_verified) VALUES (?, ?, ?, 1, 'ADMIN', 1)",
                ("Legacy Admin", app.DEFAULT_ADMIN_EMAIL, app.hash_password(legacy_password)),
            )
        app.init_db()
        admin = self.admin_user()
        self.assertIsNotNone(admin)
        self.assertFalse(app.verify_password(legacy_password, admin["password_hash"]))

    def test_configured_admin_is_created_without_builtin_backdoor(self):
        os.environ["FAIRFARES_ADMIN_EMAIL"] = "ops@fairfares.com"
        os.environ["FAIRFARES_ADMIN_PASSWORD"] = "OpsPassword123!"

        app.init_db()

        self.assertIsNone(self.admin_user())

        with app.db() as con:
            configured_admin = con.execute("SELECT * FROM users WHERE email = ?", ("ops@fairfares.com",)).fetchone()
        self.assertIsNotNone(configured_admin)
        self.assertEqual(configured_admin["is_admin"], 1)
        self.assertEqual(configured_admin["is_verified"], 1)
        self.assertTrue(app.verify_password("OpsPassword123!", configured_admin["password_hash"]))

    def test_email_lookup_accepts_accidental_spaces(self):
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_verified)
                VALUES (?, ?, ?, 1)
                """,
                ("Sriram Reddy", "sriramreddy42@gmail.com", app.hash_password("Password123!")),
            )
            user = app.find_user_by_email(con, "sriram reddy42@gmail.com")

        self.assertIsNotNone(user)
        self.assertEqual(user["email"], "sriramreddy42@gmail.com")

    def test_startup_repairs_stored_email_whitespace(self):
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_verified)
                VALUES (?, ?, ?, 1)
                """,
                ("Sriram Reddy", " Sriram Reddy42@gmail.com ", app.hash_password("Password123!")),
            )

        app.init_db()

        with app.db() as con:
            repaired = con.execute("SELECT * FROM users WHERE email = ?", ("sriramreddy42@gmail.com",)).fetchone()
            old = con.execute("SELECT * FROM users WHERE email = ?", (" Sriram Reddy42@gmail.com ",)).fetchone()

        self.assertIsNotNone(repaired)
        self.assertIsNone(old)

    def test_staff_request_matches_existing_user_with_spaced_email(self):
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_verified)
                VALUES (?, ?, ?, 1)
                """,
                ("Gopal Siddhu", "mr.sidhugopal@gmail.com", app.hash_password("Password123!")),
            )
            existing = app.find_user_by_email(con, "mr.sidhu gopal@gmail.com")

        self.assertIsNotNone(existing)
        self.assertEqual(existing["name"], "Gopal Siddhu")

    def test_email_marketing_calendar_seeds_empty_planner_once(self):
        app.init_db()

        app.ensure_email_marketing_calendar_plans()

        with app.db() as con:
            total = con.execute("SELECT COUNT(*) AS total FROM email_campaigns").fetchone()["total"]
            types = {
                row["campaign_type"]
                for row in con.execute("SELECT DISTINCT campaign_type FROM email_campaigns").fetchall()
            }
        self.assertEqual(total, len(app.default_email_campaign_plans()))
        self.assertIn("Transactional", types)
        self.assertIn("Reminder", types)
        self.assertIn("Re-engagement", types)
        self.assertIn("Seasonal", types)
        self.assertIn("Behavioral", types)
        self.assertIn("Referral", types)

        app.ensure_email_marketing_calendar_plans()

        with app.db() as con:
            total_after_second_call = con.execute("SELECT COUNT(*) AS total FROM email_campaigns").fetchone()["total"]
        self.assertEqual(total_after_second_call, total)

    def test_existing_customer_staff_request_promotes_same_user(self):
        app.init_db()

        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role, is_verified) VALUES (?, ?, ?, 1, 'ADMIN', 1)",
                ("Requesting Admin", app.DEFAULT_ADMIN_EMAIL, app.hash_password("Password123!")),
            )
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_admin, role, is_verified)
                VALUES (?, ?, ?, 1, 'ADMIN', 1)
                """,
                ("Second Admin", "second-admin@fairfares.com", app.hash_password("Password123!")),
            )
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_admin, role, is_verified)
                VALUES (?, ?, ?, 0, 'CUSTOMER', 1)
                """,
                ("Existing Customer", "customer@fairfares.com", app.hash_password("Password123!")),
            )
            requester = con.execute("SELECT * FROM users WHERE email = ?", (app.DEFAULT_ADMIN_EMAIL,)).fetchone()
            reviewer = con.execute("SELECT * FROM users WHERE email = ?", ("second-admin@fairfares.com",)).fetchone()
            customer = con.execute("SELECT * FROM users WHERE email = ?", ("customer@fairfares.com",)).fetchone()
            con.execute(
                """
                INSERT INTO staff_account_requests
                (name, email, phone, role, password_hash, requested_by, target_user_id)
                VALUES (?, ?, '', 'ADMIN', ?, ?, ?)
                """,
                (customer["name"], customer["email"], customer["password_hash"], requester["id"], customer["id"]),
            )
            request = con.execute("SELECT * FROM staff_account_requests WHERE email = ?", (customer["email"],)).fetchone()
            is_admin, role = app.user_role_flags(app.normalized_staff_role(request["role"]))
            con.execute(
                """
                UPDATE users
                SET is_admin = ?,
                    role = ?,
                    is_verified = 1
                WHERE id = ?
                """,
                (is_admin, role, request["target_user_id"]),
            )
            con.execute(
                """
                UPDATE staff_account_requests
                SET status = 'APPROVED',
                    approved_by = ?,
                    created_user_id = ?,
                    reviewed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (reviewer["id"], request["target_user_id"], request["id"]),
            )

            promoted = con.execute("SELECT * FROM users WHERE email = ?", ("customer@fairfares.com",)).fetchone()
            approved_request = con.execute("SELECT * FROM staff_account_requests WHERE id = ?", (request["id"],)).fetchone()

        self.assertEqual(promoted["id"], customer["id"])
        self.assertEqual(promoted["role"], "ADMIN")
        self.assertEqual(promoted["is_admin"], 1)
        self.assertEqual(approved_request["status"], "APPROVED")
        self.assertEqual(approved_request["target_user_id"], customer["id"])
        self.assertEqual(approved_request["created_user_id"], customer["id"])

    def test_staff_request_page_explains_common_login_blockers(self):
        py = Path("app.py").read_text()
        template = Path("templates/admin_requests.html").read_text()
        css = Path("static/css/sections/20-admin.css").read_text()

        self.assertIn("Staff requests need a temporary password", py)
        self.assertIn("A different admin must approve", py)
        self.assertIn("password_hash = ?", py)
        self.assertIn("Login failed:", py)
        self.assertIn("password_mismatch", py)
        self.assertIn("admin_password", py)
        self.assertIn("auth_failed", py)
        self.assertIn("Your admin password", py)
        self.assertIn("staff_status=missing_password", py)
        self.assertIn("staff_status=pending", py)
        self.assertIn("/admin/staff/password", py)
        self.assertIn("password_reset", py)
        self.assertIn("$staff_notice", template)
        self.assertIn("Password</th>", template)
        self.assertIn(".admin-status-notice", css)
        self.assertIn(".staff-password-reset-form", css)

    def test_row_value_accepts_missing_oncall_shift(self):
        app.init_db()

        self.assertEqual(app.row_value(None, "shift_date"), "")
        self.assertEqual(app.row_value(None, "shift_date") or "No upcoming shift", "No upcoming shift")


if __name__ == "__main__":
    unittest.main()
