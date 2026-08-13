import os
import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("FAIRFARES_SKIP_BOOTSTRAP", "1")

import app


class FakeR2Client:
    def __init__(self):
        self.objects = {}
        self.multipart_uploads = {}
        self.next_multipart_id = 1
        self.get_object_calls = 0

    def put_object(self, **kwargs):
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = {
            "Body": bytes(kwargs["Body"]),
            "ContentType": kwargs["ContentType"],
            "ChecksumSHA256": kwargs.get("ChecksumSHA256", ""),
            "Metadata": kwargs.get("Metadata", {}),
        }

    def get_object(self, **kwargs):
        self.get_object_calls += 1
        stored = self.objects[(kwargs["Bucket"], kwargs["Key"])]
        payload = stored["Body"]

        class Body:
            offset = 0

            def read(self, limit):
                chunk = payload[self.offset:self.offset + limit]
                self.offset += len(chunk)
                return chunk

        return {"Body": Body(), "ContentLength": len(payload), "ContentType": stored["ContentType"]}

    def delete_object(self, **kwargs):
        self.objects.pop((kwargs["Bucket"], kwargs["Key"]), None)

    def head_object(self, **kwargs):
        stored = self.objects[(kwargs["Bucket"], kwargs["Key"])]
        return {
            "ContentLength": len(stored["Body"]),
            "ChecksumSHA256": stored.get("ChecksumSHA256", ""),
            "Metadata": stored.get("Metadata", {}),
        }

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.presigned = {"operation": operation, "params": Params, "expires": ExpiresIn}
        return f"https://r2.example.test/{Params['Key']}?signed=1"

    def create_multipart_upload(self, **kwargs):
        upload_id = f"multipart-{self.next_multipart_id}"
        self.next_multipart_id += 1
        self.multipart_uploads[upload_id] = {"params": kwargs, "parts": {}}
        return {"UploadId": upload_id}

    def upload_test_part(self, upload_id, part_number, payload):
        etag = hashlib.md5(payload).hexdigest()
        self.multipart_uploads[upload_id]["parts"][part_number] = {"payload": payload, "etag": etag}
        return etag

    def list_parts(self, **kwargs):
        upload = self.multipart_uploads[kwargs["UploadId"]]
        return {"Parts": [
            {"PartNumber": number, "ETag": part["etag"], "Size": len(part["payload"])}
            for number, part in sorted(upload["parts"].items())
        ]}

    def complete_multipart_upload(self, **kwargs):
        upload = self.multipart_uploads.pop(kwargs["UploadId"])
        payload = b"".join(upload["parts"][part["PartNumber"]]["payload"] for part in kwargs["MultipartUpload"]["Parts"])
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = {
            "Body": payload,
            "ContentType": upload["params"]["ContentType"],
            "ChecksumSHA256": "composite-checksum",
            "Metadata": upload["params"].get("Metadata", {}),
        }
        return {"ETag": "multipart-etag"}

    def abort_multipart_upload(self, **kwargs):
        self.multipart_uploads.pop(kwargs["UploadId"], None)


