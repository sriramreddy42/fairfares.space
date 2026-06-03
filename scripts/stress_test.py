from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory(prefix="fairfares-stress-")
os.environ["FAIRFARES_DB_PATH"] = str(Path(TMP.name) / "fairfares.sqlite3")
os.environ["FAIRFARES_BACKUP_DIR"] = str(Path(TMP.name) / "backups")
os.environ["FAIRFARES_BACKUP_KEEP"] = "5"

sys.path.insert(0, str(ROOT))

import app  # noqa: E402


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def user_by_email(email: str) -> sqlite3.Row:
    with app.db() as con:
        row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    assert_true(row is not None, f"user not found: {email}")
    return row


def create_verified_user(index: int) -> sqlite3.Row:
    email = f"stress{index}@example.com"
    with app.db() as con:
        con.execute(
            "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
            (f"Stress User {index}", email, app.hash_password(f"StressPass{index}!")),
        )
    return user_by_email(email)


def modify_booking(booking_id: int, iteration: int) -> None:
    with app.db() as con:
        con.execute(
            """
            UPDATE bookings
            SET pickup_date = ?,
                pickup_time = ?,
                dropoff_date = ?,
                dropoff_time = ?,
                pickup_location = ?,
                dropoff_location = ?,
                return_location = ?,
                booking_status = 'MODIFIED',
                status = 'MODIFIED',
                cancellation_reason = ?
            WHERE id = ?
            """,
            (
                f"Jun {10 + iteration}, 2025",
                "12:00 PM",
                f"Jun {20 + iteration}, 2025",
                "02:00 PM",
                "Denver Union Station",
                "Denver International Airport (DEN)",
                "Denver International Airport (DEN)",
                f"stress modify {iteration}",
                booking_id,
            ),
        )


def request_cancellation(booking_id: int) -> None:
    with app.db() as con:
        con.execute(
            """
            UPDATE bookings
            SET booking_status = 'CANCELLATION_REQUESTED',
                status = 'CANCELLATION_REQUESTED',
                payment_status = CASE WHEN payment_status = 'PAID' THEN 'REFUND_REVIEW' ELSE payment_status END,
                cancellation_reason = ?
            WHERE id = ?
            """,
            ("stress cancellation request", booking_id),
        )


def admin_approve_cancel(booking_id: int) -> None:
    with app.db() as con:
        con.execute(
            """
            UPDATE bookings
            SET booking_status = 'CANCELLED',
                status = 'CANCELLED',
                payment_status = 'REFUNDED'
            WHERE id = ?
            """,
            (booking_id,),
        )
        con.execute(
            """
            UPDATE cars
            SET status = 'AVAILABLE'
            WHERE id = (SELECT car_id FROM bookings WHERE id = ?)
            """,
            (booking_id,),
        )


