"""Offline carpool listing/search coverage using 200 distinct real city points."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app


CITY_FIXTURE = Path(__file__).with_name("ride_city_points_geonames.tsv")


def hundred_real_city_routes():
    cities = {"US": [], "IN": []}
    for line in CITY_FIXTURE.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        country, name, region, latitude, longitude = line.split("\t")
        label = f"{name}, {region}, USA" if country == "US" else f"{name}, India"
        cities[country].append((label, float(latitude), float(longitude)))
    assert all(len(cities[country]) == 100 for country in ("US", "IN"))
    routes = []
    for country in ("US", "IN"):
        points = cities[country]
        for index in range(50):
            routes.append((country, points[index], points[99 - index]))
    assert len(routes) == 100
    assert len({point[0] for _, start, end in routes for point in (start, end)}) == 200
    return routes


class HundredCityRideListingTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "rides.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Dummy Driver", "hundred-city-driver@example.com", app.hash_password("Password123!")),
            )
            self.driver_id = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])

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

    def test_one_hundred_distinct_listings_save_and_search_correct_routes(self):
        routes = hundred_real_city_routes()
        with app.db() as con:
            for index, (country, start, end) in enumerate(routes):
                con.execute(
                    """INSERT INTO ride_posts
                       (public_id, user_id, ride_type, rider_role, title, origin_label,
                        origin_lat, origin_lng, destination_label, destination_lat,
                        destination_lng, city_label, pickup_date, pickup_time, seats,
                        max_detour_minutes, max_pickup_distance_miles, status)
                       VALUES (?, ?, 'CARPOOL_OFFER', 'DRIVER', ?, ?, ?, ?, ?, ?, ?, ?,
                               '2099-08-02', '8:00 AM', 3, 10, 5, 'ACTIVE')""",
                    (
                        f"TEST-100-CITIES-{index:03d}", self.driver_id,
                        f"Ride offered from {start[0]} to {end[0]}",
                        start[0], start[1], start[2], end[0], end[1], end[2], start[0],
                    ),
                )
            self.assertEqual(con.execute("SELECT count(*) FROM ride_posts").fetchone()[0], 100)

        # Search every saved route through the same function used by the public
        # API. A false country result, missing listing, or renamed endpoint is
        # a regression. Date and route are shared across all 100 dummy offers.
        with patch.object(app, "user_rating_summary", return_value={"average": 0, "count": 0, "label": "New member"}), patch.object(
            app, "accommodation_location_point", side_effect=AssertionError("Selected coordinates must not be broadly regeocoded")
        ):
            for index, (country, start, end) in enumerate(routes):
                expected_id = f"TEST-100-CITIES-{index:03d}"
                with self.subTest(route=expected_id, start=start[0], end=end[0]):
                    listed = app.mobile_ride_posts(ride_public_id=expected_id, limit=1)
                    self.assertEqual([ride["id"] for ride in listed], [expected_id])
                    self.assertEqual((listed[0]["origin"], listed[0]["destination"]), (start[0], end[0]))
                    results = app.mobile_ride_posts(
                        city=start[0], ride_type="CARPOOL_OFFER", origin=start[0],
                        destination=end[0], pickup_date="2099-08-02", limit=30,
                        origin_lat=start[1], origin_lng=start[2],
                        destination_lat=end[1], destination_lng=end[2],
                    )
                    matches = [ride for ride in results if ride["id"] == expected_id]
                    self.assertEqual(len(matches), 1, f"Missing exact offer among {len(results)} search results")
                    self.assertEqual(results[0]["id"], expected_id, "The exact route should rank first")
                    listing = matches[0]
                    self.assertEqual((listing["origin"], listing["destination"]), (start[0], end[0]))
                    self.assertEqual((listing["originLat"], listing["originLng"]), start[1:])
                    self.assertEqual((listing["destinationLat"], listing["destinationLng"]), end[1:])
                    self.assertEqual(listing["currencyCode"], "INR" if country == "IN" else "USD")
                    self.assertTrue(all(ride["origin"].endswith(", India") == (country == "IN") for ride in results))
                    self.assertTrue(all("licensePlate" not in ride and "licenseState" not in ride for ride in results))
                    if index % 5 == 0:
                        reversed_results = app.mobile_ride_posts(
                            city=end[0], ride_type="CARPOOL_OFFER", origin=end[0],
                            destination=start[0], pickup_date="2099-08-02", limit=30,
                            origin_lat=end[1], origin_lng=end[2],
                            destination_lat=start[1], destination_lng=start[2],
                        )
                        self.assertNotIn(expected_id, {ride["id"] for ride in reversed_results})


if __name__ == "__main__":
    unittest.main()
