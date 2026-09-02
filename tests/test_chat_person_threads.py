import os
import tempfile
import time
import unittest
import urllib.parse
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

        app.run_chat_conversation_consolidation_migration()
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

    def test_empty_direct_thread_stays_out_of_inbox_until_first_message(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "empty-current@example.com")
            other_user_id = self.insert_user(con, "Unmessaged Person", "empty-other@example.com")
            conversation_id = self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 0)

        self.assertEqual(app.get_chat_conversations_for_user(current_user_id), [])

        with app.db() as con:
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, ?)",
                (conversation_id, current_user_id, "Hello"),
            )

        inbox = app.get_chat_conversations_for_user(current_user_id)
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["otherName"], "Unmessaged Person")
        self.assertEqual(inbox[0]["lastMessage"], "Hello")

    def test_direct_chat_exposes_only_other_participant_phone_and_groups_hide_it(self):
        with app.db() as con:
            first_user_id = self.insert_user(con, "First Caller", "caller-one@example.com")
            second_user_id = self.insert_user(con, "Second Caller", "caller-two@example.com")
            con.execute("UPDATE users SET phone = '+13035550101', phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?", (first_user_id,))
            con.execute("UPDATE users SET phone = '+19375550102', phone_verified_at = CURRENT_TIMESTAMP WHERE id = ?", (second_user_id,))
            direct_id = self.insert_direct_conversation(con, first_user_id, second_user_id, 0, 1)

            first_row = app.get_chat_conversation_for_user(con, direct_id, first_user_id)
            second_row = app.get_chat_conversation_for_user(con, direct_id, second_user_id)
            first_payload = app.chat_row_payload(first_row, first_user_id)
            second_payload = app.chat_row_payload(second_row, second_user_id)

            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name, visibility) VALUES ('CALL-GROUP', 'GROUP', 'Call group', 'PRIVATE')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject) VALUES ('CALL-GROUP-CHAT', 'GROUP', ?, 'Call group')",
                (community_id,),
            )
            group_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                ((group_id, first_user_id), (group_id, second_user_id)),
            )
            con.executemany(
                "INSERT INTO chat_community_members (community_id, user_id, role) VALUES (?, ?, 'MEMBER')",
                ((community_id, first_user_id), (community_id, second_user_id)),
            )
            group_row = app.get_chat_conversation_for_user(con, group_id, first_user_id)
            group_payload = app.chat_row_payload(group_row, first_user_id)

        self.assertEqual(first_payload["otherPhone"], "+19375550102")
        self.assertEqual(second_payload["otherPhone"], "+13035550101")
        self.assertNotEqual(first_payload["otherPhone"], "+13035550101")
        self.assertEqual(group_payload["otherPhone"], "")

    def test_legacy_group_without_community_link_never_looks_like_an_individual(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "legacy-group-current@example.com")
            other_user_id = self.insert_user(con, "Misleading Person", "legacy-group-other@example.com")
            con.execute("UPDATE users SET phone = '+19375550199', profile_photo_url = 'https://example.com/person.jpg' WHERE id = ?", (other_user_id,))
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('LEGACY-GROUP-CHAT', 'GROUP', 'Legacy Housing Group')"
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                ((conversation_id, current_user_id), (conversation_id, other_user_id)),
            )
            row = app.get_chat_conversation_for_user(con, conversation_id, current_user_id)
            payload = app.chat_row_payload(row, current_user_id)

        self.assertEqual(payload["kind"], "GROUP")
        self.assertEqual(payload["otherName"], "Legacy Housing Group")
        self.assertEqual(payload["otherUserId"], 0)
        self.assertEqual(payload["otherPhone"], "")
        self.assertEqual(payload["otherPhotoUrl"], "")
        self.assertFalse(payload["otherOnline"])
        self.assertEqual(payload["otherLastSeenAt"], "")

    def test_direct_thread_disappears_when_its_only_message_is_deleted(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "deleted-current@example.com")
            other_user_id = self.insert_user(con, "Deleted Person", "deleted-other@example.com")
            conversation_id = self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 1)

        self.assertEqual(len(app.get_chat_conversations_for_user(current_user_id)), 1)

        with app.db() as con:
            con.execute("UPDATE chat_messages SET deleted_at = CURRENT_TIMESTAMP WHERE conversation_id = ?", (conversation_id,))

        self.assertEqual(app.get_chat_conversations_for_user(current_user_id), [])

    def test_direct_thread_requires_a_message_inside_participant_visibility_boundary(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "boundary-current@example.com")
            other_user_id = self.insert_user(con, "Boundary Person", "boundary-other@example.com")
            conversation_id = self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 1)
            last_message_id = int(con.execute(
                "SELECT MAX(id) AS id FROM chat_messages WHERE conversation_id = ?", (conversation_id,)
            ).fetchone()["id"])
            con.execute(
                "UPDATE chat_participants SET visible_from_message_id = ? WHERE conversation_id = ? AND user_id = ?",
                (last_message_id + 1, conversation_id, current_user_id),
            )

        self.assertEqual(app.get_chat_conversations_for_user(current_user_id), [])
        self.assertEqual(len(app.get_chat_conversations_for_user(other_user_id)), 1)

    def test_single_conversation_payload_has_same_last_message_shape_as_inbox(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "shape-current@example.com")
            other_user_id = self.insert_user(con, "Shape Person", "shape-other@example.com")
            conversation_id = self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 1)
            single_row = app.get_chat_conversation_for_user(con, conversation_id, current_user_id)

        self.assertIsNotNone(single_row)
        single_payload = app.chat_row_payload(single_row, current_user_id)
        inbox_payload = app.get_chat_conversations_for_user(current_user_id)[0]
        self.assertGreater(single_payload["lastMessageId"], 0)
        self.assertEqual(single_payload["lastMessageId"], inbox_payload["lastMessageId"])
        self.assertEqual(single_payload["lastMessage"], inbox_payload["lastMessage"])
        self.assertEqual(single_payload["unread"], inbox_payload["unread"])

    def test_deleted_latest_message_restores_previous_visible_activity_timestamp(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "activity-current@example.com")
            other_user_id = self.insert_user(con, "Activity Person", "activity-other@example.com")
            conversation_id = self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 0)
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text, created_at) VALUES (?, ?, 'older', '2026-08-01 10:00:00')",
                (conversation_id, other_user_id),
            )
            older_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text, created_at, deleted_at) VALUES (?, ?, 'deleted newer', '2026-08-20 10:00:00', CURRENT_TIMESTAMP)",
                (conversation_id, other_user_id),
            )
            con.execute("UPDATE chat_conversations SET last_message_at = '2026-08-20 10:00:00' WHERE id = ?", (conversation_id,))

        inbox = app.get_chat_conversations_for_user(current_user_id)
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["lastMessageId"], older_id)
        self.assertEqual(inbox[0]["lastMessage"], "older")
        self.assertEqual(inbox[0]["lastMessageAt"], "2026-08-01 10:00:00")

    def test_cursor_orders_by_visible_activity_after_latest_message_deletion(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "cursor-delete-current@example.com")
            first_user_id = self.insert_user(con, "First Person", "cursor-delete-first@example.com")
            second_user_id = self.insert_user(con, "Second Person", "cursor-delete-second@example.com")
            older_conversation_id = self.insert_direct_conversation(con, current_user_id, first_user_id, 0, 0)
            newer_conversation_id = self.insert_direct_conversation(con, current_user_id, second_user_id, 0, 0)
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text, created_at) VALUES (?, ?, 'visible older', '2026-08-01 10:00:00')",
                (older_conversation_id, first_user_id),
            )
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text, created_at, deleted_at) VALUES (?, ?, 'deleted newest', '2026-08-30 10:00:00', CURRENT_TIMESTAMP)",
                (older_conversation_id, first_user_id),
            )
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text, created_at) VALUES (?, ?, 'visible newer', '2026-08-15 10:00:00')",
                (newer_conversation_id, second_user_id),
            )
            con.execute("UPDATE chat_conversations SET last_message_at = '2026-08-30 10:00:00' WHERE id = ?", (older_conversation_id,))
            con.execute("UPDATE chat_conversations SET last_message_at = '2026-08-15 10:00:00' WHERE id = ?", (newer_conversation_id,))

        first_page = app.get_chat_conversations_for_user(current_user_id, limit=1)
        self.assertEqual(first_page[0]["lastMessage"], "visible newer")
        cursor = app.decode_chat_conversation_cursor(app.encode_chat_conversation_cursor(
            first_page[0]["lastMessageAt"], first_page[0]["conversationId"],
        ))
        self.assertIsNotNone(cursor)
        second_page = app.get_chat_conversations_for_user(
            current_user_id, limit=1, cursor_activity=cursor[0], cursor_id=cursor[1],
        )
        self.assertEqual(second_page[0]["lastMessage"], "visible older")

    def test_phone_started_chat_reuses_one_person_thread_and_group_creator_is_owner(self):
        with app.db() as con:
            first_id = self.insert_user(con, "Phone User", "phone-user@example.com")
            second_id = self.insert_user(con, "Discoverable User", "discoverable@example.com")
            con.execute("UPDATE users SET phone = ?, chat_phone_discoverable = 1 WHERE id = ?", ("+1 303 555 0199", second_id))
            first = con.execute("SELECT * FROM users WHERE id = ?", (first_id,)).fetchone()
            created, error = app.get_or_create_person_conversation(con, first, second_id)
            reused, reused_error = app.get_or_create_person_conversation(con, first, second_id)
            self.assertEqual(error, "")
            self.assertEqual(reused_error, "")
            self.assertEqual(created["id"], reused["id"])
            active_count = con.execute("SELECT COUNT(*) AS count FROM chat_conversations WHERE status = 'ACTIVE'").fetchone()["count"]
            self.assertEqual(active_count, 1)

        community, error = app.create_chat_community(first_id, "Private test group")
        self.assertEqual(error, "")
        with app.db() as con:
            role = con.execute(
                """SELECT members.role FROM chat_community_members members
                   JOIN chat_communities communities ON communities.id = members.community_id
                   WHERE communities.public_id = ? AND members.user_id = ?""",
                (community["id"], first_id),
            ).fetchone()["role"]
        self.assertEqual(role, "OWNER")

    def test_synchronized_group_membership_does_not_open_a_write_transaction(self):
        with app.db() as con:
            first_id = self.insert_user(con, "Group One", "group-one@example.com")
            second_id = self.insert_user(con, "Group Two", "group-two@example.com")
            con.execute(
                "INSERT INTO chat_communities (public_id, name, created_by_user_id) VALUES ('GROUP-READ-ONLY', 'Read only group', ?)",
                (first_id,),
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_community_members (community_id, user_id) VALUES (?, ?)",
                ((community_id, first_id), (community_id, second_id)),
            )
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject) VALUES ('GROUP-THREAD-READ-ONLY', 'GROUP', ?, 'Read only group')",
                (community_id,),
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                ((conversation_id, first_id), (conversation_id, second_id)),
            )
            changes_before = con.total_changes
            app.sync_chat_conversation_members_from_community(con, conversation_id, community_id)
            self.assertEqual(con.total_changes, changes_before)

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

        app.run_chat_conversation_consolidation_migration()
        started = time.monotonic()
        inbox = []
        offset = 0
        while True:
            page = app.get_chat_conversations_for_user(current_user_id, limit=30, offset=offset)
            inbox.extend(page)
            if len(page) < 30:
                break
            offset += len(page)
        first_duration = time.monotonic() - started
        started = time.monotonic()
        repeated_results = [app.get_chat_conversations_for_user(current_user_id, limit=30) for _ in range(10)]
        repeated_duration = time.monotonic() - started

        person_rows = [row for row in inbox if row.get("otherUserId")]
        self.assertEqual(len(person_rows), people_count)
        self.assertEqual(len({row["otherUserId"] for row in person_rows}), people_count)
        self.assertTrue(all(len(repeated_inbox) == 30 for repeated_inbox in repeated_results))
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
            concurrent_results = list(executor.map(lambda _: app.get_chat_conversations_for_user(current_user_id, limit=30), range(24)))
        self.assertTrue(all(len(concurrent_inbox) == 30 for concurrent_inbox in concurrent_results))

    def test_conversation_cursor_is_stable_when_a_new_chat_arrives_between_pages(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Cursor User", "cursor@example.com")
            for person_index in range(45):
                other_user_id = self.insert_user(con, f"Cursor Person {person_index}", f"cursor-{person_index}@example.com")
                self.insert_direct_conversation(con, current_user_id, other_user_id, 0, 1)

        first_page = app.get_chat_conversations_for_user(current_user_id, limit=30)
        self.assertEqual(len(first_page), 30)
        cursor = app.decode_chat_conversation_cursor(app.encode_chat_conversation_cursor(
            first_page[-1]["lastMessageAt"], first_page[-1]["conversationId"],
        ))
        self.assertIsNotNone(cursor)

        # A newly active conversation belongs ahead of page one. Cursor paging
        # must not shift the boundary and repeat one of page one's rows.
        with app.db() as con:
            new_user_id = self.insert_user(con, "Newest Person", "newest-cursor@example.com")
            self.insert_direct_conversation(con, current_user_id, new_user_id, 0, 1)

        cursor_activity, cursor_id = cursor
        second_page = app.get_chat_conversations_for_user(
            current_user_id, limit=30, cursor_activity=cursor_activity, cursor_id=cursor_id,
        )
        first_ids = {row["id"] for row in first_page}
        second_ids = {row["id"] for row in second_page}
        self.assertFalse(first_ids & second_ids)
        self.assertEqual(len(second_page), 15)
        self.assertIsNone(app.decode_chat_conversation_cursor("not-a-valid-cursor"))

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

    def test_many_listing_message_contexts_survive_one_reused_person_thread(self):
        listing_count = 250
        with app.db() as con:
            sender_id = self.insert_user(con, "Listing Sender", "listing-sender@example.com")
            owner_id = self.insert_user(con, "One Lister", "one-lister@example.com")
            conversation_id = self.insert_direct_conversation(con, sender_id, owner_id, 0, 0)
            sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
            for index in range(listing_count):
                post_id = f"FFH-CONTEXT-{index:04d}"
                self.insert_housing_post(con, owner_id, post_id, f"Listing {index}")
                message = app.save_chat_message(
                    con,
                    conversation_id,
                    sender,
                    "🔒 End-to-end encrypted message",
                    f"listing-context-{index}",
                )
                con.execute(
                    "UPDATE chat_messages SET context_type = 'HOUSING', context_public_id = ? WHERE id = ?",
                    (post_id, int(message["id"])),
                )
            self.insert_housing_post(con, sender_id, "FFH-OWN-LISTING", "Sender's own listing")
            own_message = app.save_chat_message(con, conversation_id, sender, "invalid self context", "own-listing-context")
            con.execute(
                "UPDATE chat_messages SET context_type = 'HOUSING', context_public_id = 'FFH-OWN-LISTING' WHERE id = ?",
                (int(own_message["id"]),),
            )

        started = time.monotonic()
        contexts = app.messaged_listing_ids_for_user(sender_id)
        owner_contexts = app.messaged_listing_ids_for_user(owner_id)
        first_duration = time.monotonic() - started
        with ThreadPoolExecutor(max_workers=16) as executor:
            repeated = list(executor.map(lambda _: app.messaged_listing_ids_for_user(sender_id), range(64)))

        self.assertEqual(len(contexts["postIds"]), listing_count)
        self.assertEqual(contexts["postIds"][0], "FFH-CONTEXT-0000")
        self.assertEqual(contexts["postIds"][-1], "FFH-CONTEXT-0249")
        self.assertNotIn("FFH-OWN-LISTING", contexts["postIds"])
        self.assertEqual(contexts["rideIds"], [])
        self.assertEqual(owner_contexts, {"postIds": [], "rideIds": []})
        self.assertTrue(all(result == contexts for result in repeated))
        self.assertLess(first_duration, 1.0)

    def test_unread_counts_are_exact_and_isolated_per_profile(self):
        with app.db() as con:
            first_user_id = self.insert_user(con, "First User", "first@example.com")
            second_user_id = self.insert_user(con, "Second User", "second@example.com")
            unrelated_a_id = self.insert_user(con, "Unrelated A", "unrelated-a@example.com")
            unrelated_b_id = self.insert_user(con, "Unrelated B", "unrelated-b@example.com")
            conversation_id = self.insert_direct_conversation(con, first_user_id, second_user_id, 0, 0)
            unrelated_conversation_id = self.insert_direct_conversation(con, unrelated_a_id, unrelated_b_id, 0, 30)
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, 'incoming one')",
                (conversation_id, second_user_id),
            )
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, 'reply')",
                (conversation_id, first_user_id),
            )
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, 'incoming two')",
                (conversation_id, second_user_id),
            )
            self.assertGreater(unrelated_conversation_id, conversation_id)

        first_inbox = app.get_chat_conversations_for_user(first_user_id)
        second_inbox = app.get_chat_conversations_for_user(second_user_id)
        unrelated_inbox = app.get_chat_conversations_for_user(unrelated_a_id)

        self.assertEqual(first_inbox[0]["unread"], 2)
        self.assertEqual(second_inbox[0]["unread"], 1)
        self.assertEqual(unrelated_inbox[0]["unread"], 15)

    def test_opening_one_thread_keeps_another_thread_unread(self):
        with app.db() as con:
            current_user_id = self.insert_user(con, "Current User", "current-unread@example.com")
            first_sender_id = self.insert_user(con, "First Sender", "first-sender@example.com")
            second_sender_id = self.insert_user(con, "Second Sender", "second-sender@example.com")
            first_conversation_id = self.insert_direct_conversation(
                con, current_user_id, first_sender_id, 1, 0,
            )
            second_conversation_id = self.insert_direct_conversation(
                con, current_user_id, second_sender_id, 2, 0,
            )
            con.executemany(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, ?)",
                (
                    (first_conversation_id, first_sender_id, "first unread letter"),
                    (second_conversation_id, second_sender_id, "second unread letter one"),
                    (second_conversation_id, second_sender_id, "second unread letter two"),
                ),
            )
            current_user = con.execute("SELECT * FROM users WHERE id = ?", (current_user_id,)).fetchone()
            first_public_id = str(con.execute(
                "SELECT public_id FROM chat_conversations WHERE id = ?", (first_conversation_id,),
            ).fetchone()["public_id"])
            second_public_id = str(con.execute(
                "SELECT public_id FROM chat_conversations WHERE id = ?", (second_conversation_id,),
            ).fetchone()["public_id"])

        before = {row["id"]: row["unread"] for row in app.get_chat_conversations_for_user(current_user_id)}
        self.assertEqual(before[first_public_id], 1)
        self.assertEqual(before[second_public_id], 2)

        responses = []
        handler = object.__new__(app.FairFaresHandler)
        handler.current_user = lambda: current_user
        handler.public_origin = lambda: "https://www.fairfare.space"
        handler.send_json = lambda payload, status=200: responses.append((payload, status))
        handler.api_chat_messages(urllib.parse.urlparse(
            f"/api/chat/messages?conversation_id={first_public_id}"
        ))
        self.assertEqual(responses[-1][1], 200)

        after = {row["id"]: row["unread"] for row in app.get_chat_conversations_for_user(current_user_id)}
        self.assertEqual(after[first_public_id], 0)
        self.assertEqual(after[second_public_id], 2)
        self.assertEqual(sum(after.values()), 2)

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

    def test_generated_housing_card_binds_to_sriram_profile(self):
        with app.db() as con:
            sender_id = self.insert_user(con, "Message Sender", "generated-message-sender@example.com")
            owner_id = self.insert_user(con, app.SAMPLE_HOUSING_OWNER_NAME, app.SAMPLE_HOUSING_OWNER_EMAIL)
            sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()

            conversation, error = app.get_or_create_accommodation_conversation(
                con,
                "FFH-DEMO-LOCATION-01",
                sender,
            )
            context = app.chat_listing_context(con, sender_id, "FFH-DEMO-LOCATION-01", "")

            self.assertFalse(error)
            self.assertIsNotNone(conversation)
            self.assertEqual(int(context["ownerUserId"]), owner_id)
            self.assertEqual(context["ownerName"], app.SAMPLE_HOUSING_OWNER_NAME)
            participant = con.execute(
                "SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?",
                (conversation["id"], owner_id),
            ).fetchone()
            self.assertIsNotNone(participant)


if __name__ == "__main__":
    unittest.main()