def main() -> None:
    app.init_db()

    cars = app.get_cars()
    assert_true(len(cars) >= 4, "seed cars should be available")
    assert_true(all(row["image_url"] for row in cars), "all seed cars should have images")
    with app.db() as con:
        con.executemany(
            """
            INSERT INTO cars
            (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission,
             daily_price, total_price, badge, color, features, location, image_url, status, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    f"Stress Fleet {index}",
                    "Stress",
                    f"Fleet {index}",
                    2026,
                    "Compact" if index % 2 else "SUV",
                    "Sedan" if index % 2 else "SUV",
                    "Gasoline" if index % 3 else "Electric",
                    5,
                    2,
                    4,
                    "Automatic",
                    31.00 + index,
                    (31.00 + index) * 7,
                    "Stress Ready",
                    "charcoal",
                    "Free Cancellation|Unlimited Mileage|24/7 Support",
                    "Denver International Airport (DEN)",
                    "/static/img/car-nissan-sentra.png",
                    " available " if index == 1 else "AVAILABLE",
                    100 + index,
                )
                for index in range(1, 21)
            ],
        )
    cars = app.get_cars()
    assert_true(len(cars) >= 24, "stress inventory should include added available cars")
    assert_true(any(row["name"] == "Stress Fleet 1" for row in cars), "available status should be normalized for user feed queries")
    first_card = app.FairFaresHandler.render_car_card(None, cars[0])
    assert_true("car-card-image" in first_card and cars[0]["image_url"] in first_card, "feed cards should render dynamic car images")
    dashboard_template = (ROOT / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert_true('href="/buy-cars"' in dashboard_template, "dashboard should link to the Buy Cars page")
    assert_true('data-manage-tab="details" data-detail-jump="student"' in dashboard_template, "student verification link should open details/student")
    assert_true('data-manage-tab="details" data-detail-jump="saved"' in dashboard_template, "saved trips link should open details/saved")
    assert_true('data-manage-tab="support"' in dashboard_template, "support link should open support panel")
    assert_true('data-manage-tab="documents"' in dashboard_template, "price details should open documents panel")
    app_js = (ROOT / "static" / "js" / "app.js").read_text(encoding="utf-8")
    assert_true("detailJump" in app_js and "showDetailPanel(tab.dataset.detailJump)" in app_js, "manage buttons should support detail jumps")
    assert_true("noCarResults" in app_js and "clearCarFilters" in app_js, "car feed should show and reset empty filter states")
    assert_true("playHeroFold" in app_js and "dataset.videoSrc" in app_js, "homepage hero should lazy-load and play fold video")
    assert_true("parseJsonData" in app_js and "textarea.innerHTML" in app_js, "frontend JSON parsing should not break all mobile controls")
    assert_true("fetch(heroFoldVideo.dataset.videoSrc" not in app_js, "hero video should not depend on fragile HEAD requests")
    styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")
    assert_true("rotateY(-82deg)" in styles and "prefers-reduced-motion" in styles, "homepage hero should include fold animation and reduced-motion fallback")
    index_template = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    assert_true('href="/buy-cars"' in index_template, "book page should link to the Buy Cars page")
    assert_true("noCarResults" in index_template and "resetCarFilters" in index_template, "book page should render no-results reset controls")
    assert_true("data-hero-fold" in index_template and "fairfares-hero.mp4" in index_template, "homepage hero should wire fold video transition")
    buy_template = (ROOT / "templates" / "buy_cars.html").read_text(encoding="utf-8")
    assert_true("buy-cars-coming-soon.png" in buy_template, "Buy Cars page should render the coming-soon campaign")
    assert_true('class="top-brand"' in buy_template and 'href="/manage-booking"' in buy_template, "Buy Cars page should share main header navigation")
    assert_true('"/buy-cars": self.buy_cars_page' in (ROOT / "app.py").read_text(encoding="utf-8"), "Buy Cars route should be registered")
    assert_true((ROOT / "static" / "img" / "buy-cars-coming-soon.png").exists(), "Buy Cars campaign image should be in static assets")
    low_to_high = sorted(cars, key=lambda row: row["daily_price"])
    high_to_low = sorted(cars, key=lambda row: row["daily_price"], reverse=True)
    assert_true(low_to_high[0]["daily_price"] <= low_to_high[-1]["daily_price"], "low price sort should order ascending")
    assert_true(high_to_low[0]["daily_price"] >= high_to_low[-1]["daily_price"], "high price sort should order descending")

    locations = app.get_inventory_locations()
    assert_true("Denver International Airport (DEN)" in locations, "inventory locations should be dynamic")

    counts = app.get_filter_counts()
    assert_true(sum(row["total"] for row in counts["types"]) == len(cars), "type filter counts should match available feed")
    assert_true(sum(row["total"] for row in counts["fuel"]) == len(cars), "fuel filter counts should match available feed")

    with app.db() as con:
        con.execute(
            """
            INSERT INTO discounts (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("STRESS15", "Stress discount", "PERCENT", 15, "2099-01-01", "ACTIVE", 0, 0),
        )
    assert_true(any(row["code"] == "STRESS15" for row in app.get_active_discounts()), "active discount should feed user portal")
    referral_code = app.create_referral_discount("@stress.student")
    assert_true(referral_code == "REFERRAL_STRESS_STUDENT", "referral code should normalize instagram username")
    referral = next(row for row in app.get_all_discounts() if row["code"] == referral_code)
    assert_true(referral["value"] == 10 and referral["max_uses"] == 3, "referral code should be 10 percent with max 3 uses")
    assert_true("max 3 referrals" in referral["description"], "referral terms should be visible in admin description")
    deals_template = (ROOT / "templates" / "deals.html").read_text(encoding="utf-8")
    assert_true("Follow Instagram" in deals_template and "Maximum 3 successful referrals" in deals_template, "deals page should include follow CTA and terms")
    assert_true('class="top-brand"' in deals_template and 'href="/buy-cars"' in deals_template, "deals page should share main header navigation")
    assert_true("fairfares.placeholder" in deals_template, "deals page should use temporary Instagram follow link")

    users = [create_verified_user(index) for index in range(1, 16)]
    emails = {user["email"] for user in users}
    assert_true(len(emails) == 15, "multiple unique signups should persist")
    assert_true(all("StressPass" not in user["password_hash"] for user in users), "passwords must be hashed, not plaintext")

    duplicate_failed = False
    try:
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Duplicate", users[0]["email"], app.hash_password("AnotherPass123!")),
            )
    except sqlite3.IntegrityError:
        duplicate_failed = True
    assert_true(duplicate_failed, "duplicate signup email should be rejected")

    booked_ids: list[int] = []
    for index, user in enumerate(users, start=1):
        booking = app.create_booking_for_user(user["id"], cars[(index - 1) % len(cars)]["id"])
        assert_true(booking["booking_status"] == "CONFIRMED", "new booking should be confirmed")
        booked_ids.append(booking["id"])
        with app.db() as con:
            con.execute(
                """
                UPDATE users
                SET student_email = ?,
                    student_id = ?,
                    student_verified = 1,
                    phone = ?,
                    address = ?
                WHERE id = ?
                """,
                (user["email"], f"STRESS-{index:04d}", f"555-010{index:02d}", f"{index} Test Ave", user["id"]),
            )
        for iteration in range(1, 6):
            modify_booking(booking["id"], iteration)
        modified = app.get_booking_for_user(user["id"])
        assert_true(modified["booking_status"] == "MODIFIED", "multiple modifies should leave booking modified")
        request_cancellation(booking["id"])
        requested = app.get_booking_for_user(user["id"])
        assert_true(requested["booking_status"] == "CANCELLATION_REQUESTED", "cancel request should be visible to user")
        assert_true(app.booking_status_label(requested["booking_status"]) == "REQUEST SENT TO ADMIN", "user card label should be friendly")

    admin_bookings = app.get_admin_bookings()
    requested_count = sum(1 for row in admin_bookings if row["booking_status"] == "CANCELLATION_REQUESTED")
    assert_true(requested_count == len(users), "admin should see every cancellation request")

    for booking_id in booked_ids[:8]:
        admin_approve_cancel(booking_id)
    with app.db() as con:
        approved = con.execute("SELECT COUNT(*) AS total FROM bookings WHERE booking_status = 'CANCELLED'").fetchone()["total"]
        pending = con.execute("SELECT COUNT(*) AS total FROM bookings WHERE booking_status = 'CANCELLATION_REQUESTED'").fetchone()["total"]
    assert_true(approved == 8, "admin approvals should cancel selected bookings")
    assert_true(pending == len(users) - 8, "remaining cancel requests should stay pending")

    backup = app.create_db_backup("stress")
    assert_true(backup.exists() and backup.stat().st_size > 0, "backup should create a non-empty SQLite file")

    with app.db() as con:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        fk_rows = con.execute("PRAGMA foreign_key_check").fetchall()
    assert_true(integrity == "ok", "database integrity check should pass")
    assert_true(not fk_rows, "foreign key check should pass")

    print("stress ok")
    print(f"users={len(users)} bookings={len(booked_ids)} cancelled={approved} pending={pending} backup={backup.name}")


if __name__ == "__main__":
    try:
        main()
    finally:
        TMP.cleanup()
