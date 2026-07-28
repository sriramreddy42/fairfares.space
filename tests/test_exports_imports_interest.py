import os
import tempfile
import unittest
from pathlib import Path

import app


class ExportsImportsInterestTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()

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

    def test_interest_summary_separates_signed_in_users_and_guest_submissions(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Interested User", "interest@example.com", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            rows = [
                (user_id, 5, "Interested", "mobile-home-exports-imports"),
                (user_id, 5, "Interested again", "mobile-home-exports-imports"),
                (None, 5, "Guest interest", "mobile-home-exports-imports"),
                (None, 5, "Another guest", "mobile-home-exports-imports"),
                (user_id, 5, "Unrelated feedback", "mobile-profile"),
            ]
            con.executemany(
                "INSERT INTO app_feedback (user_id, rating, message, page) VALUES (?, ?, ?, ?)",
                rows,
            )

        self.assertEqual(
            app.get_exports_imports_interest_summary(),
            {"total": 4, "signed_in_users": 1, "guest_submissions": 2, "last_7_days": 4},
        )


if __name__ == "__main__":
    unittest.main()
