from __future__ import annotations

import json
import os
import statistics
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
USERS = max(2, int(os.environ.get("FAIRFARES_LOAD_USERS", "50") or "50"))
WORKERS = max(1, int(os.environ.get("FAIRFARES_LOAD_WORKERS", str(min(USERS, 24))) or min(USERS, 24)))
TMP = tempfile.TemporaryDirectory(prefix=f"fairfares-mobile-{USERS}-")
os.environ["FAIRFARES_DB_PATH"] = str(Path(TMP.name) / "fairfares.sqlite3")
os.environ["FAIRFARES_BACKUP_DIR"] = str(Path(TMP.name) / "backups")
os.environ["FAIRFARES_SEED_DEFAULTS"] = "1"
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["GOOGLE_PLACES_API_KEY"] = ""
os.environ["GOOGLE_MAPS_API_KEY"] = ""
os.environ["EXPO_ACCESS_TOKEN"] = ""

sys.path.insert(0, str(ROOT))
import app  # noqa: E402


PASSWORD = "FairFares50!"


class QuietHandler(app.FairFaresHandler):
    def log_message(self, _format, *_args):
        return


class Workload:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"
        self.timings: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def call(self, label: str, path: str, *, method: str = "GET", payload=None, token: str = "", form: bool = False, expect=(200,)):
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            if form:
                data = urllib.parse.urlencode(payload).encode()
                headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                data = json.dumps(payload).encode()
                headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        started = time.perf_counter()
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = response.status
                raw = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8", errors="replace")
        elapsed = (time.perf_counter() - started) * 1000
        with self.lock:
            self.timings.setdefault(label, []).append(elapsed)
        if status not in expect:
            raise AssertionError(f"{label} returned {status}: {raw[:400]}")
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, raw

    def parallel(self, label: str, jobs, workers=WORKERS):
        results = [None] * len(jobs)
        errors = []
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(job): index for index, job in enumerate(jobs)}
            for future in as_completed(futures):
                index = futures[future]
                try:
                    results[index] = future.result()
                except Exception as error:  # noqa: BLE001
                    errors.append((index, str(error)))
        if errors:
            preview = "; ".join(f"#{index}: {message}" for index, message in errors[:8])
            raise AssertionError(f"{label} failed {len(errors)}/{len(jobs)} jobs: {preview}")
        return results

    def report(self):
        rows = []
        for label, values in sorted(self.timings.items()):
            ordered = sorted(values)
            p95 = ordered[min(len(ordered) - 1, max(0, int(len(ordered) * 0.95) - 1))]
            rows.append({"operation": label, "requests": len(values), "avgMs": round(statistics.mean(values), 1), "p95Ms": round(p95, 1), "maxMs": round(max(values), 1)})
        return rows


