import json
import base64
import hashlib
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import app


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


class ChatRealtimeTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app._CHAT_TYPING_LOCK:
            app._CHAT_TYPING.clear()
        with app.db() as con:
            con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'sender@realtime.test', 'x', 1)")
            self.sender_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Recipient', 'recipient@realtime.test', 'x', 1)")
            self.recipient_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Outsider', 'outsider@realtime.test', 'x', 1)")
            self.outsider_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('sender-token', ?)", (self.sender_id,))
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('recipient-token', ?)", (self.recipient_id,))
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('outsider-token', ?)", (self.outsider_id,))
            con.execute("INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('CHAT-REALTIME', 'DIRECT', 'Realtime test')")
            self.conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (self.conversation_id, self.sender_id))
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (self.conversation_id, self.recipient_id))

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
        with app._CHAT_TYPING_LOCK:
            app._CHAT_TYPING.clear()
        self.temp_dir.cleanup()

    def start_server(self):
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    def event_request(self, server, token, after=0):
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/api/chat/events?conversation_id=CHAT-REALTIME&after={after}&wait=0",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_chat_read_endpoints_do_not_run_remote_storage_housekeeping(self):
        server, thread = self.start_server()
        try:
            with patch.object(app, "cleanup_expired_chitthi_attachments") as expired, \
                 patch.object(app, "cleanup_deleted_chitthi_messages") as deleted, \
                 patch.object(app, "cleanup_unfinalized_chitthi_uploads") as uploads:
                conversations = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat/conversations",
                    headers={"Authorization": "Bearer sender-token"},
                )
                with urllib.request.urlopen(conversations, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                messages = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat/messages?conversation_id=CHAT-REALTIME&wait=0",
                    headers={"Authorization": "Bearer sender-token"},
                )
                with urllib.request.urlopen(messages, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                expired.assert_not_called()
                deleted.assert_not_called()
                uploads.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_event_stream_authorizes_delivers_receipts_and_reconnects(self):
        with app.db() as con:
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            message = app.save_chat_message(con, self.conversation_id, sender, "hello live", "live-1")
            message_id = int(message["id"])

        server, thread = self.start_server()
        try:
            unauthorized = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/events?conversation_id=CHAT-REALTIME&wait=0"
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(unauthorized, timeout=3)
            self.assertEqual(error.exception.code, 401)

            status, delivered = self.event_request(server, "recipient-token")
            self.assertEqual(status, 200)
            self.assertEqual([row["text"] for row in delivered["messages"]], ["hello live"])
            self.assertEqual(delivered["cursor"], message_id)

            _, reconnect = self.event_request(server, "recipient-token", message_id)
            self.assertEqual(reconnect["messages"], [])
            self.assertEqual(reconnect["cursor"], message_id)

            _, sender_view = self.event_request(server, "sender-token", message_id)
            receipt = next(row for row in sender_view["receipts"] if row["id"] == message_id)
            self.assertEqual(receipt["status"], "seen")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_typing_status_is_authorized_visible_and_stoppable(self):
        server, thread = self.start_server()
        try:
            typing_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/typing",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "active": True}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(typing_request, timeout=3) as response:
                self.assertEqual(response.status, 200)

            _, recipient_view = self.event_request(server, "recipient-token")
            self.assertEqual(recipient_view["typing"], [{"userId": self.sender_id, "name": "Sender"}])
            _, sender_view = self.event_request(server, "sender-token")
            self.assertEqual(sender_view["typing"], [])

            stop_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/typing",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "active": False}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            urllib.request.urlopen(stop_request, timeout=3).close()
            _, stopped_view = self.event_request(server, "recipient-token")
            self.assertEqual(stopped_view["typing"], [])

            malformed_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/typing",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "active": "false"}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(malformed_request, timeout=3) as response:
                malformed_payload = json.loads(response.read().decode("utf-8"))
            self.assertFalse(malformed_payload["active"])
            _, malformed_view = self.event_request(server, "recipient-token")
            self.assertEqual(malformed_view["typing"], [])

            outsider_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/typing",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "active": True}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer outsider-token", "Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as outsider_error:
                urllib.request.urlopen(outsider_request, timeout=3)
            self.assertEqual(outsider_error.exception.code, 404)

            unauthorized = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/typing",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "active": True}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(unauthorized, timeout=3)
            self.assertEqual(error.exception.code, 401)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_reaction_add_notifies_message_sender_and_readding_is_a_new_event(self):
        with app.db() as con:
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            message = app.save_chat_message(con, self.conversation_id, sender, "reaction target", "reaction-target-1")
            message_id = int(message["id"])

        server, thread = self.start_server()
        try:
            def react():
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat/messages/react",
                    data=json.dumps({"conversationId": "CHAT-REALTIME", "messageId": message_id, "emoji": "👍"}).encode("utf-8"),
                    method="POST",
                    headers={"Authorization": "Bearer recipient-token", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 200)

            with patch.object(app, "send_mobile_push_for_users") as push:
                react()
                self.assertEqual(push.call_count, 1)
                first = push.call_args.args
                self.assertEqual(first[0], [self.sender_id])
                self.assertEqual(first[3]["type"], "CHITTHI_REACTION")
                self.assertEqual(first[3]["conversationId"], "CHAT-REALTIME")
                self.assertEqual(first[3]["messageId"], message_id)
                self.assertEqual(first[3]["reaction"], "👍")
                self.assertNotIn("reaction target", first[2])
                first_event = first[3]["event"]

                react()  # Removing the reaction must not notify.
                self.assertEqual(push.call_count, 1)

                react()  # Re-adding is a new user action and must notify.
                self.assertEqual(push.call_count, 2)
                self.assertNotEqual(first_event, push.call_args.args[3]["event"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_group_reaction_carries_native_group_participants(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name) VALUES ('GROUP-REACTION', 'GROUP', 'Reaction Group')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_community_members (community_id, user_id) VALUES (?, ?)",
                [
                    (community_id, self.sender_id),
                    (community_id, self.recipient_id),
                    (community_id, self.outsider_id),
                ],
            )
            con.execute(
                "UPDATE chat_conversations SET conversation_type = 'GROUP', community_id = ?, subject = 'Reaction Group' WHERE id = ?",
                (community_id, self.conversation_id),
            )
            con.execute(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                (self.conversation_id, self.outsider_id),
            )
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            message = app.save_chat_message(con, self.conversation_id, sender, "group reaction target", "group-reaction-target-1")
            message_id = int(message["id"])

        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/messages/react",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "messageId": message_id, "emoji": "😂"}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer recipient-token", "Content-Type": "application/json"},
            )
            with patch.object(app, "send_mobile_push_for_users") as push:
                with urllib.request.urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 200)

            payload = push.call_args.args[3]
            self.assertTrue(payload["isGroup"])
            self.assertEqual(payload["conversationName"], "Reaction Group")
            self.assertIn("community=", payload["groupAvatarUrl"])
            self.assertEqual(
                payload["communicationRecipients"],
                [{"id": self.outsider_id, "name": "Outsider"}],
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_group_mention_notifies_muted_target_without_waking_other_muted_members(self):
        with app.db() as con:
            con.execute("INSERT INTO chat_communities (public_id, kind, name) VALUES ('GROUP-MENTION', 'GROUP', 'Mention Group')")
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_community_members (community_id, user_id) VALUES (?, ?)",
                [(community_id, self.sender_id), (community_id, self.recipient_id), (community_id, self.outsider_id)],
            )
            con.execute(
                "UPDATE chat_conversations SET conversation_type = 'GROUP', community_id = ?, subject = 'Mention Group' WHERE id = ?",
                (community_id, self.conversation_id),
            )
            con.execute("INSERT INTO chat_participants (conversation_id, user_id, muted_at) VALUES (?, ?, CURRENT_TIMESTAMP)", (self.conversation_id, self.outsider_id))
            con.execute("UPDATE chat_participants SET muted_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?", (self.conversation_id, self.recipient_id))
            con.executemany(
                "INSERT INTO mobile_push_tokens (user_id, token, platform, enabled) VALUES (?, ?, 'ios', 1)",
                [(self.recipient_id, "ExponentPushToken[mention-target]"), (self.outsider_id, "ExponentPushToken[muted-other]")],
            )
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            conversation = con.execute("SELECT * FROM chat_conversations WHERE id = ?", (self.conversation_id,)).fetchone()
            message = app.save_chat_message(con, self.conversation_id, sender, "🔒 End-to-end encrypted message", "mention-1")
            con.execute("INSERT INTO chat_message_mentions (message_id, user_id) VALUES (?, ?)", (int(message["id"]), self.recipient_id))
            handler = object.__new__(QuietHandler)
            handler.public_origin = lambda: "https://fairfares.test"
            with patch.object(app, "enqueue_mobile_pushes") as enqueue:
                handler.notify_chat_recipients(con, conversation, sender, message)

        enqueue.assert_called_once()
        recipients, _title, body, payload = enqueue.call_args.args
        self.assertEqual(recipients, [(self.recipient_id, "ExponentPushToken[mention-target]")])
        self.assertEqual(body, "Mentioned you in a group message")
        self.assertTrue(payload["isMention"])
        self.assertEqual(payload["conversationName"], "Mention Group")

    def test_group_mention_rejects_user_outside_conversation(self):
        with app.db() as con:
            con.execute("INSERT INTO chat_communities (public_id, kind, name) VALUES ('GROUP-MENTION-VALIDATION', 'GROUP', 'Mention Validation')")
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_community_members (community_id, user_id) VALUES (?, ?)",
                [(community_id, self.sender_id), (community_id, self.recipient_id)],
            )
            con.execute(
                "UPDATE chat_conversations SET conversation_type = 'GROUP', community_id = ?, subject = 'Mention Validation' WHERE id = ?",
                (community_id, self.conversation_id),
            )
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/messages",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "envelopes": [], "mentionedUserIds": [self.outsider_id]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(error.exception.code, 409)
            payload = json.loads(error.exception.read().decode("utf-8"))
            self.assertIn("no longer in this group", payload["message"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_contact_discovery_matches_every_verified_member_with_an_exact_saved_number(self):
        with app.db() as con:
            con.execute(
                "UPDATE users SET phone = '+1 (937) 555-0199', chat_phone_discoverable = 1 WHERE id = ?",
                (self.recipient_id,),
            )
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified, chat_phone_discoverable) VALUES ('Private Person', 'private@realtime.test', '+1 937 555 0188', 'x', 1, 0)"
            )
        discoverable_hash = hashlib.sha256(b"19375550199").hexdigest()
        private_hash = hashlib.sha256(b"19375550188").hexdigest()
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/people/by-contacts",
                data=json.dumps({"phoneHashes": [discoverable_hash, private_hash]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual([person["name"] for person in payload["people"]], ["Recipient", "Private Person"])
            self.assertEqual(payload["people"][0]["phoneHash"], discoverable_hash)
            self.assertEqual(payload["people"][1]["phoneHash"], private_hash)
            self.assertNotIn("phone", payload["people"][0])

            # The legacy flag must not prevent an exact saved-contact match.
            # Neither member needs prior Chitthi activity for discovery.
            with app.db() as con:
                con.execute(
                    "UPDATE users SET chat_phone_discoverable = 0 WHERE id = ?",
                    (self.recipient_id,),
                )
            legacy_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/people/by-contacts",
                data=json.dumps({"phoneHashes": [discoverable_hash, private_hash]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(legacy_request, timeout=3) as response:
                legacy_payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual([person["name"] for person in legacy_payload["people"]], ["Recipient", "Private Person"])

            national_hash = hashlib.sha256(b"9375550199").hexdigest()
            national_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/people/by-contacts",
                data=json.dumps({"phoneHashes": [national_hash]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(national_request, timeout=3) as response:
                national_payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual([person["name"] for person in national_payload["people"]], ["Recipient"])
            self.assertEqual(national_payload["people"][0]["phoneHash"], national_hash)

            with app.db() as con:
                con.execute(
                    "UPDATE users SET phone = '+65 8123 4567' WHERE id = ?",
                    (self.recipient_id,),
                )
            short_national_hash = hashlib.sha256(b"81234567").hexdigest()
            short_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/people/by-contacts",
                data=json.dumps({"phoneHashes": [short_national_hash]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(short_request, timeout=3) as response:
                short_payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual([person["name"] for person in short_payload["people"]], ["Recipient"])
            self.assertEqual(short_payload["people"][0]["phoneHash"], short_national_hash)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_sender_can_replace_encrypted_message_envelopes_without_exposing_plaintext(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'sender-device', 'sender-public-key')",
                (self.sender_id,),
            )
            con.execute(
                "INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'recipient-device', 'recipient-public-key')",
                (self.recipient_id,),
            )
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            original_envelopes = [
                {"recipientUserId": self.sender_id, "recipientDeviceId": "sender-device", "senderPublicKey": "sender-public-key", "nonce": "old-a", "ciphertext": "old-sender"},
                {"recipientUserId": self.recipient_id, "recipientDeviceId": "recipient-device", "senderPublicKey": "sender-public-key", "nonce": "old-b", "ciphertext": "old-recipient"},
            ]
            message, error = app.save_encrypted_chat_message(con, con.execute("SELECT * FROM chat_conversations WHERE id = ?", (self.conversation_id,)).fetchone(), sender, original_envelopes, "editable-1")
            self.assertEqual(error, "")
            message_id = int(message["id"])

        replacement_envelopes = [
            {"recipientUserId": self.sender_id, "recipientDeviceId": "sender-device", "senderPublicKey": "sender-public-key", "nonce": "new-a", "ciphertext": "new-sender"},
            {"recipientUserId": self.recipient_id, "recipientDeviceId": "recipient-device", "senderPublicKey": "sender-public-key", "nonce": "new-b", "ciphertext": "new-recipient"},
        ]
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/messages/edit",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "messageId": message_id, "envelopes": replacement_envelopes}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(payload["message"]["editedAt"])
            self.assertTrue(payload["message"]["canEdit"])

            with app.db() as con:
                stored = con.execute("SELECT message_text, edited_at FROM chat_messages WHERE id = ?", (message_id,)).fetchone()
                envelopes = con.execute("SELECT nonce, ciphertext FROM chat_message_envelopes WHERE message_id = ? ORDER BY recipient_user_id", (message_id,)).fetchall()
            self.assertEqual(stored["message_text"], "🔒 End-to-end encrypted message")
            self.assertTrue(stored["edited_at"])
            self.assertEqual({(row["nonce"], row["ciphertext"]) for row in envelopes}, {("new-a", "new-sender"), ("new-b", "new-recipient")})
            self.assertNotIn("replacement", json.dumps(payload).lower())

            recipient_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/messages/edit",
                data=json.dumps({"conversationId": "CHAT-REALTIME", "messageId": message_id, "envelopes": replacement_envelopes}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer recipient-token", "Content-Type": "application/json"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(recipient_request, timeout=3)
            self.assertEqual(error.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_encrypted_preview_envelopes_are_batched_and_membership_scoped(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'sender-device', 'sender-public-key')",
                (self.sender_id,),
            )
            con.execute(
                "INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'recipient-device', 'recipient-public-key')",
                (self.recipient_id,),
            )
            sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
            envelopes = [
                {
                    "recipientUserId": self.sender_id,
                    "recipientDeviceId": "sender-device",
                    "senderPublicKey": "sender-public-key",
                    "nonce": "sender-nonce",
                    "ciphertext": "sender-ciphertext",
                },
                {
                    "recipientUserId": self.recipient_id,
                    "recipientDeviceId": "recipient-device",
                    "senderPublicKey": "sender-public-key",
                    "nonce": "preview-nonce",
                    "ciphertext": "preview-ciphertext",
                }
            ]
            message, error = app.save_encrypted_chat_message(
                con,
                con.execute("SELECT * FROM chat_conversations WHERE id = ?", (self.conversation_id,)).fetchone(),
                sender,
                envelopes,
                "preview-1",
            )
            self.assertEqual(error, "")
            message_id = int(message["id"])

        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/preview-envelopes?message_ids={message_id}&device_id=recipient-device",
                headers={"Authorization": "Bearer recipient-token", "Origin": "http://localhost:8082"},
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:8082")
            self.assertEqual(payload["envelopes"], [{
                "messageId": message_id,
                "senderPublicKey": "sender-public-key",
                "nonce": "preview-nonce",
                "ciphertext": "preview-ciphertext",
            }])

            outsider_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/preview-envelopes?message_ids={message_id}&device_id=recipient-device",
                headers={"Authorization": "Bearer outsider-token"},
            )
            with urllib.request.urlopen(outsider_request, timeout=3) as response:
                outsider_payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(outsider_payload["envelopes"], [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_concurrent_sends_preserve_order_and_deduplicate_client_ids(self):
        def send(index):
            with app.db() as con:
                sender = con.execute("SELECT * FROM users WHERE id = ?", (self.sender_id,)).fetchone()
                key = "same-retry" if index >= 200 else f"unique-{index}"
                return int(app.save_chat_message(con, self.conversation_id, sender, f"message {index}", key)["id"])

        with ThreadPoolExecutor(max_workers=24) as executor:
            ids = list(executor.map(send, range(300)))

        with app.db() as con:
            rows = con.execute(
                "SELECT id, client_message_id FROM chat_messages WHERE conversation_id = ? ORDER BY id",
                (self.conversation_id,),
            ).fetchall()
        self.assertEqual(len(rows), 201)
        self.assertEqual(len([row for row in rows if row["client_message_id"] == "same-retry"]), 1)
        self.assertEqual(len(set(ids[200:])), 1)
        self.assertEqual([row["id"] for row in rows], sorted(row["id"] for row in rows))

    def test_image_attachment_requires_conversation_membership(self):
        server, thread = self.start_server()
        try:
            fake_jpeg = b"\xff\xd8\xff\xe0" + b"fairfares-image-test"
            body = json.dumps(
                {
                    "conversationId": "CHAT-REALTIME",
                    "dataUrl": f"data:image/jpeg;base64,{base64.b64encode(fake_jpeg).decode('ascii')}",
                    "caption": "route photo",
                    "clientMessageId": "image-1",
                }
            ).encode("utf-8")
            upload_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/attachments",
                data=body,
                method="POST",
                headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(upload_request, timeout=3) as response:
                uploaded = json.loads(response.read().decode("utf-8"))
            attachment_path = uploaded["message"]["attachmentUrl"]
            self.assertTrue(attachment_path.startswith("/api/chat/attachments/"))

            authorized = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}{attachment_path}",
                headers={"Authorization": "Bearer recipient-token"},
            )
            with urllib.request.urlopen(authorized, timeout=3) as response:
                self.assertEqual(response.read(), fake_jpeg)
                self.assertEqual(response.headers.get("Cache-Control"), "private, no-store")

            unauthenticated = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{attachment_path}")
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(unauthenticated, timeout=3)
            self.assertEqual(error.exception.code, 401)

            with app.db() as con:
                stored = con.execute("SELECT attachment_url FROM chat_messages WHERE client_message_id = 'image-1'").fetchone()["attachment_url"]
            public_path = stored.replace("local://", "/")
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}{public_path}", timeout=3)
            self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_file_poll_event_and_contact_messages(self):
        server, thread = self.start_server()
        try:
            def post(path, payload, token="sender-token"):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}{path}",
                    data=json.dumps(payload).encode("utf-8"),
                    method="POST",
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request, timeout=3) as response:
                    return response.status, json.loads(response.read().decode("utf-8"))

            pdf = b"%PDF-1.4\nFairFares test document\n%%EOF\n"
            status, file_payload = post("/api/chat/attachments", {
                "conversationId": "CHAT-REALTIME",
                "dataUrl": f"data:application/pdf;base64,{base64.b64encode(pdf).decode('ascii')}",
                "fileName": "ride-plan.pdf",
                "mimeType": "application/pdf",
                "clientMessageId": "file-1",
            })
            self.assertEqual(status, 201)
            self.assertEqual(file_payload["message"]["type"], "FILE")
            self.assertEqual(file_payload["message"]["metadata"]["fileName"], "ride-plan.pdf")
            download = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}{file_payload['message']['attachmentUrl']}",
                headers={"Authorization": "Bearer recipient-token"},
            )
            with urllib.request.urlopen(download, timeout=3) as response:
                self.assertEqual(response.read(), pdf)

            _, poll = post("/api/chat/rich-messages", {"conversationId": "CHAT-REALTIME", "type": "POLL", "metadata": {"question": "Pickup time?", "options": ["8 AM", "9 AM"]}, "clientMessageId": "poll-1"})
            self.assertEqual(poll["message"]["metadata"]["voteCounts"], [0, 0])
            _, vote = post("/api/chat/polls/vote", {"messageId": poll["message"]["id"], "optionIndex": 1}, "recipient-token")
            self.assertEqual(vote["message"]["metadata"]["selectedOption"], 1)
            self.assertEqual(vote["message"]["metadata"]["voteCounts"], [0, 1])

            _, event = post("/api/chat/rich-messages", {"conversationId": "CHAT-REALTIME", "type": "EVENT", "metadata": {"title": "Ride meetup", "date": "Aug 15, 2026", "time": "8:00 AM", "location": "Union Station"}})
            self.assertEqual(event["message"]["metadata"]["location"], "Union Station")
            _, contact = post("/api/chat/rich-messages", {"conversationId": "CHAT-REALTIME", "type": "CONTACT", "metadata": {"name": "Maya Driver", "phone": "+1 303 555 0148", "email": "maya@example.com"}})
            self.assertEqual(contact["message"]["metadata"]["email"], "maya@example.com")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_multipart_photo_and_file_uploads(self):
        server, thread = self.start_server()

        def multipart_upload(filename, mime_type, payload, client_id):
            boundary = f"FairFaresBoundary{client_id}"
            chunks = []
            for name, value in {
                "conversationId": "CHAT-REALTIME",
                "caption": "mobile upload",
                "clientMessageId": client_id,
                "fileName": filename,
                "mimeType": mime_type,
            }.items():
                chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
            chunks.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"{filename}\"\r\nContent-Type: {mime_type}\r\n\r\n".encode()
                + payload
                + f"\r\n--{boundary}--\r\n".encode()
            )
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/attachments",
                data=b"".join(chunks),
                method="POST",
                headers={
                    "Authorization": "Bearer sender-token",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                return response.status, json.loads(response.read().decode("utf-8"))

        try:
            jpeg = b"\xff\xd8\xff\xe0" + (b"photo-data" * 350_000)
            with patch.object(app, "send_accommodation_message_email", return_value=(Path("outbox"), "sent")) as chat_email:
                image_status, image = multipart_upload("phone-photo.jpg", "image/jpeg", jpeg, "multipart-image")
                pdf_status, document = multipart_upload("trip.pdf", "application/pdf", b"%PDF-1.4\n" + (b"document-data" * 580_000) + b"\n%%EOF\n", "multipart-file")
            chat_email.assert_not_called()
            self.assertEqual(image_status, 201)
            self.assertEqual(image["message"]["type"], "IMAGE")
            self.assertEqual(pdf_status, 201)
            self.assertEqual(document["message"]["type"], "FILE")
            self.assertEqual(document["message"]["metadata"]["fileName"], "trip.pdf")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_encrypted_attachment_and_recovery_backup_never_store_plaintext(self):
        sender_key = base64.b64encode(b"A" * 32).decode("ascii")
        recipient_key = base64.b64encode(b"B" * 32).decode("ascii")
        app.register_chat_device_key(self.sender_id, "sender-device-01", sender_key)
        app.register_chat_device_key(self.recipient_id, "recipient-device-01", recipient_key)
        server, thread = self.start_server()
        try:
            ciphertext = b"authenticated-ciphertext-not-a-real-photo"
            envelopes = [
                {"recipientUserId": self.sender_id, "recipientDeviceId": "sender-device-01", "senderPublicKey": sender_key, "nonce": "sender-nonce", "ciphertext": "wrapped-sender-key"},
                {"recipientUserId": self.recipient_id, "recipientDeviceId": "recipient-device-01", "senderPublicKey": sender_key, "nonce": "recipient-nonce", "ciphertext": "wrapped-recipient-key"},
            ]
            body = json.dumps({"conversationId": "CHAT-REALTIME", "ciphertextBase64": base64.b64encode(ciphertext).decode(), "envelopes": envelopes, "clientMessageId": "encrypted-file-1"}).encode()
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/attachments", data=body, method="POST", headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=3) as response:
                result = json.loads(response.read().decode())
            self.assertEqual(result["message"]["type"], "ENCRYPTED_ATTACHMENT")
            self.assertNotIn("photo", json.dumps(result["message"]["metadata"]))
            download = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{result['message']['attachmentUrl']}", headers={"Authorization": "Bearer recipient-token"})
            with urllib.request.urlopen(download, timeout=3) as response:
                self.assertEqual(response.read(), ciphertext)
            with app.db() as con:
                before_confirmation = con.execute("SELECT attachment_url FROM chat_messages WHERE id = ?", (int(result["message"]["id"]),)).fetchone()
            self.assertTrue(before_confirmation["attachment_url"])

            confirmation = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/attachments/downloaded",
                data=json.dumps({"messageId": int(result["message"]["id"]), "deviceId": "recipient-device-01"}).encode(),
                method="POST",
                headers={"Authorization": "Bearer recipient-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(confirmation, timeout=3) as response:
                confirmed = json.loads(response.read().decode())
            self.assertTrue(confirmed["recorded"])
            self.assertFalse(confirmed["deleted"])
            with app.db() as con:
                after_confirmation = con.execute("SELECT attachment_url, metadata_json FROM chat_messages WHERE id = ?", (int(result["message"]["id"]),)).fetchone()
            self.assertTrue(after_confirmation["attachment_url"])
            self.assertIn("downloadedByAll", after_confirmation["metadata_json"])

            backup_payload = "encrypted-only-" + ("Z" * 120)
            backup_request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/backup", data=json.dumps({"encryptedPayload": backup_payload}).encode(), method="POST", headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"})
            with urllib.request.urlopen(backup_request, timeout=3) as response:
                self.assertEqual(response.status, 200)
            duplicate_backup_request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/backup", data=json.dumps({"encryptedPayload": backup_payload}).encode(), method="POST", headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"})
            with urllib.request.urlopen(duplicate_backup_request, timeout=3) as response:
                self.assertEqual(response.status, 200)
            conflicting_backup_request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/chat/e2ee/backup", data=json.dumps({"encryptedPayload": "conflicting-" + ("Y" * 120)}).encode(), method="POST", headers={"Authorization": "Bearer sender-token", "Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as conflicting_error:
                urllib.request.urlopen(conflicting_backup_request, timeout=3)
            self.assertEqual(conflicting_error.exception.code, 409)
            with app.db() as con:
                stored = con.execute("SELECT encrypted_payload FROM chat_key_backups WHERE user_id = ?", (self.sender_id,)).fetchone()["encrypted_payload"]
                message = con.execute("SELECT message_text, metadata_json FROM chat_messages WHERE client_message_id = 'encrypted-file-1'").fetchone()
            self.assertEqual(stored, backup_payload)
            self.assertNotIn("photo", message["message_text"] + message["metadata_json"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
