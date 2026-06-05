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
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""

sys.path.insert(0, str(ROOT))

import app  # noqa: E402

app.OUTBOX_DIR = Path(TMP.name) / "outbox"


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
    assert_true("data-price-range" in first_card and "data-total-range" not in first_card, "feed cards should render daily estimate ranges without old total-range copy")
    assert_true("Found a lower quote from Avis, Enterprise, Hertz" in first_card, "feed cards should use the new price-match terminology")
    dashboard_template = (ROOT / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert_true('href="/buy-cars"' in dashboard_template, "dashboard should link to the Buy Cars page")
    assert_true("payment-confirmation" not in dashboard_template and "$booking_payment_state" not in dashboard_template, "manage booking should use the booking badge for pay at pickup")
    assert_true("booking-accordions" not in dashboard_template and "$admin_panel" not in dashboard_template, "customer dashboard should not render marketing accordions or homepage CMS")
    assert_true('data-manage-tab="details" data-detail-jump="student"' in dashboard_template, "student verification link should open details/student")
    assert_true('data-manage-tab="details" data-detail-jump="saved"' in dashboard_template, "saved trips link should open details/saved")
    assert_true('data-manage-tab="support"' in dashboard_template, "support link should open support panel")
    assert_true('data-manage-tab="documents"' in dashboard_template, "price details should open documents panel")
    css_text = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")
    assert_true(".agreement-customer" in css_text and ".agreement-issuer" in css_text, "agreement fields should mark customer and issuer ownership")
    app_js = (ROOT / "static" / "js" / "app.js").read_text(encoding="utf-8")
    index_template = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    assert_true("rentalLengthLabel" in index_template and "quoteMatchLabel" in index_template, "homepage search should show rental days/months and quote-match message")
    assert_true("$pickup_time_options" in index_template and "$return_time_options" in index_template, "homepage search should render full dynamic time selectors")
    assert_true("2025-06-10" not in index_template and "$default_pickup_date" in index_template, "homepage should not ship stale 2025 default dates")
    assert_true("getRentalDays" in app_js and "discount_code" in app_js, "select flow should carry rental length and discount code")
    assert_true("pickup_location" in app_js and "return_location" in app_js, "select flow should carry selected locations")
    assert_true("Modification sent to admin" in app_js and "response.json().then((payload) => Promise.reject(payload))" in app_js, "modify flow should show pending status and server validation errors")
    assert_true("Available after" in app_js and "data-availability-note" in first_card, "car feed should show same-day return availability notes")
    assert_true("detailJump" in app_js and "showDetailPanel(tab.dataset.detailJump)" in app_js, "manage buttons should support detail jumps")
    assert_true("noCarResults" in app_js and "clearCarFilters" in app_js, "car feed should show and reset empty filter states")
    assert_true("data-total-range" not in app_js and "total range" not in app_js, "frontend should not restore removed total-range copy")
    assert_true('document.getElementById("liveStatusText").innerHTML = "<b>Status refreshed!' not in app_js, "live status refresh should not overwrite dynamic booking status")
    assert_true('fetch("/support/tickets"' in app_js and "save-search-trip" in first_card, "support tickets should use backend API and feed cards should expose save trip")
    assert_true("Sign in to create a support ticket" in app_js and "Sign in to update student verification" in app_js, "signed-out account actions should request login")
    assert_true('fetch("/saved-cars"' in app_js and '"/saved-cars": self.save_search_car' in (ROOT / "app.py").read_text(encoding="utf-8"), "save trip should persist saved cars")
    assert_true('fetch("/bookings/request-cancel"' in app_js and "tripDetailModal" in app_js, "user should cancel pending requests and open trip detail popups")
    assert_true("function escapeHtml" in app_js and "details.price" in app_js, "trip detail modal should escape dynamic data and show price")
    assert_true("Our dev team" not in app_js and "Our dev team" not in (ROOT / "app.py").read_text(encoding="utf-8"), "customer support copy should not mention dev team")
    assert_true("saveCurrentTrip" not in app_js, "saved trips panel should not show old save current trip flow")
    assert_true('fetch("/profile/update"' in app_js, "booking confirmation details should save through profile API")
    assert_true("playHeroFold" in app_js and "dataset.videoSrc" in app_js, "homepage hero should lazy-load and play fold video")
    assert_true("parseJsonData" in app_js and "textarea.innerHTML" in app_js, "frontend JSON parsing should not break all mobile controls")
    assert_true("fetch(heroFoldVideo.dataset.videoSrc" not in app_js, "hero video should not depend on fragile HEAD requests")
    assert_true("querySelector(\"[data-video-src]\")" in app_js and "setAttribute(\"src\"" in app_js, "homepage hero should load commercial embeds dynamically")
    styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")
    assert_true(".manage-screen .mini-trip" in styles and "background: #fff !important" in styles, "saved trip rows should stay quiet with red only on hover")
    assert_true(".card-actions-row" in styles and "minmax(0, 1fr)" in styles, "car card action buttons should stay inside the card")
    assert_true(".trip-card .price-summary" in styles and "grid-column: 1 / -1" in styles, "manage booking price summary should sit as a horizontal strip")
    assert_true(".menu-button" in styles and "display: none;" in styles, "desktop navigation should not show the mobile hamburger")
    assert_true("perspective-origin: left center" in styles and "rotateY(-86deg)" in styles and "prefers-reduced-motion" in styles, "homepage hero should fold toward the left with reduced-motion fallback")
    assert_true("background-size: auto 100%" in styles and "background-position: left center" in styles, "desktop hero artwork should keep natural height alignment")
    assert_true("commercial-preview" in styles and "status-live" in styles, "admin commercials should preview and flag live videos")
    index_template = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    assert_true('href="/buy-cars"' in index_template, "book page should link to the Buy Cars page")
    assert_true("noCarResults" in index_template and "resetCarFilters" in index_template, "book page should render no-results reset controls")
    assert_true("data-hero-fold" in index_template and "$commercial_embed_url" in index_template, "homepage hero should wire dynamic commercial embeds")
    admin_commercials_template = (ROOT / "templates" / "admin_commercials.html").read_text(encoding="utf-8")
    assert_true("/admin/commercials" in admin_commercials_template and "Live feature" in admin_commercials_template, "admin should manage commercials and live links")
    assert_true(not (ROOT / "static" / "video" / "fairfares-hero.mp4").exists(), "homepage should no longer depend on uploaded static MP4")
    active_commercial = app.get_active_commercial()
    assert_true(active_commercial is not None, "default active commercial should be seeded")
    assert_true("youtube.com/embed/vMG_P78gAOE" in active_commercial["embed_url"], "default YouTube link should become an embed URL")
    assert_true(app.commercial_embed_url("https://www.youtube.com/live/vMG_P78gAOE?feature=share").startswith("https://www.youtube.com/embed/vMG_P78gAOE"), "YouTube live links should become embeds")
    with app.db() as con:
        live_url = "https://www.youtube.com/live/vMG_P78gAOE?feature=share"
        con.execute(
            """
            INSERT INTO commercials (title, video_url, embed_url, status, is_live, duration_seconds, sort_order)
            VALUES (?, ?, ?, 'ACTIVE', 1, 60, 99)
            """,
            ("Stress Live Commercial", live_url, app.commercial_embed_url(live_url)),
        )
    active_live = app.get_active_commercial()
    assert_true(active_live["title"] == "Stress Live Commercial" and active_live["is_live"] == 1, "live commercials should take homepage priority")
    assert_true('"/admin/commercials": self.admin_commercials_page' in (ROOT / "app.py").read_text(encoding="utf-8"), "admin commercials route should be registered")
    assert_true('"/admin/tickets": self.admin_tickets_page' in (ROOT / "app.py").read_text(encoding="utf-8"), "admin tickets route should be registered")
    assert_true('"/profile/update": self.update_user_profile' in (ROOT / "app.py").read_text(encoding="utf-8"), "profile update route should be registered")
    admin_tickets_template = (ROOT / "templates" / "admin_tickets.html").read_text(encoding="utf-8")
    assert_true("Support Tickets" in admin_tickets_template and "ticket-table" in admin_tickets_template, "admin tickets page should render ticket table")
    assert_true("/admin/tickets/update" in (ROOT / "app.py").read_text(encoding="utf-8"), "admin ticket rows should post update actions")
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

    app_source = (ROOT / "app.py").read_text(encoding="utf-8")
    assert_true("license_plate" not in app_source[app_source.index("def api_cars"):app_source.index("def serve_static")], "public cars API should not expose license plates")
    assert_true("allow_post_from_same_origin" in app_source and "Request origin not allowed" in app_source, "POST routes should have same-origin guard")
    assert_true("bool(not booking or booking[\"booking_status\"] not in" in app_source, "documents should stay locked when there is no booking")
    assert_true('"login_required": True, "message": "Sign in to create a support ticket."' in app_source, "signed-out support should return a login-required JSON response")
    assert_true("Vehicle change requested from" in app_source and "get_car_by_name" in app_source, "modify vehicle requests should be stored instead of ignored")
    assert_true("Modification pending approval" in app_source and "MODIFIED" in app_source[app_source.index("def booking_status_class"):app_source.index("def payment_status_label")], "modified bookings should read as pending review")
    assert_true("${car[\"total_price\"]:.2f}" not in app_source[app_source.index("upgrade_select_options"):app_source.index("editable =")], "upgrade selector should show ranges, not fixed totals")
    assert_true('if booking_status in {"CONFIRMED", "PICKED_UP", "RETURNED"}' in app_source and 'reason = "Cancelled by admin approval."' in app_source, "admin approvals should clear resolved request notes and default cancel reasons")

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
    with app.db() as con:
        con.execute(
            """
            INSERT OR IGNORE INTO saved_cars
            (user_id, car_id, pickup_location, pickup_date, pickup_time, return_date, return_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (users[0]["id"], cars[0]["id"], "Denver Union Station", "2026-06-10", "9:30 AM", "2026-06-12", "3:30 PM"),
        )
    saved_rows = app.get_saved_cars_for_user(users[0]["id"])
    assert_true(saved_rows and saved_rows[0]["car_name"], "saved cars should persist and join back to car data")
    saved_trip_html = app.render_user_trip_rows([], saved_rows)
    assert_true('data-trip-type="favorites"' in saved_trip_html and "Saved car" in saved_trip_html, "saved cars should render in saved trips modal list")
    assert_true("data-trip-details" not in app.render_user_trip_rows([]) and "mini-trip-empty" in app.render_user_trip_rows([]), "empty trip state should not open a blank trip detail modal")

    same_day_user = create_verified_user(99)
    with app.db() as con:
        con.execute(
            """
            INSERT INTO cars
            (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission,
             daily_price, total_price, badge, color, features, location, image_url, status, sort_order)
            VALUES ('Same Day Return Test', 'Toyota', 'Camry', 2026, 'Midsize', 'Sedan', 'Gasoline',
                    5, 2, 4, 'Automatic', 50, 500, 'Returning Soon', 'silver',
                    'Free Cancellation|Quote Match', 'Denver International Airport (DEN)',
                    '/static/img/car-honda-civic.png', 'BOOKED', 98)
            """
        )
        same_day_car = con.execute("SELECT id FROM cars WHERE name = 'Same Day Return Test'").fetchone()
        con.execute(
            """
            INSERT INTO bookings
            (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
             dropoff_location, dropoff_date, dropoff_time, days, subtotal_price, total_price, status, booking_status, payment_status)
            VALUES ('FFSAMEDAY1', ?, ?, 'AVIS', 'Denver International Airport (DEN)', 'Jun 1, 2026', '10:00 AM',
                    'Denver International Airport (DEN)', 'Jun 15, 2026', '12:00 PM', 14, 700, 700,
                    'CONFIRMED', 'CONFIRMED', 'PAY_AT_PICKUP')
            """,
            (same_day_user["id"], same_day_car["id"]),
        )
    same_day_row = next(row for row in app.get_cars() if row["name"] == "Same Day Return Test")
    same_day_card = app.FairFaresHandler.render_car_card(None, same_day_row)
    assert_true('data-booked-until-date="Jun 15, 2026"' in same_day_card and 'data-booked-until-time="12:00 PM"' in same_day_card, "booked cars returning same day should remain in feed with return time")
    adjusted_user = create_verified_user(100)
    adjusted_booking = app.create_booking_for_user(adjusted_user["id"], same_day_car["id"], "", 5, "2026-06-15", "2026-06-20", "10:00 AM", "10:00 AM")
    assert_true(adjusted_booking["pickup_date"] == "Jun 15, 2026" and adjusted_booking["pickup_time"] == "12:00 PM", "same-day pickup should adjust to car return time")

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
    discounted_booking_id = 0
    for index, user in enumerate(users, start=1):
        booking = app.create_booking_for_user(user["id"], cars[(index - 1) % len(cars)]["id"], "STRESS15" if index == 1 else "", 45 if index == 1 else 10)
        assert_true(booking["booking_status"] == "CONFIRMED", "new booking should be confirmed")
        assert_true(booking["payment_status"] == "PAY_AT_PICKUP", "new selected bookings should default to pay at pickup")
        assert_true(app.booking_status_label(booking["booking_status"], booking["payment_status"]) == "Confirmed / Pay at pickup", "confirmed booking badge should show pay at pickup")
        assert_true(app.payment_status_label(booking["payment_status"]) == "Pay at pickup", "pay at pickup label should be user friendly")
        if index == 1:
            discounted_booking_id = booking["id"]
            assert_true(booking["discount_code"] == "STRESS15", "selected discount code should save on booking")
            assert_true(booking["days"] == 45, "booking should store selected rental length")
            assert_true(float(booking["discount_amount"]) > 0 and float(booking["total_price"]) < float(booking["subtotal_price"]), "discount should reduce booking total")
            confirmation = app.save_booking_contact_and_send_confirmation(
                user["id"],
                "Stress",
                "Customer",
                user["email"],
                "9372518688",
                "https://fairfares.test",
            )
            assert_true(confirmation["ok"], "save details should update profile and send booking confirmation")
            confirmed_booking = app.get_booking_for_user(user["id"])
            assert_true(
                confirmed_booking["contact_name"] == "Stress Customer"
                and confirmed_booking["contact_email"] == user["email"]
                and confirmed_booking["contact_phone"] == "9372518688"
                and confirmed_booking["confirmation_email_sent_at"],
                "booking should store customer contact snapshot and confirmation timestamp",
            )
            outbox_text = Path(str(confirmation["outbox_file"])).read_text(encoding="utf-8")
            assert_true(
                booking["booking_id"] in outbox_text
                and "booking-confirmation-promise.png" in outbox_text
                and "9372518688" in outbox_text
                and "We'll match it and give you an additional 10% off" in outbox_text,
                "booking confirmation email should include poster, booking details, query phone, and price-match promise",
            )
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
        assert_true(app.booking_status_label(requested["booking_status"]) == "Request sent to admin", "user card label should be friendly")

    admin_bookings = app.get_admin_bookings()
    requested_count = sum(1 for row in admin_bookings if row["booking_status"] == "CANCELLATION_REQUESTED")
    assert_true(requested_count == len(users), "admin should see every cancellation request")
    admin_row_html = app.FairFaresHandler.render_admin_booking_row(None, admin_bookings[0])
    assert_true('value="PAY_AT_PICKUP"' in admin_row_html, "admin booking row should keep pay at pickup")
    assert_true(all(f'value="{status}"' not in admin_row_html for status in ("PENDING", "PAID", "FAILED", "REFUND_REVIEW", "REFUNDED")), "admin payment dropdown should not show old payment options")
    assert_true("admin-request-row" in admin_row_html and "admin-request-summary" in admin_row_html, "pending admin requests should be visually highlighted")
    assert_true("Cancellation approval requested" in admin_row_html, "admin cancellation requests should include approval guidance")
    assert_true("admin-request-row" in (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8"), "admin request rows should have dedicated styling")
    pickup_html = app.FairFaresHandler.render_pickup_record(None, admin_bookings[0])
    assert_true("Rental Agreement Builder" in pickup_html, "admin pickup should include agreement builder")
    assert_true('data-dl-camera="front"' in pickup_html and 'data-dl-camera="back"' in pickup_html, "admin pickup should allow taking DL pictures")
    assert_true('name="agreement_license_number"' in pickup_html and 'name="agreement_vehicle_mileage"' in pickup_html, "agreement builder should expose customer and issuer fields")
    agreement_values = app.agreement_default_values(admin_bookings[0])
    agreement_values.update(
        {
            "vehicle_mileage": "42150",
            "insurance_company": "Stress Insurance",
            "insurance_policy": "POL-STRESS-123",
            "customer_signature": "Stress User Signature",
            "issuer_signature": "FairFares Issuer Signature",
        }
    )
    agreement_text = app.build_rental_agreement_text(admin_bookings[0], agreement_values)
    with app.db() as con:
        con.execute(
            """
            INSERT INTO rental_agreements
            (booking_id, agreement_text, agreement_data, signer_name, signature_text, signed_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                admin_bookings[0]["id"],
                agreement_text,
                app.json.dumps(agreement_values),
                agreement_values["lessee_name"],
                agreement_values["customer_signature"],
            ),
        )
    docs = app.get_booking_documents(admin_bookings[0]["id"])
    assert_true("42150" in docs["Rental Agreement"]["content"] and "POL-STRESS-123" in docs["Rental Agreement"]["content"], "user rental agreement document should use saved dynamic agreement data")
    assert_true("FairFares price promise" in docs["Rental Agreement"]["content"], "agreement should include price-match promise")
    discount_docs = app.get_booking_documents(discounted_booking_id)
    assert_true("STRESS15" in discount_docs["Invoice / Receipt"]["content"], "invoice should show applied discount code")
    with app.db() as con:
        con.execute(
            """
            INSERT INTO driver_licenses
            (user_id, license_number, state, expiry_date, front_image_url, back_image_url, verification_status)
            VALUES (?, 'PHOTO_CAPTURED_PENDING_NUMBER', 'CO', '2028-12-31', 'data:image/jpeg;base64,front', 'data:image/jpeg;base64,back', 'PHOTO_CAPTURED')
            """,
            (admin_bookings[0]["user_id"],),
        )
    admin_users_template = (ROOT / "templates" / "admin_users.html").read_text(encoding="utf-8")
    assert_true("adminUserSearch" in admin_users_template and "/admin/users" in admin_users_template, "admin users page should include search and nav")
    dashboard_template = (ROOT / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert_true("$booking_confirmation_card" in dashboard_template and "customerInfoForm" in (ROOT / "app.py").read_text(encoding="utf-8"), "selected bookings should render customer confirmation form")
    assert_true("Save Current Trip" not in dashboard_template and "tripDetailModal" in dashboard_template, "saved trips should use clickable rows and modal details")
    assert_true('"/bookings/request-cancel": self.cancel_booking_request' in (ROOT / "app.py").read_text(encoding="utf-8"), "request cancel route should be registered")
    assert_true("No upgrade" in (ROOT / "app.py").read_text(encoding="utf-8") and "Current total" in (ROOT / "app.py").read_text(encoding="utf-8"), "modify vehicle should include visible no-upgrade option")
    admin_user_rows = app.get_admin_users()
    assert_true(any(row["booking_count"] > 0 for row in admin_user_rows), "admin users should aggregate booking counts")
    user_card = app.FairFaresHandler.render_admin_user_card(None, next(row for row in admin_user_rows if row["id"] == admin_bookings[0]["user_id"]))
    assert_true("Driver License" in user_card and "Front saved" in user_card and "Rental Agreements" in user_card, "admin user profile should show DL images and agreements")

    with app.db() as con:
        con.execute(
            """
            INSERT INTO support_tickets
            (ticket_id, booking_id, user_id, topic, preferred_contact, message, urgent)
            VALUES ('FF-SUP-STRESS', ?, ?, 'Pickup help', 'Email', 'stress ticket', 1)
            """,
            (admin_bookings[0]["id"], admin_bookings[0]["user_id"]),
        )
        ticket = con.execute("SELECT * FROM support_tickets WHERE ticket_id = 'FF-SUP-STRESS'").fetchone()
        con.execute(
            "UPDATE support_tickets SET claimed_by = 'Sriram', status = 'IN_PROGRESS', admin_comment = 'Checking pickup details.' WHERE id = ?",
            (ticket["id"],),
        )
    ticket_row = app.get_admin_tickets()[0]
    ticket_html = app.FairFaresHandler.render_ticket_row(None, ticket_row)
    assert_true("Sriram" in ticket_html and "Checking pickup details." in ticket_html, "admin tickets should show claim owner and comments")
    latest_ticket = app.get_latest_ticket_for_user(admin_bookings[0]["user_id"])
    assert_true(latest_ticket["claimed_by"] == "Sriram", "user ticket state should read latest admin claim owner")

    for booking_id in booked_ids[:8]:
        admin_approve_cancel(booking_id)
    with app.db() as con:
        approved = con.execute("SELECT COUNT(*) AS total FROM bookings WHERE booking_status = 'CANCELLED'").fetchone()["total"]
        pending = con.execute("SELECT COUNT(*) AS total FROM bookings WHERE booking_status = 'CANCELLATION_REQUESTED'").fetchone()["total"]
    assert_true(approved == 8, "admin approvals should cancel selected bookings")
    assert_true(pending == len(users) - 8, "remaining cancel requests should stay pending")
    with app.db() as con:
        con.execute(
            "UPDATE bookings SET booking_status = 'CONFIRMED', status = 'CONFIRMED', payment_status = 'PAY_AT_PICKUP', cancellation_reason = '' WHERE id = ?",
            (booked_ids[8],),
        )
        resolved = con.execute("SELECT * FROM bookings WHERE id = ?", (booked_ids[8],)).fetchone()
    assert_true(resolved["cancellation_reason"] == "" and app.booking_status_label(resolved["booking_status"], resolved["payment_status"]) == "Confirmed / Pay at pickup", "admin confirmation should resolve old request notes")

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
