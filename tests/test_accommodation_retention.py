import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import app


class AccommodationRetentionTest(unittest.TestCase):
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

    def insert_expired_post(self, public_id: str, expired_days_ago: int, source_label: str = "fairfares_mobile") -> int:
        expired_at = (datetime.utcnow() - timedelta(days=expired_days_ago)).isoformat(timespec="seconds")
        created_at = (datetime.utcnow() - timedelta(days=30 + expired_days_ago)).isoformat(timespec="seconds")
        with app.db() as con:
            con.execute(
                """
                INSERT INTO accommodation_posts
                (public_id, post_mode, category, title, description, city, contact_name,
                 contact_email, visibility_status, source_label, expires_at, expired_at, created_at)
                VALUES (?, 'HAVE_PLACE', 'single_room', 'Private room', 'PII description',
                        'Denver', 'Private Person', 'private@example.com', 'EXPIRED', ?, ?, ?, ?)
                """,
                (public_id, source_label, expired_at, expired_at, created_at),
            )
            return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    def test_old_expired_listing_is_purged_but_chat_is_preserved(self):
        post_id = self.insert_expired_post("FFH-DELETE-ME", app.ACCOMMODATION_POST_RECOVERY_DAYS + 1)
        upload_dir = app.DB_PATH.parent / "uploads" / "accommodations"
        upload_dir.mkdir(parents=True, exist_ok=True)
        image_path = upload_dir / "expired-room.jpg"
        image_path.write_bytes(b"listing-image")

        with app.db() as con:
            con.execute(
                "INSERT INTO accommodation_post_images (post_id, image_url) VALUES (?, ?)",
                (post_id, "local://uploads/accommodations/expired-room.jpg"),
            )
            con.execute(
                "INSERT INTO accommodation_interests (post_id, contact_email, message) VALUES (?, ?, ?)",
                (post_id, "interested@example.com", "I am interested"),
            )
            con.execute(
                "INSERT INTO chat_conversations (public_id, accommodation_post_id, subject) VALUES (?, ?, ?)",
                ("FFC-RETAINED", post_id, "Housing conversation"),
            )

        app.expire_accommodation_posts()

        with app.db() as con:
            self.assertIsNone(con.execute("SELECT id FROM accommodation_posts WHERE id = ?", (post_id,)).fetchone())
            self.assertEqual(con.execute("SELECT COUNT(*) AS count FROM accommodation_post_images WHERE post_id = ?", (post_id,)).fetchone()["count"], 0)
            self.assertEqual(con.execute("SELECT COUNT(*) AS count FROM accommodation_interests WHERE post_id = ?", (post_id,)).fetchone()["count"], 0)
            conversation = con.execute("SELECT accommodation_post_id FROM chat_conversations WHERE public_id = 'FFC-RETAINED'").fetchone()
            self.assertIsNotNone(conversation)
            self.assertIsNone(conversation["accommodation_post_id"])
            audit = con.execute("SELECT * FROM accommodation_deletion_audit").fetchone()
            self.assertEqual(audit["listing_fingerprint"], app.accommodation_deletion_fingerprint("FFH-DELETE-ME"))
            self.assertEqual(audit["deletion_reason"], "RETENTION_EXPIRED")
            self.assertNotIn("FFH-DELETE-ME", tuple(str(value) for value in audit))
        self.assertFalse(image_path.exists())

    def test_recovery_window_and_seeded_rows_are_not_purged(self):
        recovery_post_id = self.insert_expired_post("FFH-RECOVERABLE", max(0, app.ACCOMMODATION_POST_RECOVERY_DAYS - 1))
        sample_post_id = self.insert_expired_post(
            "FFH-SAMPLE-OLD",
            app.ACCOMMODATION_POST_RECOVERY_DAYS + 30,
            source_label="SAMPLE_DATA",
        )

        app.expire_accommodation_posts()

        with app.db() as con:
            remaining_ids = {
                int(row["id"])
                for row in con.execute(
                    "SELECT id FROM accommodation_posts WHERE id IN (?, ?)",
                    (recovery_post_id, sample_post_id),
                ).fetchall()
            }
        self.assertEqual(remaining_ids, {recovery_post_id, sample_post_id})

    def test_startup_maintenance_purges_eligible_rows(self):
        post_id = self.insert_expired_post("FFH-STARTUP-PURGE", app.ACCOMMODATION_POST_RECOVERY_DAYS + 1)

        app.init_db()

        with app.db() as con:
            self.assertIsNone(con.execute("SELECT id FROM accommodation_posts WHERE id = ?", (post_id,)).fetchone())

    def test_long_overdue_active_row_does_not_restart_recovery_clock(self):
        post_id = self.insert_expired_post("FFH-MISSED-EXPIRY", app.ACCOMMODATION_POST_RECOVERY_DAYS + 1)
        with app.db() as con:
            con.execute(
                "UPDATE accommodation_posts SET visibility_status = 'ACTIVE', expired_at = NULL WHERE id = ?",
                (post_id,),
            )

        app.expire_accommodation_posts()

        with app.db() as con:
            self.assertIsNone(con.execute("SELECT id FROM accommodation_posts WHERE id = ?", (post_id,)).fetchone())


if __name__ == "__main__":
    unittest.main()
