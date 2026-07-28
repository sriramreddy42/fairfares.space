from __future__ import annotations

import os
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory(prefix="fairfares-heavy-stress-")
os.environ["FAIRFARES_DB_PATH"] = str(Path(TMP.name) / "fairfares-heavy.sqlite3")
os.environ["FAIRFARES_BACKUP_DIR"] = str(Path(TMP.name) / "backups")
os.environ["FAIRFARES_BACKUP_KEEP"] = "3"
os.environ["FAIRFARES_SEED_DEFAULTS"] = "1"
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""

sys.path.insert(0, str(ROOT))

import app  # noqa: E402


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def create_user(index: int) -> int:
    with app.db() as con:
        con.execute(
            "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 1)",
            (
                f"Heavy User {index}",
                f"heavy{index}@example.com",
                f"55520{index:05d}",
                app.hash_password(f"HeavyPass{index}!"),
            ),
        )
        return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])


def insert_cars(total: int = 1000) -> list[int]:
    categories = ["Economy", "Compact", "Midsize", "SUV", "Hybrid", "Electric"]
    fuels = ["Gasoline", "Electric", "Hybrid"]
    colors = ["white", "charcoal", "silver", "blue"]
    image_by_category = {
        "Economy": "/static/img/car-toyota-corolla.png",
        "Compact": "/static/img/car-nissan-sentra.png",
        "Midsize": "/static/img/car-honda-civic.png",
        "SUV": "/static/img/car-hyundai-kona.png",
        "Hybrid": "/static/img/car-toyota-corolla.png",
        "Electric": "/static/img/car-hyundai-kona.png",
    }
    with app.db() as con:
        for index in range(total):
            category = categories[index % len(categories)]
            fuel = fuels[index % len(fuels)]
            con.execute(
                """
                INSERT INTO cars
                (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission,
                 daily_price, total_price, badge, color, features, location, image_url, status, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?)
                """,
                (
                    f"Heavy Fleet {index:04d}",
                    "FairFares",
                    f"Stress {index:04d}",
                    2026,
                    category,
                    "SUV" if category == "SUV" else "Sedan",
                    fuel,
                    5,
                    2 + (index % 2),
                    4,
                    "Automatic",
                    25 + (index % 28),
                    250 + (index % 28) * 10,
                    "Stress Ready",
                    colors[index % len(colors)],
                    "Free Cancellation|Quote Match|Unlimited Mileage",
                    "Denver International Airport (DEN)" if index % 3 else "Denver Union Station",
                    image_by_category[category],
                    1000 + index,
                ),
            )
        return [
            int(row["id"])
            for row in con.execute("SELECT id FROM cars WHERE name LIKE 'Heavy Fleet %' ORDER BY id").fetchall()
        ]


def set_booking_state(booking_id: int, car_id: int, booking_status: str, car_status: str) -> None:
    with app.db() as con:
        con.execute(
            """
            UPDATE bookings
            SET booking_status = ?,
                status = ?,
                payment_status = 'PAY_AT_PICKUP',
                cancellation_reason = CASE
                    WHEN ? = 'CANCELLED' THEN 'Heavy stress cancellation approved.'
                    WHEN ? = 'CANCELLATION_REQUESTED' THEN 'Heavy stress cancellation review.'
                    WHEN ? = 'MODIFIED' THEN 'Heavy stress timing/location review.'
                    ELSE ''
                END
            WHERE id = ?
            """,
            (booking_status, booking_status, booking_status, booking_status, booking_status, booking_id),
        )
        con.execute("UPDATE cars SET status = ? WHERE id = ?", (car_status, car_id))


