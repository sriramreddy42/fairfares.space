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

    def test_startup_creates_verified_default_admin(self):
        app.init_db()

        admin = self.admin_user()
        self.assertIsNotNone(admin)
        self.assertEqual(admin["is_admin"], 1)
        self.assertEqual(admin["role"], "ADMIN")
        self.assertEqual(admin["is_verified"], 1)
        self.assertTrue(app.verify_password(app.DEFAULT_ADMIN_PASSWORD, admin["password_hash"]))

    def test_startup_repairs_existing_admin_password_and_verification(self):
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                UPDATE users
                SET password_hash = ?,
                    is_admin = 0,
                    role = 'CUSTOMER',
                    is_verified = 0,
                    guest_account = 1
                WHERE email = ?
                """,
                (app.hash_password("WrongPassword123!"), app.DEFAULT_ADMIN_EMAIL),
            )

        app.init_db()

        admin = self.admin_user()
        self.assertEqual(admin["is_admin"], 1)
        self.assertEqual(admin["role"], "ADMIN")
        self.assertEqual(admin["is_verified"], 1)
        self.assertEqual(admin["guest_account"], 0)
        self.assertTrue(app.verify_password(app.DEFAULT_ADMIN_PASSWORD, admin["password_hash"]))

    def test_configured_admin_does_not_replace_builtin_admin_login(self):
        os.environ["FAIRFARES_ADMIN_EMAIL"] = "ops@fairfares.com"
        os.environ["FAIRFARES_ADMIN_PASSWORD"] = "OpsPassword123!"

        app.init_db()

        default_admin = self.admin_user()
        self.assertIsNotNone(default_admin)
        self.assertEqual(default_admin["is_admin"], 1)
        self.assertEqual(default_admin["is_verified"], 1)
        self.assertTrue(app.verify_password(app.DEFAULT_ADMIN_PASSWORD, default_admin["password_hash"]))

        with app.db() as con:
            configured_admin = con.execute("SELECT * FROM users WHERE email = ?", ("ops@fairfares.com",)).fetchone()
        self.assertIsNotNone(configured_admin)
        self.assertEqual(configured_admin["is_admin"], 1)
        self.assertEqual(configured_admin["is_verified"], 1)
        self.assertTrue(app.verify_password("OpsPassword123!", configured_admin["password_hash"]))


if __name__ == "__main__":
    unittest.main()
