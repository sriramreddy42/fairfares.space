import base64
import hashlib
import io
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
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


class MobileAuthTest(unittest.TestCase):
    def test_country_code_and_national_number_are_canonicalized_to_e164(self):
        self.assertEqual(app.canonical_e164_phone("937-555-0199", "+1"), "+19375550199")
        self.assertEqual(app.canonical_e164_phone("09876543210", "+91"), "+919876543210")
        self.assertEqual(app.canonical_e164_phone("+44 7700 900123", "+1"), "+447700900123")
        self.assertEqual(app.canonical_e164_phone("555", "+1"), "")

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

    @staticmethod
    def post_form(server, path, payload):
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}{path}",
            data=urllib.parse.urlencode(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read().decode("utf-8")

    def test_published_housing_testimonial_avatar_uses_stable_public_delivery_path(self):
        stored_photo = f"r2://{app.R2_BUCKET_NAME}/fairfares/profiles/public-testimonial.png"
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, profile_photo_url) VALUES (?, ?, ?, 1, ?)",
                ("Public Reviewer", "reviewer@example.com", "unused", stored_photo),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute(
                "INSERT INTO testimonials (user_id, city, rating, message, status, published_at) VALUES (?, ?, 5, ?, 'PUBLISHED', CURRENT_TIMESTAMP)",
                (user_id, "Denver, CO", "A genuinely useful public housing review."),
            )

        origin = "https://fairfares.example"
        testimonial = app.get_mobile_housing_testimonials("Denver, CO", public_origin=origin)[0]
        parsed = urllib.parse.urlparse(testimonial["photoUrl"])
        query = urllib.parse.parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "")
        self.assertEqual(parsed.netloc, "")
        self.assertEqual(parsed.path, "/api/chat/notification-avatar")
        self.assertEqual(query["user"], [str(user_id)])
        self.assertTrue(query.get("v"))
        self.assertFalse(query.get("expires"))
        self.assertFalse(query.get("signature"))
        self.assertNotIn("public-testimonial.png", testimonial["photoUrl"])

    def test_published_testimonial_avatar_is_available_without_login(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        stored_photo = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, profile_photo_url) VALUES (?, ?, ?, 1, ?)",
                ("Public Avatar", "public-avatar@example.com", "unused", stored_photo),
            )
            user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO testimonials (user_id, city, rating, message, status, published_at) VALUES (?, 'Denver, CO', 5, ?, 'PUBLISHED', CURRENT_TIMESTAMP)",
                (user_id, "This public testimonial has a durable profile avatar."),
            )
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/notification-avatar?user={user_id}"
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = response.read()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), "image/png")
            self.assertEqual(payload, png)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_r2_profile_avatar_is_streamed_by_fairfares_without_cross_host_redirect(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        object_key = "fairfares/profiles/stable-avatar.png"
        stored_photo = f"r2://{app.R2_BUCKET_NAME}/{object_key}"
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, profile_photo_url) VALUES (?, ?, ?, 1, ?)",
                ("R2 Avatar", "r2-avatar@example.com", "unused", stored_photo),
            )
            user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO testimonials (user_id, city, rating, message, status, published_at) VALUES (?, 'Denver, CO', 5, ?, 'PUBLISHED', CURRENT_TIMESTAMP)",
                (user_id, "This testimonial verifies the stable R2 avatar delivery path."),
            )
        client = mock.Mock()
        client.get_object.return_value = {
            "Body": io.BytesIO(png),
            "ContentLength": len(png),
            "ContentType": "image/png",
        }
        with mock.patch.object(app, "R2_ACCOUNT_ID", "account"), \
             mock.patch.object(app, "R2_ACCESS_KEY_ID", "access"), \
             mock.patch.object(app, "R2_SECRET_ACCESS_KEY", "secret"), \
             mock.patch.object(app, "r2_storage_client", return_value=client):
            server, thread = self.start_server()
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/chat/notification-avatar?user={user_id}"
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    payload = response.read()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.geturl(), request.full_url)
                    self.assertEqual(response.headers.get_content_type(), "image/png")
                self.assertEqual(payload, png)
                client.get_object.assert_called_once_with(Bucket=app.R2_BUCKET_NAME, Key=object_key)
                client.generate_presigned_url.assert_not_called()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_mobile_signup_activation_and_login_complete_end_to_end(self):
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "activation.txt", "sent through test provider")):
                status, signup = self.post_json(server, "/api/mobile/signup", {
                    "name": "  Mobile   Member  ",
                    "email": " MOBILE@example.com ",
                    "phone": "(937) 555-0199",
                    "countryCode": "+1",
                    "password": "CorrectHorse123!",
                    "phoneDiscoverable": False,
                    "consentAccepted": True,
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
            self.assertEqual(user["phone"], "+19375550199")
            self.assertEqual(int(user["chat_phone_discoverable"]), 0)
            self.assertTrue(user["consented_at"])
            self.assertEqual(user["terms_version"], app.TERMS_VERSION)
            self.assertEqual(user["privacy_version"], app.PRIVACY_VERSION)
            self.assertEqual(user["community_guidelines_version"], app.COMMUNITY_GUIDELINES_VERSION)

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

    def test_newly_activated_member_is_discoverable_without_any_chat_history(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Contact Owner", "owner@example.com", "+13035550101", app.hash_password("OwnerPassword123!")),
            )
            owner_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", ("contact-owner-token", owner_id))

        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "activation.txt", "sent through test provider")):
                status, _signup = self.post_json(server, "/api/mobile/signup", {
                    "name": "New Contact",
                    "email": "new-contact@example.com",
                    "phone": "937-555-0144",
                    "countryCode": "+1",
                    "password": "NewContactPassword123!",
                    "consentAccepted": True,
                })
            self.assertEqual(status, 201)

            with app.db() as con:
                member = con.execute("SELECT * FROM users WHERE email = ?", ("new-contact@example.com",)).fetchone()
                verification = con.execute(
                    "SELECT token FROM email_verifications WHERE user_id = ? AND purpose = 'ACCOUNT' ORDER BY datetime(created_at) DESC LIMIT 1",
                    (int(member["id"]),),
                ).fetchone()
                participant_count = con.execute(
                    "SELECT COUNT(*) AS count FROM chat_participants WHERE user_id = ?",
                    (int(member["id"]),),
                ).fetchone()["count"]
            self.assertEqual(int(member["chat_phone_discoverable"]), 1)
            self.assertEqual(int(participant_count), 0)

            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/activate?token={verification['token']}", timeout=5
            ) as response:
                self.assertEqual(response.status, 200)

            phone_hash = hashlib.sha256(b"19375550144").hexdigest()
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/chat/people/by-contacts",
                data=json.dumps({"phoneHashes": [phone_hash]}).encode("utf-8"),
                method="POST",
                headers={"Authorization": "Bearer contact-owner-token", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 200)
            self.assertEqual([person["name"] for person in payload["people"]], ["New Contact"])

            with app.db() as con:
                participant_count = con.execute(
                    "SELECT COUNT(*) AS count FROM chat_participants WHERE user_id = ?",
                    (int(member["id"]),),
                ).fetchone()["count"]
            self.assertEqual(int(participant_count), 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_web_signup_also_enables_contact_discovery(self):
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "send_activation_email", return_value=(Path(self.temp_dir.name) / "web-activation.txt", "sent through test provider")):
                status, _body = self.post_form(server, "/signup", {
                    "name": "Web Contact",
                    "email": "web-contact@example.com",
                    "phone": "+1 937 555 0166",
                    "password": "WebContactPassword123!",
                    "consent_accepted": "1",
                })
            self.assertEqual(status, 200)
            with app.db() as con:
                member = con.execute("SELECT * FROM users WHERE email = ?", ("web-contact@example.com",)).fetchone()
            self.assertIsNotNone(member)
            self.assertEqual(int(member["chat_phone_discoverable"]), 1)
            self.assertEqual(int(member["is_verified"]), 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_signup_rejects_missing_policy_consent(self):
        server, thread = self.start_server()
        try:
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                self.post_json(server, "/api/mobile/signup", {
                    "name": "No Consent Member",
                    "email": "no-consent@example.com",
                    "phone": "937-555-0111",
                    "countryCode": "+1",
                    "password": "CorrectHorse123!",
                })
            self.assertEqual(rejected.exception.code, 400)
            payload = json.loads(rejected.exception.read().decode("utf-8"))
            self.assertIn("must agree", payload["error"])
            with app.db() as con:
                self.assertIsNone(con.execute("SELECT id FROM users WHERE email = ?", ("no-consent@example.com",)).fetchone())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_fresh_database_authenticated_ride_activity_is_available(self):
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_verified)
                VALUES (?, ?, ?, 1)
                """,
                ("Fresh Rider", "fresh-rider@example.com", app.hash_password("FreshRiderPassword123!")),
            )
        server, thread = self.start_server()
        try:
            login_status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "fresh-rider@example.com",
                "password": "FreshRiderPassword123!",
            })
            self.assertEqual(login_status, 200)
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/rides/activity",
                headers={"Authorization": f"Bearer {login['token']}"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 200)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["rides"], [])
            housing_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/housing/activity",
                headers={"Authorization": f"Bearer {login['token']}"},
            )
            with urllib.request.urlopen(housing_request, timeout=5) as housing_response:
                housing_payload = json.loads(housing_response.read().decode("utf-8"))
            self.assertEqual(housing_response.status, 200)
            self.assertTrue(housing_payload["ok"])
            self.assertEqual(housing_payload["posts"], [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_profile_can_save_and_clear_optional_birthday(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Birthday Member", "birthday@example.com", "+13035550100", app.hash_password("BirthdayPassword123!")),
            )
        server, thread = self.start_server()
        try:
            _status, login = self.post_json(server, "/api/mobile/login", {"identifier": "birthday@example.com", "password": "BirthdayPassword123!"})
            def update_birthday(value):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/profile",
                    data=json.dumps({"dateOfBirth": value}).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {login['token']}"},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return json.loads(response.read().decode("utf-8"))
            saved = update_birthday("1995-08-10")
            self.assertEqual(saved["user"]["dateOfBirth"], "1995-08-10")
            cleared = update_birthday("")
            self.assertEqual(cleared["user"]["dateOfBirth"], "")
            with app.db() as con:
                self.assertIsNone(con.execute("SELECT date_of_birth FROM users WHERE email = 'birthday@example.com'").fetchone()["date_of_birth"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_profile_save_preserves_durable_avatar_when_client_returns_delivery_url(self):
        stored_photo = f"r2://{app.R2_BUCKET_NAME}/fairfares/profiles/persistent-avatar.png"
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified, profile_photo_url) VALUES (?, ?, ?, ?, 1, ?)",
                ("Avatar Member", "avatar@example.com", "+13035550111", app.hash_password("AvatarPassword123!"), stored_photo),
            )
        server, thread = self.start_server()
        try:
            _status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "avatar@example.com",
                "password": "AvatarPassword123!",
            })
            delivery_url = login["user"]["profilePhotoUrl"]
            self.assertTrue(delivery_url.startswith("/api/chat/notification-avatar?"))
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/profile",
                data=json.dumps({
                    "name": "Avatar Member Updated",
                    "email": "avatar@example.com",
                    "phone": "+13035550111",
                    "profilePhoto": delivery_url,
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {login['token']}"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                saved = json.loads(response.read().decode("utf-8"))
            self.assertEqual(saved["user"]["name"], "Avatar Member Updated")
            self.assertEqual(saved["user"]["email"], "avatar@example.com")
            self.assertEqual(saved["user"]["profilePhotoUrl"], delivery_url)
            with app.db() as con:
                persisted = con.execute(
                    "SELECT name, email, profile_photo_url FROM users WHERE email = ?",
                    ("avatar@example.com",),
                ).fetchone()
            self.assertEqual(persisted["name"], "Avatar Member Updated")
            self.assertEqual(persisted["email"], "avatar@example.com")
            self.assertEqual(persisted["profile_photo_url"], stored_photo)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_uploaded_profile_photo_and_email_survive_fresh_login(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Persistent Member", "persistent@example.com", "+13035550112", app.hash_password("PersistentPassword123!")),
            )
        # A valid 1x1 PNG keeps this test on the same upload path as the app
        # without introducing a fixture file.
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        data_url = f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
        server, thread = self.start_server()
        try:
            _status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "persistent@example.com",
                "password": "PersistentPassword123!",
            })
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/profile",
                data=json.dumps({
                    "name": "Persistent Member",
                    "email": "persistent@example.com",
                    "phone": "+13035550112",
                    "profilePhoto": data_url,
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {login['token']}"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                saved = json.loads(response.read().decode("utf-8"))
            self.assertEqual(saved["user"]["email"], "persistent@example.com")
            self.assertTrue(saved["user"]["profilePhotoUrl"])
            with app.db() as con:
                persisted = con.execute(
                    "SELECT email, profile_photo_url FROM users WHERE email = ?",
                    ("persistent@example.com",),
                ).fetchone()
            self.assertEqual(persisted["email"], "persistent@example.com")
            self.assertTrue(persisted["profile_photo_url"].startswith(("local://uploads/", f"r2://{app.R2_BUCKET_NAME}/")))

            _repeat_status, repeat_login = self.post_json(server, "/api/mobile/login", {
                "identifier": "persistent@example.com",
                "password": "PersistentPassword123!",
            })
            self.assertEqual(repeat_login["user"]["email"], "persistent@example.com")
            self.assertTrue(repeat_login["user"]["profilePhotoUrl"])
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
                    "consentAccepted": True,
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
                    "consentAccepted": True,
                })
            self.assertEqual(duplicate_phone.exception.code, 409)
            duplicate_payload = json.loads(duplicate_phone.exception.read().decode("utf-8"))
            self.assertIn("phone number already exists", duplicate_payload["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_social_login_collects_phone_without_sms_before_issuing_session(self):
        server, thread = self.start_server()
        try:
            claims = {
                "sub": "google-member-123",
                "email": "social@example.com",
                "email_verified": True,
                "name": "Social Member",
            }
            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                status, social = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                    "consentAccepted": True,
                })
            self.assertEqual(status, 200)
            self.assertTrue(social["phoneRequired"])
            self.assertFalse(social.get("token"))
            continuation = social["continuationToken"]

            complete_status, completed = self.post_json(server, "/api/mobile/auth/phone/complete", {
                "continuationToken": continuation,
                "countryCode": "+1",
                "phone": "937-555-0198",
            })
            self.assertEqual(complete_status, 200)
            self.assertTrue(completed["token"])
            self.assertEqual(completed["user"]["phone"], "+19375550198")
            self.assertFalse(completed["user"]["phoneVerified"])
            self.assertTrue(completed["user"]["chatPhoneDiscoverable"])

            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                repeat_status, repeat = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                })
            self.assertEqual(repeat_status, 200)
            self.assertTrue(repeat["token"])
            self.assertFalse(repeat.get("phoneRequired", False))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_social_account_can_recover_password_and_keep_social_identity(self):
        server, thread = self.start_server()
        try:
            claims = {
                "sub": "google-recovery-member",
                "email": "social-recovery@example.com",
                "email_verified": True,
                "name": "Social Recovery Member",
            }
            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                status, social = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                    "consentAccepted": True,
                })
            self.assertEqual(status, 200)
            self.assertTrue(social["phoneRequired"])

            with app.db() as con:
                user = con.execute(
                    "SELECT * FROM users WHERE email = ?",
                    ("social-recovery@example.com",),
                ).fetchone()
                identity = con.execute(
                    "SELECT * FROM auth_identities WHERE user_id = ?",
                    (int(user["id"]),),
                ).fetchone()
            self.assertIsNotNone(user)
            self.assertEqual(identity["provider"], "google")
            self.assertEqual(identity["provider_subject"], "google-recovery-member")
            self.assertIn(int(user["id"]), [int(row["id"]) for row in app.get_admin_users()])

            reset_links = []
            with mock.patch.object(
                app,
                "send_password_reset_email",
                side_effect=lambda _email, _name, link: (reset_links.append(link) or (Path(self.temp_dir.name) / "reset.txt", "sent through test provider")),
            ):
                forgot_status, forgot_page = self.post_form(server, "/forgot-password", {
                    "email": " social-recovery@example.com ",
                })
            self.assertEqual(forgot_status, 200)
            self.assertTrue(reset_links)
            self.assertIn("social-recovery@example.com", forgot_page)
            token = urllib.parse.parse_qs(urllib.parse.urlparse(reset_links[0]).query)["token"][0]

            reset_status, reset_page = self.post_form(server, "/reset-password", {
                "token": token,
                "password": "RecoveredSocialPassword123!",
            })
            self.assertEqual(reset_status, 200)
            self.assertIn("Password reset successful", reset_page)

            login_status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "social-recovery@example.com",
                "password": "RecoveredSocialPassword123!",
            })
            self.assertEqual(login_status, 200)
            self.assertTrue(login["token"])

            with app.db() as con:
                verification = con.execute(
                    "SELECT used_at FROM email_verifications WHERE token = ? AND purpose = 'PASSWORD_RESET'",
                    (token,),
                ).fetchone()
                preserved_identity = con.execute(
                    "SELECT provider_subject FROM auth_identities WHERE user_id = ? AND provider = 'google'",
                    (int(user["id"]),),
                ).fetchone()
            self.assertTrue(verification["used_at"])
            self.assertEqual(preserved_identity["provider_subject"], "google-recovery-member")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_social_phone_cannot_be_reused_by_another_account(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified, phone_verified_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)",
                ("Existing Member", "phone-owner@example.com", "+19375550197", app.hash_password("ExistingPassword123!")),
            )
        server, thread = self.start_server()
        try:
            with mock.patch.object(app, "verify_google_identity_token", return_value={
                "sub": "second-google-member",
                "email": "second-social@example.com",
                "email_verified": True,
            }):
                _status, social = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "another-google-token",
                    "consentAccepted": True,
                })
            with self.assertRaises(urllib.error.HTTPError) as duplicate_phone:
                self.post_json(server, "/api/mobile/auth/phone/complete", {
                    "continuationToken": social["continuationToken"],
                    "countryCode": "+1",
                    "phone": "937-555-0197",
                })
            self.assertEqual(duplicate_phone.exception.code, 409)
            payload = json.loads(duplicate_phone.exception.read().decode("utf-8"))
            self.assertIn("another FairFares account", payload["error"])
            self.assertTrue(payload["emailRecoveryAvailable"])
            self.assertEqual(payload["recoveryEmailHint"], "ph***er@example.com")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
