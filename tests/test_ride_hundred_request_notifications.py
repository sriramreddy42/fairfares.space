"""Exercise 100 saved ride requests and later offers through the local API."""

import json
import os
import statistics
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path
from unittest.mock import patch

import app
from tests.test_ride_hundred_city_listings import hundred_real_city_routes

PROCESS_PUSH_OUTBOX = app.process_mobile_push_outbox


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


class HundredRideRequestNotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "rides.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        self.riders = []
        self.drivers = []
        password_hash = app.hash_password("Password123!")
        with app.db() as con:
            for index in range(13):
                for role, accounts in (("rider", self.riders), ("driver", self.drivers)):
                    con.execute(
                        "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                        (f"Test {role.title()} {index}", f"ride-100-{role}-{index}@example.com", password_hash),
                    )
                    user_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
                    token = f"ride-100-{role}-session-{index}"
                    con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
                    if role == "rider":
                        con.execute(
                            "INSERT INTO mobile_push_tokens (user_id, token, platform, enabled) VALUES (?, ?, 'ios', 1)",
                            (user_id, f"ExponentPushToken[ride-100-rider-{index}]"),
                        )
                    accounts.append((user_id, token))
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
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

    def request(self, method, path, token="", payload=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers=headers,
            method=method,
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8")), time.monotonic() - started
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8")), time.monotonic() - started

    @patch.object(app, "process_mobile_push_outbox", return_value=None)
    @patch.object(app, "get_ride_driver_profile", return_value={"readyForOffers": True})
    @patch.object(app, "google_route_totals", return_value=None)
    def test_100_find_save_match_and_queue_push(self, _routes, _profile, _push_worker):
        routes = hundred_real_city_routes()
        requests = []
        offers = []
        expected_matches = set()
        timings = {"empty_search": [], "save_request": [], "create_offer": [], "matched_search": []}
        for index, (_country, start, end) in enumerate(routes):
            pickup_date = date(2099, 8, 2).isoformat()
            query = urllib.parse.urlencode({
                "type": "CARPOOL_OFFER", "city": start[0], "origin": start[0],
                "originLat": start[1], "originLng": start[2],
                "destination": end[0], "destinationLat": end[1], "destinationLng": end[2],
                "pickupDate": pickup_date,
            })
            status, found, duration = self.request("GET", f"/api/mobile/rides?{query}")
            timings["empty_search"].append(duration)
            self.assertEqual(status, 200, found)
            self.assertEqual(found["rides"], [], f"Route {index} must start without an offer")
            request_payload = {
                "rideType": "CARPOOL_REQUEST", "city": start[0],
                "origin": start[0], "originLat": start[1], "originLng": start[2],
                "destination": end[0], "destinationLat": end[1], "destinationLng": end[2],
                "pickupDate": pickup_date, "pickupTime": "8:00 AM",
            }
            rider_id, rider_token = self.riders[index % len(self.riders)]
            status, saved, duration = self.request("POST", "/api/mobile/rides", rider_token, request_payload)
            timings["save_request"].append(duration)
            self.assertEqual(status, 201, (index, saved))
            self.assertEqual(saved["dispatch"]["notifiedCount"], 0)
            self.assertEqual((saved["ride"]["origin"], saved["ride"]["destination"]), (start[0], end[0]))
            requests.append((rider_id, saved["ride"]["id"], request_payload, query))

        with app.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM ride_posts WHERE ride_type = 'CARPOOL_REQUEST'").fetchone()[0], 100)
            self.assertEqual(con.execute("SELECT count(*) FROM ride_dispatch_notifications").fetchone()[0], 0)
            self.assertEqual(con.execute("SELECT count(*) FROM mobile_push_outbox").fetchone()[0], 0)

        for index, (_country, start, end) in enumerate(routes):
            driver_id, driver_token = self.drivers[index % len(self.drivers)]
            offer_payload = {
                **requests[index][2], "rideType": "CARPOOL_OFFER",
                "vehicleMakeModel": "Test Car", "licensePlate": "TEST123", "licenseState": "CO",
                "maxDetourMinutes": 10, "maxPickupDistanceMiles": 5,
            }
            status, posted, duration = self.request("POST", "/api/mobile/rides", driver_token, offer_payload)
            timings["create_offer"].append(duration)
            self.assertEqual(status, 201, (index, posted))
            with app.db() as con:
                matched_requests = con.execute(
                    """SELECT requests.public_id, requests.origin_label, requests.destination_label, matches.route_deviation_miles
                       FROM ride_dispatch_notifications matches
                       JOIN ride_posts requests ON requests.id = matches.request_ride_post_id
                       JOIN ride_posts offers ON offers.id = matches.driver_ride_post_id
                       WHERE offers.public_id = ?""",
                    (posted["ride"]["id"],),
                ).fetchall()
            matched_ids = {row["public_id"] for row in matched_requests}
            self.assertIn(requests[index][1], matched_ids, (index, [tuple(row) for row in matched_requests]))
            self.assertEqual(posted["dispatch"]["matchedRequestCount"], len(matched_requests))
            expected_matches.update((request_id, posted["ride"]["id"]) for request_id in matched_ids)
            self.assertEqual((posted["ride"]["origin"], posted["ride"]["destination"]), (start[0], end[0]))
            offers.append(posted["ride"]["id"])
            status, found, duration = self.request("GET", f"/api/mobile/rides?{requests[index][3]}")
            timings["matched_search"].append(duration)
            self.assertEqual(status, 200, found)
            self.assertEqual(found["rides"][0]["id"], offers[index], (index, found))
            self.assertNotIn("licensePlate", found["rides"][0])

        with app.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM ride_posts").fetchone()[0], 200)
            self.assertEqual(con.execute("SELECT count(*) FROM ride_dispatch_notifications").fetchone()[0], len(expected_matches))
            pushed = con.execute(
                "SELECT user_id, body, data_json FROM mobile_push_outbox ORDER BY id"
            ).fetchall()
            self.assertEqual(len(pushed), len(expected_matches))
            request_by_id = {request_id: (rider_id, payload) for rider_id, request_id, payload, _query in requests}
            request_index_by_id = {request_id: index for index, (_rider_id, request_id, _payload, _query) in enumerate(requests)}
            offer_index_by_id = {offer_id: index for index, offer_id in enumerate(offers)}
            actual_matches = set()
            for row in pushed:
                data = json.loads(row["data_json"])
                request_id = data["requestId"]
                expected_rider_id, payload = request_by_id[request_id]
                self.assertEqual(row["user_id"], expected_rider_id)
                self.assertEqual(data["type"], "CARPOOL_MATCH")
                self.assertIn(f"{payload['origin']} → {payload['destination']}", row["body"])
                self.assertEqual(routes[request_index_by_id[request_id]][0], routes[offer_index_by_id[data["rideId"]]][0])
                actual_matches.add((request_id, data["rideId"]))
            self.assertEqual(actual_matches, expected_matches)

        # Re-saving an unchanged offer must not duplicate its rider push.
        _, driver_token = self.drivers[0]
        edit_payload = {
            **requests[0][2], "rideType": "CARPOOL_OFFER", "rideId": offers[0],
            "vehicleMakeModel": "Test Car", "licensePlate": "TEST123", "licenseState": "CO",
            "maxDetourMinutes": 10, "maxPickupDistanceMiles": 5,
        }
        status, edited, _duration = self.request("POST", "/api/mobile/rides", driver_token, edit_payload)
        self.assertEqual(status, 200, edited)
        with app.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM mobile_push_outbox").fetchone()[0], len(expected_matches))

        # Exercise the actual outbox worker and receipt handler against fake
        # Expo responses; no network request or real device is involved.
        with patch.object(app, "send_expo_push", side_effect=lambda tokens, _title, _body, _data: {
            tokens[0]: {"status": "ACCEPTED", "ticketId": f"ticket-{tokens[0]}", "error": ""}
        }):
            accepted = 0
            while accepted < len(expected_matches):
                delivery = PROCESS_PUSH_OUTBOX(limit=500)
                self.assertGreater(delivery["accepted"], 0)
                accepted += delivery["accepted"]
        self.assertEqual(accepted, len(expected_matches))
        with app.db() as con:
            con.execute("UPDATE mobile_push_outbox SET accepted_at = datetime('now', '-20 seconds')")
            tickets = [row[0] for row in con.execute("SELECT expo_ticket_id FROM mobile_push_outbox")]
        receipt_response = json.dumps({"data": {ticket: {"status": "ok"} for ticket in tickets}}).encode("utf-8")
        with patch.object(app.urllib.request, "urlopen") as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = receipt_response
            delivered = 0
            while delivered < len(expected_matches):
                receipts = app.check_expo_push_receipts(limit=1000)
                self.assertGreater(receipts["delivered"], 0)
                delivered += receipts["delivered"]
        self.assertEqual(delivered, len(expected_matches))
        with app.db() as con:
            self.assertEqual(con.execute("SELECT count(*) FROM mobile_push_outbox WHERE status = 'DELIVERED'").fetchone()[0], len(expected_matches))

        print(f"100 same-day routes: {len(expected_matches)} route-matched rider-offer notifications")

        for operation, values in timings.items():
            ordered = sorted(values)
            p95 = ordered[int(len(ordered) * 0.95) - 1]
            print(f"{operation}: median={statistics.median(values):.3f}s p95={p95:.3f}s max={max(values):.3f}s")
            self.assertLess(p95, 2.0, f"{operation} p95 regressed")


if __name__ == "__main__":
    unittest.main()
