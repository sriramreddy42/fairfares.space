import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("FAIRFARES_SKIP_BOOTSTRAP", "1")

import app


class FakeR2Client:
    def __init__(self):
        self.objects = {}

    def put_object(self, **kwargs):
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = {
            "Body": bytes(kwargs["Body"]),
            "ContentType": kwargs["ContentType"],
        }

    def get_object(self, **kwargs):
        stored = self.objects[(kwargs["Bucket"], kwargs["Key"])]
        payload = stored["Body"]

        class Body:
            def read(self, limit):
                return payload[:limit]

        return {"Body": Body(), "ContentLength": len(payload), "ContentType": stored["ContentType"]}


class R2StorageTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
