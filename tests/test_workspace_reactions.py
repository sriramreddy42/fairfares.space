import os
import tempfile
import unittest
from pathlib import Path

import app


class WorkspaceReactionTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            self.user_ids = []
            for index in range(3):
                con.execute(
                    """
                    INSERT INTO users (name, email, password_hash, is_admin, role, is_verified)
                    VALUES (?, ?, ?, 1, 'ADMIN', 1)
                    """,
                    (f"Admin {index}", f"admin{index}@example.com", app.hash_password("Password123!")),
                )
                self.user_ids.append(int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]))
            con.execute(
                """
                INSERT INTO workspace_posts (author_id, post_type, body, visibility)
                VALUES (?, 'UPDATE', 'Reaction test post', 'COMPANY')
                """,
                (self.user_ids[0],),
            )
            self.post_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

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

    def test_reaction_summary_and_second_click_unlikes(self):
        first = app.apply_workspace_reaction(self.post_id, self.user_ids[0], "LOVE")
        second = app.apply_workspace_reaction(self.post_id, self.user_ids[1], "LOVE")
        third = app.apply_workspace_reaction(self.post_id, self.user_ids[2], "ANGRY")

        self.assertEqual(first["reaction"], "LOVE")
        self.assertEqual(second["reaction_summary"], "2 ❤️ Love")
        self.assertEqual(third["reaction_summary"], "2 ❤️ Love · 1 😡 Angry")

        unlike = app.apply_workspace_reaction(self.post_id, self.user_ids[0], "LOVE")

        self.assertEqual(unlike["reaction"], "")
        self.assertEqual(unlike["label"], "Like")
        self.assertEqual(unlike["reaction_summary"], "1 ❤️ Love · 1 😡 Angry")


if __name__ == "__main__":
    unittest.main()
