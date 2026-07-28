import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

import app


class QuietHandler(app.FairFaresHandler):
    def log_message(self, _format, *_args):
        return


class SecurityHardeningTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_values = {name: os.environ.get(name) for name in (
            "FAIRFARES_DB_PATH", "FAIRFARES_SEED_DEFAULTS", "FAIRFARES_ADMIN_EMAIL",
            "FAIRFARES_ADMIN_PASSWORD", "STRIPE_WEBHOOK_SECRET",
        )}
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "security.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        for name in ("FAIRFARES_ADMIN_EMAIL", "FAIRFARES_ADMIN_PASSWORD", "STRIPE_WEBHOOK_SECRET"):
            os.environ.pop(name, None)
        app._LOGIN_ATTEMPTS.clear()
        app.refresh_storage_paths()
        app.init_db()

    def tearDown(self):
        for name, value in self.old_values.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        app._LOGIN_ATTEMPTS.clear()
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def start_server(self):
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    def test_password_hashes_are_salted_strong_and_legacy_compatible(self):
        first = app.hash_password("CorrectHorseBatteryStaple!")
        second = app.hash_password("CorrectHorseBatteryStaple!")
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith(f"pbkdf2_sha256${app.PASSWORD_HASH_ITERATIONS}$"))
        self.assertTrue(app.verify_password("CorrectHorseBatteryStaple!", first))
        salt = bytes.fromhex("00" * 16)
        digest = app.hashlib.pbkdf2_hmac("sha256", b"LegacyPassword!", salt, 120_000).hex()
        legacy = f"{salt.hex()}:{digest}"
        self.assertTrue(app.verify_password("LegacyPassword!", legacy))
        self.assertTrue(app.password_hash_needs_upgrade(legacy))

    def test_login_rate_limit_blocks_repeated_attempts(self):
        key = app.login_rate_limit_key("127.0.0.1", "person@example.com")
        for index in range(app.LOGIN_RATE_LIMIT_ATTEMPTS):
            app.record_login_failure(key, now=1000 + index)
        self.assertGreater(app.login_retry_after(key, now=1000 + app.LOGIN_RATE_LIMIT_ATTEMPTS), 0)
        app.clear_login_failures(key)
        self.assertEqual(app.login_retry_after(key, now=1006), 0)

    def test_ooxml_validation_rejects_fake_and_macro_documents(self):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        self.assertFalse(app.valid_chat_document_payload(mime, "resume.docx", b"not a zip"))
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("[Content_Types].xml", "types")
            archive.writestr("word/document.xml", "document")
            archive.writestr("word/vbaProject.bin", b"macro")
        self.assertFalse(app.valid_chat_document_payload(mime, "resume.docx", buffer.getvalue()))

    def test_local_upload_reference_cannot_escape_upload_directory(self):
        sibling = Path(self.temp_dir.name) / "uploads-private"
        sibling.mkdir()
        (sibling / "secret.txt").write_text("not public", encoding="utf-8")
        self.assertIsNone(app.local_upload_parts("local://uploads/../uploads-private/secret.txt"))

    def test_application_secret_is_random_persistent_and_private(self):
        first = app.application_secret()
        second = app.application_secret()
        self.assertEqual(first, second)
        self.assertGreaterEqual(len(first), 32)
        secret_path = Path(self.temp_dir.name) / ".fairfares-app-secret"
        self.assertEqual(secret_path.stat().st_mode & 0o777, 0o600)

    def test_cross_origin_api_post_is_rejected_and_security_headers_are_present(self):
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/login",
                data=json.dumps({"email": "a@example.com", "password": "bad"}).encode(),
                headers={"Content-Type": "application/json", "Origin": "https://attacker.example"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(error.exception.code, 403)
            self.assertEqual(error.exception.headers["X-Frame-Options"], "DENY")
            self.assertEqual(error.exception.headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("frame-ancestors 'none'", error.exception.headers["Content-Security-Policy"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_unsigned_stripe_webhook_fails_closed_when_secret_missing(self):
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/stripe/webhook",
                data=json.dumps({"type": "checkout.session.completed"}).encode(),
                headers={"Content-Type": "application/json"},
            )
            with patch.object(app, "stripe_webhook_secret", return_value=""):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=3)
            self.assertEqual(error.exception.code, 503)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
