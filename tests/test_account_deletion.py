import json
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


class AccountDeletionTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db = os.environ.get("FAIRFARES_DB_PATH")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "deletion.sqlite3")
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Delete Member", "delete@example.com", app.hash_password("Password123!")),
            )
            self.user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            self.token = "deletion-test-session"
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (self.token, self.user_id))
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, is_admin, role) VALUES (?, ?, ?, 1, 1, 'ADMIN')",
                ("Privacy Admin", "privacy-admin@example.com", app.hash_password("Password123!")),
            )
            self.admin_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            self.admin_token = "privacy-admin-session"
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (self.admin_token, self.admin_id))

    def tearDown(self):
        if self.old_db is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def start_server(self):
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread

    def test_authenticated_mobile_request_is_tracked_and_idempotent(self):
        server, thread = self.start_server()
        try:
            url = f"http://127.0.0.1:{server.server_port}/api/mobile/account-deletion"
            headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
            invalid = urllib.request.Request(url, data=json.dumps({"confirmation": "yes"}).encode(), headers=headers, method="POST")
            with self.assertRaises(urllib.error.HTTPError) as invalid_error:
                urllib.request.urlopen(invalid, timeout=5)
            self.assertEqual(invalid_error.exception.code, 400)

            valid = urllib.request.Request(url, data=json.dumps({"confirmation": "DELETE"}).encode(), headers=headers, method="POST")
            with mock.patch.object(app, "send_with_resend", return_value="sent through test provider"), mock.patch.object(app, "send_operational_alert"):
                with urllib.request.urlopen(valid, timeout=5) as response:
                    first = json.loads(response.read().decode())
                with urllib.request.urlopen(valid, timeout=5) as response:
                    second = json.loads(response.read().decode())
            self.assertEqual(first["request"]["requestId"], second["request"]["requestId"])
            self.assertEqual(first["request"]["status"], "PENDING")
            self.assertTrue(first["request"]["deletionDueAt"])
            with app.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) AS total FROM account_deletion_requests").fetchone()["total"], 1)

            status_request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}"})
            with urllib.request.urlopen(status_request, timeout=5) as response:
                status = json.loads(response.read().decode())
            self.assertEqual(status["request"]["requestId"], first["request"]["requestId"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_public_page_is_available_and_api_requires_login(self):
        server, thread = self.start_server()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/account-deletion", timeout=5) as response:
                page = response.read().decode()
            self.assertIn("Delete your FairFares account", page)
            self.assertIn("Sign in to request deletion", page)
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/account-deletion",
                data=json.dumps({"confirmation": "DELETE"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as unauthenticated:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(unauthenticated.exception.code, 401)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_admin_can_review_a_deletion_request_in_the_privacy_queue(self):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO account_deletion_requests
                (request_id, user_id, email_snapshot, source, deletion_due_at)
                VALUES ('DEL-TEST-001', ?, 'delete@example.com', 'MOBILE', '2030-01-01 00:00:00')
                """,
                (self.user_id,),
            )
            request_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

        server, thread = self.start_server()
        try:
            page_url = f"http://127.0.0.1:{server.server_port}/admin/account-deletions"
            admin_headers = {"Cookie": f"{app.SESSION_COOKIE}={self.admin_token}"}
            with urllib.request.urlopen(urllib.request.Request(page_url, headers=admin_headers), timeout=5) as response:
                page = response.read().decode()
            self.assertIn("Account deletion requests", page)
            self.assertIn("DEL-TEST-001", page)
            self.assertIn("Delete Member", page)

            body = urllib.parse.urlencode({
                "request_id": str(request_id),
                "status": "COMPLETED",
                "admin_note": "Verified request and completed the approved deletion workflow.",
                "retained_data_summary": "No retained-data exception.",
            }).encode()
            update = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/admin/account-deletions/update",
                data=body,
                headers={
                    **admin_headers,
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": page_url,
                },
                method="POST",
            )
            with mock.patch.object(app, "send_with_resend", return_value="sent through test provider"):
                with urllib.request.urlopen(update, timeout=5) as response:
                    updated_page = response.read().decode()
            self.assertIn("Request review saved", updated_page)
            self.assertIn("Completed", updated_page)
            with app.db() as con:
                updated = con.execute("SELECT * FROM account_deletion_requests WHERE id = ?", (request_id,)).fetchone()
            self.assertEqual(updated["status"], "COMPLETED")
            self.assertTrue(updated["completed_at"])
            self.assertEqual(updated["admin_note"], "Verified request and completed the approved deletion workflow.")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
