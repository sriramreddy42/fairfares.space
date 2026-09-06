import os
import base64
import tempfile
import time
import unittest
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

import app
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class ChatPrivateGroupsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            self.owner = self.insert_user(con, "Owner", "owner@groups.test")
            self.member = self.insert_user(con, "Member", "member@groups.test")
            self.outsider = self.insert_user(con, "Outsider", "outsider@groups.test")

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
        con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
        return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    @staticmethod
    def cache_city(con, city, state):
        metro_key = f"test-{city.lower().replace(' ', '-').replace('.', '')}-{state.lower()}"
        con.execute(
            "INSERT INTO accommodation_metros (metro_key, name, country, state, center_city) VALUES (?, ?, 'US', ?, ?)",
            (metro_key, f"{city} Metro Area", state, city),
        )
        metro_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        con.execute(
            "INSERT INTO accommodation_local_areas (metro_id, place_key, name, city, state) VALUES (?, ?, ?, ?, ?)",
            (metro_id, f"test-{metro_key}", f"{city}, {state}", city, state),
        )

    def create_group(self):
        group, error = app.create_chat_community(self.owner, "Private travelers", "GROUP", "Trusted members", "Denver")
        self.assertFalse(error)
        self.assertIsNotNone(group)
        return group

    def test_self_conversation_keeps_current_profile_avatar_identity(self):
        stored_photo = f"r2://{app.R2_BUCKET_NAME}/fairfares/profiles/owner-current.png"
        with app.db() as con:
            con.execute("UPDATE users SET profile_photo_url = ? WHERE id = ?", (stored_photo, self.owner))
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES (?, 'DIRECT', ?)",
                ("self-avatar-thread", "Owner"),
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                (conversation_id, self.owner),
            )

        conversation = next(item for item in app.get_chat_conversations_for_user(self.owner) if item["id"] == "self-avatar-thread")
        self.assertEqual(conversation["otherUserId"], self.owner)
        self.assertEqual(conversation["otherName"], "Owner")
        self.assertEqual(conversation["otherPhotoUrl"], stored_photo)

    def test_group_participant_sync_restores_notification_recipients(self):
        group = self.create_group()
        with app.db() as con:
            community = con.execute("SELECT * FROM chat_communities WHERE public_id = ?", (group["id"],)).fetchone()
            con.execute(
                "INSERT INTO chat_community_members (community_id, user_id, role) VALUES (?, ?, 'MEMBER')",
                (int(community["id"]), self.member),
            )
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
            conversation_id = int(conversation["id"])
            con.execute(
                "DELETE FROM chat_participants WHERE conversation_id = ? AND user_id = ?",
                (conversation_id, self.member),
            )

            app.sync_chat_conversation_members_from_community(con, conversation_id, int(community["id"]))
            recipients = {
                int(row["user_id"])
                for row in con.execute("SELECT user_id FROM chat_participants WHERE conversation_id = ?", (conversation_id,))
            }

        self.assertEqual(recipients, {self.owner, self.member})

    def test_private_group_is_hidden_and_raw_join_is_rejected(self):
        group = self.create_group()
        self.assertEqual(group["visibility"], "PRIVATE")
        self.assertFalse(any(row["id"] == group["id"] for row in app.get_chat_communities_for_user(self.outsider)))
        joined, error = app.join_chat_community(group["id"], self.outsider)
        self.assertIsNone(joined)
        self.assertIn("private", error.lower())

    def test_joined_members_can_edit_group_details_and_outsiders_cannot(self):
        group = self.create_group()
        with app.db() as con:
            community_id = int(con.execute(
                "SELECT id FROM chat_communities WHERE public_id = ?", (group["id"],)
            ).fetchone()["id"])
            con.execute(
                "INSERT INTO chat_community_members (community_id, user_id, role) VALUES (?, ?, 'MEMBER')",
                (community_id, self.member),
            )

        updated, error = app.update_chat_group_details(
            group["id"], self.member, "  Member Updated Group  ", "  Shared   details  ", " Aurora, CO "
        )
        self.assertFalse(error)
        self.assertEqual(updated["name"], "Member Updated Group")
        self.assertEqual(updated["description"], "Shared details")
        self.assertEqual(updated["area"], "Aurora, CO")

        token, error = app.create_chat_group_invite(group["id"], self.member)
        self.assertFalse(error)
        self.assertTrue(token)

        rejected, error = app.update_chat_group_details(
            group["id"], self.outsider, "Outsider edit", "No", "Nowhere"
        )
        self.assertIsNone(rejected)
        self.assertIn("join this group", error.lower())
        outsider_token, error = app.create_chat_group_invite(group["id"], self.outsider)
        self.assertFalse(outsider_token)
        self.assertIn("join this group", error.lower())

    def test_public_group_suggestions_follow_supported_city(self):
        menlo_groups = app.get_chat_communities_for_user(self.outsider, "Menlo Park, CA")
        menlo_names = {row["name"] for row in menlo_groups}
        self.assertIn("Menlo Park Housing & Roommates", menlo_names)
        self.assertIn("Menlo Park Ride Share", menlo_names)
        self.assertIn("Menlo Park Community", menlo_names)
        self.assertNotIn("Denver Roommates", menlo_names)
        self.assertTrue(all(row["virtual"] for row in menlo_groups if row["area"] == "Menlo Park, CA"))

        with app.db() as con:
            self.assertEqual(con.execute(
                "SELECT COUNT(*) AS total FROM chat_communities WHERE area_label = 'Menlo Park, CA'"
            ).fetchone()["total"], 0)

        local_group = next(row for row in menlo_groups if row["name"] == "Menlo Park Ride Share")
        joined, error = app.join_chat_community(
            local_group["id"], self.outsider, local_group["suggestionCity"], local_group["suggestionPurpose"]
        )
        self.assertFalse(error)
        self.assertTrue(joined["joined"])
        self.assertFalse(joined["virtual"])
        with app.db() as con:
            self.assertEqual(con.execute(
                "SELECT COUNT(*) AS total FROM chat_communities WHERE area_label = 'Menlo Park, CA'"
            ).fetchone()["total"], 1)
        # Joined groups stay available even after the member browses another city.
        denver_groups = app.get_chat_communities_for_user(self.outsider, "Denver, CO")
        self.assertIn(local_group["id"], {row["id"] for row in denver_groups})

    def test_public_group_suggestions_support_searched_us_city(self):
        seattle_groups = app.get_chat_communities_for_user(self.outsider, "Seattle, WA")
        seattle_names = {row["name"] for row in seattle_groups}
        self.assertIn("Seattle Housing & Roommates", seattle_names)
        self.assertIn("Seattle Ride Share", seattle_names)
        self.assertIn("Seattle Community", seattle_names)

        # Free-form searches must not create arbitrary public groups.
        invalid_groups = app.get_chat_communities_for_user(self.outsider, "somewhere near the airport")
        self.assertNotIn("Somewhere Near The Airport Community", {row["name"] for row in invalid_groups})
        self.assertNotIn("Denver Roommates", {row["name"] for row in invalid_groups})

    def test_plain_st_louis_search_gets_canonical_local_suggestions(self):
        with app.db() as con:
            self.cache_city(con, "St. Louis", "MO")
        groups = app.get_chat_communities_for_user(self.outsider, "St. Louis")
        suggestions = {row["name"] for row in groups if not row["joined"] and row["area"] == "St. Louis, MO"}
        self.assertEqual(suggestions, {"St. Louis Housing & Roommates", "St. Louis Ride Share", "St. Louis Community"})
        self.assertNotIn("Denver Roommates", {row["name"] for row in groups})

    def test_joining_all_denver_groups_does_not_hide_miami_suggestions(self):
        for community in app.get_chat_communities_for_user(self.outsider, "Denver, CO"):
            if community["visibility"] == "PUBLIC":
                joined, error = app.join_chat_community(community["id"], self.outsider)
                self.assertFalse(error)
                self.assertTrue(joined["joined"])

        with app.db() as con:
            self.cache_city(con, "Miami", "FL")
        miami_groups = app.get_chat_communities_for_user(self.outsider, "Miami")
        suggestions = {row["name"] for row in miami_groups if not row["joined"]}
        self.assertEqual(suggestions, {"Miami Housing & Roommates", "Miami Ride Share", "Miami Community"})

    def test_existing_public_group_replaces_matching_virtual_suggestion(self):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO chat_communities (public_id, kind, name, description, area_label, visibility)
                VALUES ('SEATTLE-HOMES', 'GROUP', 'Seattle Student Housing', 'Rooms and apartments', 'Seattle, WA', 'PUBLIC')
                """
            )
        groups = app.get_chat_communities_for_user(self.outsider, "Seattle, WA")
        names = {row["name"] for row in groups}
        self.assertIn("Seattle Student Housing", names)
        self.assertNotIn("Seattle Housing & Roommates", names)
        self.assertIn("Seattle Ride Share", names)
        self.assertIn("Seattle Community", names)

    def test_virtual_suggestion_materializes_once_and_rejects_tampering(self):
        suggestion = next(
            row for row in app.get_chat_communities_for_user(self.member, "Dayton, OH")
            if row["suggestionPurpose"] == "COMMUNITY"
        )
        for user_id in (self.member, self.outsider):
            joined, error = app.join_chat_community(
                suggestion["id"], user_id, suggestion["suggestionCity"], suggestion["suggestionPurpose"]
            )
            self.assertFalse(error)
            self.assertTrue(joined["joined"])
        with app.db() as con:
            group = con.execute("SELECT id FROM chat_communities WHERE public_id = ?", (suggestion["id"],)).fetchone()
            self.assertIsNotNone(group)
            self.assertEqual(con.execute(
                "SELECT COUNT(*) AS total FROM chat_community_members WHERE community_id = ?", (group["id"],)
            ).fetchone()["total"], 2)

        rejected, error = app.join_chat_community("FFG-TAMPERED", self.owner, "Dayton, OH", "RIDES")
        self.assertIsNone(rejected)
        self.assertIn("not found", error.lower())

    def test_invite_is_hashed_and_joins_once(self):
        group = self.create_group()
        token, error = app.create_chat_group_invite(group["id"], self.owner, max_uses=1)
        self.assertFalse(error)
        with app.db() as con:
            row = con.execute("SELECT * FROM chat_group_invites").fetchone()
            self.assertNotEqual(row["token_hash"], token)
            self.assertEqual(row["token_hash"], app.chat_group_invite_hash(token))
            self.assertIsNotNone(app.chat_group_share_row(con, token))
        joined, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertEqual(joined["memberRole"], "MEMBER")
        with app.db() as con:
            self.assertIsNone(app.chat_group_share_row(con, token))
        joined_again, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertIsNotNone(joined_again)
        blocked, error = app.join_chat_group_by_invite(token, self.outsider)
        self.assertIsNone(blocked)
        self.assertIn("limit", error.lower())

    def test_exhausted_invite_landing_is_explicitly_unavailable(self):
        group = self.create_group()
        token, error = app.create_chat_group_invite(group["id"], self.owner, max_uses=1)
        self.assertFalse(error)
        joined, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertIsNotNone(joined)

        response = {}
        handler = object.__new__(app.FairFaresHandler)
        handler.send_text = lambda body, content_type="text/plain; charset=utf-8", status=200, **kwargs: response.update(
            body=body, content_type=content_type, status=status, **kwargs
        )
        parsed = urllib.parse.urlparse(
            f"/chitthi/invite?group_invite={urllib.parse.quote(token)}"
        )
        handler.chitthi_invite_landing(parsed)

        self.assertEqual(response["status"], 410)
        self.assertIn("Invitation unavailable", response["body"])
        self.assertNotIn("Open in Chitthi", response["body"])

    def test_valid_invite_landing_keeps_token_and_uses_one_smart_cta(self):
        group = self.create_group()
        token, error = app.create_chat_group_invite(group["id"], self.owner)
        self.assertFalse(error)

        response = {}
        handler = object.__new__(app.FairFaresHandler)
        handler.send_text = lambda body, content_type="text/plain; charset=utf-8", status=200, **kwargs: response.update(
            body=body, content_type=content_type, status=status, **kwargs
        )
        parsed = urllib.parse.urlparse(
            f"/chitthi/invite?group_invite={urllib.parse.quote(token)}"
        )
        handler.chitthi_invite_landing(parsed)

        self.assertEqual(response["status"], 200)
        self.assertIn("Continue in FairFares", response["body"])
        self.assertEqual(response["body"].count('id="continue-fairfares"'), 1)
        self.assertNotIn("Install or update FairFares", response["body"])
        self.assertIn(urllib.parse.quote(token), response["body"])
        self.assertIn("apps.apple.com/us/app/fairfares-ltd/id6797162820", response["body"])
        self.assertIn(
            urllib.parse.quote("https://play.google.com/store/apps/details?id=com.fairfares.mobile", safe=""),
            response["body"],
        )

    def test_membership_changes_create_durable_system_timeline_events_once(self):
        public_group = next(
            row for row in app.get_chat_communities_for_user(self.outsider, "Denver, CO")
            if not row["joined"] and row["visibility"] == "PUBLIC"
        )
        joined, error = app.join_chat_community(
            public_group["id"], self.outsider, public_group["suggestionCity"], public_group["suggestionPurpose"]
        )
        self.assertFalse(error)
        self.assertTrue(joined["joined"])
        app.join_chat_community(public_group["id"], self.outsider)
        with app.db() as con:
            events = con.execute(
                "SELECT message_type, message_text FROM chat_messages ORDER BY id"
            ).fetchall()
        self.assertEqual([(row["message_type"], row["message_text"]) for row in events], [
            ("SYSTEM", "Outsider joined from the community")
        ])

    def test_admin_add_and_private_invite_use_distinct_system_event_copy(self):
        group = self.create_group()
        self.assertFalse(app.add_chat_group_member(group["id"], self.owner, self.member))
        token, error = app.create_chat_group_invite(group["id"], self.owner)
        self.assertFalse(error)
        joined, error = app.join_chat_group_by_invite(token, self.outsider)
        self.assertFalse(error)
        self.assertTrue(joined["joined"])
        with app.db() as con:
            events = con.execute(
                "SELECT message_type, message_text FROM chat_messages ORDER BY id"
            ).fetchall()
        self.assertEqual([(row["message_type"], row["message_text"]) for row in events], [
            ("SYSTEM", "Owner added Member"),
            ("SYSTEM", "Outsider joined via an invite"),
        ])

    def test_new_group_member_history_starts_at_membership_event(self):
        group = self.create_group()
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
            old_message = app.save_chat_message(
                con, int(conversation["id"]), owner, "Private conversation before joining", "old-group-message"
            )
            old_message_id = int(old_message["id"])

        token, error = app.create_chat_group_invite(group["id"], self.owner)
        self.assertFalse(error)
        joined, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertTrue(joined["joined"])

        with app.db() as con:
            participant = con.execute(
                """SELECT participant.visible_from_message_id, conversation.id AS conversation_id
                   FROM chat_participants participant
                   JOIN chat_conversations conversation ON conversation.id = participant.conversation_id
                   JOIN chat_communities community ON community.id = conversation.community_id
                   WHERE community.public_id = ? AND participant.user_id = ?""",
                (group["id"], self.member),
            ).fetchone()
            visible_ids = [int(row["id"]) for row in con.execute(
                """SELECT id FROM chat_messages
                   WHERE conversation_id = ? AND id >= ? ORDER BY id""",
                (int(participant["conversation_id"]), int(participant["visible_from_message_id"])),
            ).fetchall()]
            membership_event = con.execute(
                "SELECT id FROM chat_messages WHERE message_text = 'Member joined via an invite'"
            ).fetchone()

        self.assertGreater(int(participant["visible_from_message_id"]), old_message_id)
        self.assertNotIn(old_message_id, visible_ids)
        self.assertEqual(visible_ids, [int(membership_event["id"])])

    def test_invite_preview_does_not_join_or_consume_invitation(self):
        group = self.create_group()
        with app.db() as con:
            con.execute(
                "UPDATE chat_communities SET photo_url = '/uploads/groups/private-travelers.jpg' WHERE public_id = ?",
                (group["id"],),
            )
        token, error = app.create_chat_group_invite(group["id"], self.owner, max_uses=1)
        self.assertFalse(error)
        preview, error = app.preview_chat_group_invite(token, self.member)
        self.assertFalse(error)
        self.assertEqual(preview["name"], "Private travelers")
        self.assertEqual(preview["photoUrl"], "/uploads/groups/private-travelers.jpg")
        self.assertEqual(preview["memberCount"], 1)
        self.assertFalse(preview["alreadyMember"])
        with app.db() as con:
            invite = con.execute("SELECT use_count FROM chat_group_invites").fetchone()
            self.assertEqual(int(invite["use_count"]), 0)
            self.assertFalse(con.execute(
                "SELECT 1 FROM chat_community_members WHERE user_id = ?", (self.member,)
            ).fetchone())

    def test_signed_public_invite_supports_legacy_token_join_flow(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO chat_communities
                   (public_id, kind, name, description, area_label, visibility, photo_url)
                   VALUES ('FFG-LEGACY-PUBLIC', 'GROUP', 'Legacy public group', 'Compatible with 0.1.6', 'Denver, CO', 'PUBLIC', '/uploads/groups/legacy.jpg')"""
            )
        token = app.public_chat_group_invite_token("FFG-LEGACY-PUBLIC")
        self.assertGreaterEqual(len(token), 24)
        with app.db() as con:
            share_group = app.chat_group_share_row(con, token)
        self.assertIsNotNone(share_group)
        self.assertEqual(share_group["name"], "Legacy public group")
        self.assertEqual(share_group["description"], "Compatible with 0.1.6")
        self.assertEqual(share_group["photo_url"], "/uploads/groups/legacy.jpg")
        preview, error = app.preview_chat_group_invite(token, self.member)
        self.assertFalse(error)
        self.assertEqual(preview["id"], "FFG-LEGACY-PUBLIC")
        self.assertEqual(preview["photoUrl"], "/uploads/groups/legacy.jpg")
        self.assertFalse(preview["alreadyMember"])

        joined, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertTrue(joined["joined"])
        preview, error = app.preview_chat_group_invite(token, self.member)
        self.assertFalse(error)
        self.assertTrue(preview["alreadyMember"])

    def test_legacy_public_community_id_invite_preview_returns_group_photo(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO chat_communities
                   (public_id, kind, name, description, area_label, visibility, photo_url)
                   VALUES ('FFG-LEGACY-ID', 'GROUP', 'Legacy id group', 'Older shared message', 'Dayton, OH', 'PUBLIC', '/uploads/groups/legacy-id.jpg')"""
            )
            member = con.execute("SELECT * FROM users WHERE id = ?", (self.member,)).fetchone()
        responses = []
        handler = object.__new__(app.FairFaresHandler)
        handler.current_user = lambda: member
        handler.send_json = lambda payload, status=200: responses.append((payload, status))
        handler.api_chat_group_invite_preview(urllib.parse.urlparse(
            "/api/chat/groups/invite-preview?community_id=FFG-LEGACY-ID"
        ))
        payload, status = responses.pop()
        self.assertEqual(status, 200)
        self.assertEqual(payload["group"]["name"], "Legacy id group")
        self.assertEqual(payload["group"]["photoUrl"], "/uploads/groups/legacy-id.jpg")

    def test_legacy_private_community_id_is_not_disclosed_by_invite_preview(self):
        group = self.create_group()
        with app.db() as con:
            member = con.execute("SELECT * FROM users WHERE id = ?", (self.member,)).fetchone()
        responses = []
        handler = object.__new__(app.FairFaresHandler)
        handler.current_user = lambda: member
        handler.send_json = lambda payload, status=200: responses.append((payload, status))
        handler.api_chat_group_invite_preview(urllib.parse.urlparse(
            f"/api/chat/groups/invite-preview?community_id={urllib.parse.quote(group['id'])}"
        ))
        payload, status = responses.pop()
        self.assertEqual(status, 400)
        self.assertNotIn("Private travelers", str(payload))

    def test_signed_public_invite_rejects_tampering_and_private_groups(self):
        group = self.create_group()
        private_token = app.public_chat_group_invite_token(group["id"])
        joined, error = app.join_chat_group_by_invite(private_token, self.outsider)
        self.assertIsNone(joined)
        self.assertIn("private", error.lower())

        tampered = private_token[:-1] + ("0" if private_token[-1] != "0" else "1")
        preview, error = app.preview_chat_group_invite(tampered, self.outsider)
        self.assertIsNone(preview)
        self.assertIn("invalid", error.lower())

    def test_expired_and_revoked_invites_are_rejected(self):
        group = self.create_group()
        expired_token, _ = app.create_chat_group_invite(group["id"], self.owner)
        with app.db() as con:
            con.execute("UPDATE chat_group_invites SET expires_at = ?", ((datetime.utcnow() - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S"),))
        joined, error = app.join_chat_group_by_invite(expired_token, self.member)
        self.assertIsNone(joined)
        self.assertIn("expired", error.lower())
        revoked_token, _ = app.create_chat_group_invite(group["id"], self.owner)
        self.assertFalse(app.revoke_chat_group_invites(group["id"], self.owner))
        joined, error = app.join_chat_group_by_invite(revoked_token, self.member)
        self.assertIsNone(joined)
        self.assertIn("revoked", error.lower())

    def test_owner_controls_roles_and_admin_cannot_remove_owner(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        with app.db() as con:
            owner_row = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner_row)
            self.assertFalse(error)
            conversation_id = int(conversation["id"])
            self.assertTrue(con.execute("SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?", (conversation_id, self.member)).fetchone())
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.member, "ROLE", "ADMIN"))
        self.assertIn("permission", app.update_chat_group_member(group["id"], self.member, self.owner, "REMOVE").lower())
        self.assertIn("transfer", app.update_chat_group_member(group["id"], self.owner, self.owner, "LEAVE").lower())
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.member, "REMOVE"))
        with app.db() as con:
            self.assertFalse(con.execute("SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?", (conversation_id, self.member)).fetchone())
        members, error = app.get_chat_group_members(group["id"], self.owner)
        self.assertFalse(error)
        self.assertEqual([member["id"] for member in members], [self.owner])

    def test_owner_can_add_member_directly_and_outsider_cannot(self):
        group = self.create_group()
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
            conversation_id = int(conversation["id"])
        self.assertFalse(app.add_chat_group_member(group["id"], self.owner, self.member))
        with app.db() as con:
            self.assertTrue(con.execute(
                "SELECT 1 FROM chat_community_members WHERE community_id = (SELECT id FROM chat_communities WHERE public_id = ?) AND user_id = ?",
                (group["id"], self.member),
            ).fetchone())
            self.assertTrue(con.execute(
                "SELECT 1 FROM chat_participants WHERE conversation_id = ? AND user_id = ?",
                (conversation_id, self.member),
            ).fetchone())
        self.assertIn("owners and admins", app.add_chat_group_member(group["id"], self.outsider, self.member).lower())

    def test_owner_can_transfer_ownership_and_then_leave(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.member, "TRANSFER"))
        members, error = app.get_chat_group_members(group["id"], self.member)
        self.assertFalse(error)
        roles = {member["id"]: member["role"] for member in members}
        self.assertEqual(roles[self.member], "OWNER")
        self.assertEqual(roles[self.owner], "MEMBER")
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.owner, "LEAVE"))

    def test_member_who_leaves_cannot_list_or_reopen_group_messages(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
            conversation_public_id = conversation["public_id"]
        self.assertTrue(any(row["id"] == conversation_public_id for row in app.get_chat_conversations_for_user(self.member)))
        self.assertFalse(app.update_chat_group_member(group["id"], self.member, self.member, "LEAVE"))
        self.assertFalse(any(row["id"] == conversation_public_id for row in app.get_chat_conversations_for_user(self.member)))
        with app.db() as con:
            self.assertIsNone(app.get_chat_conversation_by_public_id(con, conversation_public_id, self.member))

    def test_compact_group_apis_keep_public_and_numeric_community_ids_separate(self):
        group = self.create_group()
        self.assertTrue(str(group["id"]).startswith("FFG-"))
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            con.execute(
                "UPDATE chat_communities SET photo_url = ? WHERE public_id = ?",
                ("data:image/png;base64,iVBORw0KGgo=", group["id"]),
            )
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
            conversation_public_id = str(conversation["public_id"])

        responses = []
        handler = object.__new__(app.FairFaresHandler)
        handler.current_user = lambda: owner
        handler.public_origin = lambda: "https://www.fairfare.space"
        handler.send_json = lambda payload, status=200: responses.append((payload, status))

        handler.api_chat_conversations(urllib.parse.urlparse("/api/chat/conversations?compact_senders=1"))
        inbox, status = responses.pop()
        self.assertEqual(status, 200)
        self.assertEqual(inbox["conversations"][0]["communityId"], group["id"])
        self.assertIn("/api/chat/notification-avatar?community=", inbox["conversations"][0]["otherPhotoUrl"])

        handler.api_chat_messages(urllib.parse.urlparse(
            f"/api/chat/messages?conversation_id={conversation_public_id}&compact_senders=1"
        ))
        thread, status = responses.pop()
        self.assertEqual(status, 200)
        self.assertEqual(thread["conversation"]["communityId"], group["id"])
        self.assertIn("/api/chat/notification-avatar?community=", thread["conversation"]["otherPhotoUrl"])

    def test_encrypted_message_stores_only_placeholder_and_per_device_envelopes(self):
        with app.db() as con:
            con.execute("INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('CHAT-E2EE', 'DIRECT', 'Secure chat')")
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, self.owner))
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, self.member))
        owner_key = base64.b64encode(b"A" * 32).decode("ascii")
        member_key = base64.b64encode(b"B" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.owner, "owner-device-01", owner_key))
        self.assertFalse(app.register_chat_device_key(self.member, "member-device-01", member_key))
        with app.db() as con:
            conversation = con.execute("SELECT * FROM chat_conversations WHERE id = ?", (conversation_id,)).fetchone()
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            envelopes = [
                {"recipientUserId": self.owner, "recipientDeviceId": "owner-device-01", "senderPublicKey": owner_key, "nonce": "nonce-owner", "ciphertext": "cipher-owner"},
                {"recipientUserId": self.member, "recipientDeviceId": "member-device-01", "senderPublicKey": owner_key, "nonce": "nonce-member", "ciphertext": "cipher-member"},
            ]
            message, error = app.save_encrypted_chat_message(con, conversation, owner, envelopes, "encrypted-1")
            self.assertFalse(error)
            self.assertNotIn("secret words", message["message_text"])
            stored = con.execute("SELECT * FROM chat_message_envelopes WHERE message_id = ?", (message["id"],)).fetchall()
            self.assertEqual(len(stored), 2)
            unregistered_key = base64.b64encode(b"X" * 32).decode("ascii")
            rejected, error = app.save_encrypted_chat_message(con, conversation, owner, [{**item, "senderPublicKey": unregistered_key} for item in envelopes], "encrypted-2")
            self.assertIsNone(rejected)
            self.assertIn("sender", error.lower())

            # A 32 KB JPEG becomes roughly 59 KB after thumbnail base64, JSON,
            # authenticated encryption and envelope base64. Exercise that real
            # expansion instead of only the former compact-preview size.
            sharper_preview_envelopes = [{**item, "ciphertext": "x" * 60_000} for item in envelopes]
            sharper_message, error = app.save_encrypted_chat_message(
                con, conversation, owner, sharper_preview_envelopes, "encrypted-sharp-preview"
            )
            self.assertFalse(error)
            self.assertIsNotNone(sharper_message)

            oversized_envelopes = [
                {**item, "ciphertext": "x" * (app.MAX_CHAT_ENVELOPE_CIPHERTEXT_CHARS + 1)}
                for item in envelopes
            ]
            rejected, error = app.save_encrypted_chat_message(
                con, conversation, owner, oversized_envelopes, "encrypted-oversized-preview"
            )
            self.assertIsNone(rejected)
            self.assertIn("invalid", error.lower())

    def test_device_key_registration_rejects_malformed_curve_key(self):
        malformed = base64.b64encode(b"too short").decode("ascii")
        error = app.register_chat_device_key(self.owner, "owner-device-invalid", malformed)
        self.assertIn("valid device key", error.lower())
        with app.db() as con:
            self.assertFalse(con.execute(
                "SELECT 1 FROM chat_device_keys WHERE user_id = ? AND device_id = ?",
                (self.owner, "owner-device-invalid"),
            ).fetchone())

    def test_device_id_cannot_be_silently_rebound_to_another_key(self):
        original_key = base64.b64encode(b"A" * 32).decode("ascii")
        replacement_key = base64.b64encode(b"B" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.owner, "immutable-device-01", original_key))
        error = app.register_chat_device_key(self.owner, "immutable-device-01", replacement_key)
        self.assertIn("already bound", error.lower())
        with app.db() as con:
            stored = con.execute(
                "SELECT public_key FROM chat_device_keys WHERE user_id = ? AND device_id = ?",
                (self.owner, "immutable-device-01"),
            ).fetchone()
        self.assertEqual(stored["public_key"], original_key)

    def test_removed_group_member_is_excluded_from_future_device_envelopes(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        app.register_chat_device_key(self.owner, "owner-rotation-device", base64.b64encode(b"A" * 32).decode("ascii"))
        app.register_chat_device_key(self.member, "member-rotation-device", base64.b64encode(b"B" * 32).decode("ascii"))
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, _ = app.get_or_create_community_conversation(con, group["id"], owner)
        keys, warning, can_send = app.get_chat_conversation_device_keys(conversation["public_id"], self.owner)
        self.assertFalse(warning)
        self.assertTrue(can_send)
        self.assertEqual({item["userId"] for item in keys}, {self.owner, self.member})
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.member, "REMOVE"))
        keys, warning, can_send = app.get_chat_conversation_device_keys(conversation["public_id"], self.owner)
        self.assertFalse(warning)
        self.assertTrue(can_send)
        self.assertEqual({item["userId"] for item in keys}, {self.owner})
        denied, error, can_send = app.get_chat_conversation_device_keys(conversation["public_id"], self.member)
        self.assertIsNone(denied)
        self.assertFalse(can_send)
        self.assertIn("not found", error.lower())

    def test_unkeyed_member_does_not_freeze_encrypted_group_messaging(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        owner_key = base64.b64encode(b"A" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.owner, "owner-group-device", owner_key))
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
        keys, warning, can_send = app.get_chat_conversation_device_keys(conversation["public_id"], self.owner)
        self.assertFalse(warning)
        self.assertTrue(can_send)
        self.assertEqual({item["userId"] for item in keys}, {self.owner})
        with app.db() as con:
            conversation = con.execute("SELECT * FROM chat_conversations WHERE public_id = ?", (conversation["public_id"],)).fetchone()
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            envelopes = [{
                "recipientUserId": self.owner,
                "recipientDeviceId": "owner-group-device",
                "senderPublicKey": owner_key,
                "nonce": "group-nonce",
                "ciphertext": "group-ciphertext",
            }]
            message, error = app.save_encrypted_chat_message(con, conversation, owner, envelopes, "group-message-1")
            self.assertFalse(error)
            self.assertIsNotNone(message)

    def test_direct_chat_readiness_recovers_when_recipient_registers_after_opening_app(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type) VALUES ('direct-key-recovery', 'DIRECT')"
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            for user_id in (self.owner, self.member):
                con.execute(
                    "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                    (conversation_id, user_id),
                )

        keys, warning, can_send = app.get_chat_conversation_device_keys("direct-key-recovery", self.owner)
        self.assertEqual(keys, [])
        self.assertFalse(can_send)
        self.assertIn("this device", warning.lower())

        owner_key = base64.b64encode(b"A" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.owner, "owner-direct-device", owner_key))
        keys, warning, can_send = app.get_chat_conversation_device_keys("direct-key-recovery", self.owner)
        self.assertEqual({item["userId"] for item in keys}, {self.owner})
        self.assertFalse(can_send)
        self.assertIn("Member", warning)

        member_key = base64.b64encode(b"B" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.member, "member-direct-device", member_key))
        keys, warning, can_send = app.get_chat_conversation_device_keys("direct-key-recovery", self.owner)
        self.assertFalse(warning)
        self.assertTrue(can_send)
        self.assertEqual({item["userId"] for item in keys}, {self.owner, self.member})

    def test_signed_relay_rejects_tampering_expiry_and_duplicates(self):
        group = self.create_group()
        signing_key = Ed25519PrivateKey.generate()
        signing_public = base64.b64encode(signing_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )).decode()
        sender_box_key = base64.b64encode(b"A" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.owner, "owner-relay-device", sender_box_key, signing_public))
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, error = app.get_or_create_community_conversation(con, group["id"], owner)
            self.assertFalse(error)
        now = int(time.time())
        unsigned = {
            "version": 1,
            "senderUserId": self.owner,
            "senderDeviceId": "owner-relay-device",
            "conversationId": conversation["public_id"],
            "clientMessageId": "relay-dedup-1",
            "createdAt": now,
            "expiresAt": now + 600,
            "envelopes": [{
                "recipientUserId": self.owner,
                "recipientDeviceId": "owner-relay-device",
                "senderPublicKey": sender_box_key,
                "nonce": "relay-nonce",
                "ciphertext": "relay-ciphertext",
            }],
        }
        bundle = {**unsigned, "signature": base64.b64encode(signing_key.sign(app.chat_relay_signature_payload(unsigned))).decode()}
        first, error = app.accept_encrypted_chat_relay(bundle)
        self.assertFalse(error)
        duplicate, error = app.accept_encrypted_chat_relay(bundle)
        self.assertFalse(error)
        self.assertEqual(first["id"], duplicate["id"])
        tampered = {**bundle, "conversationId": "FFC-TAMPERED"}
        rejected, error = app.accept_encrypted_chat_relay(tampered)
        self.assertIsNone(rejected)
        self.assertIn("signature", error.lower())
        impersonated = {**bundle, "senderUserId": self.member}
        rejected, error = app.accept_encrypted_chat_relay(impersonated)
        self.assertIsNone(rejected)
        self.assertIn("signature", error.lower())
        expired_unsigned = {**unsigned, "clientMessageId": "relay-expired", "createdAt": now - 1200, "expiresAt": now - 600}
        expired = {**expired_unsigned, "signature": base64.b64encode(signing_key.sign(app.chat_relay_signature_payload(expired_unsigned))).decode()}
        rejected, error = app.accept_encrypted_chat_relay(expired)
        self.assertIsNone(rejected)
        self.assertIn("expired", error.lower())


if __name__ == "__main__":
    unittest.main()
