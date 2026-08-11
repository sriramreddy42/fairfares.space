import unittest

import app


ROUTES = (
    ("Denver-Dayton", (39.7392, -104.9903), (39.7589, -84.1916)),
    ("San Francisco-Los Angeles", (37.7749, -122.4194), (34.0522, -118.2437)),
    ("Seattle-Portland", (47.6062, -122.3321), (45.5152, -122.6784)),
    ("Dallas-Houston", (32.7767, -96.7970), (29.7604, -95.3698)),
    ("New York-Boston", (40.7128, -74.0060), (42.3601, -71.0589)),
    ("Chicago-Detroit", (41.8781, -87.6298), (42.3314, -83.0458)),
    ("Atlanta-Charlotte", (33.7490, -84.3880), (35.2271, -80.8431)),
    ("Miami-Orlando", (25.7617, -80.1918), (28.5383, -81.3792)),
    ("Phoenix-Las Vegas", (33.4484, -112.0740), (36.1699, -115.1398)),
    ("Kansas City-St Louis", (39.0997, -94.5786), (38.6270, -90.1994)),
)


def interpolate(start, end, fraction):
    return {
        "lat": start[0] + ((end[0] - start[0]) * fraction),
        "lng": start[1] + ((end[1] - start[1]) * fraction),
    }


class RideRouteMatchingAccuracyTests(unittest.TestCase):
    def test_one_hundred_distinct_pickup_dropoff_pairs(self):
        cases = []
        positive_segments = ((0.0, 1.0), (0.05, 0.70), (0.10, 0.90), (0.20, 0.65), (0.35, 0.95))

        for route_index, (name, start, end) in enumerate(ROUTES):
            row = {
                "origin_lat": start[0],
                "origin_lng": start[1],
                "destination_lat": end[0],
                "destination_lng": end[1],
                "max_detour_minutes": 100,
                "max_pickup_distance_miles": 50,
            }
            for case_index, (start_fraction, end_fraction) in enumerate(positive_segments):
                cases.append((f"{name}-valid-{case_index}", row, interpolate(start, end, start_fraction), interpolate(start, end, end_fraction), True))

            negative_pairs = [
                (interpolate(start, end, 1.0), interpolate(start, end, 0.0)),
                (interpolate(start, end, 0.80), interpolate(start, end, 0.20)),
                ({"lat": start[0], "lng": start[1]}, {"lat": start[0] + 6.0, "lng": start[1]}),
                ({"lat": start[0], "lng": start[1]}, {"lat": start[0] - 6.0, "lng": start[1]}),
                (
                    {"lat": start[0] + 4.0, "lng": start[1]},
                    {"lat": end[0] + 4.0, "lng": end[1]},
                ),
            ]
            # Preserve the reported production regression as one of the 100
            # cases: a Denver→Dayton offer must reject Denver→New Mexico.
            if route_index == 0:
                negative_pairs[3] = (
                    {"lat": 39.7392, "lng": -104.9903},
                    {"lat": 35.0844, "lng": -106.6504},
                )
            for case_index, (pickup, dropoff) in enumerate(negative_pairs):
                cases.append((f"{name}-invalid-{case_index}", row, pickup, dropoff, False))

        self.assertEqual(len(cases), 100)
        distinct_pairs = {
            (round(pickup["lat"], 5), round(pickup["lng"], 5), round(dropoff["lat"], 5), round(dropoff["lng"], 5))
            for _, _, pickup, dropoff, _ in cases
        }
        self.assertEqual(len(distinct_pairs), 100)

        true_positive = true_negative = false_positive = false_negative = 0
        for name, row, pickup, dropoff, expected in cases:
            with self.subTest(name=name):
                metrics = app.ride_route_match_metrics(row, pickup, dropoff, allow_google=False)
                actual = app.ride_route_match_is_valid(row, metrics)
                if expected and actual:
                    true_positive += 1
                elif not expected and not actual:
                    true_negative += 1
                elif actual:
                    false_positive += 1
                else:
                    false_negative += 1
                self.assertEqual(actual, expected, metrics)

        self.assertEqual(
            (true_positive, true_negative, false_positive, false_negative),
            (50, 50, 0, 0),
        )


if __name__ == "__main__":
    unittest.main()
