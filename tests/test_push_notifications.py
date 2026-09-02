import json
import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

import app


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class ImmediateThread:
    def __init__(self, target, args, **_kwargs):
        self.target = target
        self.args = args

    def start(self):
        self.target(*self.args)


class DeferredThread:
    def __init__(self, target, args=(), **_kwargs):
        self.target = target
        self.args = args

    def start(self):
        return None


class PushNotificationTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Push User", "push@example.com", app.hash_password("Password123!")),
            )
            self.user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

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

    def add_token(self, token, enabled=1, notification_schema=0):
        with app.db() as con:
            con.execute(
                "INSERT INTO mobile_push_tokens (user_id, token, platform, notification_schema, enabled) VALUES (?, ?, 'android', ?, ?)",
                (self.user_id, token, notification_schema, enabled),
            )

    def test_chitthi_direct_notification_has_stable_sender_layout(self):
        self.assertEqual(
            app.chitthi_notification_copy("Marisa", "Are you available?"),
            ("Marisa", "Are you available?", ""),
        )

    def test_chitthi_group_notification_has_stable_group_layout(self):
        self.assertEqual(
            app.chitthi_notification_copy(
                "Marisa",
                "Are you available?",
                "DU Housing Board",
                is_group=True,
            ),
            ("Marisa", "Are you available?", "DU Housing Board"),
        )

    def test_chitthi_group_notification_keeps_message_text_unmodified(self):
        self.assertEqual(
            app.chitthi_notification_copy(
                "Marisa",
                "A message with Marisa: inside remains unchanged",
                "DU Housing Board",
                is_group=True,
            ),
            ("Marisa", "A message with Marisa: inside remains unchanged", "DU Housing Board"),
        )

    def test_chitthi_notification_has_deterministic_missing_data_fallbacks(self):
        self.assertEqual(
            app.chitthi_notification_copy("", "", "", is_group=True),
            ("FairFares member", "New Chitthi letter", "Chitthi group"),
        )

    def test_group_notification_context_refetches_canonical_conversation(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name) VALUES ('FFG-PUSH', 'GROUP', 'DU Housing Board')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject)
                   VALUES ('FFC-PUSH-GROUP', 'GROUP', ?, 'Stale subject')""",
                (community_id,),
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            is_group, name, resolved_community_id = app.chat_notification_conversation_context(
                con, {"id": conversation_id, "conversation_type": "DIRECT"},
            )

        self.assertTrue(is_group)
        self.assertEqual(name, "DU Housing Board")
        self.assertEqual(resolved_community_id, community_id)

    def test_queued_group_push_is_refreshed_from_canonical_conversation(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name) VALUES ('FFG-QUEUED', 'GROUP', 'DU Housing Board')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject)
                   VALUES ('FFC-QUEUED-GROUP', 'GROUP', ?, 'Stale subject')""",
                (community_id,),
            )

        title, body, data = app.refresh_queued_chitthi_notification(
            "Marisa",
            "Hello group",
            {
                "type": "CHITTHI_MESSAGE",
                "conversationId": "FFC-QUEUED-GROUP",
                "senderName": "Marisa",
                "isGroup": False,
                "conversationName": "",
                "subtitle": "",
            },
        )

        self.assertEqual((title, body), ("Marisa", "Hello group"))
        self.assertTrue(data["isGroup"])
        self.assertEqual(data["conversationName"], "DU Housing Board")
        self.assertEqual(data["subtitle"], "DU Housing Board")
        self.assertIn(f"community={community_id}", data["groupAvatarUrl"])
        self.assertTrue(data["nativeGroupEnrichment"])
        self.assertEqual(data["notificationSchema"], 2)

    def test_queued_group_push_replaces_stale_https_avatar_before_delivery(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name) VALUES ('FFG-FRESH-AVATAR', 'GROUP', 'Fresh Avatar Group')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject)
                   VALUES ('FFC-FRESH-AVATAR', 'GROUP', ?, 'Fresh Avatar Group')""",
                (community_id,),
            )

        _, _, data = app.refresh_queued_chitthi_notification(
            "Marisa",
            "Hello group",
            {
                "type": "CHITTHI_MESSAGE",
                "conversationId": "FFC-FRESH-AVATAR",
                "senderId": self.user_id,
                "senderName": "Marisa",
                "groupAvatarUrl": "https://www.fairfare.space/api/chat/notification-avatar?community=1&expires=1&signature=stale",
                "senderAvatarUrl": "https://www.fairfare.space/api/chat/notification-avatar?user=1&expires=1&signature=stale",
            },
        )

        self.assertIn(f"community={community_id}", data["groupAvatarUrl"])
        self.assertNotIn("signature=stale", data["groupAvatarUrl"])
        self.assertIn(f"user={self.user_id}", data["senderAvatarUrl"])
        self.assertNotIn("signature=stale", data["senderAvatarUrl"])

    def test_legacy_multi_member_conversation_is_never_notified_as_direct(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, subject)
                   VALUES ('FFC-LEGACY-MULTI', 'DIRECT', 'Legacy housing group')"""
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            for index in range(3):
                con.execute(
                    "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'unused', 1)",
                    (f"Legacy member {index}", f"legacy-member-{index}@example.com"),
                )
                member_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
                con.execute(
                    "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                    (conversation_id, member_id),
                )

            is_group, name, _community_id = app.chat_notification_conversation_context(
                con, {"id": conversation_id, "conversation_type": "DIRECT"},
            )

        self.assertTrue(is_group)
        self.assertEqual(name, "Legacy housing group")

    def test_legacy_group_with_duplicate_name_does_not_borrow_another_groups_photo(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name, photo_url) VALUES ('FFG-DUP-A', 'GROUP', 'Same Name', '/wrong-a.jpg')"
            )
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name, photo_url) VALUES ('FFG-DUP-B', 'GROUP', 'Same Name', '/wrong-b.jpg')"
            )
            con.execute(
                "INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('FFC-DUP-NAME', 'GROUP', 'Same Name')"
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            conversation = con.execute("SELECT * FROM chat_conversations WHERE id = ?", (conversation_id,)).fetchone()
            is_group, name, community_id = app.chat_notification_conversation_context(con, conversation)

        self.assertTrue(is_group)
        self.assertEqual(name, "Same Name")
        self.assertEqual(community_id, 0)

    def test_legacy_group_with_missing_link_recovers_from_registered_group_name(self):
        with app.db() as con:
            community_id = int(con.execute(
                "SELECT id FROM chat_communities WHERE name = 'DU Housing Board' ORDER BY id LIMIT 1"
            ).fetchone()["id"])
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, subject)
                   VALUES ('FFC-LEGACY-DU', 'DIRECT', 'DU Housing Board')"""
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

            is_group, name, resolved_community_id = app.chat_notification_conversation_context(
                con, {"id": conversation_id, "conversation_type": "DIRECT"},
            )

        self.assertTrue(is_group)
        self.assertEqual(name, "DU Housing Board")
        self.assertEqual(resolved_community_id, community_id)

    def test_direct_subject_without_registered_group_remains_direct(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, subject)
                   VALUES ('FFC-SUBJECT-DIRECT', 'DIRECT', 'Private housing question')"""
            )
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

            is_group, name, resolved_community_id = app.chat_notification_conversation_context(
                con, {"id": conversation_id, "conversation_type": "DIRECT"},
            )

        self.assertFalse(is_group)
        self.assertEqual(name, "")
        self.assertEqual(resolved_community_id, 0)

    def test_queued_direct_push_clears_stale_group_metadata(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, subject)
                   VALUES ('FFC-QUEUED-DIRECT', 'DIRECT', 'Private chat')"""
            )

        title, body, data = app.refresh_queued_chitthi_notification(
            "Gopal",
            "Hello",
            {
                "type": "CHITTHI_MESSAGE",
                "conversationId": "FFC-QUEUED-DIRECT",
                "senderName": "Gopal",
                "isGroup": True,
                "conversationName": "Wrong group",
                "groupAvatarUrl": "https://fairfare.space/wrong.jpg",
                "subtitle": "Wrong group",
            },
        )

        self.assertEqual((title, body), ("Gopal", "Hello"))
        self.assertFalse(data["isGroup"])
        self.assertEqual(data["conversationName"], "")
        self.assertEqual(data["groupAvatarUrl"], "")
        self.assertEqual(data["subtitle"], "")
        self.assertFalse(data["nativeGroupEnrichment"])

    def test_first_chat_device_key_backfills_legacy_push_token_device_id(self):
        token = "ExpoPushToken[legacy-preview-device]"
        self.add_token(token)
        public_key = app.base64.b64encode(b"A" * 32).decode("ascii")

        self.assertFalse(app.register_chat_device_key(self.user_id, "device-preview-01", public_key))

        with app.db() as con:
            row = con.execute("SELECT device_id FROM mobile_push_tokens WHERE token = ?", (token,)).fetchone()
        self.assertEqual(row["device_id"], "device-preview-01")

    def test_multi_device_account_does_not_guess_legacy_push_token_device_id(self):
        first_key = app.base64.b64encode(b"A" * 32).decode("ascii")
        second_key = app.base64.b64encode(b"B" * 32).decode("ascii")
        self.assertFalse(app.register_chat_device_key(self.user_id, "device-preview-01", first_key))
        self.assertFalse(app.register_chat_device_key(self.user_id, "device-preview-02", second_key))
        token = "ExpoPushToken[ambiguous-preview-device]"
        self.add_token(token)

        self.assertFalse(app.register_chat_device_key(self.user_id, "device-preview-01", first_key))

        with app.db() as con:
            row = con.execute("SELECT device_id FROM mobile_push_tokens WHERE token = ?", (token,)).fetchone()
        self.assertEqual(row["device_id"], "")

    def test_chitthi_direct_layout_survives_expo_transport(self):
        token = "ExpoPushToken[direct-layout-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-direct-layout"}]})
        title, body, subtitle = app.chitthi_notification_copy("Marisa", "Are you available?")
        data = {
            "type": "CHITTHI_MESSAGE",
            "conversationId": "FFC-DIRECT-1",
            "senderName": "Marisa",
            "senderAvatarUrl": "https://fairfare.space/sender.jpg",
            "conversationName": "",
            "groupAvatarUrl": "",
            "isGroup": False,
            "subtitle": subtitle,
        }

        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], title, body, data)

        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["title"], "Marisa")
        self.assertNotIn("subtitle", message)
        self.assertEqual(message["body"], "Are you available?")
        self.assertFalse(message["data"]["isGroup"])
        self.assertEqual(message["data"]["conversationName"], "")
        self.assertEqual(message["data"]["groupAvatarUrl"], "")
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["richContent"], {"image": "https://fairfare.space/sender.jpg"})

    def test_chitthi_group_layout_survives_expo_transport(self):
        token = "ExpoPushToken[group-layout-device]"
        self.add_token(token)
        title, body, subtitle = app.chitthi_notification_copy(
            "Marisa", "Are you available?", "DU Housing Board", is_group=True,
        )
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-group-layout"}]})
        data = {
            "type": "CHITTHI_MESSAGE",
            "conversationId": "FFC-GROUP-1",
            "senderName": "Marisa",
            "conversationName": "DU Housing Board",
            "senderAvatarUrl": "https://fairfare.space/sender.jpg",
            "groupAvatarUrl": "https://fairfare.space/group.jpg",
            "isGroup": True,
            "subtitle": subtitle,
        }

        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], title, body, data)

        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["title"], "Marisa")
        self.assertEqual(message["subtitle"], "DU Housing Board")
        self.assertEqual(message["body"], "Are you available?")
        self.assertEqual(message["sound"], "default")
        self.assertEqual(message["channelId"], "chitthi-messages-v2")
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["categoryId"], "CHITTHI_MESSAGE")
        self.assertEqual(message["data"]["groupAvatarUrl"], "https://fairfare.space/group.jpg")
        self.assertTrue(message["data"]["isGroup"])
        self.assertEqual(message["richContent"], {"image": "https://fairfare.space/group.jpg"})

    def test_group_native_enrichment_can_be_enabled_after_fixed_build_rollout(self):
        token = "ExpoPushToken[group-native-v2-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-group-native-v2"}]})
        data = {
            "type": "CHITTHI_MESSAGE",
            "conversationId": "FFC-GROUP-V2",
            "conversationName": "DU Housing Board",
            "isGroup": True,
            "subtitle": "DU Housing Board",
            "nativeGroupEnrichment": True,
        }

        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], "Marisa", "DU Housing Board\nHello", data)

        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["categoryId"], "CHITTHI_MESSAGE")

    def test_chitthi_group_reaction_layout_survives_expo_transport(self):
        token = "ExpoPushToken[group-reaction-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-group-reaction"}]})
        title, body, subtitle = app.chitthi_notification_copy(
            "Marisa", "reacted 👍 to your message", "DU Housing Board", is_group=True,
        )
        data = {
            "type": "CHITTHI_REACTION",
            "conversationId": "FFC-GROUP-1",
            "messageId": 42,
            "senderName": "Marisa",
            "conversationName": "DU Housing Board",
            "groupAvatarUrl": "https://fairfare.space/group.jpg",
            "isGroup": True,
            "subtitle": subtitle,
            "reaction": "👍",
        }

        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], title, body, data)

        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["title"], "Marisa")
        self.assertEqual(message["subtitle"], "DU Housing Board")
        self.assertEqual(message["body"], "reacted 👍 to your message")
        self.assertEqual(message["data"]["type"], "CHITTHI_REACTION")
        self.assertTrue(message["data"]["isGroup"])
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["richContent"], {"image": "https://fairfare.space/group.jpg"})

    def test_android_group_message_renders_person_group_and_message(self):
        token = "ExpoPushToken[android-group-message]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-android-group"}]})
        data = {
            "type": "CHITTHI_MESSAGE",
            "conversationId": "FFC-ANDROID-GROUP",
            "senderName": "Marisa",
            "senderAvatarUrl": "https://fairfare.space/sender.jpg",
            "groupAvatarUrl": "https://fairfare.space/group.jpg",
            "conversationName": "DU Housing Board",
            "isGroup": True,
            "subtitle": "DU Housing Board",
            "targetPlatform": "android",
        }
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], "Marisa", "Are you available?", data)
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["title"], "Marisa")
        self.assertEqual(message["body"], "DU Housing Board\nAre you available?")
        self.assertEqual(message["richContent"], {"image": "https://fairfare.space/group.jpg"})
        self.assertNotIn("targetPlatform", message["data"])

    def test_android_group_reaction_renders_person_group_and_reaction(self):
        token = "ExpoPushToken[android-group-reaction]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-android-reaction"}]})
        data = {
            "type": "CHITTHI_REACTION",
            "conversationId": "FFC-ANDROID-GROUP",
            "senderName": "Marisa",
            "groupAvatarUrl": "https://fairfare.space/group.jpg",
            "conversationName": "DU Housing Board",
            "isGroup": True,
            "subtitle": "DU Housing Board",
            "reaction": "👍",
            "targetPlatform": "android",
        }
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], "Marisa", "reacted 👍 to your message", data)
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["title"], "Marisa")
        self.assertEqual(message["body"], "DU Housing Board\nreacted 👍 to your message")
        self.assertEqual(message["richContent"], {"image": "https://fairfare.space/group.jpg"})

    def test_every_chitthi_push_type_requests_message_sound(self):
        token = "ExpoPushToken[chitthi-sound-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-sound"}]})

        for notification_type in ("CHITTHI_MESSAGE", "FCHAT_MESSAGE", "CHITTHI_REACTION"):
            with self.subTest(notification_type=notification_type):
                with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
                    app.send_expo_push(
                        [token],
                        "Marisa",
                        "Hello",
                        {"type": notification_type, "conversationId": "FFC-SOUND-1"},
                    )
                message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
                self.assertEqual(message["sound"], "default")
                self.assertEqual(message["channelId"], "chitthi-messages-v2")
                self.assertEqual(message["categoryId"], "CHITTHI_MESSAGE")
                self.assertTrue(message["mutableContent"])

    def test_direct_reaction_uses_native_enrichment_for_profile_picture(self):
        token = "ExpoPushToken[direct-reaction-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-direct-reaction"}]})

        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [token],
                "Marisa",
                "Reacted 🎉 to your message",
                {
                    "type": "CHITTHI_REACTION",
                    "conversationId": "FFC-DIRECT-REACTION",
                    "reaction": "🎉",
                },
            )

        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["body"], "Reacted 🎉 to your message")
        self.assertEqual(message["categoryId"], "CHITTHI_MESSAGE")
        self.assertTrue(message["mutableContent"])

    def test_carpool_payload_uses_carpool_channel_and_disables_unregistered_token(self):
        good_token = "ExpoPushToken[good-device]"
        stale_token = "ExpoPushToken[stale-device]"
        self.add_token(good_token)
        self.add_token(stale_token)
        response = FakeResponse(
            {
                "data": [
                    {"status": "ok", "id": "ticket-1"},
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}},
                ]
            }
        )
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [good_token, stale_token, good_token, "invalid-token"],
                "Carpool request accepted",
                "Denver → Dayton",
                {"type": "CARPOOL_STATUS", "rideId": "ride-1", "status": "ACCEPTED"},
            )

        request = mock_open.call_args.args[0]
        messages = json.loads(request.data.decode("utf-8"))
        self.assertEqual([message["to"] for message in messages], [good_token, stale_token])
        self.assertTrue(all(message["channelId"] == "carpool-v2" for message in messages))
        self.assertTrue(all(message["sound"] == "default" for message in messages))
        self.assertEqual(messages[0]["data"]["rideId"], "ride-1")
        with app.db() as con:
            states = {row["token"]: row["enabled"] for row in con.execute("SELECT token, enabled FROM mobile_push_tokens")}
        self.assertEqual(states[good_token], 1)
        self.assertEqual(states[stale_token], 0)

    def test_user_delivery_excludes_disabled_tokens(self):
        enabled_token = "ExpoPushToken[enabled-device]"
        self.add_token(enabled_token, 1)
        self.add_token("ExpoPushToken[disabled-device]", 0)
        with patch.object(app.threading, "Thread", ImmediateThread), patch.object(app, "send_expo_push") as mock_send:
            app.send_mobile_push_for_users(
                [self.user_id, self.user_id, 0],
                "New carpool request",
                "Denver → Dayton",
                {"type": "CARPOOL_REQUEST", "rideId": "ride-2"},
            )

        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], [enabled_token])
        self.assertEqual(mock_send.call_args.args[3]["type"], "CARPOOL_REQUEST")

    def test_group_native_enrichment_is_enabled_for_every_registered_device(self):
        legacy_token = "ExpoPushToken[group-legacy-device]"
        current_token = "ExpoPushToken[group-schema-three-device]"
        self.add_token(legacy_token, notification_schema=0)
        self.add_token(current_token, notification_schema=3)
        payload = {
            "type": "CHITTHI_MESSAGE",
            "messageId": 901,
            "conversationId": "FFC-GROUP-901",
            "conversationName": "DU Housing Board",
            "isGroup": True,
        }

        with patch.object(app.threading, "Thread", DeferredThread):
            app.send_mobile_push_for_users([self.user_id], "Marisa", "Hello group", payload)

        with app.db() as con:
            rows = con.execute("SELECT token, data_json FROM mobile_push_outbox ORDER BY token").fetchall()
        enrichment = {
            row["token"]: json.loads(row["data_json"])["nativeGroupEnrichment"]
            for row in rows
        }
        self.assertEqual(enrichment, {legacy_token: True, current_token: True})

    def test_group_reaction_uses_native_enrichment_on_capable_device(self):
        token = "ExpoPushToken[group-reaction-schema-three-device]"
        self.add_token(token, notification_schema=3)
        payload = {
            "type": "CHITTHI_REACTION",
            "messageId": 902,
            "conversationId": "FFC-GROUP-902",
            "conversationName": "DU Housing Board",
            "isGroup": True,
            "reaction": "❤️",
        }

        with patch.object(app.threading, "Thread", DeferredThread):
            app.send_mobile_push_for_users(
                [self.user_id], "Marisa", "reacted ❤️ to your message", payload,
            )

        with app.db() as con:
            row = con.execute(
                "SELECT body, data_json FROM mobile_push_outbox WHERE token = ?",
                (token,),
            ).fetchone()
        self.assertEqual(row["body"], "reacted ❤️ to your message")
        self.assertTrue(json.loads(row["data_json"])["nativeGroupEnrichment"])

    def test_group_reaction_avatar_is_not_blocked_by_stale_device_schema(self):
        token = "ExpoPushToken[group-reaction-stale-schema-device]"
        self.add_token(token, notification_schema=0)
        payload = {
            "type": "CHITTHI_REACTION",
            "messageId": 903,
            "conversationId": "FFC-GROUP-903",
            "conversationName": "DU Housing Board",
            "groupAvatarUrl": "https://www.fairfare.space/group.jpg",
            "isGroup": True,
            "reaction": "😂",
        }

        with patch.object(app.threading, "Thread", DeferredThread):
            app.send_mobile_push_for_users(
                [self.user_id], "Marisa", "reacted 😂 to your message", payload,
            )

        with app.db() as con:
            row = con.execute(
                "SELECT data_json FROM mobile_push_outbox WHERE token = ?",
                (token,),
            ).fetchone()
        self.assertTrue(json.loads(row["data_json"])["nativeGroupEnrichment"])

    def test_legacy_fchat_payload_stays_on_chitthi_message_channel(self):
        token = "ExponentPushToken[chitthi-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-chat"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], "Vinay Reddy", "Hello", {"type": "FCHAT_MESSAGE", "subtitle": "Dayton Rides & Community"})
        messages = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(messages[0]["channelId"], "chitthi-messages-v2")
        self.assertTrue(messages[0]["mutableContent"])
        self.assertEqual(messages[0]["categoryId"], "CHITTHI_MESSAGE")
        self.assertEqual(messages[0]["subtitle"], "Dayton Rides & Community")

    def test_promotional_payload_includes_rich_image_for_android_and_ios(self):
        token = "ExpoPushToken[promo-rich-device]"
        image_url = "https://www.fairfare.space/static/img/notifications/denver-rental-deals.jpg"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-promo"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [token],
                "Denver rental deals are live",
                "Compare low daily and weekly car rates.",
                {"type": "FAIRFARES_PROMO", "target": "rentals", "imageUrl": image_url},
            )
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["channelId"], "marketing-v2")
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["richContent"], {"image": image_url})

    def test_chat_payload_carries_unread_badge(self):
        token = "ExpoPushToken[badge-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-badge"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(token.split(), "New message", "Hello", {"type": "CHITTHI_MESSAGE", "badge": 4})
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["badge"], 4)

    def test_transient_expo_failure_is_retried(self):
        token = "ExpoPushToken[retry-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-retry"}]})
        with patch.object(app.urllib.request, "urlopen", side_effect=[OSError("temporary"), response]) as mock_open, patch.object(app.time, "sleep"):
            app.send_expo_push([token], "Rental updated", "Ready", {"type": "RENTAL_BOOKING"})
        self.assertEqual(mock_open.call_count, 2)
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["channelId"], "rentals-v2")

    def test_outbox_persists_and_deduplicates_same_event_for_token(self):
        token = "ExpoPushToken[outbox-device]"
        self.add_token(token)
        payload = {"type": "CARPOOL_STATUS", "rideId": "ride-dedupe", "status": "ACCEPTED"}
        with patch.object(app.threading, "Thread", DeferredThread):
            app.send_mobile_push_for_users([self.user_id], "Ride accepted", "Your ride was accepted", payload)
            app.send_mobile_push_for_users([self.user_id], "Ride accepted", "Your ride was accepted", payload)
        with app.db() as con:
            rows = con.execute("SELECT status, attempt_count FROM mobile_push_outbox").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "PENDING")

    def test_category_preference_prevents_carpool_enqueue(self):
        token = "ExpoPushToken[preference-device]"
        self.add_token(token)
        with app.db() as con:
            con.execute("INSERT INTO mobile_notification_preferences (user_id, carpool_enabled) VALUES (?, 0)", (self.user_id,))
        with patch.object(app.threading, "Thread", DeferredThread):
            app.send_mobile_push_for_users([self.user_id], "New request", "A rider requested your trip", {"type": "CARPOOL_REQUEST", "rideId": "ride-muted"})
        with app.db() as con:
            count = int(con.execute("SELECT COUNT(*) AS count FROM mobile_push_outbox").fetchone()["count"])
        self.assertEqual(count, 0)

    def test_outbox_records_ticket_then_receipt_delivery(self):
        token = "ExpoPushToken[receipt-device]"
        with patch.object(app.threading, "Thread", DeferredThread):
            app.enqueue_mobile_pushes([(self.user_id, token)], "New message", "Hello", {"type": "CHITTHI_MESSAGE", "messageId": 88})
        with patch.object(app, "send_expo_push", return_value={token: {"status": "ACCEPTED", "ticketId": "ticket-88", "error": ""}}):
            result = app.process_mobile_push_outbox()
        self.assertEqual(result["accepted"], 1)
        with app.db() as con:
            con.execute("UPDATE mobile_push_outbox SET accepted_at = datetime('now', '-1 minute')")
        response = FakeResponse({"data": {"ticket-88": {"status": "ok"}}})
        with patch.object(app.urllib.request, "urlopen", return_value=response):
            receipts = app.check_expo_push_receipts()
        self.assertEqual(receipts["delivered"], 1)
        with app.db() as con:
            row = con.execute("SELECT status, delivered_at FROM mobile_push_outbox").fetchone()
        self.assertEqual(row["status"], "DELIVERED")
        self.assertTrue(row["delivered_at"])

    def test_outbox_mints_group_avatar_immediately_before_expo_delivery(self):
        token = "ExpoPushToken[group-avatar-outbox]"
        with app.db() as con:
            con.execute(
                "INSERT INTO chat_communities (public_id, kind, name) VALUES ('FFG-OUTBOX-AVATAR', 'GROUP', 'Outbox Avatar Group')"
            )
            community_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                """INSERT INTO chat_conversations (public_id, conversation_type, community_id, subject)
                   VALUES ('FFC-OUTBOX-AVATAR', 'GROUP', ?, 'Outbox Avatar Group')""",
                (community_id,),
            )
        with patch.object(app.threading, "Thread", DeferredThread):
            app.enqueue_mobile_pushes(
                [(self.user_id, token)],
                "Marisa",
                "Hello group",
                {
                    "type": "CHITTHI_MESSAGE",
                    "messageId": 901,
                    "conversationId": "FFC-OUTBOX-AVATAR",
                    "senderId": self.user_id,
                    "senderName": "Marisa",
                    "groupAvatarUrl": "https://www.fairfare.space/stale-group-avatar.jpg",
                },
            )

        with patch.object(
            app,
            "send_expo_push",
            return_value={token: {"status": "ACCEPTED", "ticketId": "ticket-avatar", "error": ""}},
        ) as mock_send:
            result = app.process_mobile_push_outbox()

        self.assertEqual(result["accepted"], 1)
        delivered_data = mock_send.call_args.args[3]
        self.assertIn(f"community={community_id}", delivered_data["groupAvatarUrl"])
        self.assertNotEqual(delivered_data["groupAvatarUrl"], "https://www.fairfare.space/stale-group-avatar.jpg")
        self.assertTrue(delivered_data["isGroup"])
        self.assertEqual(delivered_data["conversationName"], "Outbox Avatar Group")

    def test_chitthi_avatar_urls_cover_delayed_delivery_and_are_tamper_evident(self):
        with patch.object(app.time, "time", return_value=2_000_000_000):
            url = app.chat_notification_avatar_url("https://www.fairfare.space", self.user_id)
        parsed = app.urllib.parse.urlparse(url)
        query = app.urllib.parse.parse_qs(parsed.query)
        expires_at = int(query["expires"][0])
        signature = query["signature"][0]
        self.assertEqual(parsed.path, "/api/chat/notification-avatar")
        self.assertEqual(int(query["user"][0]), self.user_id)
        self.assertEqual(expires_at, 2_000_000_000 + app.NOTIFICATION_AVATAR_URL_LIFETIME_SECONDS)
        self.assertTrue(app.hmac.compare_digest(signature, app.chat_notification_avatar_signature(self.user_id, expires_at)))
        self.assertFalse(app.hmac.compare_digest(signature, app.chat_notification_avatar_signature(self.user_id + 1, expires_at)))

    def test_chitthi_group_avatar_urls_cover_delayed_delivery_and_are_tamper_evident(self):
        with patch.object(app.time, "time", return_value=2_000_000_000):
            url = app.chat_notification_group_avatar_url("https://www.fairfare.space", 42)
        parsed = app.urllib.parse.urlparse(url)
        query = app.urllib.parse.parse_qs(parsed.query)
        expires_at = int(query["expires"][0])
        signature = query["signature"][0]
        self.assertEqual(int(query["community"][0]), 42)
        self.assertEqual(expires_at, 2_000_000_000 + app.NOTIFICATION_AVATAR_URL_LIFETIME_SECONDS)
        self.assertTrue(app.hmac.compare_digest(signature, app.chat_notification_group_avatar_signature(42, expires_at)))
        self.assertFalse(app.hmac.compare_digest(signature, app.chat_notification_group_avatar_signature(43, expires_at)))

    def test_compact_avatar_accepts_legacy_jpeg_alias_and_wrapped_base64(self):
        jpeg = b"\xff\xd8\xff\xe0legacy-avatar"
        encoded = app.base64.b64encode(jpeg).decode("ascii")
        wrapped = f"{encoded[:8]}\n{encoded[8:]}"
        self.assertEqual(app.chat_avatar_data_url_parts(f"data:image/jpg;base64,{wrapped}"), ("image/jpeg", jpeg))

    def test_compact_avatar_rejects_mislabeled_active_content(self):
        payload = app.base64.b64encode(b"<svg onload=alert(1)>").decode("ascii")
        self.assertIsNone(app.chat_avatar_data_url_parts(f"data:image/jpeg;base64,{payload}"))

    def test_rental_payload_uses_rental_channel_and_booking_context(self):
        token = "ExpoPushToken[rental-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-rental"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [token],
                "Rental booking confirmed",
                "Payment received.",
                {"type": "RENTAL_BOOKING", "event": "PAYMENT_CONFIRMED", "bookingId": "FF-100"},
            )
        messages = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(messages[0]["channelId"], "rentals-v2")
        self.assertEqual(messages[0]["data"]["bookingId"], "FF-100")
        self.assertNotIn("mutableContent", messages[0])

    def test_rental_helper_targets_booking_owner(self):
        booking = {
            "user_id": self.user_id,
            "booking_id": "FF-200",
            "booking_status": "CONFIRMED",
            "payment_status": "HOLD_PAID",
        }
        with patch.object(app, "send_mobile_push_for_users") as mock_send:
            app.send_rental_booking_push(booking, "Rental confirmed", "Payment received.", "PAYMENT_CONFIRMED")
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], [self.user_id])
        self.assertEqual(mock_send.call_args.args[3]["type"], "RENTAL_BOOKING")
        self.assertEqual(mock_send.call_args.args[3]["bookingId"], "FF-200")

    def test_pickup_reminder_pushes_once_with_email_automation_reservation(self):
        booking = {
            "id": 200,
            "user_id": self.user_id,
            "booking_id": "FF-REMINDER",
            "contact_email": "push@example.com",
            "contact_name": "Push User",
            "car_name": "Nissan Versa",
            "pickup_location": "Denver International Airport",
            "booking_status": "CONFIRMED",
            "payment_status": "HOLD_PAID",
        }
        with patch.object(app, "reserve_and_send_automation", return_value={"event": "pickup_24h", "sent": True, "status": "sent"}), patch.object(app, "send_rental_booking_push") as mock_push:
            app.automated_booking_email("pickup_24h", booking, "https://fairfare.space", "Reminder", "Pickup", "Body")
        mock_push.assert_called_once()
        self.assertEqual(mock_push.call_args.args[3], "PICKUP_24H")

        with patch.object(app, "reserve_and_send_automation", return_value={"event": "pickup_24h", "sent": False, "status": "already sent"}), patch.object(app, "send_rental_booking_push") as duplicate_push:
            app.automated_booking_email("pickup_24h", booking, "https://fairfare.space", "Reminder", "Pickup", "Body")
        duplicate_push.assert_not_called()

    def test_promotional_push_runs_three_alternating_days_and_requires_opt_in(self):
        self.add_token("ExpoPushToken[promo-device]")
        scheduled = datetime(2026, 8, 3, 11, 0)  # Monday, ISO week 32: Denver rentals rotation.
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 0)
        send_push.assert_not_called()

        with app.db() as con:
            con.execute("UPDATE users SET promo_push_opt_in = 1 WHERE id = ?", (self.user_id,))
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
            duplicate = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(duplicate["sent"], 0)
        send_push.assert_called_once()
        self.assertEqual(send_push.call_args.args[3]["type"], "FAIRFARES_PROMO")
        self.assertEqual(send_push.call_args.args[3]["target"], "rentals")
        self.assertEqual(send_push.call_args.args[1], "🚗 Need 4 wheels? We found affordable rentals 👀")
        self.assertTrue(send_push.call_args.args[2].startswith("Verrry cheap"))
        self.assertEqual(
            send_push.call_args.args[3]["imageUrl"],
            f"{app.schema_origin()}/static/img/notifications/denver-rental-deals.jpg",
        )

    def test_promotional_push_uses_monday_wednesday_friday_schedule(self):
        self.add_token("ExpoPushToken[promo-schedule-device]")
        with app.db() as con:
            con.execute("UPDATE users SET promo_push_opt_in = 1 WHERE id = ?", (self.user_id,))

        with patch.object(app, "send_mobile_push_for_users") as send_push:
            monday = app.run_promotional_push_automation(datetime(2026, 8, 3, 11, 0))
            tuesday = app.run_promotional_push_automation(datetime(2026, 8, 4, 11, 0))
            wednesday = app.run_promotional_push_automation(datetime(2026, 8, 5, 11, 0))
            friday = app.run_promotional_push_automation(datetime(2026, 8, 7, 11, 0))

        self.assertEqual([monday["sent"], tuesday["sent"], wednesday["sent"], friday["sent"]], [1, 0, 1, 1])
        self.assertEqual(send_push.call_count, 3)
        self.assertEqual(
            [call.args[3]["target"] for call in send_push.call_args_list],
            ["rentals", "housing", "rentals"],
        )

    def test_housing_promotion_uses_real_active_inventory_count(self):
        self.add_token("ExpoPushToken[housing-opportunity-device]")
        with app.db() as con:
            con.execute("UPDATE users SET promo_push_opt_in = 1 WHERE id = ?", (self.user_id,))
            con.executemany(
                """
                INSERT INTO accommodation_posts
                (public_id, user_id, post_mode, title, visibility_status, created_at)
                VALUES (?, ?, 'HAVE_PLACE', ?, 'ACTIVE', ?)
                """,
                [
                    (f"ROOM-{index}", self.user_id, f"Room {index}", "2026-08-04 10:00:00")
                    for index in range(1, 4)
                ],
            )
            expected_count = int(con.execute(
                """
                SELECT COUNT(*) FROM accommodation_posts
                WHERE post_mode = 'HAVE_PLACE'
                  AND visibility_status = 'ACTIVE'
                  AND (expires_at IS NULL OR expires_at = '' OR datetime(expires_at) > datetime('2026-08-05 11:00:00'))
                """
            ).fetchone()[0])

        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(datetime(2026, 8, 5, 11, 0))

        self.assertEqual(result["sent"], 1)
        self.assertEqual(send_push.call_args.args[1], f"🏡 {expected_count} rooms are available 👀")
        self.assertEqual(send_push.call_args.args[3]["target"], "housing")

    def test_carpool_promotion_uses_real_active_offer_count(self):
        self.add_token("ExpoPushToken[carpool-opportunity-device]")
        with app.db() as con:
            con.execute("UPDATE users SET promo_push_opt_in = 1 WHERE id = ?", (self.user_id,))
            con.executemany(
                """
                INSERT INTO ride_posts
                (public_id, user_id, ride_type, title, seats, status, pickup_date)
                VALUES (?, ?, 'CARPOOL_OFFER', ?, 2, 'ACTIVE', '2026-08-20')
                """,
                [
                    (f"RIDE-{index}", self.user_id, f"Ride {index}")
                    for index in range(1, 4)
                ],
            )
            expected_count = int(con.execute(
                """
                SELECT COUNT(*) FROM ride_posts
                WHERE ride_type = 'CARPOOL_OFFER'
                  AND status = 'ACTIVE'
                  AND seats > 0
                  AND date(pickup_date) >= date('2026-08-12')
                """
            ).fetchone()[0])

        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(datetime(2026, 8, 12, 11, 0))

        self.assertEqual(result["sent"], 1)
        self.assertEqual(send_push.call_args.args[1], f"🚗 {expected_count} rides are available")
        self.assertEqual(send_push.call_args.args[3]["target"], "carpool")

    def test_festival_push_uses_poster_and_sends_only_once(self):
        self.add_token("ExpoPushToken[festival-device]")
        with app.db() as con:
            con.execute("UPDATE users SET promo_push_opt_in = 1 WHERE id = ?", (self.user_id,))
        scheduled = datetime(2026, 11, 8, 10, 0)
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
            duplicate = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["campaign"], "diwali")
        self.assertEqual(duplicate["sent"], 0)
        send_push.assert_called_once()
        self.assertEqual(send_push.call_args.args[1], "🎉 Happy Diwali from FairFares!")
        self.assertEqual(
            send_push.call_args.args[3]["imageUrl"],
            f"{app.schema_origin()}/static/img/notifications/festivals/diwali.jpg",
        )

    def test_fixed_festival_dates_repeat_each_year(self):
        self.assertEqual(app.festival_campaign_for_day(date(2034, 8, 15))["slug"], "independence-day")
        self.assertEqual(app.festival_campaign_for_day(date(2034, 12, 25))["slug"], "christmas")
        self.assertIsNone(app.festival_campaign_for_day(date(2034, 8, 16)))


if __name__ == "__main__":
    unittest.main()
