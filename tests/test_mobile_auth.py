import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

import app


class QuietHandler(app.FairFaresHandler):
    def log_message(self, _format, *_args):
        return


class MobileAuthTest(unittest.TestCase):
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
    def start_server():
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    @staticmethod
    def post_json(server, path, payload):
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_mobile_signup_activation_and_login_complete_end_to_end(self):
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "activation.txt", "sent through test provider")):
                status, signup = self.post_json(server, "/api/mobile/signup", {
                    "name": "  Mobile   Member  ",
                    "email": " MOBILE@example.com ",
                    "phone": "+1 (937) 555-0199",
                    "password": "CorrectHorse123!",
                    "phoneDiscoverable": False,
                })
            self.assertEqual(status, 201)
            self.assertTrue(signup["activationRequired"])
            self.assertFalse(signup["token"])
            with app.db() as con:
                user = con.execute("SELECT * FROM users WHERE email = ?", ("mobile@example.com",)).fetchone()
                verification = con.execute(
                    "SELECT token FROM email_verifications WHERE user_id = ? AND purpose = 'ACCOUNT' ORDER BY datetime(created_at) DESC LIMIT 1",
                    (int(user["id"]),),
                ).fetchone()
            self.assertEqual(user["name"], "Mobile Member")
            self.assertEqual(int(user["chat_phone_discoverable"]), 0)

            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "resent.txt", "sent through test provider")):
                with self.assertRaises(urllib.error.HTTPError) as pending_error:
                    self.post_json(server, "/api/mobile/login", {
                        "identifier": "mobile@example.com",
                        "password": "CorrectHorse123!",
                    })
            self.assertEqual(pending_error.exception.code, 403)
            pending_payload = json.loads(pending_error.exception.read().decode("utf-8"))
            self.assertTrue(pending_payload["activationRequired"])
            self.assertIn("fresh activation link", pending_payload["error"])

            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/activate?token={verification['token']}", timeout=5
            ) as response:
                self.assertEqual(response.status, 200)

            login_status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": " mobile@example.com ",
                "password": "CorrectHorse123!",
            })
            self.assertEqual(login_status, 200)
            self.assertTrue(login["token"])
            self.assertEqual(login["user"]["email"], "mobile@example.com")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_signup_preserves_guest_profile_and_rejects_member_phone_reuse(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, guest_account) VALUES (?, ?, ?, ?, 1)",
                ("Booking Guest", "guest@example.com", "+1 937 555 0101", app.hash_password("temporary-password")),
            )
            guest_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Existing Member", "existing@example.com", "+1 937 555 0202", app.hash_password("ExistingPassword123!")),
            )
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "guest-activation.txt", "sent through test provider")):
                status, _signup = self.post_json(server, "/api/mobile/signup", {
                    "name": "Booking Member",
                    "email": "guest@example.com",
                    "phone": "+1 937 555 0101",
                    "password": "MemberPassword123!",
                })
            self.assertEqual(status, 201)
            with app.db() as con:
                converted = con.execute("SELECT * FROM users WHERE email = 'guest@example.com'").fetchone()
            self.assertEqual(int(converted["id"]), guest_id)
            self.assertEqual(int(converted["guest_account"]), 0)

            with self.assertRaises(urllib.error.HTTPError) as duplicate_phone:
                self.post_json(server, "/api/mobile/signup", {
                    "name": "Different Person",
                    "email": "different@example.com",
                    "phone": "19375550202",
                    "password": "DifferentPassword123!",
                })
            self.assertEqual(duplicate_phone.exception.code, 409)
            duplicate_payload = json.loads(duplicate_phone.exception.read().decode("utf-8"))
            self.assertIn("phone number already exists", duplicate_payload["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
