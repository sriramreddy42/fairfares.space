import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import app


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


class ChitthiSafetyReportsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            self.reporter_id = self.insert_user(con, "Reporter", "reporter@safety.test")
            self.reported_id = self.insert_user(con, "Reported", "reported@safety.test")
            self.admin_id = self.insert_user(con, "Admin", "admin@safety.test", admin=True)
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('reporter-token', ?)", (self.reporter_id,))
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('admin-token', ?)", (self.admin_id,))
            con.execute("INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('CHAT-SAFETY', 'DIRECT', 'Safety test')")
            self.conversation_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (self.conversation_id, self.reporter_id))
            con.execute("INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)", (self.conversation_id, self.reported_id))
            con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, 'first message')", (self.conversation_id, self.reporter_id))
            con.execute("INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, 'unsafe message')", (self.conversation_id, self.reported_id))
            self.reported_message_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO user_ratings (reviewer_user_id, reviewed_user_id, context_type, context_public_id, score, comment) VALUES (?, ?, 'CHAT', 'older-one', 4, '')", (self.reporter_id, self.reported_id))
            con.execute("INSERT INTO user_ratings (reviewer_user_id, reviewed_user_id, context_type, context_public_id, score, comment) VALUES (?, ?, 'CHAT', 'older-two', 2, '')", (self.admin_id, self.reported_id))

    @staticmethod
    def insert_user(con, name, email, admin=False):
        con.execute(
            "INSERT INTO users (name, email, password_hash, is_verified, is_admin, role) VALUES (?, ?, 'x', 1, ?, ?)",
            (name, email, 1 if admin else 0, "ADMIN" if admin else "USER"),
        )
        return int(con.execute("SELECT last_insert_rowid()").fetchone()[0])

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

    def start_server(self):
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        return server

    @staticmethod
    def post(server, token, path, fields):
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}{path}",
            data=urllib.parse.urlencode(fields).encode("utf-8"),
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8")) if "api/" in path else response.headers
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_report_captures_category_comment_priority_and_rating_context(self):
        server = self.start_server()
        status, response = self.post(server, "reporter-token", "/api/chat/messages/report", {
            "conversation_id": "CHAT-SAFETY",
            "message_id": self.reported_message_id,
            "reported_user_id": self.reported_id,
            "reason": "THREATS_OR_VIOLENCE",
            "details": "They threatened me after I declined to share my address.",
        })
        self.assertEqual(status, 201)
        self.assertTrue(response["ok"])
        self.assertEqual(response["priority"], "HIGH")
        with app.db() as con:
            report = con.execute("SELECT * FROM chat_message_reports").fetchone()
            self.assertEqual(report["reported_user_id"], self.reported_id)
            self.assertEqual(report["reason"], "THREATS_OR_VIOLENCE")
            self.assertIn("declined", report["details"])
            self.assertEqual(report["priority"], "HIGH")
            self.assertEqual(report["rating_count"], 2)
            self.assertEqual(report["rating_average"], 3.0)
            self.assertEqual(con.execute("SELECT COUNT(*) FROM mobile_push_outbox WHERE user_id = ?", (self.reported_id,)).fetchone()[0], 0)

        admin_rows = app.get_admin_chat_reports()
        self.assertEqual(len(admin_rows), 1)
        self.assertEqual(admin_rows[0]["reported_name"], "Reported")
        self.assertEqual(app.chat_report_rating_label(admin_rows[0]), "3.0 (2)")
        self.assertIn("declined", admin_rows[0]["details"])

    def test_direct_member_report_anchors_to_latest_member_message_and_rejects_self_report(self):
        server = self.start_server()
        status, response = self.post(server, "reporter-token", "/api/chat/messages/report", {
            "conversation_id": "CHAT-SAFETY",
            "reported_user_id": self.reported_id,
            "reason": "SPAM_SCAM",
            "details": "They keep sending a suspicious payment link.",
        })
        self.assertEqual(status, 201)
        self.assertEqual(response["priority"], "NORMAL")
        with app.db() as con:
            report = con.execute("SELECT message_id, reported_user_id FROM chat_message_reports").fetchone()
            self.assertEqual(report["message_id"], self.reported_message_id)
            self.assertEqual(report["reported_user_id"], self.reported_id)

        status, response = self.post(server, "reporter-token", "/api/chat/messages/report", {
            "conversation_id": "CHAT-SAFETY",
            "message_id": self.reported_message_id - 1,
            "reported_user_id": self.reporter_id,
            "reason": "OTHER",
            "details": "Trying to report my own message.",
        })
        self.assertEqual(status, 400)
        self.assertIn("another member", response["message"])

    def test_previous_mobile_build_can_still_submit_its_generic_message_report(self):
        server = self.start_server()
        status, response = self.post(server, "reporter-token", "/api/chat/messages/report", {
            "conversation_id": "CHAT-SAFETY",
            "message_id": self.reported_message_id,
            "reason": "Reported from mobile Messenger",
        })
        self.assertEqual(status, 201)
        self.assertTrue(response["ok"])
        with app.db() as con:
            report = con.execute("SELECT reason, details FROM chat_message_reports").fetchone()
            self.assertEqual(report["reason"], "OTHER")
            self.assertIn("earlier FairFares app version", report["details"])

    def test_admin_can_escalate_and_resolve_without_notifying_reported_member(self):
        server = self.start_server()
        status, _response = self.post(server, "reporter-token", "/api/chat/messages/report", {
            "conversation_id": "CHAT-SAFETY",
            "message_id": self.reported_message_id,
            "reason": "THEFT_OR_PROPERTY_DAMAGE",
            "details": "My property was taken after the handoff.",
        })
        self.assertEqual(status, 201)
        with app.db() as con:
            report_id = int(con.execute("SELECT id FROM chat_message_reports").fetchone()[0])

        self.post(server, "admin-token", "/admin/chitthi/reports/moderate", {"report_id": report_id, "action": "ESCALATED"})
        with app.db() as con:
            report = con.execute("SELECT status, reviewed_by FROM chat_message_reports WHERE id = ?", (report_id,)).fetchone()
            self.assertEqual(report["status"], "ESCALATED")
            self.assertEqual(report["reviewed_by"], self.admin_id)
        self.post(server, "admin-token", "/admin/chitthi/reports/moderate", {"report_id": report_id, "action": "RESOLVED"})
        with app.db() as con:
            self.assertEqual(con.execute("SELECT status FROM chat_message_reports WHERE id = ?", (report_id,)).fetchone()[0], "RESOLVED")


if __name__ == "__main__":
    unittest.main()