def main() -> None:
    started = time.perf_counter()
    app.init_db()
    pickup_date = (date.today() + timedelta(days=30)).isoformat()
    return_date = (date.today() + timedelta(days=39)).isoformat()
    later_return_date = (date.today() + timedelta(days=44)).isoformat()
    short_return_date = (date.today() + timedelta(days=42)).isoformat()
    car_ids = insert_cars(1000)
    assert_true(len(car_ids) == 1000, "should insert 1000 stress cars")

    booking_ids: list[int] = []
    for index, car_id in enumerate(car_ids):
        user_id = create_user(index)
        pickup_time = "12:00 PM" if index % 10 == 0 else "10:00 AM"
        booking = app.create_booking_for_user(
            user_id,
            car_id,
            "",
            10,
            pickup_date,
            return_date,
            pickup_time,
            "4:00 PM",
            "Denver International Airport (DEN)",
            "Denver International Airport (DEN)",
        )
        booking_ids.append(int(booking["id"]))

    for index, (booking_id, car_id) in enumerate(zip(booking_ids, car_ids)):
        bucket = index % 10
        if bucket in {0, 1, 2}:
            set_booking_state(booking_id, car_id, "CONFIRMED", "BOOKED")
        elif bucket in {3, 4}:
            set_booking_state(booking_id, car_id, "CANCELLED", "AVAILABLE")
        elif bucket in {5, 6}:
            set_booking_state(booking_id, car_id, "RETURNED", "AVAILABLE")
        elif bucket == 7:
            set_booking_state(booking_id, car_id, "PICKED_UP", "BOOKED")
        elif bucket == 8:
            set_booking_state(booking_id, car_id, "MODIFIED", "BOOKED")
        else:
            set_booking_state(booking_id, car_id, "CANCELLATION_REQUESTED", "BOOKED")

    with app.db() as con:
        totals = dict(
            con.execute(
                """
                SELECT
                    SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available,
                    SUM(CASE WHEN status = 'BOOKED' THEN 1 ELSE 0 END) AS booked,
                    SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS maintenance
                FROM cars
                WHERE name LIKE 'Heavy Fleet %'
                """
            ).fetchone()
        )
        status_counts = {
            row["booking_status"]: row["total"]
            for row in con.execute(
                """
                SELECT booking_status, COUNT(*) AS total
                FROM bookings
                WHERE booking_id IN (SELECT booking_id FROM bookings ORDER BY id DESC LIMIT 1000)
                GROUP BY booking_status
                """
            ).fetchall()
        }

    feed_rows = [row for row in app.get_cars() if row["name"].startswith("Heavy Fleet ")]
    assert_true(len(feed_rows) == 1000, "all non-maintenance stress cars should remain in feed")
    assert_true(totals["available"] == 400 and totals["booked"] == 600 and totals["maintenance"] == 0, "inventory state mix should match expected counts")
    assert_true(status_counts.get("CONFIRMED") == 300, "confirmed booking count should update")
    assert_true(status_counts.get("CANCELLED") == 200, "cancelled booking count should update")
    assert_true(status_counts.get("RETURNED") == 200, "returned booking count should update")
    assert_true(status_counts.get("PICKED_UP") == 100, "picked-up booking count should update")
    assert_true(status_counts.get("MODIFIED") == 100, "modified booking count should update")
    assert_true(status_counts.get("CANCELLATION_REQUESTED") == 100, "cancellation-request count should update")

    booked_rows = [row for row in feed_rows if row["status"] == "BOOKED"]
    available_rows = [row for row in feed_rows if row["status"] == "AVAILABLE"]
    assert_true(all(app.row_value(row, "booked_until_date") for row in booked_rows), "booked feed rows should expose return date")
    assert_true(all(app.row_value(row, "booked_until_time") == "4:00 PM" for row in booked_rows), "booked feed rows should expose 4 PM return time")
    assert_true(all(not app.row_value(row, "booked_until_date") for row in available_rows), "available feed rows should not carry stale blockers")

    same_day_row = booked_rows[0]
    same_day_card = app.FairFaresHandler.render_car_card(None, same_day_row)
    formatted_return_date = date.fromisoformat(return_date).strftime("%b %-d, %Y")
    assert_true(f'data-booked-until-date="{formatted_return_date}"' in same_day_card, "same-day booked car should render return date")
    assert_true('data-booked-until-time="4:00 PM"' in same_day_card, "same-day booked car should render return time")
    adjusted_user = create_user(2000)
    adjusted_booking = app.create_booking_for_user(
        adjusted_user,
        int(same_day_row["id"]),
        "",
        5,
        return_date,
        later_return_date,
        "12:00 PM",
        "10:00 AM",
    )
    assert_true(adjusted_booking["pickup_time"] == "4:00 PM", "same-day pre-return pickup should adjust to available-after time")

    return_car = next(row for row in booked_rows if row["status"] == "BOOKED")
    with app.db() as con:
        con.execute("UPDATE bookings SET booking_status = 'RETURNED', status = 'RETURNED' WHERE car_id = ?", (return_car["id"],))
        con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ?", (return_car["id"],))
    refreshed = next(row for row in app.get_cars() if row["id"] == return_car["id"])
    assert_true(refreshed["status"] == "AVAILABLE", "returned car should be marked available")
    assert_true(not app.row_value(refreshed, "booked_until_date"), "returned car should reappear without booked-until blocker")
    post_return_user = create_user(3000)
    post_return_booking = app.create_booking_for_user(
        post_return_user,
        int(return_car["id"]),
        "",
        3,
        return_date,
        short_return_date,
        "12:00 PM",
        "10:00 AM",
    )
    assert_true(post_return_booking["pickup_time"] == "12:00 PM", "returned available car should book at requested time")

    with app.db() as con:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        fk_rows = con.execute("PRAGMA foreign_key_check").fetchall()
    assert_true(integrity == "ok", "heavy stress db integrity should pass")
    assert_true(not fk_rows, "heavy stress foreign keys should pass")

    elapsed = time.perf_counter() - started
    print("heavy stress ok")
    print(f"cars=1000 bookings=1000 feed={len(feed_rows)} available={totals['available']} booked={totals['booked']} elapsed={elapsed:.2f}s")
    print(f"statuses={status_counts}")


if __name__ == "__main__":
    try:
        main()
    finally:
        TMP.cleanup()
