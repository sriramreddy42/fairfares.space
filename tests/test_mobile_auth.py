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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


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
        self.assertEqual(testimonial["userId"], user_id)
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

    def test_testimonial_uses_profile_city_without_exposing_street_address(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, address) VALUES (?, ?, ?, 1, ?)",
                ("Dayton Reviewer", "dayton-reviewer@example.com", "unused", "125 Main Street, Dayton, OH 45402"),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute(
                "INSERT INTO testimonials (user_id, city, rating, message, status, published_at) VALUES (?, 'Denver, CO', 5, ?, 'PUBLISHED', CURRENT_TIMESTAMP)",
                (user_id, "Very good app and useful for finding housing."),
            )

        testimonial = next(item for item in app.get_mobile_housing_testimonials("Denver, CO") if item["userId"] == user_id)
        self.assertEqual(testimonial["city"], "Dayton, OH")
        self.assertNotIn("125 Main", testimonial["city"])

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
            self.assertEqual(int(user["chat_phone_discoverable"]), 1)
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

    def test_owner_can_edit_housing_listing_without_creating_duplicate(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Housing Owner", "housing-owner@example.com", "+13035550123", app.hash_password("HousingOwnerPassword123!")),
            )
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Housing Viewer", "housing-viewer@example.com", "+13035550124", app.hash_password("HousingViewerPassword123!")),
            )
        server, thread = self.start_server()
        try:
            with app.db() as con:
                listing_count_before = int(con.execute("SELECT COUNT(*) AS total FROM accommodation_posts").fetchone()["total"] or 0)
            _status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "housing-owner@example.com",
                "password": "HousingOwnerPassword123!",
            })
            base_payload = {
                "postMode": "NEED_PLACE", "category": "single_room", "title": "Need a room",
                "description": "Looking near campus", "city": "Denver, CO", "zipCode": "80203",
                "area": "Capitol Hill", "moveInDate": "2026-09-15", "rentMin": "700",
                "rentPeriod": "MONTH", "accommodates": "1", "contactName": "Housing Owner",
                "contactEmail": "housing-owner@example.com", "contactPhone": "+13035550123",
            }

            def save(payload):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                    data=json.dumps(payload).encode("utf-8"), method="POST",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {login['token']}"},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return response.status, json.loads(response.read().decode("utf-8"))

            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(
                app, "accommodation_location_point", return_value={"lat": 39.7392, "lng": -104.9903, "label": "Denver, CO 80203, USA"}
            ):
                created_status, created = save(base_payload)
                listing_id = created["post"]["id"]
                updated_status, updated = save({**base_payload, "listingId": listing_id, "title": "Updated room search"})

            self.assertEqual(created_status, 201)
            self.assertEqual(updated_status, 200)
            self.assertEqual(updated["post"]["id"], listing_id)
            self.assertEqual(updated["post"]["title"], "Updated room search")

            def fetch_listing(token=""):
                headers = {"Authorization": f"Bearer {token}"} if token else {}
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing?postId={urllib.parse.quote(listing_id)}",
                    headers=headers,
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return json.loads(response.read().decode("utf-8"))["posts"][0]

            guest_listing = fetch_listing()
            self.assertEqual(guest_listing["contactEmail"], "")
            self.assertEqual(guest_listing["contactPhone"], "")
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/api/mobile/bootstrap?city=Denver%2C%20CO",
                timeout=5,
            ) as response:
                guest_bootstrap = json.loads(response.read().decode("utf-8"))
            guest_bootstrap_listing = next(post for post in guest_bootstrap["housing"] if post["id"] == listing_id)
            self.assertEqual(guest_bootstrap_listing["contactEmail"], "")
            self.assertEqual(guest_bootstrap_listing["contactPhone"], "")
            owner_listing = fetch_listing(login["token"])
            self.assertEqual(owner_listing["contactEmail"], "housing-owner@example.com")
            self.assertEqual(owner_listing["contactPhone"], "+13035550123")
            _viewer_status, viewer_login = self.post_json(server, "/api/mobile/login", {
                "identifier": "housing-viewer@example.com",
                "password": "HousingViewerPassword123!",
            })
            viewer_listing = fetch_listing(viewer_login["token"])
            self.assertEqual(viewer_listing["contactEmail"], "")
            self.assertEqual(viewer_listing["contactPhone"], "")
            with app.db() as con:
                self.assertEqual(con.execute("SELECT COUNT(*) AS total FROM accommodation_posts").fetchone()["total"], listing_count_before + 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_housing_post_lifecycle_across_cities_and_images(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Housing Matrix Owner", "housing-matrix@example.com", "+13035550131", app.hash_password("HousingMatrixPassword123!")),
            )
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Housing Matrix Other", "housing-matrix-other@example.com", "+13035550132", app.hash_password("HousingMatrixOtherPassword123!")),
            )
        server, thread = self.start_server()
        try:
            _status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "housing-matrix@example.com",
                "password": "HousingMatrixPassword123!",
            })
            _other_status, other_login = self.post_json(server, "/api/mobile/login", {
                "identifier": "housing-matrix-other@example.com",
                "password": "HousingMatrixOtherPassword123!",
            })

            def save(payload, token=login["token"]):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                    data=json.dumps(payload).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=5) as response:
                        return response.status, json.loads(response.read().decode("utf-8"))
                except urllib.error.HTTPError as error:
                    return error.code, json.loads(error.read().decode("utf-8"))

            def search(city, token=""):
                headers = {"Authorization": f"Bearer {token}"} if token else {}
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing?city={urllib.parse.quote(city)}&limit=50",
                    headers=headers,
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return json.loads(response.read().decode("utf-8"))["posts"]

            base = {
                "postMode": "NEED_PLACE", "category": "single_room",
                "description": "Disposable cross-city API housing lifecycle test.",
                "moveInDate": "2099-09-15", "rentMin": "700", "rentPeriod": "MONTH",
                "accommodates": "1", "contactName": "Housing Matrix Owner",
                "contactEmail": "housing-matrix@example.com", "contactPhone": "+13035550131",
            }
            cities = (
                ("Denver, CO", "80203", "Capitol Hill", 39.7392, -104.9903),
                ("Denver, NE", "68333", "Central", 40.6572, -96.7056),
                ("Cincinnati, OH", "45202", "Downtown", 39.1031, -84.5120),
            )
            points = {
                city: {"lat": lat, "lng": lng, "label": f"{area}, {city} {zip_code}, USA"}
                for city, zip_code, area, lat, lng in cities
            }

            def location_point(value, *_args, **_kwargs):
                text = str(value or "")
                return next((point for city, point in points.items() if city in text), {})

            created_ids = {}
            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(
                app, "accommodation_location_point", side_effect=location_point
            ):
                for city, zip_code, area, _lat, _lng in cities:
                    status, response = save({
                        **base, "title": f"Need housing in {city}", "city": city,
                        "zipCode": zip_code, "area": area,
                    })
                    self.assertEqual(status, 201, response)
                    created_ids[city] = response["post"]["id"]

            for city, _zip_code, _area, _lat, _lng in cities:
                ids = {post["id"] for post in search(city)}
                self.assertIn(created_ids[city], ids)
                self.assertTrue(ids.isdisjoint({value for key, value in created_ids.items() if key != city}))

            tiny_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            dayton_payload = {
                **base,
                "postMode": "HAVE_PLACE", "title": "Dayton room with photo",
                "city": "Dayton, OH", "zipCode": "45402", "area": "Downtown",
                "streetAddress": "1 Main St", "images": [tiny_png],
            }
            dayton_point = {"lat": 39.7589, "lng": -84.1916, "label": "1 Main St, Dayton, OH 45402, USA"}
            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(
                app, "precise_accommodation_location_point", return_value=dayton_point
            ):
                dayton_status, dayton = save(dayton_payload)
            self.assertEqual(dayton_status, 201, dayton)
            dayton_id = dayton["post"]["id"]
            self.assertEqual(len(dayton["post"]["images"]), 1)
            retained_image = dayton["post"]["images"][0]

            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(
                app, "precise_accommodation_location_point", return_value=dayton_point
            ):
                edited_status, edited = save({
                    **dayton_payload, "listingId": dayton_id,
                    "title": "Updated Dayton room", "images": [retained_image],
                })
            self.assertEqual(edited_status, 200, edited)
            self.assertEqual(edited["post"]["id"], dayton_id)
            self.assertEqual(edited["post"]["title"], "Updated Dayton room")
            self.assertEqual(edited["post"]["images"], [retained_image])
            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}{retained_image}", timeout=5
            ) as image_response:
                self.assertEqual(image_response.status, 200)
                self.assertEqual(image_response.headers.get_content_type(), "image/png")
                self.assertGreater(len(image_response.read()), 0)

            forbidden_status, _forbidden = save(
                {**dayton_payload, "listingId": dayton_id, "images": [retained_image]},
                other_login["token"],
            )
            self.assertEqual(forbidden_status, 403)
            missing_image_status, _missing_image = save({**dayton_payload, "images": []})
            self.assertEqual(missing_image_status, 400)
            past_date_status, _past_date = save({
                **base, "title": "Past date", "city": "Denver, CO", "zipCode": "80203",
                "area": "Capitol Hill", "moveInDate": "2020-01-01",
            })
            self.assertEqual(past_date_status, 400)
            reversed_rent_status, _reversed_rent = save({
                **base, "title": "Invalid rent", "city": "Denver, CO", "zipCode": "80203",
                "area": "Capitol Hill", "rentMin": "900", "rentMax": "700",
            })
            self.assertEqual(reversed_rent_status, 400)
            with mock.patch.object(app, "refresh_accommodation_location_cache") as refresh_location, mock.patch.object(
                app, "accommodation_location_point"
            ) as locate_invalid_state:
                invalid_state_status, _invalid_state = save({
                    **base, "title": "Invalid state", "city": "Denver, CE", "zipCode": "80203",
                    "area": "Central",
                })
            self.assertEqual(invalid_state_status, 400)
            refresh_location.assert_not_called()
            locate_invalid_state.assert_not_called()

            activity_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/housing/activity",
                headers={"Authorization": f"Bearer {login['token']}"},
            )
            with urllib.request.urlopen(activity_request, timeout=5) as response:
                activity_ids = {post["id"] for post in json.loads(response.read().decode("utf-8"))["posts"]}
            self.assertTrue(set(created_ids.values()) | {dayton_id} <= activity_ids)

            with urllib.request.urlopen(
                f"http://127.0.0.1:{server.server_port}/api/mobile/community?city=Dayton%2C%20OH&category=HOUSING",
                timeout=5,
            ) as community_response:
                community_posts = json.loads(community_response.read().decode("utf-8"))["posts"]
            projected = next(post for post in community_posts if post.get("sourceId") == dayton_id)
            self.assertEqual(projected["sourceKind"], "HOUSING")
            self.assertEqual(projected["title"], "Updated Dayton room")
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
            member_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Profile Observer", "profile-observer@example.com", "+13035550113", app.hash_password("ObserverPassword123!")),
            )
            observer_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute("INSERT INTO chat_conversations (public_id, conversation_type, subject) VALUES ('PROFILE-SYNC', 'DIRECT', 'Profile sync')")
            conversation_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.executemany(
                "INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)",
                ((conversation_id, member_id), (conversation_id, observer_id)),
            )
            # Empty direct conversations are intentionally omitted from
            # Chitthi. Add a real message so this profile-sync assertion
            # exercises a conversation that a user can actually see.
            con.execute(
                "INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES (?, ?, ?)",
                (conversation_id, member_id, "Profile sync test"),
            )
            con.execute(
                "INSERT INTO testimonials (user_id, city, rating, message, status, published_at) VALUES (?, 'Denver, CO', 5, ?, 'PUBLISHED', CURRENT_TIMESTAMP)",
                (member_id, "Profile changes should appear consistently on this testimonial."),
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
                    "name": "Persistent Member Updated",
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
            self.assertEqual(saved["user"]["name"], "Persistent Member Updated")
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
            self.assertEqual(repeat_login["user"]["name"], "Persistent Member Updated")
            self.assertTrue(repeat_login["user"]["profilePhotoUrl"])
            testimonial = app.get_mobile_housing_testimonials("Denver, CO")[0]
            self.assertEqual(testimonial["userId"], member_id)
            self.assertEqual(testimonial["name"], "Persistent Member Updated")
            self.assertEqual(testimonial["photoUrl"], repeat_login["user"]["profilePhotoUrl"])
            observer_chat = app.get_chat_conversations_for_user(observer_id)[0]
            self.assertEqual(observer_chat["otherName"], "Persistent Member Updated")
            self.assertEqual(observer_chat["otherPhotoUrl"], persisted["profile_photo_url"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_consecutive_photo_replacements_invalidate_cache_and_personal_details_persist(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Replace Member", "replace@example.com", "+13035550120", app.hash_password("ReplacePassword123!")),
            )
        first_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        second_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=")
        server, thread = self.start_server()
        try:
            _status, login = self.post_json(server, "/api/mobile/login", {
                "identifier": "replace@example.com",
                "password": "ReplacePassword123!",
            })

            def update_profile(payload):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/profile",
                    data=json.dumps(payload).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {login['token']}"},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return json.loads(response.read().decode("utf-8"))

            first = update_profile({"profilePhoto": f"data:image/png;base64,{base64.b64encode(first_png).decode('ascii')}"})
            first_url = first["user"]["profilePhotoUrl"]
            with app.db() as con:
                first_reference = str(con.execute("SELECT profile_photo_url FROM users WHERE email = 'replace@example.com'").fetchone()[0])

            second = update_profile({"profilePhoto": f"data:image/png;base64,{base64.b64encode(second_png).decode('ascii')}"})
            second_url = second["user"]["profilePhotoUrl"]
            self.assertNotEqual(first_url, second_url)
            with app.db() as con:
                persisted = con.execute("SELECT * FROM users WHERE email = 'replace@example.com'").fetchone()
            self.assertNotEqual(first_reference, persisted["profile_photo_url"])
            if first_reference.startswith("local://uploads/"):
                first_path = Path(self.temp_dir.name) / "uploads" / first_reference.removeprefix("local://uploads/")
                self.assertFalse(first_path.exists())

            with self.assertRaises(urllib.error.HTTPError) as password_required:
                update_profile({"name": "Replace Member Updated", "phone": "+13035550121"})
            self.assertEqual(password_required.exception.code, 403)
            details = update_profile({
                "name": "Replace Member Updated",
                "phone": "+13035550121",
                "dateOfBirth": "1992-04-15",
                "currentPassword": "ReplacePassword123!",
            })
            self.assertEqual(details["user"]["name"], "Replace Member Updated")
            self.assertEqual(details["user"]["phone"], "+13035550121")
            self.assertEqual(details["user"]["dateOfBirth"], "1992-04-15")
            self.assertEqual(details["user"]["profilePhotoUrl"], second_url)

            _fresh_status, fresh = self.post_json(server, "/api/mobile/login", {
                "identifier": "replace@example.com",
                "password": "ReplacePassword123!",
            })
            self.assertEqual(fresh["user"]["name"], "Replace Member Updated")
            self.assertEqual(fresh["user"]["phone"], "+13035550121")
            self.assertEqual(fresh["user"]["dateOfBirth"], "1992-04-15")
            self.assertEqual(fresh["user"]["profilePhotoUrl"], second_url)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_social_member_can_complete_initial_phone_without_unknown_generated_password(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Pending Social", "pending-social@example.com", app.hash_password("server-generated-secret")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO auth_identities (user_id, provider, provider_subject, provider_email) VALUES (?, 'google', ?, ?)",
                (user_id, "pending-social-subject", "pending-social@example.com"),
            )
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", ("pending-social-token", user_id))

        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/profile",
                data=json.dumps({"phone": "+91 98765 43210"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer pending-social-token"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(payload["user"]["phone"], "+919876543210")
            self.assertFalse(payload["user"]["phonePending"])
            with app.db() as con:
                saved = con.execute("SELECT phone, chat_phone_discoverable FROM users WHERE id = ?", (user_id,)).fetchone()
            self.assertEqual(saved["phone"], "+919876543210")
            self.assertEqual(int(saved["chat_phone_discoverable"]), 1)
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

    def test_pending_policy_status_is_private_and_grace_deadline_fails_closed(self):
        pending = app.mobile_user_payload({
            "id": 91,
            "name": "Pending Member",
            "email": "pending@example.com",
            "phone": "",
            "role": "CUSTOMER",
            "is_admin": 0,
            "is_verified": 1,
        })
        self.assertTrue(pending["phonePending"])
        self.assertTrue(pending["consentPending"])
        with mock.patch.object(app, "LEGACY_SOCIAL_CONSENT_GRACE_ENABLED", True), mock.patch.object(
            app, "LEGACY_SOCIAL_CONSENT_GRACE_UNTIL", "invalid"
        ):
            self.assertFalse(app.legacy_social_consent_grace_active())

    def test_duplicate_phone_lookup_normalizes_legacy_formatting(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Legacy Phone", "legacy-phone@example.com", "+1 (303) 555-0123", "x"),
            )
            owner_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Other Member", "other-phone@example.com", "x"),
            )
            other_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            duplicate = app.find_other_user_by_phone(con, "+13035550123", other_id)
            self.assertEqual(int(duplicate["id"]), owner_id)
            self.assertIsNone(app.find_other_user_by_phone(con, "+13035550123", owner_id))

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
                    "consentUiPresented": True,
                })
            self.assertEqual(status, 200)
            self.assertTrue(social["phoneRequired"])
            self.assertTrue(social["accountCreated"])
            self.assertFalse(social.get("token"))
            continuation = social["continuationToken"]

            with self.assertRaises(urllib.error.HTTPError) as missing_consent:
                self.post_json(server, "/api/mobile/auth/phone/complete", {
                    "continuationToken": continuation,
                    "countryCode": "+1",
                    "phone": "937-555-0198",
                    "consentUiPresented": True,
                })
            self.assertEqual(missing_consent.exception.code, 400)

            complete_status, completed = self.post_json(server, "/api/mobile/auth/phone/complete", {
                "continuationToken": continuation,
                "countryCode": "+1",
                "phone": "937-555-0198",
                "consentAccepted": True,
            })
            self.assertEqual(complete_status, 200)
            self.assertTrue(completed["token"])
            self.assertEqual(completed["user"]["phone"], "+19375550198")
            self.assertFalse(completed["user"]["phoneVerified"])
            self.assertNotIn("chatPhoneDiscoverable", completed["user"])
            with app.db() as con:
                consented_user = con.execute("SELECT * FROM users WHERE email = ?", ("social@example.com",)).fetchone()
            self.assertTrue(consented_user["consented_at"])
            self.assertEqual(consented_user["terms_version"], app.TERMS_VERSION)
            self.assertEqual(consented_user["privacy_version"], app.PRIVACY_VERSION)
            self.assertEqual(consented_user["community_guidelines_version"], app.COMMUNITY_GUIDELINES_VERSION)

            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                repeat_status, repeat = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                })
            self.assertEqual(repeat_status, 200)
            self.assertTrue(repeat["token"])
            self.assertFalse(repeat.get("phoneRequired", False))
            self.assertFalse(repeat["accountCreated"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_legacy_social_login_can_continue_with_consent_pending(self):
        server, thread = self.start_server()
        try:
            claims = {
                "sub": "google-legacy-member",
                "email": "legacy-social@example.com",
                "email_verified": True,
                "name": "Legacy Social Member",
            }
            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                status, social = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                })
            self.assertEqual(status, 200)
            self.assertTrue(social["token"])
            self.assertTrue(social["consentPending"])
            self.assertTrue(social["phonePending"])
            self.assertFalse(social.get("phoneRequired", False))

            with app.db() as con:
                pending_user = con.execute(
                    "SELECT * FROM users WHERE email = ?", ("legacy-social@example.com",)
                ).fetchone()
            self.assertIsNone(pending_user["phone"])
            self.assertIsNone(pending_user["consented_at"])
            self.assertIsNone(pending_user["terms_version"])
            self.assertIsNone(pending_user["privacy_version"])
            self.assertIsNone(pending_user["community_guidelines_version"])

            # A fixed client identifies its consent UI and must complete it.
            with mock.patch.object(app, "verify_google_identity_token", return_value=claims):
                repeat_status, repeat = self.post_json(server, "/api/mobile/auth/oauth", {
                    "provider": "google",
                    "identityToken": "verified-google-token",
                    "consentUiPresented": True,
                })
            self.assertEqual(repeat_status, 200)
            self.assertTrue(repeat["phoneRequired"])
            self.assertFalse(repeat.get("token"))
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
                    "consentUiPresented": True,
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
                    "consentUiPresented": True,
                })
            with self.assertRaises(urllib.error.HTTPError) as duplicate_phone:
                self.post_json(server, "/api/mobile/auth/phone/complete", {
                    "continuationToken": social["continuationToken"],
                    "countryCode": "+1",
                    "phone": "937-555-0197",
                    "consentAccepted": True,
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

    def test_public_listing_creation_requires_verified_user(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 0)",
                ("Unverified Poster", "unverified-poster@example.com", "+13035550200", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('unverified-poster-token', ?)", (user_id,))
        server, thread = self.start_server()
        try:
            payload = {
                "postMode": "NEED_PLACE", "category": "single_room", "title": "Need a clean room",
                "description": "Looking near campus with flexible move-in.", "city": "Denver, CO", "zipCode": "80203",
                "area": "Capitol Hill", "moveInDate": "2099-09-15", "rentMin": "700",
                "rentPeriod": "MONTH", "accommodates": "1", "contactName": "Unverified Poster",
                "contactEmail": "unverified-poster@example.com", "contactPhone": "+13035550200",
            }
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                data=json.dumps(payload).encode("utf-8"), method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer unverified-poster-token"},
            )
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(blocked.exception.code, 403)
            body = json.loads(blocked.exception.read().decode("utf-8"))
            self.assertIn("Verify", body["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_abusive_account_identity_is_blocked_at_signup(self):
        server, thread = self.start_server()
        try:
            for name, email in (
                ("Abusive Email", "Gayyyyy0123456789denge@fuckyou.com"),
                ("Sriram Reddy Gay0123456789bhaagbdsk", "clean-user@example.com"),
            ):
                with self.assertRaises(urllib.error.HTTPError) as blocked:
                    self.post_json(server, "/api/mobile/signup", {
                        "name": name,
                        "email": email,
                        "phone": "+13035550204",
                        "password": "Password123!",
                        "consentAccepted": True,
                    })
                self.assertEqual(blocked.exception.code, 400)
                payload = json.loads(blocked.exception.read().decode("utf-8"))
                self.assertIn("respectful", payload["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_housing_spam_burst_and_abusive_text_are_blocked(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Verified Poster", "verified-poster@example.com", "+13035550201", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('verified-poster-token', ?)", (user_id,))
        server, thread = self.start_server()
        try:
            def save(payload):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                    data=json.dumps(payload).encode("utf-8"), method="POST",
                    headers={"Content-Type": "application/json", "Authorization": "Bearer verified-poster-token"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=5) as response:
                        return response.status, json.loads(response.read().decode("utf-8"))
                except urllib.error.HTTPError as error:
                    return error.code, json.loads(error.read().decode("utf-8"))

            base = {
                "postMode": "NEED_PLACE", "category": "single_room",
                "description": "Looking near campus with flexible move-in.",
                "city": "Denver, CO", "zipCode": "80203", "area": "Capitol Hill",
                "moveInDate": "2099-09-15", "rentMin": "700",
                "rentPeriod": "MONTH", "accommodates": "1", "contactName": "Verified Poster",
                "contactEmail": "verified-poster@example.com", "contactPhone": "+13035550201",
            }
            with mock.patch.object(app, "refresh_accommodation_location_cache"), mock.patch.object(
                app, "accommodation_location_point", return_value={"lat": 39.7392, "lng": -104.9903, "label": "Denver, CO 80203, USA"}
            ):
                abusive_status, abusive = save({**base, "title": "Nee jaathini dengaa", "description": "You gay"})
                self.assertEqual(abusive_status, 400)
                self.assertIn("respectful", abusive["error"])

                statuses = []
                for index in range(6):
                    status, _payload = save({**base, "title": f"Need a clean room {index}", "description": f"Looking near campus with flexible move-in number {index}."})
                    statuses.append(status)

            self.assertEqual(statuses[:5], [201, 201, 201, 201, 201])
            self.assertEqual(statuses[5], 429)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_verified_abusive_identity_cannot_publish_listing(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Sriram Reddy Gay0123456789bhaagbdsk", "identity-spam@example.com", "+13035550205", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('identity-spam-token', ?)", (user_id,))
        server, thread = self.start_server()
        try:
            payload = {
                "postMode": "NEED_PLACE", "category": "single_room", "title": "Need a clean room",
                "description": "Looking near campus with flexible move-in.", "city": "Denver, CO", "zipCode": "80203",
                "area": "Capitol Hill", "moveInDate": "2099-09-15", "rentMin": "700",
                "rentPeriod": "MONTH", "accommodates": "1", "contactName": "Clean Contact",
                "contactEmail": "clean-contact@example.com", "contactPhone": "+13035550205",
            }
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/housing",
                data=json.dumps(payload).encode("utf-8"), method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer identity-spam-token"},
            )
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                urllib.request.urlopen(request, timeout=5)
            self.assertEqual(blocked.exception.code, 400)
            body = json.loads(blocked.exception.read().decode("utf-8"))
            self.assertIn("respectful", body["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_admin_can_suspend_user_and_delete_public_content(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role, is_verified) VALUES (?, ?, ?, 1, 'ADMIN', 1)",
                ("Owner Admin", "owner-admin@example.com", app.hash_password("Password123!")),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('owner-admin-token', ?)", (admin_id,))
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Attack User", "attack-user@example.com", "+13035550202", app.hash_password("Password123!")),
            )
            target_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('attack-token', ?)", (target_id,))
            con.execute(
                """INSERT INTO product_analytics_events
                   (event_name, anonymous_id, user_id, platform, dedupe_key)
                   VALUES ('app_open', 'ff-repeat-install-1', ?, 'ios', 'attack-install-event')""",
                (target_id,),
            )
            con.execute(
                """INSERT INTO mobile_push_tokens
                   (user_id, token, platform, device_id)
                   VALUES (?, 'ExponentPushToken[attack-token]', 'ios', 'device-repeat-1')""",
                (target_id,),
            )
            con.execute(
                """INSERT INTO accommodation_posts
                   (public_id, user_id, post_mode, category, title, description, city, zip_code, move_in_date,
                    rent_min, contact_name, contact_phone, contact_email, visibility_status)
                   VALUES ('FFH-ATTACK-1', ?, 'NEED_PLACE', 'single_room', 'Bad housing', 'Bad content', 'Boulder, CO', '80301', '2099-09-15',
                           700, 'Attack User', '+13035550202', 'attack-user@example.com', 'ACTIVE')""",
                (target_id,),
            )
            con.execute(
                """INSERT INTO ride_posts
                   (public_id, user_id, title, origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
                    city_label, pickup_date, pickup_time, status)
                   VALUES ('FFR-ATTACK-1', ?, 'Bad ride', 'Boulder, CO', 40.015, -105.2705, 'Denver, CO', 39.7392, -104.9903,
                           'Boulder, CO', '2099-09-15', '09:00 AM', 'ACTIVE')""",
                (target_id,),
            )
            con.execute(
                """INSERT INTO ask_community_posts
                   (public_id, author_id, post_type, title, body, category, city, status)
                   VALUES ('FFC-ATTACK-1', ?, 'REQUEST', 'Bad community', 'Bad content body', 'GENERAL', 'Boulder, CO', 'PUBLISHED')""",
                (target_id,),
            )
        server, thread = self.start_server()
        try:
            data = urllib.parse.urlencode({
                "user_id": str(target_id),
                "action": "SUSPEND_HIDE",
                "reason": "Spam and harassment",
            }).encode("utf-8")
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/admin/users/moderate",
                data=data,
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded", "Cookie": "fairfares_session=owner-admin-token"},
            )
            opener = urllib.request.build_opener(NoRedirect)
            try:
                opener.open(request, timeout=5)
            except urllib.error.HTTPError as redirect:
                self.assertEqual(redirect.code, 303)
            with app.db() as con:
                target = con.execute("SELECT suspended_at, suspended_reason FROM users WHERE id = ?", (target_id,)).fetchone()
                self.assertTrue(target["suspended_at"])
                self.assertEqual(target["suspended_reason"], "Spam and harassment")
                self.assertFalse(con.execute("SELECT 1 FROM sessions WHERE user_id = ?", (target_id,)).fetchone())
                self.assertEqual(con.execute("SELECT visibility_status FROM accommodation_posts WHERE user_id = ?", (target_id,)).fetchone()["visibility_status"], "DELETED")
                self.assertEqual(con.execute("SELECT status FROM ride_posts WHERE user_id = ?", (target_id,)).fetchone()["status"], "DELETED")
                self.assertEqual(con.execute("SELECT status FROM ask_community_posts WHERE author_id = ?", (target_id,)).fetchone()["status"], "DELETED")
                audit = con.execute("SELECT action, reason FROM user_moderation_actions WHERE target_user_id = ?", (target_id,)).fetchone()
                self.assertEqual(audit["action"], "SUSPEND_HIDE")
                self.assertEqual(audit["reason"], "Spam and harassment")
                self.assertGreaterEqual(
                    con.execute("SELECT COUNT(*) AS count FROM abuse_fingerprints WHERE source_user_id = ? AND active = 1", (target_id,)).fetchone()["count"],
                    4,
                )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_admin_blocked_installation_cannot_create_new_account(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role, is_verified) VALUES (?, ?, ?, 1, 'ADMIN', 1)",
                ("Owner Admin", "owner-block@example.com", app.hash_password("Password123!")),
            )
            admin_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('owner-block-token', ?)", (admin_id,))
            con.execute(
                "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
                ("Repeat Attacker", "repeat-attacker@example.com", "+13035550777", app.hash_password("Password123!")),
            )
            target_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute(
                """INSERT INTO product_analytics_events
                   (event_name, anonymous_id, user_id, platform, dedupe_key)
                   VALUES ('app_open', 'ff-blocked-install-2', ?, 'ios', 'blocked-install-event')""",
                (target_id,),
            )
        server, thread = self.start_server()
        try:
            data = urllib.parse.urlencode({
                "user_id": str(target_id),
                "action": "SUSPEND_HIDE",
                "reason": "Repeat abusive signups",
            }).encode("utf-8")
            moderate_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/admin/users/moderate",
                data=data,
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded", "Cookie": "fairfares_session=owner-block-token"},
            )
            opener = urllib.request.build_opener(NoRedirect)
            try:
                opener.open(moderate_request, timeout=5)
            except urllib.error.HTTPError as redirect:
                self.assertEqual(redirect.code, 303)

            signup_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/signup",
                data=json.dumps({
                    "name": "Clean New User",
                    "email": "clean-new-user@example.com",
                    "phone": "3035550888",
                    "countryCode": "+1",
                    "password": "Password123!",
                    "consentAccepted": True,
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "X-FairFares-Install-ID": "ff-blocked-install-2"},
            )
            with self.assertRaises(urllib.error.HTTPError) as blocked:
                urllib.request.urlopen(signup_request, timeout=5)
            self.assertEqual(blocked.exception.code, 403)
            body = json.loads(blocked.exception.read().decode("utf-8"))
            self.assertIn("cannot use FairFares", body["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_admin_user_search_finds_users_beyond_default_page(self):
        with app.db() as con:
            for index in range(130):
                con.execute(
                    "INSERT INTO users (name, email, password_hash, is_verified, created_at) VALUES (?, ?, 'x', 1, datetime('now', ?))",
                    (f"Regular User {index:03d}", f"regular-{index:03d}@example.com", f"-{index + 2} minutes"),
                )
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified, created_at) VALUES (?, ?, 'x', 1, datetime('now', '-300 minutes'))",
                ("Attack User", "wawoxef642@meonvr.com",),
            )
            target_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute(
                """INSERT INTO accommodation_posts
                   (public_id, user_id, post_mode, category, title, description, city, zip_code, move_in_date,
                    rent_min, contact_name, contact_phone, contact_email, visibility_status)
                   VALUES ('FFH-HIDDEN-ATTACK', ?, 'NEED_PLACE', 'single_room', 'Nee jaathini dengaa', 'You gay', 'Boulder, CO', '80301', '2099-09-15',
                           700, 'Attack User', '+13035550203', 'wawoxef642@meonvr.com', 'ACTIVE')""",
                (target_id,),
            )

        default_users = app.get_admin_users()
        self.assertLessEqual(len(default_users), 500)
        self.assertFalse(any(row["email"] == "wawoxef642@meonvr.com" for row in default_users[:100]))

        email_matches = app.get_admin_users("wawoxef642@meonvr.com")
        self.assertEqual([row["email"] for row in email_matches], ["wawoxef642@meonvr.com"])

        content_matches = app.get_admin_users("FFH-HIDDEN-ATTACK")
        self.assertEqual([row["email"] for row in content_matches], ["wawoxef642@meonvr.com"])

    def test_rental_listing_requires_verified_clean_user(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 0)",
                ("Unverified Owner", "unverified-owner@example.com", app.hash_password("Password123!")),
            )
            unverified_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('unverified-rental-token', ?)", (unverified_id,))
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Clean Owner", "clean-owner@example.com", app.hash_password("Password123!")),
            )
            clean_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('clean-rental-token', ?)", (clean_id,))
            app.add_abuse_fingerprint(con, "EMAIL", "blocked-owner@example.com", reason="abuse regression")
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Blocked Owner", "blocked-owner@example.com", app.hash_password("Password123!")),
            )
            blocked_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('blocked-rental-token', ?)", (blocked_id,))

        server, thread = self.start_server()
        listing_payload = {
            "name": "Honda Civic",
            "location": "Denver, CO",
            "dailyPrice": 45,
            "licensePlate": "ABC1234",
        }
        try:
            def request_listing(token, payload):
                request = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/mobile/rentals/listing",
                    data=json.dumps(payload).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    return response.status, json.loads(response.read().decode("utf-8"))

            with self.assertRaises(urllib.error.HTTPError) as unverified_error:
                request_listing("unverified-rental-token", listing_payload)
            self.assertEqual(unverified_error.exception.code, 403)
            self.assertIn("Verify", json.loads(unverified_error.exception.read().decode("utf-8"))["error"])

            with self.assertRaises(urllib.error.HTTPError) as blocked_error:
                request_listing("blocked-rental-token", listing_payload)
            self.assertIn(blocked_error.exception.code, {401, 403})
            blocked_body = json.loads(blocked_error.exception.read().decode("utf-8"))
            self.assertTrue("Login" in blocked_body["error"] or "cannot use FairFares" in blocked_body["error"])

            abusive_payload = dict(listing_payload, notes="Nee jaathini dengaa")
            with self.assertRaises(urllib.error.HTTPError) as moderation_error:
                request_listing("clean-rental-token", abusive_payload)
            self.assertEqual(moderation_error.exception.code, 400)
            self.assertIn("cannot be published", json.loads(moderation_error.exception.read().decode("utf-8"))["error"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_mobile_push_token_registration_enables_delivery_preferences(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Push Owner", "push-owner@example.com", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('push-owner-token', ?)", (user_id,))
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/push-token",
                data=json.dumps({
                    "token": "ExpoPushToken[registration-device]",
                    "platform": "ios",
                    "deviceLabel": "iPhone test",
                    "deviceId": "device-notification-1",
                    "notificationSchema": 3,
                    "enabled": True,
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer push-owner-token"},
            )
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["enabled"])
            with app.db() as con:
                token = con.execute("SELECT * FROM mobile_push_tokens WHERE user_id = ?", (user_id,)).fetchone()
                preferences = con.execute("SELECT * FROM mobile_notification_preferences WHERE user_id = ?", (user_id,)).fetchone()
            self.assertEqual(token["token"], "ExpoPushToken[registration-device]")
            self.assertEqual(token["platform"], "ios")
            self.assertEqual(token["device_id"], "device-notification-1")
            self.assertEqual(int(token["notification_schema"]), 3)
            self.assertEqual(int(token["enabled"]), 1)
            self.assertEqual(int(preferences["chitthi_enabled"]), 1)
            self.assertEqual(int(preferences["carpool_enabled"]), 1)
            self.assertEqual(int(preferences["rentals_enabled"]), 1)
            self.assertEqual(int(preferences["housing_enabled"]), 1)

            with app.db() as con:
                con.execute(
                    """
                    UPDATE mobile_notification_preferences
                    SET carpool_enabled = 0, housing_enabled = 0
                    WHERE user_id = ?
                    """,
                    (user_id,),
                )
                con.execute(
                    "UPDATE mobile_push_tokens SET last_seen_at = datetime('now', '-30 days') WHERE token = ?",
                    ("ExpoPushToken[registration-device]",),
                )
                con.execute(
                    """INSERT INTO mobile_push_tokens
                       (user_id, token, platform, device_label, device_id, notification_schema, enabled)
                       VALUES (?, ?, 'ios', 'iPhone test', 'device-notification-1', 2, 1)""",
                    (user_id, "ExpoPushToken[registration-device-old]"),
                )
            refresh_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/push-token",
                data=json.dumps({
                    "token": "ExpoPushToken[registration-device]",
                    "platform": "ios",
                    "deviceLabel": "iPhone test",
                    "deviceId": "device-notification-1",
                    "notificationSchema": 3,
                    "enabled": True,
                }).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer push-owner-token"},
            )
            with urllib.request.urlopen(refresh_request, timeout=5) as response:
                refresh_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(refresh_payload["ok"])
            with app.db() as con:
                refreshed_preferences = con.execute("SELECT * FROM mobile_notification_preferences WHERE user_id = ?", (user_id,)).fetchone()
                current_token = con.execute(
                    "SELECT enabled, last_seen_at >= datetime('now', '-1 minute') AS recently_seen FROM mobile_push_tokens WHERE token = ?",
                    ("ExpoPushToken[registration-device]",),
                ).fetchone()
                rotated_token = con.execute(
                    "SELECT enabled FROM mobile_push_tokens WHERE token = ?",
                    ("ExpoPushToken[registration-device-old]",),
                ).fetchone()
            self.assertEqual(int(refreshed_preferences["chitthi_enabled"]), 1)
            self.assertEqual(int(refreshed_preferences["carpool_enabled"]), 0)
            self.assertEqual(int(refreshed_preferences["rentals_enabled"]), 1)
            self.assertEqual(int(refreshed_preferences["housing_enabled"]), 0)
            self.assertEqual(int(current_token["enabled"]), 1)
            self.assertEqual(int(current_token["recently_seen"]), 1)
            self.assertEqual(int(rotated_token["enabled"]), 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_signed_in_notification_self_test_covers_each_device_without_exposing_tokens(self):
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Two Device Owner", "two-devices@example.com", app.hash_password("Password123!")),
            )
            user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
            con.execute("INSERT INTO sessions (token, user_id) VALUES ('two-device-token', ?)", (user_id,))
            con.executemany(
                """INSERT INTO mobile_push_tokens
                   (user_id, token, platform, device_label, enabled)
                   VALUES (?, ?, ?, ?, 1)""",
                [
                    (user_id, "ExpoPushToken[self-test-ios]", "ios", "Sriram iPhone"),
                    (user_id, "ExpoPushToken[self-test-android]", "android", "Sriram Android"),
                    (user_id, "ExpoPushToken[self-test-android-old]", "android", "Old Android install"),
                ],
            )
            con.execute(
                "UPDATE mobile_push_tokens SET last_seen_at = datetime('now', '-1 day') WHERE token = ?",
                ("ExpoPushToken[self-test-android-old]",),
            )
        server, thread = self.start_server()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/notification-test",
                data=json.dumps({"category": "housing"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Authorization": "Bearer two-device-token"},
            )
            with mock.patch.object(app, "process_mobile_push_outbox"):
                with urllib.request.urlopen(request, timeout=5) as response:
                    self.assertEqual(response.status, 202)
                    payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["category"], "housing")
            self.assertEqual(payload["registeredDevices"], 2)
            self.assertEqual(payload["activeAccountDevices"], 3)
            self.assertEqual(payload["queuedDevices"], 2)
            self.assertEqual({device["platform"] for device in payload["devices"]}, {"ios", "android"})
            self.assertNotIn("ExpoPushToken", json.dumps(payload))
            with app.db() as con:
                queued_rows = con.execute("SELECT token, data_json FROM mobile_push_outbox WHERE user_id = ?", (user_id,)).fetchall()
                queued_payloads = [json.loads(row["data_json"]) for row in queued_rows]
            self.assertEqual({item["type"] for item in queued_payloads}, {"HOUSING_MATCH"})
            self.assertEqual({item["testCategory"] for item in queued_payloads}, {"housing"})
            self.assertEqual({row["token"] for row in queued_rows}, {"ExpoPushToken[self-test-ios]", "ExpoPushToken[self-test-android]"})

            status_request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/api/mobile/notification-test?diagnostic_id={urllib.parse.quote(payload['diagnosticId'])}",
                headers={"Authorization": "Bearer two-device-token"},
            )
            with urllib.request.urlopen(status_request, timeout=5) as response:
                status_payload = json.loads(response.read().decode("utf-8"))
            self.assertTrue(status_payload["ok"])
            self.assertEqual(len(status_payload["devices"]), 2)
            self.assertEqual({device["status"] for device in status_payload["devices"]}, {"PENDING"})
            self.assertNotIn("ExpoPushToken", json.dumps(status_payload))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
