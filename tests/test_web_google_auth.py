import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

import app


class QuietHandler(app.FairFaresHandler):
    def log_message(self, _format, *_args):
        return


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class WebGoogleAuthTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_values = {
            name: os.environ.get(name)
            for name in (
                "FAIRFARES_DB_PATH",
                "FAIRFARES_SEED_DEFAULTS",
                "GOOGLE_WEB_CLIENT_ID",
                "PUBLIC_BASE_URL",
            )
        }
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "google-web.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        os.environ["GOOGLE_WEB_CLIENT_ID"] = "web-client.apps.googleusercontent.com"
        os.environ["PUBLIC_BASE_URL"] = "https://www.fairfare.space"
        app.refresh_storage_paths()
        app.init_db()

    def tearDown(self):
        for name, value in self.old_values.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    @staticmethod
    def start_server():
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    @staticmethod
    def google_post(server, csrf_cookie="matching-csrf", submitted_csrf="matching-csrf"):
        payload = urllib.parse.urlencode(
            {"credential": "verified-google-token", "g_csrf_token": submitted_csrf}
        ).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/auth/google",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": f"g_csrf_token={csrf_cookie}",
            },
        )
        return urllib.request.build_opener(NoRedirect()).open(request, timeout=5)

    def test_login_page_renders_official_google_button_and_callback(self):
        server, thread = self.start_server()
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/login", timeout=5
            ) as response:
                body = response.read().decode("utf-8")
            self.assertIn("https://accounts.google.com/gsi/client", body)
            self.assertIn("web-client.apps.googleusercontent.com", body)
            self.assertIn("https://www.fairfare.space/auth/google", body)
            self.assertIn('class="g_id_signin"', body)
            self.assertNotIn("Continue with Apple", body)
            self.assertNotIn("Continue with Facebook", body)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_google_callback_creates_verified_account_and_session(self):
        claims = {
            "sub": "google-web-member-123",
            "email": "web.member@example.com",
            "email_verified": True,
            "name": "Web Member",
        }
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                with self.assertRaises(urllib.error.HTTPError) as redirect:
                    self.google_post(server)
            self.assertEqual(redirect.exception.code, 303)
            self.assertEqual(redirect.exception.headers["Location"], "/dashboard")
            self.assertIn(f"{app.SESSION_COOKIE}=", redirect.exception.headers["Set-Cookie"])
            with app.db() as con:
                user = con.execute(
                    "SELECT * FROM users WHERE email = ?", ("web.member@example.com",)
                ).fetchone()
                identity = con.execute(
                    "SELECT * FROM auth_identities WHERE provider = 'google' AND provider_subject = ?",
                    ("google-web-member-123",),
                ).fetchone()
            self.assertIsNotNone(user)
            self.assertEqual(user["name"], "Web Member")
            self.assertEqual(int(user["is_verified"]), 1)
            self.assertEqual(int(identity["user_id"]), int(user["id"]))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_google_callback_rejects_csrf_mismatch_before_token_verification(self):
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "verify_google_identity_token") as verifier:
                with self.google_post(server, submitted_csrf="different-csrf") as response:
                    body = response.read().decode("utf-8")
            verifier.assert_not_called()
            self.assertIn("Google sign-in could not be validated", body)
            with app.db() as con:
                count = con.execute("SELECT COUNT(*) AS count FROM auth_identities").fetchone()["count"]
            self.assertEqual(int(count), 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
