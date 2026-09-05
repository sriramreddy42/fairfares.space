import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import app


class QuietHandler(app.FairFaresHandler):
    suppress_operational_alerts = True

    def log_message(self, _format, *_args):
        return


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
    "Hyderabad, Telangana, India": {"label": "Hyderabad, Telangana, India", "lat": 17.3850, "lng": 78.4867},
    "Guntur, Andhra Pradesh, India": {"label": "Guntur, Andhra Pradesh, India", "lat": 16.3067, "lng": 80.4365},
    "Nellore, Andhra Pradesh, India": {"label": "Nellore, Andhra Pradesh, India", "lat": 14.4426, "lng": 79.9865},
    "Chennai, Tamil Nadu, India": {"label": "Chennai, Tamil Nadu, India", "lat": 13.0827, "lng": 80.2707},
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

    def request_json(self, server, method, path, token="", payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_specific_ride_label_is_not_replaced_by_country_fallback(self):
        self.assertEqual(
            app.ride_display_label(
                "Hyderabad, Telangana, India",
                {"label": "United States", "lat": 17.3850, "lng": 78.4867},
                "Dayton, OH",
            ),
            "Hyderabad, Telangana, India",
        )
        self.assertEqual(
            app.ride_display_label(
                "Chennai, Tamil Nadu, India",
                {"label": "United States", "lat": 13.0827, "lng": 80.2707},
                "Dayton, OH",
            ),
            "Chennai, Tamil Nadu, India",
        )

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

    def test_long_interstate_search_keeps_valid_intermediate_city_corridor(self):
        denver = {"lat": 39.7392, "lng": -104.9903}
        nashville = {"lat": 36.1627, "lng": -86.7816}
        denver_to_huntsville = {
            "origin_lat": denver["lat"],
            "origin_lng": denver["lng"],
            "destination_lat": 34.7304,
            "destination_lng": -86.5861,
            "max_detour_minutes": 35,
            "max_pickup_distance_miles": 20,
        }

        metrics = app.ride_route_match_metrics(
            denver_to_huntsville,
            denver,
            nashville,
            allow_google=False,
        )

        self.assertGreater(metrics["routeDeviationMiles"], app.ride_allowed_detour_miles(denver_to_huntsville))
        self.assertTrue(app.ride_route_match_is_valid(denver_to_huntsville, metrics))

    def test_hyderabad_chennai_search_keeps_mid_route_towns_for_road_verification(self):
        hyderabad_to_chennai = {
            "origin_lat": 17.3850,
            "origin_lng": 78.4867,
            "destination_lat": 13.0827,
            "destination_lng": 80.2707,
            "max_detour_minutes": 100,
            "max_pickup_distance_miles": 50,
        }

        # Guntur -> Nellore is a same-direction, midway request. Its fast
        # straight-line detour is slightly above the driver's configured limit
        # because the intercity corridor bends, so search must retain it for
        # road-route verification instead of hiding it.
        midway_metrics = app.ride_route_match_metrics(
            hyderabad_to_chennai,
            {"lat": 16.3067, "lng": 80.4365},
            {"lat": 14.4426, "lng": 79.9865},
            allow_google=False,
        )
        self.assertGreater(midway_metrics["routeDeviationMiles"], app.ride_allowed_detour_miles(hyderabad_to_chennai))
        self.assertTrue(app.ride_route_match_is_valid(hyderabad_to_chennai, midway_metrics))

        # Warangal -> Chennai is well outside the provisional corridor and must
        # not be admitted merely because it travels in a similar direction.
        off_corridor_metrics = app.ride_route_match_metrics(
            hyderabad_to_chennai,
            {"lat": 17.9689, "lng": 79.5941},
            {"lat": 13.0827, "lng": 80.2707},
            allow_google=False,
        )
        self.assertFalse(app.ride_route_match_is_valid(hyderabad_to_chennai, off_corridor_metrics))

    def test_hyderabad_chennai_database_search_returns_midway_request(self):
        with app.db() as con:
            offer = self.insert_ride(
                con,
                self.driver_id,
                "CARPOOL_OFFER",
                "Hyderabad, Telangana, India",
                "Chennai, Tamil Nadu, India",
                max_detour=100,
                pickup_distance=50,
            )

        def india_point(query, _city="", **_kwargs):
            return POINTS.get(query, {})

        with patch.object(app, "accommodation_location_point", side_effect=india_point):
            results = app.mobile_ride_posts(
                city="Hyderabad, Telangana, India",
                ride_type="CARPOOL_OFFER",
                origin="Guntur, Andhra Pradesh, India",
                destination="Nellore, Andhra Pradesh, India",
                origin_lat=POINTS["Guntur, Andhra Pradesh, India"]["lat"],
                origin_lng=POINTS["Guntur, Andhra Pradesh, India"]["lng"],
                destination_lat=POINTS["Nellore, Andhra Pradesh, India"]["lat"],
                destination_lng=POINTS["Nellore, Andhra Pradesh, India"]["lng"],
            )

        self.assertEqual([item["id"] for item in results], [offer["public_id"]])
        self.assertEqual(results[0]["routeDeviationSource"], "ROAD_ROUTE_PENDING")

    def test_hyderabad_chennai_dispatch_uses_real_road_detour(self):
        with app.db() as con:
            self.insert_ride(
                con,
                self.driver_id,
                "CARPOOL_OFFER",
                "Hyderabad, Telangana, India",
                "Chennai, Tamil Nadu, India",
                max_detour=100,
                pickup_distance=50,
            )
            request = self.insert_ride(
                con,
                self.rider_id,
                "CARPOOL_REQUEST",
                "Guntur, Andhra Pradesh, India",
                "Nellore, Andhra Pradesh, India",
                max_detour=50,
                pickup_distance=50,
            )

            def road_totals(points):
                return (390.0, 480) if len(points) == 2 else (405.0, 510)

            with patch.object(app, "google_route_totals", side_effect=road_totals):
                dispatch = app.create_ride_dispatch_notifications(con, request, self.rider_id)

        self.assertEqual(dispatch["notifiedCount"], 1)
        self.assertEqual(dispatch["nearestRadius"], 20)
        self.assertEqual(dispatch["driverDetours"][self.driver_id]["miles"], 15.0)
        self.assertEqual(dispatch["driverDetours"][self.driver_id]["minutes"], 30)

    def test_us_interstate_midway_search_and_safety_filters_remain_correct(self):
        denver_to_dayton = {
            "origin_lat": 39.7392,
            "origin_lng": -104.9903,
            "destination_lat": 39.7589,
            "destination_lng": -84.1916,
            "max_detour_minutes": 35,
            "max_pickup_distance_miles": 20,
        }
        cases = (
            ("Kansas City to St Louis", (39.0997, -94.5786), (38.6270, -90.1994), True),
            ("St Louis to Indianapolis", (38.6270, -90.1994), (39.7684, -86.1581), True),
            ("Indianapolis to Dayton", (39.7684, -86.1581), (39.7589, -84.1916), True),
            ("reverse Dayton to Denver", (39.7589, -84.1916), (39.7392, -104.9903), False),
            ("Nashville to Dayton", (36.1627, -86.7816), (39.7589, -84.1916), False),
            ("Denver to Dallas", (39.7392, -104.9903), (32.7767, -96.7970), False),
        )

        for name, origin, destination, expected in cases:
            with self.subTest(name=name):
                metrics = app.ride_route_match_metrics(
                    denver_to_dayton,
                    {"lat": origin[0], "lng": origin[1]},
                    {"lat": destination[0], "lng": destination[1]},
                    allow_google=False,
                )
                self.assertEqual(app.ride_route_match_is_valid(denver_to_dayton, metrics), expected, metrics)

    @patch.object(app, "google_route_totals")
    def test_us_interstate_final_match_still_obeys_road_detour(self, mock_routes):
        denver_to_dayton = {
            "origin_lat": 39.7392,
            "origin_lng": -104.9903,
            "destination_lat": 39.7589,
            "destination_lng": -84.1916,
            "max_detour_minutes": 35,
            "max_pickup_distance_miles": 20,
        }
        kansas_city = {"lat": 39.0997, "lng": -94.5786}
        st_louis = {"lat": 38.6270, "lng": -90.1994}

        mock_routes.side_effect = [(1150.0, 1000), (1162.0, 1024)]
        valid_metrics = app.ride_route_match_metrics(denver_to_dayton, kansas_city, st_louis)
        self.assertEqual(valid_metrics["routeDeviationSource"], "GOOGLE_DIRECTIONS")
        self.assertEqual(valid_metrics["routeDeviationMiles"], 12.0)
        self.assertTrue(app.ride_route_match_is_valid(denver_to_dayton, valid_metrics))

        mock_routes.side_effect = [(1150.0, 1000), (1195.0, 1090)]
        excessive_metrics = app.ride_route_match_metrics(denver_to_dayton, kansas_city, st_louis)
        self.assertEqual(excessive_metrics["routeDeviationMiles"], 45.0)
        self.assertFalse(app.ride_route_match_is_valid(denver_to_dayton, excessive_metrics))

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

    @patch.object(app, "google_route_totals", return_value=None)
    def test_large_route_search_keeps_older_valid_offers_and_excludes_unavailable_routes(self, _mock_routes):
        with app.db() as con:
            valid_ids = []
            for _ in range(40):
                valid_ids.append(str(self.insert_ride(
                    con,
                    self.driver_id,
                    "CARPOOL_OFFER",
                    "300 East 17th Ave, Denver, CO",
                    "Colorado Springs, CO",
                    max_detour=50,
                    pickup_distance=50,
                    seats=3,
                    pickup_date="2099-08-02",
                )["public_id"]))
            # These newer rows previously filled the 250-candidate window and
            # prevented every valid older offer from being evaluated.
            for _ in range(320):
                self.insert_ride(
                    con,
                    self.driver_id,
                    "CARPOOL_OFFER",
                    "Denver, CO",
                    "Boulder, CO",
                    max_detour=10,
                    pickup_distance=10,
                    seats=3,
                    pickup_date="2099-08-02",
                )
            zero_seat_id = str(self.insert_ride(
                con, self.driver_id, "CARPOOL_OFFER", "Denver, CO", "Colorado Springs, CO",
                max_detour=50, pickup_distance=50, seats=0, pickup_date="2099-08-02",
            )["public_id"])
            wrong_date_id = str(self.insert_ride(
                con, self.driver_id, "CARPOOL_OFFER", "Denver, CO", "Colorado Springs, CO",
                max_detour=50, pickup_distance=50, seats=3, pickup_date="2099-08-03",
            )["public_id"])
            reverse_id = str(self.insert_ride(
                con, self.driver_id, "CARPOOL_OFFER", "Colorado Springs, CO", "Denver, CO",
                max_detour=50, pickup_distance=50, seats=3, pickup_date="2099-08-02",
            )["public_id"])

        query = {
            "city": "Denver, CO",
            "ride_type": "CARPOOL_OFFER",
            "origin": "Littleton, CO",
            "destination": "Colorado Springs, CO",
            "pickup_date": "2099-08-02",
            "limit": 20,
            "origin_lat": POINTS["Littleton, CO"]["lat"],
            "origin_lng": POINTS["Littleton, CO"]["lng"],
            "destination_lat": POINTS["Colorado Springs, CO"]["lat"],
            "destination_lng": POINTS["Colorado Springs, CO"]["lng"],
        }
        first_page = app.mobile_ride_posts(**query)
        second_page = app.mobile_ride_posts(**query, offset=20)
        first_ids = [item["id"] for item in first_page]
        second_ids = [item["id"] for item in second_page]
        returned_ids = set(first_ids + second_ids)

        self.assertEqual(returned_ids, set(valid_ids))
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertNotIn(zero_seat_id, returned_ids)
        self.assertNotIn(wrong_date_id, returned_ids)
        self.assertNotIn(reverse_id, returned_ids)
        self.assertTrue(all(item["seats"] > 0 for item in first_page + second_page))
        self.assertTrue(all(item["pickupDate"] == "2099-08-02" for item in first_page + second_page))
        self.assertTrue(all(item["directionCompatible"] for item in first_page + second_page))

        expected_first_ids = first_ids
        with ThreadPoolExecutor(max_workers=12) as executor:
            repeated = list(executor.map(lambda _: app.mobile_ride_posts(**query), range(36)))
        self.assertTrue(all([item["id"] for item in batch] == expected_first_ids for batch in repeated))

    @patch.object(app, "send_mobile_push_for_users")
    def test_accept_decline_status_and_pickup_pin_flow(self, mock_push):
        with app.db() as con:
            second_driver_id = self.insert_user(con, "Driver Two", "driver-two@example.com")
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            accepted_driver_offer = self.insert_ride(con, second_driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            con.execute(
                """
                INSERT INTO ride_driver_profiles
                (user_id, vehicle_make_model, vehicle_year, vehicle_color, license_plate, license_state,
                 insurance_provider, insurance_policy_last4, service_types, availability_days,
                 availability_start_time, availability_end_time, seat_count, luggage_space,
                 max_detour_minutes, max_pickup_distance_miles, review_status)
                VALUES (?, 'Toyota Camry', '2024', 'Blue', 'LOAD02', 'CO',
                        'State Farm', '4002', 'CARPOOL_OFFER', 'Mon,Tue,Wed,Thu,Fri',
                        '7:00 AM', '7:00 PM', 4, '1 small bag', 25, 15, 'APPROVED')
                """,
                (second_driver_id,),
            )
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
        self.assertEqual(accepted["ride"]["origin"], "Littleton, CO")
        self.assertEqual(accepted["ride"]["destination"], "Colorado Springs, CO")
        self.assertAlmostEqual(accepted["ride"]["originLat"], POINTS["Littleton, CO"]["lat"], places=4)
        self.assertAlmostEqual(accepted["ride"]["originLng"], POINTS["Littleton, CO"]["lng"], places=4)
        self.assertAlmostEqual(accepted["ride"]["destinationLat"], POINTS["Colorado Springs, CO"]["lat"], places=4)
        self.assertAlmostEqual(accepted["ride"]["destinationLng"], POINTS["Colorado Springs, CO"]["lng"], places=4)
        self.assertEqual(accepted["ride"]["matchedRideId"], accepted_driver_offer["public_id"])
        self.assertEqual(accepted["ride"]["matchedRouteOrigin"], "300 East 17th Ave, Denver, CO")
        self.assertEqual(accepted["ride"]["matchedRouteDestination"], "Colorado Springs, CO")
        self.assertAlmostEqual(accepted["ride"]["matchedRouteOriginLat"], POINTS["300 East 17th Ave, Denver, CO"]["lat"], places=4)
        self.assertAlmostEqual(accepted["ride"]["matchedRouteOriginLng"], POINTS["300 East 17th Ave, Denver, CO"]["lng"], places=4)
        self.assertAlmostEqual(accepted["ride"]["matchedRouteDestinationLat"], POINTS["Colorado Springs, CO"]["lat"], places=4)
        self.assertAlmostEqual(accepted["ride"]["matchedRouteDestinationLng"], POINTS["Colorado Springs, CO"]["lng"], places=4)
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
            self.assertEqual(response["ride"]["origin"], "Littleton, CO")
            self.assertEqual(response["ride"]["destination"], "Colorado Springs, CO")
            self.assertEqual(mock_push.call_args.args[3]["status"], expected)
            if expected == "ARRIVED":
                self.assertIn("Vehicle: CO LOAD02.", mock_push.call_args.args[2])
            with app.db() as con:
                active_location_row = con.execute(
                    """
                    SELECT driver_lat, driver_lng, driver_location_updated_at
                    FROM ride_dispatch_notifications notifications
                    JOIN ride_posts requests ON requests.id = notifications.request_ride_post_id
                    WHERE requests.public_id = ?
                      AND notifications.driver_user_id = ?
                      AND notifications.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED')
                      AND requests.user_id = ?
                    LIMIT 1
                    """,
                    (request_public_id, second_driver, self.rider_id),
                ).fetchone()
            if expected in {"EN_ROUTE", "ARRIVED"}:
                self.assertIsNotNone(active_location_row)
                with app.db() as con:
                    con.execute(
                        """
                        UPDATE ride_dispatch_notifications
                        SET driver_lat = ?, driver_lng = ?, driver_location_updated_at = CURRENT_TIMESTAMP
                        WHERE request_ride_post_id = (SELECT id FROM ride_posts WHERE public_id = ?)
                          AND driver_user_id = ?
                        """,
                        (39.7001, -104.9002, request_public_id, second_driver),
                    )
                    rider_visible_location = con.execute(
                        """
                        SELECT driver_lat, driver_lng, driver_location_updated_at
                        FROM ride_dispatch_notifications notifications
                        JOIN ride_posts requests ON requests.id = notifications.request_ride_post_id
                        WHERE requests.public_id = ?
                          AND notifications.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED')
                          AND requests.user_id = ?
                        LIMIT 1
                        """,
                        (request_public_id, self.rider_id),
                    ).fetchone()
                self.assertIsNotNone(rider_visible_location)
                self.assertAlmostEqual(float(rider_visible_location["driver_lat"]), 39.7001, places=4)
                self.assertAlmostEqual(float(rider_visible_location["driver_lng"]), -104.9002, places=4)
                self.assertTrue(rider_visible_location["driver_location_updated_at"])
            else:
                self.assertIsNone(active_location_row)

        status_code, response = app.apply_ride_dispatch_action(second_driver, request_public_id, "DECLINE")
        self.assertEqual(status_code, 409)
        self.assertIn("Cannot change ride request", response["error"])
        self.assertEqual(mock_push.call_count, 5)

    @patch.object(app, "send_mobile_push_for_users")
    def test_rider_can_fetch_live_driver_location_through_mobile_api(self, _mock_push):
        driver_token = "driver-location-token"
        rider_token = "rider-location-token"
        outsider_token = "outsider-location-token"
        with app.db() as con:
            outsider_id = self.insert_user(con, "Outsider", "outsider-location@example.com")
            con.executemany(
                "INSERT INTO sessions (token, user_id) VALUES (?, ?)",
                ((driver_token, self.driver_id), (rider_token, self.rider_id), (outsider_token, outsider_id)),
            )
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            request = self.insert_ride(con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO")
            with patch.object(app, "google_route_totals", return_value=None):
                app.create_ride_dispatch_notifications(con, request, self.rider_id)
            request_public_id = request["public_id"]

        self.assertEqual(app.apply_ride_dispatch_action(self.driver_id, request_public_id, "ACCEPT")[0], 200)
        self.assertEqual(app.apply_ride_dispatch_action(self.driver_id, request_public_id, "EN_ROUTE")[0], 200)

        server = app.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            status, pending = self.request_json(server, "GET", f"/api/mobile/rides/driver-location?rideId={request_public_id}", rider_token)
            self.assertEqual(status, 200)
            self.assertFalse(pending["available"])
            self.assertEqual(pending["status"], "EN_ROUTE")

            status, updated = self.request_json(
                server,
                "POST",
                "/api/mobile/rides/driver-location",
                driver_token,
                {"rideId": request_public_id, "latitude": 39.7001, "longitude": -104.9002},
            )
            self.assertEqual(status, 200)
            self.assertEqual(updated["location"]["status"], "EN_ROUTE")

            status, visible = self.request_json(server, "GET", f"/api/mobile/rides/driver-location?rideId={request_public_id}", rider_token)
            self.assertEqual(status, 200)
            self.assertTrue(visible["available"])
            self.assertAlmostEqual(visible["location"]["latitude"], 39.7001, places=4)
            self.assertAlmostEqual(visible["location"]["longitude"], -104.9002, places=4)
            self.assertIn("ageSeconds", visible["location"])

            status, blocked = self.request_json(server, "GET", f"/api/mobile/rides/driver-location?rideId={request_public_id}", outsider_token)
            self.assertEqual(status, 404)
            self.assertFalse(blocked["ok"])

            self.assertEqual(app.apply_ride_dispatch_action(self.driver_id, request_public_id, "ARRIVED")[0], 200)
            status, arrived_visible = self.request_json(server, "GET", f"/api/mobile/rides/driver-location?rideId={request_public_id}", rider_token)
            self.assertEqual(status, 200)
            self.assertTrue(arrived_visible["available"])
            self.assertEqual(arrived_visible["status"], "ARRIVED")

            self.assertEqual(app.apply_ride_dispatch_action(self.driver_id, request_public_id, "COMPLETED")[0], 200)
            status, completed = self.request_json(server, "GET", f"/api/mobile/rides/driver-location?rideId={request_public_id}", rider_token)
            self.assertEqual(status, 404)
            self.assertFalse(completed["ok"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    @patch.object(app, "google_route_totals", return_value=None)
    def test_dispatch_notifies_only_drivers_travelling_on_request_date(self, _mock_routes):
        with app.db() as con:
            matching_driver = self.insert_ride(
                con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO",
                pickup_date="2099-08-02",
            )
            other_driver_id = self.insert_user(con, "Other Date Driver", "other-date@example.com")
            self.insert_ride(
                con, other_driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO",
                pickup_date="2099-08-03",
            )
            request = self.insert_ride(
                con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO",
                pickup_date="2099-08-02",
            )
            dispatch = app.create_ride_dispatch_notifications(con, request, self.rider_id)
            notified_offer_ids = {
                int(row["driver_ride_post_id"])
                for row in con.execute("SELECT driver_ride_post_id FROM ride_dispatch_notifications").fetchall()
            }

        self.assertEqual(dispatch["driverUserIds"], [self.driver_id])
        self.assertEqual(notified_offer_ids, {int(matching_driver["id"])})

    @patch.object(app, "google_route_totals", return_value=None)
    def test_new_offer_back_matches_existing_request(self, _mock_routes):
        with app.db() as con:
            request = self.insert_ride(
                con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO",
                pickup_date="2099-08-02",
            )
            offer = self.insert_ride(
                con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO",
                pickup_date="2099-08-02",
            )
            matched = app.create_dispatch_for_ride_offer(con, offer)
            notification = con.execute(
                "SELECT * FROM ride_dispatch_notifications WHERE request_ride_post_id = ? AND driver_ride_post_id = ?",
                (int(request["id"]), int(offer["id"])),
            ).fetchone()

        self.assertEqual(matched, 1)
        self.assertIsNotNone(notification)
        self.assertEqual(int(notification["driver_user_id"]), self.driver_id)

    @patch.object(app, "google_accommodation_place_suggestions", return_value=[])
    def test_missing_carpool_city_does_not_fall_back_to_denver(self, _mock_places):
        suggestions = app.ride_place_suggestions("", "unin", limit=10)
        self.assertFalse(any("denver" in str(item.get("label") or "").lower() for item in suggestions))

    @patch.object(app, "send_mobile_push_for_users")
    def test_concurrent_driver_acceptance_has_exactly_one_winner(self, _mock_push):
        with app.db() as con:
            second_driver_id = self.insert_user(con, "Driver Two", "driver-two-race@example.com")
            self.insert_ride(con, self.driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            self.insert_ride(con, second_driver_id, "CARPOOL_OFFER", "300 East 17th Ave, Denver, CO", "Colorado Springs, CO")
            request = self.insert_ride(con, self.rider_id, "CARPOOL_REQUEST", "Littleton, CO", "Colorado Springs, CO")
            with patch.object(app, "google_route_totals", return_value=None):
                app.create_ride_dispatch_notifications(con, request, self.rider_id)
            public_id = str(request["public_id"])

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(
                lambda driver_id: app.apply_ride_dispatch_action(driver_id, public_id, "ACCEPT"),
                (self.driver_id, second_driver_id),
            ))

        self.assertEqual([status for status, _ in results].count(200), 1)
        self.assertEqual([status for status, _ in results].count(409), 1)
        with app.db() as con:
            accepted = con.execute(
                "SELECT COUNT(*) FROM ride_dispatch_notifications WHERE request_ride_post_id = ? AND status = 'ACCEPTED'",
                (int(request["id"]),),
            ).fetchone()[0]
        self.assertEqual(accepted, 1)


if __name__ == "__main__":
    unittest.main()
