import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


POINTS = {
    "Denver, CO": {"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903},
    "300 East 17th Ave, Denver, CO": {"label": "300 East 17th Ave, Denver, CO", "lat": 39.7430, "lng": -104.9847},
    "Littleton, CO": {"label": "Littleton, CO", "lat": 39.6133, "lng": -105.0166},
    "Englewood, CO": {"label": "Englewood, CO", "lat": 39.6478, "lng": -104.9878},
    "Aurora, CO": {"label": "Aurora, CO", "lat": 39.7294, "lng": -104.8319},
    "Colorado Springs, CO": {"label": "Colorado Springs, CO", "lat": 38.8339, "lng": -104.8214},
    "Boulder, CO": {"label": "Boulder, CO", "lat": 40.0150, "lng": -105.2705},
    "Fort Collins, CO": {"label": "Fort Collins, CO", "lat": 40.5853, "lng": -105.0844},
    "Cincinnati, OH": {"label": "Cincinnati, OH", "lat": 39.1031, "lng": -84.5120},
    "Miamisburg, OH": {"label": "Miamisburg, OH", "lat": 39.6428, "lng": -84.2866},
    "Miami, Florida": {"label": "Miami, Florida", "lat": 25.7617, "lng": -80.1918},
}


def fake_ride_point(query: str, city: str = "", **_kwargs):
    key = (query or city or "Denver, CO").strip()
    return POINTS.get(key, POINTS.get(city, POINTS["Denver, CO"]))


class RideCarpoolMatchingTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            self.driver_id = self.insert_user(con, "Driver One", "driver-one@example.com")
            self.rider_id = self.insert_user(con, "Rider One", "rider-one@example.com")

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

    def insert_user(self, con, name, email):
        con.execute(
            """
            INSERT INTO users (name, email, password_hash, is_verified)
            VALUES (?, ?, ?, 1)
            """,
            (name, email, app.hash_password("Password123!")),
        )
        return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    def insert_ride(self, con, user_id, ride_type, origin, destination, *, max_detour=35, pickup_distance=20, seats=3, pickup_date="2099-08-02"):
        public_id = app.ride_public_id()
        origin_point = POINTS[origin]
        destination_point = POINTS[destination]
        con.execute(
            """
            INSERT INTO ride_posts
            (public_id, user_id, ride_type, rider_role, title, origin_label, origin_lat, origin_lng,
             destination_label, destination_lat, destination_lng, city_label, pickup_date, pickup_time,
             start_date, end_date, days_of_week, seats, luggage, accessibility, max_detour_minutes,
             max_pickup_distance_miles, departure_flex_minutes, contribution_per_seat, approval_required,
             preferences, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Denver, CO', ?, '8:00 AM',
                    '', '', '', ?, '1 small bag', '', ?, ?, 30, 25, 1, '', '', 'ACTIVE')
            """,
            (
                public_id,
                user_id,
                ride_type,
                app.ride_role_for_type(ride_type),
                f"{origin} to {destination}",
                origin,
                origin_point["lat"],
                origin_point["lng"],
                destination,
                destination_point["lat"],
                destination_point["lng"],
                pickup_date,
                seats,
                max_detour,
                pickup_distance,
            ),
        )
        return con.execute("SELECT * FROM ride_posts WHERE public_id = ?", (public_id,)).fetchone()

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_nearby_same_direction_carpool_offer_matches_with_detour(self, _mock_point):
        with app.db() as con:
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")

        results = app.mobile_ride_posts(
            city="Denver, CO",
            ride_type="CARPOOL_OFFER",
            origin="Littleton, CO",
            destination="Colorado Springs, CO",
            limit=10,
            origin_lat=POINTS["Littleton, CO"]["lat"],
            origin_lng=POINTS["Littleton, CO"]["lng"],
            destination_lat=POINTS["Colorado Springs, CO"]["lat"],
            destination_lng=POINTS["Colorado Springs, CO"]["lng"],
        )

        self.assertEqual(len(results), 1)
        self.assertGreater(results[0]["pickupDistanceMiles"], 0)
        self.assertGreaterEqual(results[0]["routeDeviationMiles"], 0)
        self.assertLessEqual(results[0]["routeDeviationMiles"], app.ride_allowed_detour_miles(results[0]))

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_mid_route_search_is_not_discarded_by_city_text(self, _mock_point):
        with app.db() as con:
            self.insert_ride(
                con,
                self.driver_id,
                "CARPOOL_OFFER",
                "300 East 17th Ave, Denver, CO",
                "Colorado Springs, CO",
                max_detour=100,
                pickup_distance=50,
            )

        with patch.object(app, "google_route_totals", return_value=None):
            results = app.mobile_ride_posts(
                city="Littleton, CO",
                ride_type="CARPOOL_OFFER",
                origin="Littleton, CO",
                destination="Colorado Springs, CO",
                limit=10,
                origin_lat=POINTS["Littleton, CO"]["lat"],
                origin_lng=POINTS["Littleton, CO"]["lng"],
                destination_lat=POINTS["Colorado Springs, CO"]["lat"],
                destination_lng=POINTS["Colorado Springs, CO"]["lng"],
            )

        self.assertEqual(len(results), 1)
        self.assertLessEqual(float(results[0]["routeDeviationMiles"]), 50.0)

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_expired_carpool_offer_stays_visible_but_marked_expired(self, _mock_point):
        with app.db() as con:
            self.insert_ride(
                con,
                self.driver_id,
                "CARPOOL_OFFER",
                "300 East 17th Ave, Denver, CO",
                "Colorado Springs, CO",
                pickup_date="2026-07-01",
            )

        results = app.mobile_ride_posts(
            city="Denver, CO",
            ride_type="CARPOOL_OFFER",
            origin="Littleton, CO",
            destination="Colorado Springs, CO",
            limit=10,
            origin_lat=POINTS["Littleton, CO"]["lat"],
            origin_lng=POINTS["Littleton, CO"]["lng"],
            destination_lat=POINTS["Colorado Springs, CO"]["lat"],
            destination_lng=POINTS["Colorado Springs, CO"]["lng"],
        )

        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["isExpired"])
        self.assertEqual(results[0]["status"], "EXPIRED")

    def test_combined_detour_limit_is_capped_at_fifty_miles(self):
        self.assertEqual(
            app.ride_allowed_detour_miles({"maxDetourMinutes": 500, "maxPickupDistanceMiles": 200}),
            50.0,
        )

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_unrelated_destination_does_not_match_carpool_offer(self, _mock_point):
        with app.db() as con:
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")

        results = app.mobile_ride_posts(
            city="Denver, CO",
            ride_type="CARPOOL_OFFER",
            origin="Denver, CO",
            destination="Boulder, CO",
            limit=10,
            origin_lat=POINTS["Denver, CO"]["lat"],
            origin_lng=POINTS["Denver, CO"]["lng"],
            destination_lat=POINTS["Boulder, CO"]["lat"],
            destination_lng=POINTS["Boulder, CO"]["lng"],
        )

        self.assertEqual(results, [])

    def test_miami_is_not_resolved_as_miamisburg_or_matched_to_ohio_offer(self):
        miami = app.accommodation_location_point("Miami, Florida", allow_refresh=False)
        miamisburg = app.accommodation_location_point("Miamisburg, OH", allow_refresh=False)
        self.assertGreater(
            app.distance_miles_between(miami["lat"], miami["lng"], miamisburg["lat"], miamisburg["lng"]),
            900,
        )

        with app.db() as con:
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "Denver, CO", "Miamisburg, OH")

        # Reproduce the bad client coordinate shown in the UI: the label says
        # Miami, Florida, while the supplied coordinate points to Miamisburg.
        results = app.mobile_ride_posts(
            city="Denver, CO",
            ride_type="CARPOOL_OFFER",
            origin="Littleton, CO",
            destination="Miami, Florida",
            limit=10,
            origin_lat=POINTS["Littleton, CO"]["lat"],
            origin_lng=POINTS["Littleton, CO"]["lng"],
            destination_lat=POINTS["Miamisburg, OH"]["lat"],
            destination_lng=POINTS["Miamisburg, OH"]["lng"],
        )

        self.assertEqual(results, [])

    def test_dispatch_notification_stores_pickup_and_detour_metrics(self):
        with app.db() as con:
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            request = self.insert_ride(con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO")

            with patch.object(app, "google_route_totals", return_value=None):
                dispatch = app.create_ride_dispatch_notifications(con, request, self.rider_id)
            notification = con.execute("SELECT * FROM ride_dispatch_notifications").fetchone()

        self.assertEqual(dispatch["notifiedCount"], 1)
        self.assertEqual(dispatch["nearestRadius"], 10)
        self.assertIsNotNone(notification)
        self.assertGreater(notification["distance_miles"], 0)
        self.assertGreaterEqual(notification["route_deviation_miles"], 0)
        self.assertGreaterEqual(notification["route_deviation_minutes"], 0)

    @patch.object(app, "google_route_totals")
    def test_route_metrics_use_google_driving_detour_when_available(self, mock_route):
        mock_route.side_effect = [(100.0, 100), (108.0, 116)]
        row = {
            "originLat": POINTS["Denver, CO"]["lat"],
            "originLng": POINTS["Denver, CO"]["lng"],
            "destinationLat": POINTS["Colorado Springs, CO"]["lat"],
            "destinationLng": POINTS["Colorado Springs, CO"]["lng"],
        }

        metrics = app.ride_route_match_metrics(
            row,
            POINTS["Littleton, CO"],
            POINTS["Colorado Springs, CO"],
        )

        self.assertEqual(metrics["routeDeviationMiles"], 8.0)
        self.assertEqual(metrics["routeDeviationMinutes"], 16)
        self.assertEqual(metrics["routeDeviationSource"], "GOOGLE_DIRECTIONS")

    @patch.object(app, "google_route_totals")
    def test_ride_search_does_not_call_google_directions_per_candidate(self, mock_route):
        with app.db() as con:
            for _ in range(12):
                self.insert_ride(
                    con,
                    self.driver_id,
                    "CARPOOL_OFFER",
                    "Denver, CO",
                    "Colorado Springs, CO",
                    max_detour=50,
                    pickup_distance=50,
                )

        results = app.mobile_ride_posts(
            city="Denver, CO",
            ride_type="CARPOOL_OFFER",
            origin="Littleton, CO",
            destination="Colorado Springs, CO",
            limit=30,
            origin_lat=POINTS["Littleton, CO"]["lat"],
            origin_lng=POINTS["Littleton, CO"]["lng"],
            destination_lat=POINTS["Colorado Springs, CO"]["lat"],
            destination_lng=POINTS["Colorado Springs, CO"]["lng"],
        )

        self.assertTrue(results)
        mock_route.assert_not_called()
        self.assertTrue(all(item["routeDeviationSource"] == "ESTIMATE" for item in results))

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_bulk_matching_keeps_same_route_and_filters_false_routes(self, _mock_point):
        with app.db() as con:
            for index in range(50):
                destination = "Colorado Springs, CO" if index < 35 else "Boulder, CO"
                self.insert_ride(
                    con,
                    self.driver_id,
                    "CARPOOL_OFFER",
                    "300 East 17th Ave, Denver, CO",
                    destination,
                    max_detour=40,
                    pickup_distance=25,
                )

        same_route_queries = ["Littleton, CO", "Englewood, CO", "Denver, CO"]
        with patch.object(app, "google_route_totals", return_value=None):
            for origin in same_route_queries:
                results = app.mobile_ride_posts(
                    city="Denver, CO",
                    ride_type="CARPOOL_OFFER",
                    origin=origin,
                    destination="Colorado Springs, CO",
                    limit=50,
                    origin_lat=POINTS[origin]["lat"],
                    origin_lng=POINTS[origin]["lng"],
                    destination_lat=POINTS["Colorado Springs, CO"]["lat"],
                    destination_lng=POINTS["Colorado Springs, CO"]["lng"],
                )
                self.assertTrue(results)
                self.assertTrue(all("Colorado Springs" in item["destination"] for item in results))

            false_results = app.mobile_ride_posts(
                city="Denver, CO",
                ride_type="CARPOOL_OFFER",
                origin="Denver, CO",
                destination="Fort Collins, CO",
                limit=50,
                origin_lat=POINTS["Denver, CO"]["lat"],
                origin_lng=POINTS["Denver, CO"]["lng"],
                destination_lat=POINTS["Fort Collins, CO"]["lat"],
                destination_lng=POINTS["Fort Collins, CO"]["lng"],
            )
        self.assertTrue(all("Colorado Springs" not in item["destination"] for item in false_results))

    @patch.object(app, "ride_point", side_effect=fake_ride_point)
    def test_fifty_driver_listings_and_fifty_rider_searches_respect_route_detour(self, _mock_point):
        with app.db() as con:
            driver_ids = [
                self.insert_user(con, f"Driver {index}", f"driver-{index}@example.com")
                for index in range(50)
            ]
            rider_ids = [
                self.insert_user(con, f"Rider {index}", f"rider-{index}@example.com")
                for index in range(50)
            ]
            for index, driver_id in enumerate(driver_ids):
                if index < 30:
                    origin, destination = "300 East 17th Ave, Denver, CO", "Colorado Springs, CO"
                elif index < 40:
                    origin, destination = "Englewood, CO", "Colorado Springs, CO"
                elif index < 45:
                    origin, destination = "Denver, CO", "Boulder, CO"
                else:
                    origin, destination = "Denver, CO", "Fort Collins, CO"
                self.insert_ride(
                    con,
                    driver_id,
                    "CARPOOL_OFFER",
                    origin,
                    destination,
                    max_detour=45,
                    pickup_distance=30,
                )

        same_route_origins = ["Denver, CO", "Littleton, CO", "Englewood, CO"]
        false_route_destinations = ["Boulder, CO", "Fort Collins, CO"]
        with patch.object(app, "google_route_totals", return_value=None):
            for index in range(50):
                rider_origin = same_route_origins[index % len(same_route_origins)]
                if index < 40:
                    rider_destination = "Colorado Springs, CO"
                    results = app.mobile_ride_posts(
                        city="Denver, CO",
                        ride_type="CARPOOL_OFFER",
                        origin=rider_origin,
                        destination=rider_destination,
                        limit=80,
                        origin_lat=POINTS[rider_origin]["lat"],
                        origin_lng=POINTS[rider_origin]["lng"],
                        destination_lat=POINTS[rider_destination]["lat"],
                        destination_lng=POINTS[rider_destination]["lng"],
                    )
                    self.assertTrue(results, f"expected matches for rider {rider_ids[index]} from {rider_origin}")
                    self.assertTrue(all("Colorado Springs" in item["destination"] for item in results))
                    self.assertTrue(all(float(item["routeDeviationMiles"]) <= app.ride_allowed_detour_miles(item) for item in results))
                else:
                    rider_destination = false_route_destinations[index % len(false_route_destinations)]
                    results = app.mobile_ride_posts(
                        city="Denver, CO",
                        ride_type="CARPOOL_OFFER",
                        origin=rider_origin,
                        destination=rider_destination,
                        limit=80,
                        origin_lat=POINTS[rider_origin]["lat"],
                        origin_lng=POINTS[rider_origin]["lng"],
                        destination_lat=POINTS[rider_destination]["lat"],
                        destination_lng=POINTS[rider_destination]["lng"],
                    )
                    self.assertTrue(all("Colorado Springs" not in item["destination"] for item in results))

    @patch.object(app, "send_mobile_push_for_users")
    def test_accept_decline_status_and_pickup_pin_flow(self, mock_push):
        with app.db() as con:
            second_driver_id = self.insert_user(con, "Driver Two", "driver-two@example.com")
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            self.insert_ride(con, second_driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            request = self.insert_ride(con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO")
            with patch.object(app, "google_route_totals", return_value=None):
                dispatch = app.create_ride_dispatch_notifications(con, request, self.rider_id)
            request_public_id = request["public_id"]
            notifications = con.execute(
                "SELECT * FROM ride_dispatch_notifications ORDER BY driver_user_id"
            ).fetchall()

        self.assertEqual(dispatch["notifiedCount"], 2)
        self.assertEqual(set(dispatch["driverUserIds"]), {self.driver_id, second_driver_id})
        self.assertEqual(len(notifications), 2)
        first_driver = int(notifications[0]["driver_user_id"])
        second_driver = int(notifications[1]["driver_user_id"])

        status_code, declined = app.apply_ride_dispatch_action(first_driver, request_public_id, "DECLINE")
        self.assertEqual(status_code, 200)
        self.assertEqual(declined["ride"]["dispatchStatus"], "DECLINED")
        self.assertEqual(mock_push.call_args.args[0], [self.rider_id])
        self.assertEqual(mock_push.call_args.args[3]["status"], "DECLINED")

        status_code, accepted = app.apply_ride_dispatch_action(second_driver, request_public_id, "ACCEPT")
        self.assertEqual(status_code, 200)
        self.assertEqual(accepted["ride"]["dispatchStatus"], "ACCEPTED")
        self.assertRegex(accepted["ride"]["pickupPin"], r"^\d{4}$")
        self.assertGreaterEqual(accepted["ride"]["routeDeviationMinutes"], 0)
        self.assertEqual(mock_push.call_args.args[3]["status"], "ACCEPTED")

        with app.db() as con:
            statuses = {
                int(row["driver_user_id"]): row["status"]
                for row in con.execute("SELECT driver_user_id, status FROM ride_dispatch_notifications").fetchall()
            }
            request_status = con.execute("SELECT status FROM ride_posts WHERE public_id = ?", (request_public_id,)).fetchone()["status"]
        self.assertEqual(statuses[first_driver], "DECLINED")
        self.assertEqual(statuses[second_driver], "ACCEPTED")
        self.assertEqual(request_status, "ACCEPTED")

        for action, expected in (("EN_ROUTE", "EN_ROUTE"), ("ARRIVED", "ARRIVED"), ("COMPLETED", "COMPLETED")):
            status_code, response = app.apply_ride_dispatch_action(second_driver, request_public_id, action)
            self.assertEqual(status_code, 200)
            self.assertEqual(response["ride"]["dispatchStatus"], expected)
            self.assertRegex(response["ride"]["pickupPin"], r"^\d{4}$")
            self.assertEqual(mock_push.call_args.args[3]["status"], expected)

        status_code, response = app.apply_ride_dispatch_action(second_driver, request_public_id, "DECLINE")
        self.assertEqual(status_code, 409)
        self.assertIn("Cannot change ride request", response["error"])
        self.assertEqual(mock_push.call_count, 5)


if __name__ == "__main__":
    unittest.main()