class R2StorageTest(unittest.TestCase):
    def test_forward_rewraps_descriptor_without_copying_ciphertext_and_cleanup_is_reference_safe(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        object_key = "fairfares/chitthi/shared-forward.ffenc"
        reference = f"r2://fairfares-attachments/{object_key}"
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                for name in ("Original", "Forwarder", "Destination"):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, f"{name.lower()}@example.com"))
                original_id, forwarder_id, destination_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('source-chat')")
                source_conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('destination-chat')")
                destination_conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                for user_id in (original_id, forwarder_id):
                    con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (source_conversation_id, user_id))
                for user_id in (forwarder_id, destination_id):
                    con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (destination_conversation_id, user_id))
                forwarder_key = base64.b64encode(b"F" * 32).decode()
                destination_key = base64.b64encode(b"D" * 32).decode()
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'forwarder-device', ?)", (forwarder_id, forwarder_key))
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'destination-device', ?)", (destination_id, destination_key))
                con.execute(
                    """INSERT INTO chat_messages
                       (conversation_id, sender_id, message_type, message_text, attachment_url, metadata_json, client_message_id, created_at)
                       VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', 'encrypted', ?, ?, 'source-media', CURRENT_TIMESTAMP)""",
                    (source_conversation_id, original_id, reference, json.dumps({"encrypted": True, "size": 17, "mediaMimeType": "image/jpeg", "ciphertextSha256": "checksum"})),
                )
                source_message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                forwarder = con.execute("SELECT * FROM users WHERE id = ?", (forwarder_id,)).fetchone()
            client.put_object(Bucket="fairfares-attachments", Key=object_key, Body=b"immutable-cipher", ContentType="application/octet-stream")
            envelopes = [
                {"recipientUserId": forwarder_id, "recipientDeviceId": "forwarder-device", "senderPublicKey": forwarder_key, "nonce": "n1", "ciphertext": "rewrapped1"},
                {"recipientUserId": destination_id, "recipientDeviceId": "destination-device", "senderPublicKey": forwarder_key, "nonce": "n2", "ciphertext": "rewrapped2"},
            ]
            forwarded, conversation, error = app.forward_chitthi_attachment(
                user=forwarder, source_message_id=source_message_id,
                destination_conversation_public_id="destination-chat", envelopes=envelopes,
                client_message_id="forwarded-media",
            )
            self.assertFalse(error)
            self.assertEqual(int(conversation["id"]), destination_conversation_id)
            self.assertEqual(forwarded["attachment_url"], reference)
            self.assertTrue(json.loads(forwarded["metadata_json"])["reusedCiphertext"])
            self.assertEqual(len(client.objects), 1)

            with app.db() as con:
                con.execute("UPDATE chat_messages SET created_at = datetime('now', '-10 days') WHERE id = ?", (source_message_id,))
            cleanup = app.cleanup_expired_chitthi_attachments()
            self.assertEqual(cleanup["deleted"], 1)
            self.assertIn(("fairfares-attachments", object_key), client.objects)
            with app.db() as con:
                self.assertEqual(con.execute("SELECT attachment_url FROM chat_messages WHERE id = ?", (int(forwarded["id"]),)).fetchone()[0], reference)

    def test_chitthi_rollout_defaults_safe_and_internal_ids_override_percentage(self):
        with mock.patch.object(app, "CHITTHI_MULTIPART_ROLLOUT_ENABLED", True), \
             mock.patch.object(app, "CHITTHI_ROLLOUT_PERCENT", 0), \
             mock.patch.object(app, "CHITTHI_ROLLOUT_MAX_VIDEO_MB", 50), \
             mock.patch.object(app, "CHITTHI_ROLLOUT_USER_IDS", {42}):
            control = app.chitthi_transfer_features(41)
            internal = app.chitthi_transfer_features(42)
        self.assertEqual(control["maxVideoSizeMb"], 12)
        self.assertFalse(control["enableMultipartUpload"])
        self.assertEqual(internal["maxVideoSizeMb"], 50)
        self.assertTrue(internal["enableMultipartUpload"])
        self.assertEqual(internal["rolloutCohort"], "internal")

    def test_multipart_upload_is_resumable_and_completion_does_not_redownload_object(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        encrypted = b"eightbyt" + b"final"
        checksum = base64.b64encode(hashlib.sha256(encrypted).digest()).decode()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "CHITTHI_MULTIPART_THRESHOLD_BYTES", 10), \
             mock.patch.object(app, "CHITTHI_MULTIPART_PART_BYTES", 8), \
             mock.patch.object(app, "CHITTHI_MULTIPART_ROLLOUT_ENABLED", True), \
             mock.patch.object(app, "CHITTHI_ROLLOUT_PERCENT", 100), \
             mock.patch.object(app, "CHITTHI_ROLLOUT_MAX_VIDEO_MB", 100), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                for name, email in (("Sender", "multipart-sender@example.com"), ("Recipient", "multipart-recipient@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                sender_id, recipient_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('multipart-conversation')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                for user_id in (sender_id, recipient_id):
                    con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, user_id))
                sender_key = base64.b64encode(b"S" * 32).decode()
                recipient_key = base64.b64encode(b"R" * 32).decode()
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'sender-device', ?)", (sender_id, sender_key))
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'recipient-device', ?)", (recipient_id, recipient_key))
                sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()

            authorization, error = app.create_chitthi_upload_authorization(
                user_id=sender_id, conversation_public_id="multipart-conversation", encrypted_size=len(encrypted),
                ciphertext_sha256=checksum, media_mime_type="video/mp4",
            )
            self.assertFalse(error)
            self.assertEqual(authorization["transferMode"], "MULTIPART")
            self.assertEqual(authorization["partCount"], 2)
            with app.db() as con:
                upload = con.execute("SELECT * FROM chat_attachment_uploads WHERE public_id = ?", (authorization["uploadId"],)).fetchone()
            multipart_id = upload["multipart_upload_id"]
            completed_parts = []
            for number, payload in enumerate((encrypted[:8], encrypted[8:]), 1):
                part_checksum = base64.b64encode(hashlib.sha256(payload).digest()).decode()
                part_authorization, part_error = app.authorize_chitthi_multipart_part(
                    upload_id=authorization["uploadId"], user_id=sender_id, part_number=number,
                    part_size=len(payload), part_sha256=part_checksum,
                )
                self.assertFalse(part_error)
                self.assertEqual(client.presigned["operation"], "upload_part")
                self.assertEqual(part_authorization["headers"]["x-amz-checksum-sha256"], part_checksum)
                completed_parts.append({"partNumber": number, "etag": client.upload_test_part(multipart_id, number, payload)})

            resumed, status_error = app.list_chitthi_multipart_parts(upload_id=authorization["uploadId"], user_id=sender_id)
            self.assertFalse(status_error)
            self.assertEqual([part["partNumber"] for part in resumed], [1, 2])
            completion, completion_error = app.complete_chitthi_multipart_upload(
                upload_id=authorization["uploadId"], user_id=sender_id, completed_parts=completed_parts,
            )
            self.assertFalse(completion_error)
            self.assertTrue(completion["completed"])
            self.assertEqual(client.get_object_calls, 0)
            envelopes = [
                {"recipientUserId": sender_id, "recipientDeviceId": "sender-device", "senderPublicKey": sender_key, "nonce": "n1", "ciphertext": "c1"},
                {"recipientUserId": recipient_id, "recipientDeviceId": "recipient-device", "senderPublicKey": sender_key, "nonce": "n2", "ciphertext": "c2"},
            ]
            message, finalize_error = app.finalize_chitthi_upload(
                user=sender, upload_id=authorization["uploadId"], envelopes=envelopes, client_message_id="multipart-finalized",
            )
            self.assertFalse(finalize_error)
            self.assertEqual(message["message_type"], "ENCRYPTED_ATTACHMENT")

    def test_expired_unfinalized_upload_is_deleted_from_r2_and_database(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'orphan@example.com', 'x', 1)")
                user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('orphan-conversation')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("""INSERT INTO chat_attachment_uploads
                    (public_id, conversation_id, uploader_user_id, object_key, expected_size, expected_checksum, media_mime_type, expires_at)
                    VALUES ('expired-upload', ?, ?, 'fairfares/chitthi/orphan.ffenc', 6, 'checksum', 'image/jpeg', datetime('now', '-1 hour'))""", (conversation_id, user_id))
            client.put_object(Bucket="fairfares-attachments", Key="fairfares/chitthi/orphan.ffenc", Body=b"orphan", ContentType="application/octet-stream")
            result = app.cleanup_unfinalized_chitthi_uploads()
            self.assertEqual(result, {"scanned": 1, "deleted": 1, "failed": 0})
            self.assertEqual(client.objects, {})
            with app.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM chat_attachment_uploads").fetchone()[0], 0)

    def test_finalize_verifies_r2_object_before_publishing_message(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        encrypted = b"verified-encrypted-media"
        checksum = base64.b64encode(hashlib.sha256(encrypted).digest()).decode()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths()
            app.init_db()
            with app.db() as con:
                for name, email in (("Sender", "sender-final@example.com"), ("Recipient", "recipient-final@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                sender_id, recipient_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('finalize-upload')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                for user_id in (sender_id, recipient_id):
                    con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, user_id))
                sender_key = base64.b64encode(b"S" * 32).decode()
                recipient_key = base64.b64encode(b"R" * 32).decode()
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'sender-device', ?)", (sender_id, sender_key))
                con.execute("INSERT INTO chat_device_keys (user_id, device_id, public_key) VALUES (?, 'recipient-device', ?)", (recipient_id, recipient_key))
                sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
            authorization, error = app.create_chitthi_upload_authorization(
                user_id=sender_id, conversation_public_id="finalize-upload", encrypted_size=len(encrypted),
                ciphertext_sha256=checksum, media_mime_type="video/mp4",
            )
            self.assertFalse(error)
            params = client.presigned["params"]
            client.put_object(
                Bucket=params["Bucket"], Key=params["Key"], Body=encrypted,
                ContentType=params["ContentType"], ChecksumSHA256=checksum,
                Metadata={"upload-id": authorization["uploadId"]},
            )
            envelopes = [
                {"recipientUserId": sender_id, "recipientDeviceId": "sender-device", "senderPublicKey": sender_key, "nonce": "n1", "ciphertext": "c1"},
                {"recipientUserId": recipient_id, "recipientDeviceId": "recipient-device", "senderPublicKey": sender_key, "nonce": "n2", "ciphertext": "c2"},
            ]
            message, finalize_error = app.finalize_chitthi_upload(
                user=sender, upload_id=authorization["uploadId"], envelopes=envelopes,
                client_message_id="finalized-1",
            )
            self.assertFalse(finalize_error)
            self.assertEqual(message["message_type"], "ENCRYPTED_ATTACHMENT")
            self.assertTrue(message["attachment_url"].startswith("r2://"))
            self.assertNotIn("verified-encrypted-media", message["metadata_json"])
            second, second_error = app.finalize_chitthi_upload(
                user=sender, upload_id=authorization["uploadId"], envelopes=envelopes,
                client_message_id="finalized-1",
            )
            self.assertFalse(second_error)
            self.assertEqual(second["id"], message["id"])

    def test_finalize_rejects_checksum_mismatch_without_message(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        checksum = base64.b64encode(hashlib.sha256(b"expected").digest()).decode()
        wrong_checksum = base64.b64encode(hashlib.sha256(b"wrong").digest()).decode()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'mismatch@example.com', 'x', 1)")
                sender_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('mismatch-upload')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, sender_id))
                sender = con.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
            authorization, _ = app.create_chitthi_upload_authorization(
                user_id=sender_id, conversation_public_id="mismatch-upload", encrypted_size=8,
                ciphertext_sha256=checksum, media_mime_type="image/jpeg",
            )
            params = client.presigned["params"]
            client.put_object(Bucket=params["Bucket"], Key=params["Key"], Body=b"expected", ContentType="application/octet-stream", ChecksumSHA256=wrong_checksum, Metadata={"upload-id": authorization["uploadId"]})
            message, error = app.finalize_chitthi_upload(user=sender, upload_id=authorization["uploadId"], envelopes=[], client_message_id="bad")
            self.assertIsNone(message)
            self.assertIn("verification failed", error.lower())
            with app.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0], 0)

    def test_direct_upload_authorization_binds_encrypted_size_type_and_checksum(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths()
            app.init_db()
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'sender@example.com', 'x', 1)")
                user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('direct-upload')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, user_id))
            checksum = base64.b64encode(hashlib.sha256(b'encrypted-bytes').digest()).decode()
            result, error = app.create_chitthi_upload_authorization(
                user_id=user_id, conversation_public_id="direct-upload", encrypted_size=15,
                ciphertext_sha256=checksum, media_mime_type="image/jpeg",
            )
            self.assertFalse(error)
            self.assertEqual(client.presigned["operation"], "put_object")
            self.assertEqual(client.presigned["params"]["ContentType"], "application/octet-stream")
            self.assertEqual(client.presigned["params"]["ContentLength"], 15)
            self.assertEqual(client.presigned["params"]["ChecksumSHA256"], checksum)
            self.assertNotIn("direct-upload", client.presigned["params"]["Key"])
            with app.db() as con:
                pending = con.execute("SELECT * FROM chat_attachment_uploads WHERE public_id = ?", (result["uploadId"],)).fetchone()
            self.assertEqual(pending["uploader_user_id"], user_id)
            self.assertEqual(pending["expected_checksum"], checksum)

    def test_direct_upload_authorization_rejects_non_member_and_bad_type(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths()
            app.init_db()
            with app.db() as con:
                for name, email in (("Member", "member@example.com"), ("Outsider", "outsider@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                member_id, outsider_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('private-upload')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, member_id))
            checksum = base64.b64encode(b"x" * 32).decode()
            denied, membership_error = app.create_chitthi_upload_authorization(
                user_id=outsider_id, conversation_public_id="private-upload", encrypted_size=10,
                ciphertext_sha256=checksum, media_mime_type="image/jpeg",
            )
            bad_type, type_error = app.create_chitthi_upload_authorization(
                user_id=member_id, conversation_public_id="private-upload", encrypted_size=10,
                ciphertext_sha256=checksum, media_mime_type="text/html",
            )
            self.assertIsNone(denied)
            self.assertIn("not found", membership_error.lower())
            self.assertIsNone(bad_type)
            self.assertIn("not supported", type_error.lower())

    def test_chat_payload_round_trip_uses_private_r2_reference(self):
        client = FakeR2Client()
        with mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "R2_OBJECT_PREFIX", "fairfares"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            reference = app.save_chat_file_payload(
                file_data={"filename": "photo.jpg", "mime_type": "image/jpeg", "payload": b"photo-bytes"},
                fallback_name="photo.jpg",
                allowed_mime_types={"image/jpeg"},
                max_bytes=1024,
            )
            self.assertTrue(reference.startswith("r2://fairfares-attachments/fairfares/chat/"))
            filename, mime_type, payload = app.stored_upload_parts(reference)
            self.assertTrue(filename.endswith(".jpg"))
            self.assertEqual(mime_type, "image/jpeg")
            self.assertEqual(payload, b"photo-bytes")

    def test_unconfigured_r2_keeps_local_development_fallback(self):
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(app, "DB_PATH", Path(directory) / "fairfares.sqlite3"), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""):
            reference = app.save_chat_file_payload(
                file_data={"filename": "photo.jpg", "mime_type": "image/jpeg", "payload": b"local-photo"},
                fallback_name="photo.jpg",
                allowed_mime_types={"image/jpeg"},
                max_bytes=1024,
            )
            self.assertTrue(reference.startswith("local://uploads/chat/"))
            self.assertEqual(app.stored_upload_parts(reference)[2], b"local-photo")

    def test_expired_chitthi_cleanup_removes_only_encrypted_chat_media(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""), \
             mock.patch.object(app, "CHITTHI_ATTACHMENT_RETENTION_DAYS", 1):
            app.refresh_storage_paths()
            app.init_db()
            encrypted_reference = app.save_chat_file_payload(
                file_data={"filename": "encrypted.ffenc", "mime_type": "application/octet-stream", "payload": b"encrypted-photo"},
                fallback_name="encrypted.ffenc",
                allowed_mime_types={"application/octet-stream"},
                max_bytes=1024,
            )
            normal_reference = app.save_chat_file_payload(
                file_data={"filename": "normal.jpg", "mime_type": "image/jpeg", "payload": b"normal-photo"},
                fallback_name="normal.jpg",
                allowed_mime_types={"image/jpeg"},
                max_bytes=1024,
            )
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('A', 'a@example.com', 'x', 1)")
                user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('conv')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    "INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json, created_at) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?, '{}', datetime('now', '-3 days'))",
                    (conversation_id, user_id, encrypted_reference),
                )
                encrypted_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    "INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json, created_at) VALUES (?, ?, 'IMAGE', ?, '{}', datetime('now', '-3 days'))",
                    (conversation_id, user_id, normal_reference),
                )
                normal_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            result = app.cleanup_expired_chitthi_attachments(force=True)
            self.assertEqual(result["deleted"], 1)
            self.assertIsNone(app.stored_upload_parts(encrypted_reference))
            self.assertEqual(app.stored_upload_parts(normal_reference)[2], b"normal-photo")
            with app.db() as con:
                encrypted_row = con.execute("SELECT attachment_url, metadata_json FROM chat_messages WHERE id = ?", (encrypted_id,)).fetchone()
                normal_row = con.execute("SELECT attachment_url FROM chat_messages WHERE id = ?", (normal_id,)).fetchone()
            self.assertEqual(encrypted_row["attachment_url"], "")
            self.assertIn("mediaExpired", encrypted_row["metadata_json"])
            self.assertEqual(normal_row["attachment_url"], normal_reference)

    def test_expired_chitthi_cleanup_deletes_r2_object(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "R2_OBJECT_PREFIX", "fairfares"), \
             mock.patch.object(app, "r2_storage_client", return_value=client), \
             mock.patch.object(app, "CHITTHI_ATTACHMENT_RETENTION_DAYS", 1):
            app.refresh_storage_paths()
            app.init_db()
            reference = app.save_chat_file_payload(
                file_data={"filename": "encrypted.ffenc", "mime_type": "application/octet-stream", "payload": b"encrypted-r2"},
                fallback_name="encrypted.ffenc",
                allowed_mime_types={"application/octet-stream"},
                max_bytes=1024,
            )
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('A', 'a@example.com', 'x', 1)")
                user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('conv')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    "INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json, created_at) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?, '{}', datetime('now', '-3 days'))",
                    (conversation_id, user_id, reference),
                )
            self.assertEqual(len(client.objects), 1)
            result = app.cleanup_expired_chitthi_attachments(force=True)
            self.assertEqual(result["deleted"], 1)
            self.assertEqual(client.objects, {})

    def test_chitthi_download_receipt_deletes_one_on_one_media_after_recipient_download(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""):
            app.refresh_storage_paths()
            app.init_db()
            reference = app.save_chat_file_payload(
                file_data={"filename": "encrypted.ffenc", "mime_type": "application/octet-stream", "payload": b"one-on-one"},
                fallback_name="encrypted.ffenc",
                allowed_mime_types={"application/octet-stream"},
                max_bytes=1024,
            )
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'sender@example.com', 'x', 1)")
                sender_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Recipient', 'recipient@example.com', 'x', 1)")
                recipient_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('conv-receipt')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    "INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?, '{}')",
                    (conversation_id, sender_id, reference),
                )
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    """
                    INSERT INTO chat_message_envelopes
                    (message_id, recipient_user_id, recipient_device_id, sender_public_key, nonce, ciphertext)
                    VALUES (?, ?, 'device-r', 'sender-key', 'nonce', 'ciphertext')
                    """,
                    (message_id, recipient_id),
                )
            result = app.record_chitthi_attachment_download(message_id, recipient_id, "device-r")
            self.assertTrue(result["deleted"])
            self.assertIsNone(app.stored_upload_parts(reference))
            with app.db() as con:
                row = con.execute("SELECT attachment_url, metadata_json FROM chat_messages WHERE id = ?", (message_id,)).fetchone()
            self.assertEqual(row["attachment_url"], "")
            self.assertIn("downloadedByAll", row["metadata_json"])

    def test_chitthi_group_media_waits_for_last_recipient_download(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""):
            app.refresh_storage_paths()
            app.init_db()
            reference = app.save_chat_file_payload(
                file_data={"filename": "encrypted.ffenc", "mime_type": "application/octet-stream", "payload": b"group-media"},
                fallback_name="encrypted.ffenc",
                allowed_mime_types={"application/octet-stream"},
                max_bytes=1024,
            )
            with app.db() as con:
                for name, email in (("Sender", "gs@example.com"), ("One", "one@example.com"), ("Two", "two@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                sender_id, first_id, second_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id").fetchall()]
                con.execute("INSERT INTO chat_conversations (public_id, conversation_type) VALUES ('conv-group-receipt', 'GROUP')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute(
                    "INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?, '{}')",
                    (conversation_id, sender_id, reference),
                )
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                for recipient_id, device_id in ((first_id, "device-1"), (second_id, "device-2")):
                    con.execute(
                        """
                        INSERT INTO chat_message_envelopes
                        (message_id, recipient_user_id, recipient_device_id, sender_public_key, nonce, ciphertext)
                        VALUES (?, ?, ?, 'sender-key', 'nonce', 'ciphertext')
                        """,
                        (message_id, recipient_id, device_id),
                    )
            first = app.record_chitthi_attachment_download(message_id, first_id, "device-1")
            self.assertFalse(first["deleted"])
            self.assertEqual(app.stored_upload_parts(reference)[2], b"group-media")
            second = app.record_chitthi_attachment_download(message_id, second_id, "device-2")
            self.assertTrue(second["deleted"])
            self.assertIsNone(app.stored_upload_parts(reference))

    def test_chitthi_media_waits_for_every_device_on_same_account(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""):
            app.refresh_storage_paths(); app.init_db()
            reference = app.save_chat_file_payload(
                file_data={"filename": "encrypted.ffenc", "mime_type": "application/octet-stream", "payload": b"two-devices"},
                fallback_name="encrypted.ffenc", allowed_mime_types={"application/octet-stream"}, max_bytes=1024,
            )
            with app.db() as con:
                for name, email in (("Sender", "sender-devices@example.com"), ("Recipient", "recipient-devices@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                sender_id, recipient_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('two-device-receipt')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?)", (conversation_id, sender_id, reference))
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                for device_id in ("phone-device", "tablet-device"):
                    con.execute("INSERT INTO chat_message_envelopes (message_id, recipient_user_id, recipient_device_id, sender_public_key, nonce, ciphertext) VALUES (?, ?, ?, 'key', 'nonce', 'cipher')", (message_id, recipient_id, device_id))
            first = app.record_chitthi_attachment_download(message_id, recipient_id, "phone-device")
            self.assertFalse(first["deleted"])
            self.assertEqual(first["recipientCount"], 2)
            second = app.record_chitthi_attachment_download(message_id, recipient_id, "tablet-device")
            self.assertTrue(second["deleted"])

    def test_presigned_download_is_scoped_to_recipient_device(self):
        self.addCleanup(app.refresh_storage_paths)
        client = FakeR2Client()
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "R2_BUCKET_NAME", "fairfares-attachments"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                for name, email in (("Sender", "sender-download@example.com"), ("Recipient", "recipient-download@example.com")):
                    con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, 'x', 1)", (name, email))
                sender_id, recipient_id = [int(row[0]) for row in con.execute("SELECT id FROM users ORDER BY id")]
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('download-auth')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (conversation_id, recipient_id))
                metadata = json.dumps({"size": 123, "ciphertextSha256": "digest", "mediaMimeType": "image/jpeg"})
                con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, metadata_json) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', 'r2://fairfares-attachments/fairfares/chitthi/object.ffenc', ?)", (conversation_id, sender_id, metadata))
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_message_envelopes (message_id, recipient_user_id, recipient_device_id, sender_public_key, nonce, ciphertext) VALUES (?, ?, 'authorized-device', 'key', 'nonce', 'cipher')", (message_id, recipient_id))
            allowed, error = app.create_chitthi_download_authorization(message_id=message_id, user_id=recipient_id, device_id="authorized-device")
            denied, denied_error = app.create_chitthi_download_authorization(message_id=message_id, user_id=recipient_id, device_id="other-device")
            self.assertFalse(error)
            self.assertEqual(client.presigned["operation"], "get_object")
            self.assertEqual(allowed["encryptedSize"], 123)
            self.assertIsNone(denied)
            self.assertIn("not found", denied_error.lower())

    def test_deleted_chitthi_message_is_hard_deleted_after_five_days_with_related_data(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "R2_ACCOUNT_ID", ""), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", ""), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", ""), \
             mock.patch.object(app, "CHITTHI_DELETED_MESSAGE_RETENTION_DAYS", 5):
            app.refresh_storage_paths(); app.init_db()
            reference = app.save_chat_file_payload(
                file_data={"filename": "deleted.ffenc", "mime_type": "application/octet-stream", "payload": b"deleted-ciphertext"},
                fallback_name="deleted.ffenc", allowed_mime_types={"application/octet-stream"}, max_bytes=1024,
            )
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'purge-sender@example.com', 'x', 1)")
                sender_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Recipient', 'purge-recipient@example.com', 'x', 1)")
                recipient_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('purge-conversation')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_type, attachment_url, deleted_at) VALUES (?, ?, 'ENCRYPTED_ATTACHMENT', ?, datetime('now', '-6 days'))", (conversation_id, sender_id, reference))
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_message_envelopes (message_id, recipient_user_id, recipient_device_id, sender_public_key, nonce, ciphertext) VALUES (?, ?, 'device', 'key', 'nonce', 'cipher')", (message_id, recipient_id))
                con.execute("INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES (?, ?, '👍')", (message_id, recipient_id))
                con.execute("INSERT INTO chat_attachment_device_receipts (message_id, user_id, device_id) VALUES (?, ?, 'device')", (message_id, recipient_id))
                con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_text, reply_to_message_id) VALUES (?, ?, 'reply', ?)", (conversation_id, recipient_id, message_id))
                reply_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            result = app.cleanup_deleted_chitthi_messages()
            self.assertEqual(result["deleted"], 1)
            self.assertIsNone(app.stored_upload_parts(reference))
            with app.db() as con:
                self.assertIsNone(con.execute("SELECT id FROM chat_messages WHERE id = ?", (message_id,)).fetchone())
                self.assertIsNone(con.execute("SELECT id FROM chat_message_envelopes WHERE message_id = ?", (message_id,)).fetchone())
                self.assertIsNone(con.execute("SELECT id FROM chat_message_reactions WHERE message_id = ?", (message_id,)).fetchone())
                reply = con.execute("SELECT reply_to_message_id FROM chat_messages WHERE id = ?", (reply_id,)).fetchone()
                self.assertIsNone(reply["reply_to_message_id"])

    def test_open_report_holds_deleted_chitthi_message_past_five_days(self):
        self.addCleanup(app.refresh_storage_paths)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ, {"FAIRFARES_DB_PATH": str(Path(directory) / "fairfares.sqlite3"), "FAIRFARES_SEED_DEFAULTS": "0"}), \
             mock.patch.object(app, "CHITTHI_DELETED_MESSAGE_RETENTION_DAYS", 5):
            app.refresh_storage_paths(); app.init_db()
            with app.db() as con:
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Sender', 'hold-sender@example.com', 'x', 1)")
                sender_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO users (name, email, password_hash, is_verified) VALUES ('Reporter', 'hold-reporter@example.com', 'x', 1)")
                reporter_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_conversations (public_id) VALUES ('hold-conversation')")
                conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_text, deleted_at) VALUES (?, ?, 'deleted', datetime('now', '-6 days'))", (conversation_id, sender_id))
                message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                con.execute("INSERT INTO chat_message_reports (message_id, conversation_id, reporter_user_id, reason, status) VALUES (?, ?, ?, 'abuse', 'OPEN')", (message_id, conversation_id, reporter_id))
            result = app.cleanup_deleted_chitthi_messages()
            self.assertEqual(result["heldForReport"], 1)
            self.assertEqual(result["deleted"], 0)
            with app.db() as con:
                self.assertIsNotNone(con.execute("SELECT id FROM chat_messages WHERE id = ?", (message_id,)).fetchone())


if __name__ == "__main__":
    unittest.main()
