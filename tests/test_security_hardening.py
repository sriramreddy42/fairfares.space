import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

import app


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

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

    def test_google_maps_loader_reports_auth_failures_and_uses_async_loader(self):
        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test maps key"}):
            loader = app.explorer_maps_loader()
        self.assertIn("loading=async", loader)
        self.assertIn("gm_authFailure", loader)
        self.assertIn("fairfares-map-error", loader)
        self.assertIn("referrerpolicy=\"origin\"", loader)

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

    def test_login_rate_limit_is_persistent_and_account_scoped(self):
        ip_key = app.login_rate_limit_key("127.0.0.1", "Person@Example.com")
        account_key = app.login_account_rate_limit_key("person@example.com")
        self.assertNotIn("person@example.com", ip_key)
        self.assertNotEqual(ip_key, account_key)
        for _index in range(app.LOGIN_RATE_LIMIT_ATTEMPTS):
            app.record_login_failure(account_key)
        self.assertGreater(app.login_retry_after(account_key), 0)
        with app.db() as con:
            stored = con.execute(
                "SELECT attempt_count FROM security_rate_limits WHERE scope = 'login' AND rate_key = ?",
                (account_key,),
            ).fetchone()
        self.assertEqual(stored["attempt_count"], app.LOGIN_RATE_LIMIT_ATTEMPTS)
        app._LOGIN_ATTEMPTS.clear()
        self.assertGreater(app.login_retry_after(account_key), 0)
        app.clear_login_failures(account_key)
        self.assertEqual(app.login_retry_after(account_key), 0)

    def test_account_fields_are_cleaned_and_passwords_are_bounded(self):
        name, email, phone, error = app.validate_account_fields(
            "  Test\x00   Person  ", " TEST@Example.COM ", "+1 (303) 555-0199", "correct horse battery staple"
        )
        self.assertEqual(name, "Test Person")
        self.assertEqual(email, "test@example.com")
        self.assertEqual(phone, "+1 (303) 555-0199")
        self.assertEqual(error, "")
        self.assertFalse(app.valid_account_password("x" * (app.MAX_PASSWORD_LENGTH + 1)))

    def test_unknown_password_reset_does_not_create_a_token_for_another_user(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES ('First User', 'first@example.com', ?, 1)",
                (app.hash_password("StrongPassword123!"),),
            )
        server, thread = self.start_server()
        try:
            body = urllib.parse.urlencode({"email": "missing@example.com"}).encode("utf-8")
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/forgot-password",
                data=body,
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                self.assertEqual(response.status, 200)
            with app.db() as con:
                reset_count = con.execute(
                    "SELECT COUNT(*) AS count FROM email_verifications WHERE purpose = 'PASSWORD_RESET'"
                ).fetchone()["count"]
            self.assertEqual(reset_count, 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_client_disconnect_is_not_reported_as_a_backend_failure(self):
        handler = object.__new__(QuietHandler)
        handler.path = "/api/chat/conversations"
        handler.command = "GET"
        with patch.object(app.SimpleHTTPRequestHandler, "handle_one_request", side_effect=BrokenPipeError), \
             patch.object(app, "send_operational_alert") as alert:
            handler.handle_one_request()
        self.assertTrue(handler.client_disconnected)
        self.assertTrue(handler.close_connection)
        alert.assert_not_called()

    def test_feedback_rate_limit_blocks_repeated_submissions(self):
        key = app.feedback_rate_limit_key("127.0.0.1", 42)
        for index in range(app.FEEDBACK_RATE_LIMIT_ATTEMPTS):
            app.record_feedback_submission(key, now=2000 + index)
        self.assertGreater(app.feedback_retry_after(key, now=2000 + app.FEEDBACK_RATE_LIMIT_ATTEMPTS), 0)
        app.clear_feedback_submissions(key)
        self.assertEqual(app.feedback_retry_after(key, now=2006), 0)
        self.assertNotEqual(key, app.feedback_rate_limit_key("127.0.0.1", 43))

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
            content_security_policy = error.exception.headers["Content-Security-Policy"]
            self.assertIn("frame-ancestors 'none'", content_security_policy)
            self.assertIn("https://maps.googleapis.com", content_security_policy)
            self.assertIn("https://maps.gstatic.com", content_security_policy)
            self.assertIn("frame-src ", content_security_policy)
            self.assertIn("https://www.youtube.com", content_security_policy)
            self.assertIn("https://www.youtube-nocookie.com", content_security_policy)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_production_custom_domain_is_allowed_for_mobile_api_cors(self):
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/bootstrap",
                method="OPTIONS",
                headers={
                    "Origin": "https://www.fairfare.space",
                    "Access-Control-Request-Method": "GET",
                },
            )
            with urllib.request.urlopen(request, timeout=3) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://www.fairfare.space")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_bootstrap_rejects_an_invalid_bearer_instead_of_logging_user_out_as_guest(self):
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/bootstrap",
                headers={"Authorization": "Bearer expired-or-invalid-token"},
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(error.exception.code, 401)
            payload = json.loads(error.exception.read())
            self.assertTrue(payload["login_required"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_health_endpoint_checks_database_availability(self):
        server, thread = self.start_server()
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/api/health",
                timeout=3,
            ) as response:
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["status"], "healthy")
                self.assertEqual(payload["database"], "available")
                self.assertEqual(payload["service"], "fairfares-api")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_feedback_interest_allows_production_mobile_cors_preflight_and_post(self):
        server, thread = self.start_server()
        origin = "https://www.fairfare.space"
        try:
            preflight = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/feedback",
                method="OPTIONS",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            with urllib.request.urlopen(preflight, timeout=3) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)

            payload = urllib.parse.urlencode({
                "rating": "5",
                "message": "Interested in FairFares Exports & Imports service.",
                "page": "mobile-home-exports-imports",
            }).encode()
            post = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/feedback",
                data=payload,
                headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": origin},
            )
            with urllib.request.urlopen(post, timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                self.assertTrue(json.loads(response.read())["ok"])
            with app.db() as con:
                row = con.execute("SELECT page FROM app_feedback ORDER BY id DESC LIMIT 1").fetchone()
            self.assertEqual(row["page"], "mobile-home-exports-imports")
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
