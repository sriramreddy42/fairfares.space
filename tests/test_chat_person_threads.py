import os
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import app


class ChatPersonThreadsTest(unittest.TestCase):
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

    @staticmethod
    def insert_user(con, name, email):
        con.execute(
            "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
            (name, email, app.hash_password("Password123!")),
        )
        return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    @staticmethod
    def insert_direct_conversation(con, first_user_id, second_user_id, index, message_count):
        public_id = f"CHAT-STRESS-{second_user_id}-{index}"
        con.execute(
            """
            INSERT INTO chat_conversations
            (public_id, conversation_type, subject, status, created_at, updated_at, last_message_at)
            VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (public_id, "HOST_GUEST" if index % 2 == 0 else "RIDE", f"Listing context {index}"),
        )
        conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, first_user_id))
        con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, second_user_id))
        for message_index in range(message_count):
            sender_id = first_user_id if message_index % 2 == 0 else second_user_id
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, ?)",
                (conversation_id, sender_id, f"message-{index}-{message_index}"),
            )
        return conversation_id

    @staticmethod
    def insert_housing_post(con, owner_user_id, public_id, title):
        con.execute(
            """
            INSERT INTO accommodation_posts
            (public_id, user_id, post_mode, category, title, description, city, city_area_zip,
             rent_min, contact_name, contact_phone, contact_email, visibility_status)
            VALUES (?, ?, 'HAVE_PLACE', 'ROOM', ?, 'Test listing', 'Denver', 'Denver, CO',
                    900, 'Contact label', '3035550100', ?, 'ACTIVE')
            """,
            (public_id, owner_user_id, title, f"owner-{owner_user_id}@example.com"),
        )

    @staticmethod
    def insert_ride_post(con, owner_user_id, public_id, title):
        con.execute(
            """
            INSERT INTO ride_posts
            (public_id, user_id, ride_type, rider_role, title, origin_label, destination_label,
             city_label, pickup_date, pickup_time, seats, status)
            VALUES (?, ?, 'CARPOOL_OFFER', 'DRIVER', ?, 'Denver, CO', 'Dayton, OH',
                    'Denver, CO', '2026-08-01', '8:00 AM', 3, 'ACTIVE')
            """,
            (public_id, owner_user_id, title),
        )

    def test_duplicate_threads_merge_by_person_and_keep_every_message(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "current@example.com")
            other_user_id = self.insert_user(con, "Actual Person Name", "person@example.com")
            conversation_ids = [
                self.insert_direct_conversation(con, current_user_id, other_user_id, index, 20)
                for index in range(8)
            ]

        inbox = app.get_chat_conversations_for_user(current_user_id)

        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["otherName"], "Actual Person Name")
        self.assertEqual(inbox[0]["otherUserId"], other_user_id)
        with app.db() as con:
            active = con.execute("SELECT COUNT(*) AS count FROM chat_conversations WHERE status = 'ACTIVE'").fetchone()["count"]
            merged = con.execute("SELECT COUNT(*) AS count FROM chat_conversations WHERE status = 'MERGED'").fetchone()["count"]
            message_count = con.execute("SELECT COUNT(*) AS count FROM chat_messages").fetchone()["count"]
            message_thread_count = con.execute("SELECT COUNT(DISTINCT conversation_id) AS count FROM chat_messages").fetchone()["count"]
        self.assertEqual(active, 1)
        self.assertEqual(merged, len(conversation_ids) - 1)
        self.assertEqual(message_count, 160)
        self.assertEqual(message_thread_count, 1)

    def test_stress_many_people_posts_and_messages_stay_one_thread_per_person(self):
        people_count = 80
        duplicates_per_person = 5
        messages_per_thread = 25
        with app.db() as con:
            current_user_id = self.insert_user(con, "Load Test User", "load@example.com")
            for person_index in range(people_count):
                other_user_id = self.insert_user(con, f"Person {person_index}", f"person-{person_index}@example.com")
                for duplicate_index in range(duplicates_per_person):
                    self.insert_direct_conversation(
                        con,
                        current_user_id,
                        other_user_id,
                        duplicate_index,
                        messages_per_thread,
                    )

        started = time.monotonic()
        inbox = app.get_chat_conversations_for_user(current_user_id)
        first_duration = time.monotonic() - started
        started = time.monotonic()
        repeated_results = [app.get_chat_conversations_for_user(current_user_id) for _ in range(10)]
        repeated_duration = time.monotonic() - started

        person_rows = [row for row in inbox if row.get("otherUserId")]
        self.assertEqual(len(person_rows), people_count)
        self.assertEqual(len({row["otherUserId"] for row in person_rows}), people_count)
        self.assertTrue(all(len(repeated_inbox) == people_count for repeated_inbox in repeated_results))
        self.assertLess(first_duration, 10.0)
        self.assertLess(repeated_duration, 10.0)
        with app.db() as con:
            total_messages = con.execute("SELECT COUNT(*) AS count FROM chat_messages").fetchone()["count"]
            active_threads = con.execute("SELECT COUNT(*) AS count FROM chat_conversations WHERE status = 'ACTIVE'").fetchone()["count"]
            merged_threads = con.execute("SELECT COUNT(*) AS count FROM chat_conversations WHERE status = 'MERGED'").fetchone()["count"]
        self.assertEqual(total_messages, people_count * duplicates_per_person * messages_per_thread)
        self.assertEqual(active_threads, people_count)
        self.assertEqual(merged_threads, people_count * (duplicates_per_person - 1))

        with ThreadPoolExecutor(max_workers=8) as executor:
            concurrent_results = list(executor.map(lambda _: app.get_chat_conversations_for_user(current_user_id), range(24)))
        self.assertTrue(all(len(concurrent_inbox) == people_count for concurrent_inbox in concurrent_results))

    def test_listing_context_is_stored_on_the_individual_message(self):
        with app.db() as con:
            sender_id = self.insert_user(con, "Sender", "sender@example.com")
            recipient_id = self.insert_user(con, "Poster", "poster@example.com")
            conversation_id = self.insert_direct_conversation(con, sender_id, recipient_id, 0, 0)
            sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
            message = app.save_chat_message(
                con,
                conversation_id,
                sender,
                "Is this still available?",
                "context-message-1",
                {
                    "type": "CARPOOL",
                    "id": "RIDE-123",
                    "title": "Denver → Dayton",
                    "subtitle": "2026-07-24 · 8:00 AM",
                },
            )

        payload = app.chat_message_payload(message, sender_id)
        self.assertEqual(payload["contextType"], "CARPOOL")
        self.assertEqual(payload["contextId"], "RIDE-123")
        self.assertEqual(payload["contextTitle"], "Denver → Dayton")
        self.assertEqual(payload["contextSubtitle"], "2026-07-24 · 8:00 AM")

    def test_housing_and_carpool_cards_bind_to_the_correct_profile(self):
        with app.db() as con:
            sender_id = self.insert_user(con, "Message Sender", "message-sender@example.com")
            first_owner_id = self.insert_user(con, "First Poster", "owner-1@example.com")
            second_owner_id = self.insert_user(con, "Second Poster", "owner-2@example.com")
            self.insert_housing_post(con, first_owner_id, "HOME-A1", "First poster apartment")
            self.insert_housing_post(con, first_owner_id, "HOME-A2", "First poster room")
            self.insert_housing_post(con, second_owner_id, "HOME-B1", "Second poster apartment")
            self.insert_ride_post(con, second_owner_id, "RIDE-B1", "Second poster carpool")
            sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()

            first_thread, first_error = app.get_or_create_accommodation_conversation(con, "HOME-A1", sender)
            repeated_thread, repeated_error = app.get_or_create_accommodation_conversation(con, "HOME-A2", sender)
            second_thread, second_error = app.get_or_create_accommodation_conversation(con, "HOME-B1", sender)
            ride_thread, ride_error = app.get_or_create_ride_conversation(con, "RIDE-B1", sender)

            self.assertFalse(first_error or repeated_error or second_error or ride_error)
            self.assertEqual(first_thread["id"], repeated_thread["id"])
            self.assertEqual(second_thread["id"], ride_thread["id"])
            self.assertNotEqual(first_thread["id"], second_thread["id"])

            contexts = [
                app.chat_listing_context(con, sender_id, "HOME-A1", ""),
                app.chat_listing_context(con, sender_id, "HOME-A2", ""),
                app.chat_listing_context(con, sender_id, "HOME-B1", ""),
                app.chat_listing_context(con, sender_id, "", "RIDE-B1"),
            ]
            expected_owners = [first_owner_id, first_owner_id, second_owner_id, second_owner_id]
            expected_names = ["First Poster", "First Poster", "Second Poster", "Second Poster"]
            for index, context in enumerate(contexts):
                self.assertEqual(int(context["ownerUserId"]), expected_owners[index])
                self.assertEqual(context["ownerName"], expected_names[index])
                target_thread_id = int(first_thread["id"] if index < 2 else second_thread["id"])
                participant = con.execute(
                    "SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?",
                    (target_thread_id, expected_owners[index]),
                ).fetchone()
                self.assertIsNotNone(participant)
                app.save_chat_message(con, target_thread_id, sender, f"listing message {index}", f"bound-{index}", context)

            stored = con.execute(
                "SELECT context_public_id, context_owner_user_id, context_owner_name FROM chat_messages ORDER BY id"
            ).fetchall()

        self.assertEqual(len(stored), 4)
        self.assertEqual([row["context_public_id"] for row in stored], ["HOME-A1", "HOME-A2", "HOME-B1", "RIDE-B1"])
        self.assertEqual([row["context_owner_user_id"] for row in stored], expected_owners)
        self.assertEqual([row["context_owner_name"] for row in stored], expected_names)
        inbox = app.get_chat_conversations_for_user(sender_id)
        self.assertEqual(len(inbox), 2)
        self.assertEqual({row["otherName"] for row in inbox}, {"First Poster", "Second Poster"})


if __name__ == "__main__":
    unittest.main()
