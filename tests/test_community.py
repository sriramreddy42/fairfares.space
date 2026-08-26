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
        status, guest_like = self.guest_request("POST", "/api/mobile/community/react", token, {"postId": post_id, "reaction": "LIKE"})
        self.assertEqual((status, guest_like["active"], guest_like["reaction"], guest_like["count"]), (200, True, "LIKE", 1))
        status, guest_detail = self.guest_request("GET", f"/api/mobile/community?postId={post_id}", token)
        self.assertEqual((status, guest_detail["posts"][0]["viewerReaction"]), (200, "LIKE"))
        status, guest_unlike = self.guest_request("POST", "/api/mobile/community/react", token, {"postId": post_id, "reaction": "LIKE"})
        self.assertEqual((status, guest_unlike["active"], guest_unlike["count"]), (200, False, 0))
        first_answer_id = ""
        for index in range(6):
            status, answered = self.guest_request("POST", "/api/mobile/community/answer", token, {"postId": post_id, "body": f"Guest message number {index + 1}"})
            self.assertEqual(status, 201)
            self.assertEqual(answered["guestRemaining"], 5 - index)
            first_answer_id = first_answer_id or answered["answerId"]
        status, limited = self.guest_request("POST", "/api/mobile/community/answer", token, {"postId": post_id, "body": "Seventh guest message"})
        self.assertEqual(status, 403)
        self.assertTrue(limited["guestLimitReached"])
        self.assertEqual(limited["remaining"], 0)

        status, reply = self.request("POST", "/api/mobile/community/answer", "owner-token", {"postId": post_id, "body": "Thanks — replying here so you can see it.", "parentAnswerId": first_answer_id})
        self.assertEqual(status, 201)
        _, detail = self.request("GET", f"/api/mobile/community?postId={post_id}")
        answers = detail["posts"][0]["answers"]
        self.assertEqual(answers[-1]["parentAnswerId"], first_answer_id)
        self.assertEqual(answers[-1]["body"], "Thanks — replying here so you can see it.")
        guest_names = {answer["author"]["name"] for answer in answers[:-1]}
        self.assertEqual(guest_names, {session["guestId"]})

        status, resumed = self.request("POST", "/api/mobile/community/guest-session", payload={"installationId": "test-installation-guest-0001"})
        self.assertEqual(status, 200)
        self.assertEqual(resumed["guestId"], session["guestId"])
        self.assertEqual(resumed["remaining"], 0)

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
        self.assertIn(f"fairfares://community?postId={dayton['post']['id']}", markup)

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
