import base64
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


class CommunityFeatureTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "community.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            self.owner_id = self.insert_user(con, "Owner", "owner@example.com", "owner-token")
            self.member_id = self.insert_user(con, "Member", "member@example.com", "member-token")
            self.outsider_id = self.insert_user(con, "Outsider", "outsider@example.com", "outsider-token")
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        if self.old_db is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    @staticmethod
    def insert_user(con, name, email, token):
        cursor = con.execute(
            "INSERT INTO users (name, email, password_hash, role, is_admin, is_verified) VALUES (?, ?, 'x', 'CUSTOMER', 0, 1)",
            (name, email),
        )
        user_id = int(cursor.lastrowid)
        con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        return user_id

    def request(self, method, path, token="", payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(f"http://127.0.0.1:{self.server.server_port}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def guest_request(self, method, path, guest_token, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}", data=data,
            headers={"Content-Type": "application/json", "X-FairFares-Guest-Token": guest_token}, method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def create_post(self, token="owner-token", **updates):
        payload = {
            "type": "QUESTION", "category": "HOUSING", "title": "Where is good housing near Dayton?",
            "body": "I am looking for a safe neighborhood with nearby transit.", "city": "Dayton, OH",
            "area": "Downtown", "linkUrl": "https://www.fairfare.space", "communityId": "", "images": [],
        }
        payload.update(updates)
        return self.request("POST", "/api/mobile/community", token, payload)

    def test_public_feed_is_readable_but_publishing_requires_login(self):
        status, created = self.create_post()
        self.assertEqual(status, 201)
        status, feed = self.request("GET", "/api/mobile/community?category=HOUSING")
        self.assertEqual(status, 200)
        self.assertEqual(feed["posts"][0]["id"], created["post"]["id"])
        self.assertFalse(feed["posts"][0]["reacted"])
        self.assertFalse(feed["posts"][0]["saved"])
        status, rejected = self.create_post(token="")
        self.assertEqual(status, 401)
        self.assertIn("Login", rejected["error"])

    def test_guest_identity_allows_six_comments_then_requires_signup(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        status, session = self.request("POST", "/api/mobile/community/guest-session", payload={"installationId": "test-installation-guest-0001"})
        self.assertEqual(status, 201)
        self.assertTrue(session["guestId"].startswith("Guest "))
        self.assertEqual(session["remaining"], 6)
        token = session["token"]
        first_conversation_id = ""
        status, guest_like = self.guest_request("POST", "/api/mobile/community/react", token, {"postId": post_id, "reaction": "LIKE"})
        self.assertEqual((status, guest_like["active"], guest_like["reaction"], guest_like["count"]), (200, True, "LIKE", 1))
        status, guest_detail = self.guest_request("GET", f"/api/mobile/community?postId={post_id}", token)
        self.assertEqual((status, guest_detail["posts"][0]["viewerReaction"]), (200, "LIKE"))
        self.assertEqual(guest_detail["posts"][0]["reactionCounts"]["LIKE"], 1)
        status, guest_unlike = self.guest_request("POST", "/api/mobile/community/react", token, {"postId": post_id, "reaction": "LIKE"})
        self.assertEqual((status, guest_unlike["active"], guest_unlike["count"]), (200, False, 0))
        first_answer_id = ""
        for index in range(6):
            status, answered = self.guest_request("POST", "/api/mobile/community/answer", token, {"postId": post_id, "body": f"Guest message number {index + 1}"})
            self.assertEqual(status, 201)
            self.assertEqual(answered["guestRemaining"], 5 - index)
            first_answer_id = first_answer_id or answered["answerId"]
            self.assertTrue(answered["conversationId"])
            first_conversation_id = first_conversation_id or answered["conversationId"]
            self.assertEqual(answered["conversationId"], first_conversation_id)
            with app.db() as con:
                guest_user = con.execute("SELECT id FROM users WHERE name = ?", (session["guestId"],)).fetchone()
                guest_message = con.execute(
                    "SELECT * FROM chat_messages WHERE client_message_id = ?",
                    (f"community-answer-{answered['answerId']}",),
                ).fetchone()
                self.assertIsNotNone(guest_message)
                self.assertEqual(int(guest_message["sender_id"]), int(guest_user["id"]))
                self.assertEqual(guest_message["context_type"], "COMMUNITY")
                self.assertEqual(guest_message["context_public_id"], post_id)

        _, second_session = self.request("POST", "/api/mobile/community/guest-session", payload={"installationId": "test-installation-guest-0002"})
        second_status, second_answer = self.guest_request("POST", "/api/mobile/community/answer", second_session["token"], {"postId": post_id, "body": "A different guest is interested."})
        self.assertEqual(second_status, 201)
        self.assertNotEqual(second_answer["conversationId"], first_conversation_id)
        cross_status, cross_answer = self.guest_request(
            "POST", "/api/mobile/community/answer", second_session["token"],
            {"postId": post_id, "body": "A different guest replied inside the first guest branch.", "parentAnswerId": first_answer_id},
        )
        self.assertEqual(cross_status, 201)
        self.assertEqual(cross_answer["conversationId"], second_answer["conversationId"])
        with app.db() as con:
            owner_conversations = con.execute(
                """SELECT DISTINCT conversations.public_id
                   FROM chat_conversations conversations
                   JOIN chat_participants participants ON participants.conversation_id = conversations.id
                   WHERE participants.user_id = ? AND conversations.public_id IN (?, ?)""",
                (self.owner_id, first_conversation_id, second_answer["conversationId"]),
            ).fetchall()
        self.assertEqual({row["public_id"] for row in owner_conversations}, {first_conversation_id, second_answer["conversationId"]})
        status, limited = self.guest_request("POST", "/api/mobile/community/answer", token, {"postId": post_id, "body": "Seventh guest message"})
        self.assertEqual(status, 403)
        self.assertTrue(limited["guestLimitReached"])
        self.assertEqual(limited["remaining"], 0)

        status, reply = self.request("POST", "/api/mobile/community/answer", "owner-token", {"postId": post_id, "body": "Thanks — replying here so you can see it.", "parentAnswerId": first_answer_id})
        self.assertEqual(status, 201)
        status, nested_reply = self.request("POST", "/api/mobile/community/answer", "owner-token", {"postId": post_id, "body": "This reply is nested under the previous reply.", "parentAnswerId": reply["answerId"]})
        self.assertEqual(status, 201)
        _, detail = self.request("GET", f"/api/mobile/community?postId={post_id}")
        answers = detail["posts"][0]["answers"]
        self.assertEqual(answers[-2]["parentAnswerId"], first_answer_id)
        self.assertEqual(answers[-2]["body"], "Thanks — replying here so you can see it.")
        self.assertEqual(answers[-1]["parentAnswerId"], reply["answerId"])
        self.assertEqual(answers[-1]["body"], "This reply is nested under the previous reply.")
        guest_names = {answer["author"]["name"] for answer in answers[:-2]}
        self.assertEqual(guest_names, {session["guestId"], second_session["guestId"]})

        status, inbox = self.guest_request("GET", "/api/mobile/community/guest-inbox", token)
        self.assertEqual(status, 200)
        self.assertEqual(inbox["guestId"], session["guestId"])
        self.assertEqual(inbox["remaining"], 0)
        self.assertEqual(len(inbox["threads"]), 1)
        self.assertEqual(inbox["threads"][0]["id"], post_id)
        inbox_answers = inbox["threads"][0]["answers"]
        inbox_bodies = {answer["body"] for answer in inbox_answers}
        self.assertIn("Thanks — replying here so you can see it.", inbox_bodies)
        self.assertIn("This reply is nested under the previous reply.", inbox_bodies)
        self.assertNotIn("A different guest is interested.", inbox_bodies)
        self.assertNotIn("A different guest replied inside the first guest branch.", inbox_bodies)
        self.assertEqual({answer["author"]["name"] for answer in inbox_answers}, {session["guestId"], "Owner"})

        second_inbox_status, second_inbox = self.guest_request("GET", "/api/mobile/community/guest-inbox", second_session["token"])
        self.assertEqual(second_inbox_status, 200)
        self.assertEqual(len(second_inbox["threads"]), 1)
        self.assertEqual([answer["body"] for answer in second_inbox["threads"][0]["answers"]], ["A different guest is interested."])

        status, resumed = self.request("POST", "/api/mobile/community/guest-session", payload={"installationId": "test-installation-guest-0001"})
        self.assertEqual(status, 200)
        self.assertEqual(resumed["guestId"], session["guestId"])
        self.assertEqual(resumed["remaining"], 0)

    def test_guest_comment_succeeds_when_post_owner_has_push_token(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        with app.db() as con:
            con.execute(
                """INSERT INTO mobile_push_tokens
                   (user_id, token, platform, device_label, enabled, notification_schema)
                   VALUES (?, ?, 'ios', 'Previously signed-in iPhone', 1, 3)""",
                (self.owner_id, "ExponentPushToken[owner-device-token]"),
            )
        _, session = self.request(
            "POST",
            "/api/mobile/community/guest-session",
            payload={"installationId": "test-owner-device-guest-comment-0001"},
        )
        with mock.patch.object(app, "send_expo_push", return_value={
            "ExponentPushToken[owner-device-token]": {"status": "ACCEPTED", "ticketId": "guest-comment-ticket", "error": ""},
        }):
            status, answered = self.guest_request(
                "POST",
                "/api/mobile/community/answer",
                session["token"],
                {"postId": post_id, "body": "Available?"},
            )
        self.assertEqual(status, 201)
        self.assertTrue(answered["answerId"])
        self.assertTrue(answered["conversationId"])
        with app.db() as con:
            self.assertIsNotNone(con.execute(
                "SELECT id FROM mobile_push_outbox WHERE user_id = ?",
                (self.owner_id,),
            ).fetchone())

    def test_signup_claims_guest_identity_and_preserves_comments(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        _, session = self.request(
            "POST",
            "/api/mobile/community/guest-session",
            payload={"installationId": "test-installation-guest-claim-0001"},
        )
        guest_token = session["token"]
        status, answered = self.guest_request(
            "POST",
            "/api/mobile/community/answer",
            guest_token,
            {"postId": post_id, "body": "Please preserve this guest comment."},
        )
        self.assertEqual(status, 201)
        with app.db() as con:
            original = con.execute(
                "SELECT author_id FROM ask_community_answers WHERE public_id = ?",
                (answered["answerId"],),
            ).fetchone()
            guest_user_id = int(original["author_id"])

        with mock.patch.object(
            app,
            "send_activation_email",
            return_value=(Path(self.temp_dir.name) / "guest-claim-activation.txt", "sent through test provider"),
        ):
            status, signup = self.guest_request(
                "POST",
                "/api/mobile/signup",
                guest_token,
                {
                    "name": "Claimed Community Member",
                    "email": "claimed-community@example.com",
                    "phone": "+1 720 555 0188",
                    "password": "CommunityPassword123!",
                    "consentAccepted": True,
                },
            )
        self.assertEqual(status, 201)
        self.assertTrue(signup["activationRequired"])
        with app.db() as con:
            claimed = con.execute("SELECT * FROM users WHERE id = ?", (guest_user_id,)).fetchone()
            answer = con.execute(
                "SELECT author_id FROM ask_community_answers WHERE public_id = ?",
                (answered["answerId"],),
            ).fetchone()
            guest_session = con.execute(
                "SELECT id FROM ask_community_guest_sessions WHERE user_id = ?",
                (guest_user_id,),
            ).fetchone()
        self.assertEqual(claimed["name"], "Claimed Community Member")
        self.assertEqual(int(claimed["guest_account"]), 0)
        self.assertEqual(int(answer["author_id"]), guest_user_id)
        self.assertIsNone(guest_session)
        _, detail = self.request("GET", f"/api/mobile/community?postId={post_id}")
        self.assertEqual(detail["posts"][0]["answers"][0]["author"]["name"], "Claimed Community Member")

    def test_guest_continues_privately_in_chitthi_after_first_public_comment(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        _, session = self.request("POST", "/api/mobile/community/guest-session", payload={"installationId": "test-private-chitthi-guest-0001"})
        status, first_comment = self.guest_request("POST", "/api/mobile/community/answer", session["token"], {"postId": post_id, "body": "Is this still available?"})
        self.assertEqual(status, 201)
        conversation_id = first_comment["conversationId"]

        status, private_reply = self.guest_request("POST", "/api/mobile/community/guest-message", session["token"], {"conversationId": conversation_id, "body": "I can move in next week."})
        self.assertEqual(status, 201)
        self.assertEqual(private_reply["guestRemaining"], 4)

        status, linked_reply = self.guest_request("POST", "/api/mobile/community/guest-message", session["token"], {
            "conversationId": conversation_id,
            "body": "Replying privately to my last message.",
            "replyToMessageId": private_reply["messageId"],
        })
        self.assertEqual(status, 201)
        self.assertEqual(linked_reply["guestRemaining"], 3)

        with app.db() as con:
            public_answer_count = int(con.execute("SELECT COUNT(*) AS count FROM ask_community_answers WHERE post_id = (SELECT id FROM ask_community_posts WHERE public_id = ?)", (post_id,)).fetchone()["count"])
            conversation = con.execute("SELECT * FROM chat_conversations WHERE public_id = ?", (conversation_id,)).fetchone()
            owner = con.execute("SELECT * FROM users WHERE id = ?", (self.owner_id,)).fetchone()
            app.save_chat_message(con, int(conversation["id"]), owner, "Yes, it is available.")
        self.assertEqual(public_answer_count, 1)

        inbox_status, inbox = self.guest_request("GET", "/api/mobile/community/guest-inbox", session["token"])
        self.assertEqual(inbox_status, 200)
        self.assertEqual(inbox["threads"][0]["guestConversationId"], conversation_id)
        guest_messages = inbox["threads"][0]["guestMessages"]
        self.assertEqual([message["body"] for message in guest_messages], ["Is this still available?", "I can move in next week.", "Replying privately to my last message.", "Yes, it is available."])
        self.assertEqual(guest_messages[2]["replyToMessageId"], private_reply["messageId"])

    def test_layered_feed_returns_local_first_and_active_public_usa_fallback(self):
        _, local = self.create_post(title="Dayton neighborhood advice", city="Dayton, OH")
        _, local_full_state = self.create_post(token="member-token", title="Dayton events this weekend", city="Dayton, Ohio")
        _, national = self.create_post(title="Columbus community update", city="Columbus, OH")
        _, national_full_state = self.create_post(token="outsider-token", title="Austin community update", city="Austin, Texas")
        _, international = self.create_post(title="Hyderabad community update", city="Hyderabad, Telangana, India")
        _, resolved = self.create_post(title="Resolved Denver housing request", city="Denver, CO")
        _, private = self.create_post(title="Private Dallas group update", city="Dallas, TX")
        _, reported = self.create_post(token="member-token", title="Reported Seattle community post", city="Seattle, WA")
        with app.db() as con:
            con.execute("INSERT INTO ask_community_posts (public_id, author_id, post_type, title, body, category, city, area, status, fulfillment_status) VALUES ('FFC-DENVER-SUFFIX', ?, 'UPDATE', 'Denver listing with country suffix', 'Local Denver update with a country-qualified city.', 'GENERAL', 'Denver, CO, United States', 'Denver', 'PUBLISHED', 'OPEN')", (self.owner_id,))
            con.execute("INSERT INTO ask_community_posts (public_id, author_id, post_type, title, body, category, city, area, status, fulfillment_status) VALUES ('FFC-DENVER-NC', ?, 'UPDATE', 'Denver North Carolina update', 'This must not appear in Colorado local results.', 'GENERAL', 'Denver, NC', 'Denver', 'PUBLISHED', 'OPEN')", (self.owner_id,))
            con.execute("INSERT INTO ask_community_posts (public_id, author_id, post_type, title, body, category, city, area, status, fulfillment_status) VALUES ('FFC-PARKER-CO', ?, 'UPDATE', 'Parker metro update', 'This should appear in the Denver metro feed.', 'GENERAL', 'Parker, CO', 'Parker', 'PUBLISHED', 'OPEN')", (self.owner_id,))
            con.execute("UPDATE ask_community_posts SET fulfillment_status = 'RESOLVED' WHERE public_id = ?", (resolved["post"]["id"],))
            group = con.execute(
                "INSERT INTO chat_communities (public_id, kind, name, description, area_label, visibility, created_by_user_id) VALUES ('FFG-PRIVATE-USA', 'GROUP', 'Private USA', '', 'Dallas, TX', 'PRIVATE', ?)",
                (self.owner_id,),
            )
            con.execute("UPDATE ask_community_posts SET community_id = ? WHERE public_id = ?", (int(group.lastrowid), private["post"]["id"]))
            con.execute("INSERT INTO chat_community_members (community_id, user_id, role) VALUES (?, ?, 'OWNER')", (int(group.lastrowid), self.owner_id))
        report_status, _ = self.request("POST", "/api/mobile/community/report", "outsider-token", {"postId": reported["post"]["id"], "reason": "SPAM"})
        self.assertEqual(report_status, 201)

        status, feed = self.request("GET", "/api/mobile/community?city=Dayton%2C%20OH&layered=1&limit=20", "owner-token")
        self.assertEqual(status, 200)
        local_ids = [post["id"] for post in feed["sections"]["local"]["posts"]]
        national_ids = [post["id"] for post in feed["sections"]["national"]["posts"]]
        self.assertEqual(set(local_ids), {local["post"]["id"], local_full_state["post"]["id"]})
        self.assertIn(national["post"]["id"], national_ids)
        self.assertIn(national_full_state["post"]["id"], national_ids)
        self.assertNotIn(local["post"]["id"], national_ids)
        self.assertNotIn(international["post"]["id"], national_ids)
        self.assertNotIn(resolved["post"]["id"], national_ids)
        self.assertNotIn(private["post"]["id"], national_ids)
        self.assertNotIn(reported["post"]["id"], national_ids)

        status, denver_feed = self.request("GET", "/api/mobile/community?city=Denver%2C%20CO&layered=1&limit=20")
        self.assertEqual(status, 200)
        denver_local_ids = {post["id"] for post in denver_feed["sections"]["local"]["posts"]}
        self.assertIn("FFC-DENVER-SUFFIX", denver_local_ids)
        self.assertIn("FFC-PARKER-CO", denver_local_ids)
        self.assertNotIn("FFC-DENVER-NC", denver_local_ids)

        status, empty_local_feed = self.request("GET", "/api/mobile/community?city=Boston%2C%20MA&layered=1&limit=20")
        self.assertEqual(status, 200)
        self.assertEqual(empty_local_feed["sections"]["local"]["posts"], [])
        empty_market_national_ids = [post["id"] for post in empty_local_feed["sections"]["national"]["posts"]]
        self.assertIn(local["post"]["id"], empty_market_national_ids)
        self.assertIn(national["post"]["id"], empty_market_national_ids)
        self.assertIn("FFC-DENVER-SUFFIX", empty_market_national_ids)

        _, first_page = self.request("GET", "/api/mobile/community?city=Dayton%2C%20OH&layered=1&limit=1&localOffset=0&nationalOffset=0")
        _, second_page = self.request("GET", "/api/mobile/community?city=Dayton%2C%20OH&layered=1&limit=1&localOffset=1&nationalOffset=1")
        first_local_page = {post["id"] for post in first_page["sections"]["local"]["posts"]}
        second_local_page = {post["id"] for post in second_page["sections"]["local"]["posts"]}
        first_national_page = {post["id"] for post in first_page["sections"]["national"]["posts"]}
        second_national_page = {post["id"] for post in second_page["sections"]["national"]["posts"]}
        self.assertTrue(first_local_page and second_local_page)
        self.assertTrue(first_national_page and second_national_page)
        self.assertFalse(first_local_page & second_local_page)
        self.assertFalse(first_national_page & second_national_page)

    def test_public_post_author_avatar_is_readable_without_login(self):
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        with app.db() as con:
            con.execute(
                "UPDATE users SET profile_photo_url = ? WHERE id = ?",
                (f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}", self.owner_id),
            )
        self.create_post()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}/api/chat/notification-avatar?user={self.owner_id}"
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "image/png")
            self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=600")
            self.assertEqual(response.read(), png)

    def test_search_and_public_share_page_find_the_right_post(self):
        _, dayton = self.create_post(title="Best groceries in Brookville?", body="Looking for fresh produce west of Dayton.", area="Brookville")
        self.create_post(title="Columbus airport advice", body="Which terminal is easiest for pickup?", city="Columbus, OH", area="Columbus")
        status, result = self.request("GET", "/api/mobile/community?q=Brookville")
        self.assertEqual(status, 200)
        self.assertEqual([post["id"] for post in result["posts"]], [dayton["post"]["id"]])
        with urllib.request.urlopen(f"http://127.0.0.1:{self.server.server_port}/community/{dayton['post']['id']}", timeout=5) as response:
            markup = response.read().decode()
        self.assertIn("Best groceries in Brookville?", markup)
        self.assertIn("Open in FairFares", markup)
        self.assertIn(f"https://fairfare.space/community/{dayton['post']['id']}", markup)
        self.assertIn("Install FairFares", markup)
        self.assertNotIn("fairfares://", markup)

    def test_creation_rejects_short_content_and_unsafe_link(self):
        status, rejected = self.create_post(title="Bad", body="short")
        self.assertEqual(status, 400)
        status, created = self.create_post(linkUrl="javascript:alert(1)")
        self.assertEqual(status, 201)
        self.assertEqual(created["post"]["linkUrl"], "")

    def test_customer_need_categories_are_saved_and_filterable(self):
        choices = ("GENERAL", "NEED_ROOMMATE", "NEED_PLACE", "HAVE_PLACE", "CARPOOL_RIDE")
        created_ids = {}
        for category in choices:
            status, created = self.create_post(category=category, title=f"Community request for {category}")
            self.assertEqual(status, 201)
            self.assertEqual(created["post"]["category"], category)
            created_ids[category] = created["post"]["id"]
        for category in choices:
            status, feed = self.request("GET", f"/api/mobile/community?category={category}")
            self.assertEqual(status, 200)
            self.assertEqual([post["id"] for post in feed["posts"]], [created_ids[category]])
        _, housing = self.request("GET", "/api/mobile/community?category=HOUSING")
        self.assertEqual({post["id"] for post in housing["posts"]}, {created_ids["NEED_ROOMMATE"], created_ids["NEED_PLACE"], created_ids["HAVE_PLACE"]})
        _, rides = self.request("GET", "/api/mobile/community?category=RIDES")
        self.assertEqual([post["id"] for post in rides["posts"]], [created_ids["CARPOOL_RIDE"]])

    def test_city_only_housing_projection_is_visible_locally_and_nationwide(self):
        with app.db() as con:
            metro = con.execute(
                """INSERT INTO accommodation_metros
                   (metro_key, name, country, state, center_city)
                   VALUES ('dayton-oh-test', 'Dayton, OH', 'US', 'OH', 'Dayton')"""
            )
            con.execute(
                """INSERT INTO accommodation_local_areas
                   (metro_id, place_key, name, city, state, zip_code)
                   VALUES (?, 'dayton-45402-test', 'Dayton, OH 45402', 'Dayton', 'OH', '45402')""",
                (int(metro.lastrowid),),
            )
            con.execute(
                """INSERT INTO accommodation_posts
                   (public_id, user_id, post_mode, category, title, description,
                    city, country, zip_code, city_area_zip, area_or_apartment,
                    rent_min, contact_name, contact_phone, contact_email,
                    visibility_status, expires_at, created_at, updated_at)
                   VALUES ('CITY-ONLY-DAYTON', ?, 'HAVE_PLACE', 'shared_room',
                           '238 Oak Street', 'Shared room in Dayton', '', 'US',
                           '45402', 'Dayton, 45402', 'Downtown', 250,
                           'Owner', '9375550100', 'owner@example.com', 'ACTIVE',
                           '2099-12-31 23:59:59', datetime('now'), datetime('now'))""",
                (self.owner_id,),
            )
            con.execute(
                """INSERT INTO accommodation_posts
                   (public_id, user_id, post_mode, category, title, description,
                    city, country, zip_code, city_area_zip, area_or_apartment,
                    rent_min, contact_name, contact_phone, contact_email,
                    visibility_status, expires_at, created_at, updated_at)
                   VALUES ('CITY-ONLY-BRIDGEPORT', ?, 'HAVE_PLACE', 'single_room',
                           'Private room', 'Private room in Bridgeport', 'Bridgeport', 'US',
                           '06605', 'Bridgeport', 'Bridgeport, CT', 500,
                           'Owner', '2035550100', 'owner@example.com', 'ACTIVE',
                           '2099-12-31 23:59:59', datetime('now'), datetime('now'))""",
                (self.owner_id,),
            )
            # Production already contains community projections for these
            # listings.  Exercise the UPDATE path as well as first-time
            # projection so a deploy repairs cards users created earlier.
            con.execute(
                """INSERT INTO ask_community_posts
                   (public_id, author_id, post_type, title, body, category,
                    city, area, status, fulfillment_status, expires_at,
                    source_kind, source_public_id)
                   VALUES ('FFH-CITY-ONLY-DAYTON', ?, 'REQUEST',
                           '238 Oak Street', 'Shared room in Dayton',
                           'HAVE_PLACE', '', 'Dayton', 'PUBLISHED', 'OPEN',
                           '2099-12-31 23:59:59', 'HOUSING',
                           'CITY-ONLY-DAYTON')""",
                (self.owner_id,),
            )
            con.execute(
                """INSERT INTO ask_community_posts
                   (public_id, author_id, post_type, title, body, category,
                    city, area, status, fulfillment_status, expires_at,
                    source_kind, source_public_id)
                   VALUES ('FFH-CITY-ONLY-BRIDGEPORT', ?, 'REQUEST',
                           'Private room', 'Private room in Bridgeport',
                           'HAVE_PLACE', 'Bridgeport', 'Bridgeport, CT',
                           'PUBLISHED', 'OPEN', '2099-12-31 23:59:59',
                           'HOUSING', 'CITY-ONLY-BRIDGEPORT')""",
                (self.owner_id,),
            )

        status, dayton = self.request("GET", "/api/mobile/community?city=Dayton%2C%20OH&layered=1&category=HOUSING")
        self.assertEqual(status, 200)
        self.assertIn("FFH-CITY-ONLY-DAYTON", [post["id"] for post in dayton["sections"]["local"]["posts"]])

        status, cincinnati = self.request("GET", "/api/mobile/community?city=Cincinnati%2C%20OH&layered=1&category=HOUSING")
        self.assertEqual(status, 200)
        national = cincinnati["sections"]["national"]["posts"]
        projected = next(post for post in national if post["id"] == "FFH-CITY-ONLY-DAYTON")
        self.assertEqual(projected["city"], "Dayton, OH")
        bridgeport = next(post for post in national if post["id"] == "FFH-CITY-ONLY-BRIDGEPORT")
        self.assertEqual(bridgeport["city"], "Bridgeport, CT")
        with app.db() as con:
            repaired_rows = con.execute(
                """SELECT public_id, city FROM accommodation_posts
                   WHERE public_id IN ('CITY-ONLY-DAYTON', 'CITY-ONLY-BRIDGEPORT')"""
            ).fetchall()
        self.assertEqual(
            {row["public_id"]: row["city"] for row in repaired_rows},
            {"CITY-ONLY-DAYTON": "Dayton, OH", "CITY-ONLY-BRIDGEPORT": "Bridgeport, CT"},
        )

    def test_structured_details_expiration_and_owner_outcome(self):
        status, created = self.create_post(
            category="CARPOOL_RIDE", title="Carpool from Dayton to Columbus",
            details={"origin": "Dayton", "destination": "Columbus", "travelDate": "2026-09-02", "travelTime": "8:30 AM", "seats": "3"},
            expiresInDays=30,
        )
        self.assertEqual(status, 201)
        post = created["post"]
        self.assertEqual(post["details"]["origin"], "Dayton")
        self.assertEqual(post["details"]["seats"], "3")
        self.assertTrue(post["expiresAt"])
        status, result = self.request("POST", "/api/mobile/community/status", "owner-token", {"postId": post["id"], "status": "ARRANGED"})
        self.assertEqual((status, result["status"]), (200, "ARRANGED"))
        _, detail = self.request("GET", f"/api/mobile/community?postId={post['id']}", "owner-token")
        self.assertEqual(detail["posts"][0]["fulfillmentStatus"], "ARRANGED")
        self.assertFalse(detail["posts"][0]["canAnswer"])
        status, _ = self.request("POST", "/api/mobile/community/status", "member-token", {"postId": post["id"], "status": "OPEN"})
        self.assertEqual(status, 403)
        with app.db() as con:
            con.execute("UPDATE ask_community_posts SET expires_at = datetime('now', '-1 day') WHERE public_id = ?", (post["id"],))
        _, public_feed = self.request("GET", "/api/mobile/community?category=CARPOOL_RIDE")
        self.assertFalse(public_feed["posts"])
        _, owner_feed = self.request("GET", "/api/mobile/community?category=CARPOOL_RIDE", "owner-token")
        self.assertEqual(owner_feed["posts"][0]["id"], post["id"])

    def test_answer_reaction_save_and_accept_flow(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        status, answered = self.request("POST", "/api/mobile/community/answer", "member-token", {"postId": post_id, "body": "Brookville has several quiet areas and a direct drive into Dayton."})
        self.assertEqual(status, 201)
        answer_id = answered["answerId"]
        self.assertTrue(answered["conversationId"])
        with app.db() as con:
            chitthi_message = con.execute(
                """SELECT messages.*, conversations.public_id AS conversation_public_id
                   FROM chat_messages messages
                   JOIN chat_conversations conversations ON conversations.id = messages.conversation_id
                   WHERE messages.client_message_id = ?""",
                (f"community-answer-{answer_id}",),
            ).fetchone()
            self.assertIsNotNone(chitthi_message)
            self.assertEqual(chitthi_message["conversation_public_id"], answered["conversationId"])
            self.assertEqual(chitthi_message["sender_id"], self.member_id)
            self.assertEqual(chitthi_message["context_type"], "COMMUNITY")
            self.assertEqual(chitthi_message["context_public_id"], post_id)
            self.assertEqual(chitthi_message["message_text"], "Brookville has several quiet areas and a direct drive into Dayton.")
            owner_participant = con.execute(
                "SELECT last_read_message_id FROM chat_participants WHERE conversation_id = ? AND user_id = ?",
                (chitthi_message["conversation_id"], self.owner_id),
            ).fetchone()
            self.assertLess(int(owner_participant["last_read_message_id"] or 0), int(chitthi_message["id"]))
        _, feed_with_comment = self.request("GET", "/api/mobile/community", "owner-token")
        feed_post = next(item for item in feed_with_comment["posts"] if item["id"] == post_id)
        self.assertEqual(feed_post["latestAnswer"]["id"], answer_id)
        self.assertEqual(feed_post["latestAnswer"]["author"]["name"], "Member")
        self.assertIn("Brookville", feed_post["latestAnswer"]["body"])
        status, loved = self.request("POST", "/api/mobile/community/react", "owner-token", {"answerId": answer_id, "reaction": "LOVE"})
        self.assertEqual((status, loved["active"], loved["reaction"]), (200, True, "LOVE"))
        _, detail_with_love = self.request("GET", f"/api/mobile/community?postId={post_id}", "owner-token")
        self.assertEqual(detail_with_love["posts"][0]["answers"][0]["reactionCounts"]["LOVE"], 1)
        status, reacted = self.request("POST", "/api/mobile/community/react", "owner-token", {"answerId": answer_id, "reaction": "HELPFUL"})
        self.assertEqual((status, reacted["active"], reacted["count"]), (200, True, 1))
        _, unreacted = self.request("POST", "/api/mobile/community/react", "owner-token", {"answerId": answer_id, "reaction": "HELPFUL"})
        self.assertEqual((unreacted["active"], unreacted["count"]), (False, 0))
        _, saved = self.request("POST", "/api/mobile/community/save", "member-token", {"postId": post_id})
        self.assertTrue(saved["saved"])
        _, saved_feed = self.request("GET", "/api/mobile/community?saved=1", "member-token")
        self.assertEqual(saved_feed["posts"][0]["id"], post_id)
        status, accepted = self.request("POST", "/api/mobile/community/accept-answer", "owner-token", {"postId": post_id, "answerId": answer_id})
        self.assertEqual(status, 200)
        self.assertEqual(accepted["acceptedAnswerId"], answer_id)
        _, detail = self.request("GET", f"/api/mobile/community?postId={post_id}", "owner-token")
        self.assertTrue(detail["posts"][0]["answers"][0]["accepted"])
        self.assertEqual(detail["posts"][0]["acceptedAnswerId"], answer_id)

    def test_multiple_reaction_types_persist_and_reload_together(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]

        status, liked = self.request("POST", "/api/mobile/community/react", "member-token", {"postId": post_id, "reaction": "LIKE"})
        self.assertEqual((status, liked["active"]), (200, True))
        status, loved = self.request("POST", "/api/mobile/community/react", "outsider-token", {"postId": post_id, "reaction": "LOVE"})
        self.assertEqual((status, loved["active"]), (200, True))
        status, cared = self.request("POST", "/api/mobile/community/react", "owner-token", {"postId": post_id, "reaction": "CARE"})
        self.assertEqual((status, cared["active"]), (200, True))

        _, reloaded = self.request("GET", f"/api/mobile/community?postId={post_id}", "owner-token")
        post = reloaded["posts"][0]
        self.assertEqual(post["reactionCount"], 3)
        self.assertEqual(post["reactionCounts"]["LIKE"], 1)
        self.assertEqual(post["reactionCounts"]["LOVE"], 1)
        self.assertEqual(post["reactionCounts"]["CARE"], 1)
        self.assertEqual(post["viewerReaction"], "CARE")

    def test_housing_listing_uses_the_same_comments_and_reactions(self):
        with app.db() as con:
            con.execute(
                """INSERT INTO accommodation_posts
                   (public_id, user_id, post_mode, category, title, description, city,
                    area_or_apartment, move_in_date, rent_min, lease_term, visibility_status)
                   VALUES ('FFP-HOUSING-1', ?, 'HAVE_PLACE', 'single_room',
                           'Room near Dayton', 'Sunny private room with parking.', 'Dayton, OH',
                           'Brookville', '2026-09-01', 900, '12_months', 'ACTIVE')""",
                (self.owner_id,),
            )
        status, feed = self.request("GET", "/api/mobile/community?category=HOUSING", "member-token")
        self.assertEqual(status, 200)
        housing = next(post for post in feed["posts"] if post["sourceId"] == "FFP-HOUSING-1")
        self.assertEqual(housing["sourceKind"], "HOUSING")
        status, reaction = self.request("POST", "/api/mobile/community/react", "member-token", {"postId": housing["id"], "reaction": "HELPFUL"})
        self.assertEqual((status, reaction["active"], reaction["count"]), (200, True, 1))
        self.assertEqual((reaction["reaction"], reaction["counts"]), ("LIKE", {"LIKE": 1}))
        status, comment = self.request("POST", "/api/mobile/community/answer", "member-token", {"postId": housing["id"], "body": "Is the room still available for September?"})
        self.assertEqual(status, 201)
        _, detail = self.request("GET", f"/api/mobile/community?postId={housing['id']}", "member-token")
        self.assertEqual(detail["posts"][0]["reactionCount"], 1)
        self.assertEqual(detail["posts"][0]["answerCount"], 1)
        self.assertEqual(detail["posts"][0]["answers"][0]["id"], comment["answerId"])

    def test_only_question_owner_can_accept_answer(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        _, answered = self.request("POST", "/api/mobile/community/answer", "member-token", {"postId": post_id, "body": "Here is a useful answer."})
        status, _ = self.request("POST", "/api/mobile/community/accept-answer", "outsider-token", {"postId": post_id, "answerId": answered["answerId"]})
        self.assertEqual(status, 403)

    def test_private_group_post_requires_membership_and_stays_private(self):
        with app.db() as con:
            cursor = con.execute("INSERT INTO chat_communities (public_id, name, kind, visibility, created_by_user_id) VALUES ('FFG-PRIVATE', 'Private neighbors', 'GROUP', 'PRIVATE', ?)", (self.owner_id,))
            group_id = int(cursor.lastrowid)
            con.execute("INSERT INTO chat_community_members (community_id, user_id, role) VALUES (?, ?, 'OWNER')", (group_id, self.owner_id))
        status, created = self.create_post(communityId="FFG-PRIVATE")
        self.assertEqual(status, 201)
        status, _ = self.create_post(token="outsider-token", communityId="FFG-PRIVATE")
        self.assertEqual(status, 403)
        _, outsider_feed = self.request("GET", "/api/mobile/community", "outsider-token")
        self.assertFalse(any(post["id"] == created["post"]["id"] for post in outsider_feed["posts"]))
        _, owner_feed = self.request("GET", "/api/mobile/community", "owner-token")
        self.assertTrue(any(post["id"] == created["post"]["id"] for post in owner_feed["posts"]))

    def test_reporting_own_content_is_rejected_and_other_report_is_deduplicated(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        status, _ = self.request("POST", "/api/mobile/community/report", "owner-token", {"postId": post_id, "reason": "SPAM"})
        self.assertEqual(status, 400)
        for _ in range(2):
            status, _payload = self.request("POST", "/api/mobile/community/report", "member-token", {"postId": post_id, "reason": "SPAM", "details": "Duplicate post"})
            self.assertEqual(status, 201)
        with app.db() as con:
            count = con.execute("SELECT COUNT(*) AS count FROM ask_community_reports").fetchone()["count"]
        self.assertEqual(count, 1)

    def test_only_owner_can_edit_or_delete(self):
        _, created = self.create_post()
        post_id = created["post"]["id"]
        status, _ = self.request("POST", "/api/mobile/community/update", "member-token", {"postId": post_id, "title": "A different valid title", "body": "This is a long enough edited body.", "linkUrl": ""})
        self.assertEqual(status, 403)
        status, _ = self.request("POST", "/api/mobile/community/delete", "member-token", {"postId": post_id})
        self.assertEqual(status, 403)
        status, _ = self.request("POST", "/api/mobile/community/delete", "owner-token", {"postId": post_id})
        self.assertEqual(status, 200)
        _, feed = self.request("GET", "/api/mobile/community")
        self.assertFalse(feed["posts"])


if __name__ == "__main__":
    unittest.main()