def main():
    started = time.perf_counter()
    app.OUTBOX_DIR = Path(TMP.name) / "outbox"
    app.refresh_storage_paths()
    app.init_db()
    server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    workload = Workload(server.server_port)
    try:
        user_rows = [
            {
                "name": f"Load User {index:02d}",
                "email": f"load.user.{index:02d}@example.test",
                "phone": f"303555{1000 + index:04d}",
                "password": PASSWORD,
            }
            for index in range(USERS)
        ]

        # Signup is intentionally protected by a per-IP abuse limiter, so 50
        # localhost signups would test the limiter rather than 50 distinct
        # clients. Seed verified test identities directly, then load-test the
        # same login and authenticated HTTP paths used by the mobile app.
        password_hash = app.hash_password(PASSWORD)
        with app.db() as con:
            con.executemany(
                """
                INSERT INTO users (name, email, phone, password_hash, is_verified, verified_at)
                VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                """,
                [(row["name"], row["email"], row["phone"], password_hash) for row in user_rows],
            )
            placeholders = ",".join("?" for _ in user_rows)
            verified_count = con.execute(
                f"SELECT COUNT(*) AS count FROM users WHERE is_verified = 1 AND email IN ({placeholders})",
                tuple(row["email"] for row in user_rows),
            ).fetchone()["count"]
        assert verified_count == USERS

        logins = workload.parallel("login", [
            lambda row=row: workload.call("login", "/api/mobile/login", method="POST", payload={"identifier": row["email"], "password": PASSWORD})[1]
            for row in user_rows
        ])
        tokens = [row["token"] for row in logins]
        assert len(set(tokens)) == USERS

        bootstraps = workload.parallel("bootstrap", [
            lambda token=token: workload.call("bootstrap", "/api/mobile/bootstrap?city=Denver%2C%20CO", token=token)[1]
            for token in tokens
        ])
        assert all(row.get("user", {}).get("email") == user_rows[index]["email"] for index, row in enumerate(bootstraps))

        move_in = (date.today() + timedelta(days=14)).isoformat()
        housing_results = workload.parallel("housing-create", [
            lambda index=index, token=tokens[index], row=user_rows[index]: workload.call(
                "housing-create",
                "/api/mobile/housing",
                method="POST",
                token=token,
                payload={
                    "postMode": "HAVE_PLACE" if index % 2 == 0 else "NEED_PLACE",
                    "category": "single_room" if index % 3 else "shared_room",
                    "title": f"Load housing post {index:02d}",
                    "description": "Concurrent FairFares housing workflow validation.",
                    "city": "Denver, CO",
                    "streetAddress": f"{1600 + index} Grant St" if index % 2 == 0 else "",
                    "zipCode": "80203",
                    "area": "Capitol Hill" if index % 2 else "",
                    "workSchoolLocation": "University of Denver" if index % 2 else "",
                    "moveInDate": move_in,
                    "rentMin": str(800 + index),
                    "rentMax": str(1100 + index),
                    "rentPeriod": "MONTH",
                    "accommodates": "1",
                    "roommateCount": str(index % 3),
                    "roommateIntent": index % 5 == 0,
                    "contactName": row["name"],
                    "contactEmail": row["email"],
                    "contactPhone": row["phone"],
                },
                expect=(201,),
            )[1]
            for index in range(USERS)
        ])
        housing_ids = [result["post"]["id"] for result in housing_results]
        assert len(set(housing_ids)) == USERS

        housing_searches = workload.parallel("housing-search", [
            lambda token=token: workload.call("housing-search", "/api/mobile/housing?city=Denver%2C%20CO&area=Capitol%20Hill&radius=60&limit=50", token=token)[1]
            for token in tokens
        ])
        expected_housing_matches = min(50, max(1, USERS // 2))
        housing_counts = [len(result.get("posts", [])) for result in housing_searches]
        assert all(count >= expected_housing_matches for count in housing_counts), f"housing search returned too few posts: {housing_counts}"

        driver_indexes = list(range(0, USERS, 2))
        workload.parallel("driver-profile", [
            lambda index=index, token=tokens[index]: workload.call(
                "driver-profile", "/api/mobile/rides/driver-profile", method="POST", token=token,
                payload={"vehicleMakeModel": "Toyota Camry", "vehicleYear": "2024", "vehicleColor": "Blue", "licensePlate": f"LOAD{index:02d}", "licenseState": "CO", "insuranceProvider": "State Farm", "insurancePolicyLast4": f"{4000 + index}", "serviceTypes": ["CARPOOL_OFFER"], "seatCount": 4, "maxDetourMinutes": 25, "maxPickupDistanceMiles": 15},
            )[1]
            for index in driver_indexes
        ])
        with app.db() as con:
            con.execute("UPDATE ride_driver_profiles SET review_status = 'APPROVED'")

        pickup_date = (date.today() + timedelta(days=21)).isoformat()
        ride_results = workload.parallel("ride-create", [
            lambda index=index, token=tokens[index]: workload.call(
                "ride-create", "/api/mobile/rides", method="POST", token=token,
                payload={"rideType": "CARPOOL_OFFER" if index % 2 == 0 else "CARPOOL_REQUEST", "city": "Denver, CO", "origin": "Denver, CO", "originLat": 39.7392, "originLng": -104.9903, "destination": "Colorado Springs, CO", "destinationLat": 38.8339, "destinationLng": -104.8214, "pickupDate": pickup_date, "pickupTime": "8:00 AM", "seats": 3 if index % 2 == 0 else 1, "maxDetourMinutes": 25, "maxPickupDistanceMiles": 15, "contributionPerSeat": 20},
                expect=(201,),
            )[1]
            for index in range(USERS)
        ])
        assert len({result["ride"]["id"] for result in ride_results}) == USERS

        ride_searches = workload.parallel("ride-search", [
            lambda token=token: workload.call("ride-search", f"/api/mobile/rides?city=Denver%2C%20CO&type=CARPOOL_OFFER&origin=Denver%2C%20CO&destination=Colorado%20Springs%2C%20CO&pickup_date={pickup_date}&limit=50", token=token)[1]
            for token in tokens
        ])
        expected_ride_matches = min(50, len(driver_indexes))
        ride_counts = [len(result.get("rides", [])) for result in ride_searches]
        assert all(count >= expected_ride_matches for count in ride_counts), f"ride search returned too few offers: {ride_counts}"

        rental_lists = workload.parallel("rental-search", [
            lambda token=token: workload.call("rental-search", "/api/mobile/rentals?location=Denver", token=token)[1]
            for token in tokens
        ])
        car_id = rental_lists[0]["cars"][0]["id"]
        return_date = (date.today() + timedelta(days=28)).isoformat()
        rental_quotes = workload.parallel("rental-quote", [
            lambda token=token: workload.call("rental-quote", "/api/mobile/rentals/quote", method="POST", token=token, payload={"carId": car_id, "days": 7, "pickupDate": pickup_date, "returnDate": return_date, "pickupTime": "10:00 AM", "returnTime": "10:00 AM", "pickupLocation": "Denver International Airport (DEN)", "returnLocation": "Denver International Airport (DEN)"})[1]
            for token in tokens
        ])
        assert all(result.get("quote") for result in rental_quotes)

        booking_user_count = min(4, USERS, len(rental_lists[0]["cars"]))
        rental_bookings = workload.parallel("rental-book", [
            lambda index=index, token=tokens[index], selected_car=rental_lists[0]["cars"][index]["id"]: workload.call(
                "rental-book", "/api/mobile/rentals/book", method="POST", token=token,
                payload={"carId": selected_car, "days": 7, "pickupDate": pickup_date, "returnDate": return_date, "pickupTime": "10:00 AM", "returnTime": "10:00 AM", "pickupLocation": "Denver International Airport (DEN)", "returnLocation": "Denver International Airport (DEN)"},
            )[1]
            for index in range(booking_user_count)
        ], workers=booking_user_count)
        assert all(result.get("booking") for result in rental_bookings)
        booking_views = workload.parallel("rental-bookings", [
            lambda index=index, token=tokens[index]: workload.call("rental-bookings", "/api/mobile/rentals/bookings", token=token)[1]
            for index in range(booking_user_count)
        ], workers=booking_user_count)
        # Reservations are persisted immediately, but intentionally stay out of
        # the customer Activity/bookings feed until payment confirms them.
        assert all(len(result.get("bookings", [])) == 0 for result in booking_views)

        owner_listing_count = min(10, USERS)
        owner_listings = workload.parallel("rental-owner-list", [
            lambda index=index, token=tokens[index]: workload.call("rental-owner-list", "/api/mobile/rentals/listing", method="POST", token=token, payload={"brand": "Toyota", "model": f"LoadCar {index}", "year": 2024, "category": "Compact", "location": "Denver, CO", "dailyPrice": 45 + index, "seats": 5, "bags": 2, "doors": 4, "licensePlate": f"RENT{index:02d}", "availableFrom": pickup_date, "availableTo": return_date})[1]
            for index in range(owner_listing_count)
        ])
        assert len(owner_listings) == owner_listing_count

        chat_start = USERS // 2
        chat_count = USERS - chat_start
        conversations = workload.parallel("chat-open", [
            lambda index=index, token=tokens[index]: workload.call("chat-open", "/api/chat/conversations", method="POST", token=token, payload={"postId": housing_ids[index - chat_start], "message": f"Housing question from user {index}", "clientMessageId": f"open-{index}"})[1]
            for index in range(chat_start, USERS)
        ])
        conversation_ids = [result["conversation"]["id"] for result in conversations]
        assert len(conversation_ids) == chat_count
        workload.parallel("chat-send", [
            lambda index=index, token=tokens[index], conversation_id=conversation_ids[index - chat_start]: workload.call("chat-send", "/api/chat/messages", method="POST", token=token, form=True, payload={"conversation_id": conversation_id, "message": f"Second concurrent message {index}", "client_message_id": f"second-{index}"})[1]
            for index in range(chat_start, USERS)
        ])

        workload.parallel("push-token", [
            lambda index=index, token=tokens[index]: workload.call("push-token", "/api/mobile/push-token", method="POST", token=token, payload={"token": f"ExponentPushToken[load-{index:02d}]", "platform": "ios" if index % 2 else "android", "deviceLabel": f"Load device {index}", "enabled": True})[1]
            for index in range(USERS)
        ])

        workload.parallel("support-ticket", [
            lambda index=index, token=tokens[index]: workload.call("support-ticket", "/api/mobile/rentals/support-ticket", method="POST", token=token, payload={"topic": "Load test support", "message": f"Routine support validation {index}", "urgent": False})[1]
            for index in range(owner_listing_count)
        ])

        workload.parallel("logout", [lambda token=token: workload.call("logout", "/api/mobile/logout", method="POST", token=token)[1] for token in tokens])
        relogins = workload.parallel("relogin", [
            lambda row=row: workload.call("relogin", "/api/mobile/login", method="POST", payload={"identifier": row["email"], "password": PASSWORD})[1]
            for row in user_rows
        ])
        assert all(result.get("token") for result in relogins)

        with app.db() as con:
            counts = {
                "users": con.execute("SELECT COUNT(*) FROM users WHERE email LIKE 'load.user.%@example.test'").fetchone()[0],
                "sessions": con.execute("SELECT COUNT(*) FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'load.user.%@example.test')").fetchone()[0],
                "housing": con.execute("SELECT COUNT(*) FROM accommodation_posts WHERE title LIKE 'Load housing post %'").fetchone()[0],
                "rides": con.execute("SELECT COUNT(*) FROM ride_posts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'load.user.%@example.test')").fetchone()[0],
                "ownerCars": con.execute("SELECT COUNT(*) FROM cars WHERE listing_source = 'OWNER_LISTING' AND owner_user_id IN (SELECT id FROM users WHERE email LIKE 'load.user.%@example.test')").fetchone()[0],
                "bookings": con.execute("SELECT COUNT(*) FROM bookings WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'load.user.%@example.test')").fetchone()[0],
                "messages": con.execute("SELECT COUNT(*) FROM chat_messages WHERE client_message_id LIKE 'open-%' OR client_message_id LIKE 'second-%'").fetchone()[0],
                "pushTokens": con.execute("SELECT COUNT(*) FROM mobile_push_tokens WHERE token LIKE 'ExponentPushToken[load-%'").fetchone()[0],
                "supportTickets": con.execute("SELECT COUNT(*) FROM support_tickets WHERE topic = 'Load test support'").fetchone()[0],
            }
            integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = con.execute("PRAGMA foreign_key_check").fetchall()
        expected = {
            "users": USERS,
            "sessions": USERS,
            "housing": USERS,
            "rides": USERS,
            "ownerCars": owner_listing_count,
            "bookings": booking_user_count,
            "messages": chat_count * 2,
            "pushTokens": USERS,
            "supportTickets": owner_listing_count,
        }
        assert counts == expected, (counts, expected)
        assert integrity == "ok" and not foreign_keys
        print(json.dumps({"ok": True, "users": USERS, "workers": WORKERS, "counts": counts, "elapsedSeconds": round(time.perf_counter() - started, 2), "timings": workload.report()}, indent=2))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        app.refresh_storage_paths()
        TMP.cleanup()


if __name__ == "__main__":
    main()
