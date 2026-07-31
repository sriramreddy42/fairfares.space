import os
import base64
import tempfile
import time
import unittest
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

    def create_group(self):
        group, error = app.create_chat_community(self.owner, "Private travelers", "GROUP", "Trusted members", "Denver")
        self.assertFalse(error)
        self.assertIsNotNone(group)
        return group

    def test_private_group_is_hidden_and_raw_join_is_rejected(self):
        group = self.create_group()
        self.assertEqual(group["visibility"], "PRIVATE")
        self.assertFalse(any(row["id"] == group["id"] for row in app.get_chat_communities_for_user(self.outsider)))
        joined, error = app.join_chat_community(group["id"], self.outsider)
        self.assertIsNone(joined)
        self.assertIn("private", error.lower())

    def test_invite_is_hashed_and_joins_once(self):
        group = self.create_group()
        token, error = app.create_chat_group_invite(group["id"], self.owner, max_uses=1)
        self.assertFalse(error)
        with app.db() as con:
            row = con.execute("SELECT * FROM chat_group_invites").fetchone()
            self.assertNotEqual(row["token_hash"], token)
            self.assertEqual(row["token_hash"], app.chat_group_invite_hash(token))
        joined, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertEqual(joined["memberRole"], "MEMBER")
        joined_again, error = app.join_chat_group_by_invite(token, self.member)
        self.assertFalse(error)
        self.assertIsNotNone(joined_again)
        blocked, error = app.join_chat_group_by_invite(token, self.outsider)
        self.assertIsNone(blocked)
        self.assertIn("limit", error.lower())

    def test_invite_preview_does_not_join_or_consume_invitation(self):
        group = self.create_group()
        token, error = app.create_chat_group_invite(group["id"], self.owner, max_uses=1)
        self.assertFalse(error)
        preview, error = app.preview_chat_group_invite(token, self.member)
        self.assertFalse(error)
        self.assertEqual(preview["name"], "Private travelers")
        self.assertEqual(preview["memberCount"], 1)
        self.assertFalse(preview["alreadyMember"])
        with app.db() as con:
            invite = con.execute("SELECT use_count FROM chat_group_invites").fetchone()
            self.assertEqual(int(invite["use_count"]), 0)
            self.assertFalse(con.execute(
                "SELECT 1 FROM chat_community_members WHERE user_id = ?", (self.member,)
            ).fetchone())

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

    def test_encrypted_message_stores_only_placeholder_and_per_device_envelopes(self):
        with app.db() as con:
            con.execute("INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('CHAT-E2EE', 'DIRECT', 'Secure chat')")
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, self.owner))
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, self.member))
        owner_key = "A" * 44
        member_key = "B" * 44
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
            rejected, error = app.save_encrypted_chat_message(con, conversation, owner, [{**item, "senderPublicKey": "X" * 44} for item in envelopes], "encrypted-2")
            self.assertIsNone(rejected)
            self.assertIn("sender", error.lower())

    def test_removed_group_member_is_excluded_from_future_device_envelopes(self):
        group = self.create_group()
        token, _ = app.create_chat_group_invite(group["id"], self.owner)
        app.join_chat_group_by_invite(token, self.member)
        app.register_chat_device_key(self.owner, "owner-rotation-device", "A" * 44)
        app.register_chat_device_key(self.member, "member-rotation-device", "B" * 44)
        with app.db() as con:
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner,)).fetchone()
            conversation, _ = app.get_or_create_community_conversation(con, group["id"], owner)
        keys, warning = app.get_chat_conversation_device_keys(conversation["public_id"], self.owner)
        self.assertFalse(warning)
        self.assertEqual({item["userId"] for item in keys}, {self.owner, self.member})
        self.assertFalse(app.update_chat_group_member(group["id"], self.owner, self.member, "REMOVE"))
        keys, warning = app.get_chat_conversation_device_keys(conversation["public_id"], self.owner)
        self.assertFalse(warning)
        self.assertEqual({item["userId"] for item in keys}, {self.owner})
        denied, error = app.get_chat_conversation_device_keys(conversation["public_id"], self.member)
        self.assertIsNone(denied)
        self.assertIn("not found", error.lower())

    def test_signed_relay_rejects_tampering_expiry_and_duplicates(self):
        group = self.create_group()
        signing_key = Ed25519PrivateKey.generate()
        signing_public = base64.b64encode(signing_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )).decode()
        sender_box_key = "A" * 44
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
