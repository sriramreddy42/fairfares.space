from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import secrets
import smtplib
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from http import cookies
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from string import Template


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "fairfares.sqlite3"
OUTBOX_DIR = DATA_DIR / "outbox"
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
SESSION_COOKIE = "fairfares_session"


def load_env_file() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    candidate = hash_password(password, salt).split(":", 1)[1]
    return hmac.compare_digest(candidate, digest_hex)


def ensure_column(con: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in con.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def create_verification(user_id: int, email: str) -> str:
    token = secrets.token_urlsafe(32)
    with db() as con:
        con.execute(
            "INSERT INTO email_verifications (token, user_id, email) VALUES (?, ?, ?)",
            (token, user_id, email),
        )
    return token


def send_with_resend(email: str, subject: str, text_body: str, html_body: str) -> str:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return "not configured"

    payload = json.dumps(
        {
            "from": os.environ.get("RESEND_FROM", "FairFares <onboarding@resend.dev>"),
            "to": [email],
            "subject": subject,
            "text": text_body,
            "html": html_body,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "fairfares-local/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return f"sent through Resend ({response.status})" if 200 <= response.status < 300 else f"Resend returned {response.status}"
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        return f"Resend rejected the email ({error.code}): {detail}"
    except (OSError, TimeoutError, urllib.error.URLError) as error:
        return f"Resend request failed: {error}"


def send_activation_email(email: str, name: str, activation_link: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Activate your FairFares account"
    text_body = (
        f"Hi {name},\n\n"
        "Welcome to FairFares. Activate your account with this link:\n"
        f"{activation_link}\n\n"
        "After activation, you can sign in and manage your booking.\n"
    )
    html_body = (
        f"<p>Hi {html.escape(name)},</p>"
        "<p>Welcome to FairFares. Activate your account to finish signup.</p>"
        f'<p><a href="{html.escape(activation_link)}">Activate your FairFares account</a></p>'
        "<p>After activation, you can sign in and manage your booking.</p>"
    )

    outbox_file = OUTBOX_DIR / f"activation-{secrets.token_hex(8)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)

    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = email
        message.set_content(text_body)
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as smtp:
            if os.environ.get("SMTP_TLS", "1") != "0":
                smtp.starttls()
            smtp_user = os.environ.get("SMTP_USER")
            smtp_password = os.environ.get("SMTP_PASSWORD")
            if smtp_user and smtp_password:
                smtp.login(smtp_user, smtp_password)
            smtp.send_message(message)
        delivery_status = "sent through SMTP"

    outbox_file.write_text(
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\n\n{text_body}",
        encoding="utf-8",
    )

    return outbox_file, delivery_status


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    with db() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                role TEXT NOT NULL DEFAULT 'CUSTOMER',
                phone TEXT,
                address TEXT,
                date_of_birth TEXT,
                student_email TEXT,
                student_id TEXT,
                student_verified INTEGER NOT NULL DEFAULT 0,
                is_verified INTEGER NOT NULL DEFAULT 0,
                verified_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS email_verifications (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                used_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS site_content (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                icon TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS cars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                brand TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                year INTEGER,
                category TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT '',
                fuel_type TEXT NOT NULL DEFAULT 'Gasoline',
                seats INTEGER NOT NULL,
                bags INTEGER NOT NULL,
                doors INTEGER NOT NULL,
                transmission TEXT NOT NULL,
                daily_price REAL NOT NULL,
                total_price REAL NOT NULL,
                badge TEXT NOT NULL,
                color TEXT NOT NULL,
                features TEXT NOT NULL,
                location TEXT NOT NULL DEFAULT 'Denver International Airport (DEN)',
                image_url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'AVAILABLE',
                license_plate TEXT NOT NULL DEFAULT '',
                vin_number TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                car_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                pickup_location TEXT NOT NULL,
                pickup_date TEXT NOT NULL,
                pickup_time TEXT NOT NULL,
                dropoff_location TEXT NOT NULL,
                dropoff_date TEXT NOT NULL,
                dropoff_time TEXT NOT NULL,
                days INTEGER NOT NULL,
                total_price REAL NOT NULL,
                status TEXT NOT NULL,
                booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
                payment_status TEXT NOT NULL DEFAULT 'PAID',
                return_location TEXT NOT NULL DEFAULT '',
                cancellation_reason TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(car_id) REFERENCES cars(id)
            );

            CREATE TABLE IF NOT EXISTS driver_licenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                license_number TEXT NOT NULL,
                state TEXT NOT NULL,
                expiry_date TEXT NOT NULL,
                front_image_url TEXT NOT NULL DEFAULT '',
                back_image_url TEXT NOT NULL DEFAULT '',
                verification_status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS insurances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL,
                insurance_type TEXT NOT NULL,
                coverage_amount REAL NOT NULL DEFAULT 0,
                insurance_provider TEXT NOT NULL,
                document_url TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES bookings(id)
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL,
                payment_method TEXT NOT NULL,
                amount REAL NOT NULL,
                transaction_status TEXT NOT NULL DEFAULT 'PAID',
                invoice_number TEXT NOT NULL UNIQUE,
                invoice_pdf_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES bookings(id)
            );

            CREATE TABLE IF NOT EXISTS rental_agreements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL,
                agreement_text TEXT NOT NULL,
                signer_name TEXT NOT NULL DEFAULT '',
                signature_text TEXT NOT NULL DEFAULT '',
                signed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES bookings(id)
            );

            CREATE TABLE IF NOT EXISTS discounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                discount_type TEXT NOT NULL DEFAULT 'PERCENT',
                value REAL NOT NULL,
                valid_through TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        ensure_column(con, "users", "role", "role TEXT NOT NULL DEFAULT 'CUSTOMER'")
        ensure_column(con, "users", "phone", "phone TEXT")
        ensure_column(con, "users", "address", "address TEXT")
        ensure_column(con, "users", "date_of_birth", "date_of_birth TEXT")
        ensure_column(con, "users", "student_email", "student_email TEXT")
        ensure_column(con, "users", "student_id", "student_id TEXT")
        ensure_column(con, "users", "student_verified", "student_verified INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "is_verified", "is_verified INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "verified_at", "verified_at TEXT")
        ensure_column(con, "cars", "brand", "brand TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "cars", "model", "model TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "cars", "year", "year INTEGER")
        ensure_column(con, "cars", "type", "type TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "cars", "fuel_type", "fuel_type TEXT NOT NULL DEFAULT 'Gasoline'")
        ensure_column(con, "cars", "location", "location TEXT NOT NULL DEFAULT 'Denver International Airport (DEN)'")
        ensure_column(con, "cars", "image_url", "image_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "cars", "status", "status TEXT NOT NULL DEFAULT 'AVAILABLE'")
        ensure_column(con, "cars", "license_plate", "license_plate TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "cars", "vin_number", "vin_number TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "booking_status", "booking_status TEXT NOT NULL DEFAULT 'CONFIRMED'")
        ensure_column(con, "bookings", "payment_status", "payment_status TEXT NOT NULL DEFAULT 'PAID'")
        ensure_column(con, "bookings", "return_location", "return_location TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "cancellation_reason", "cancellation_reason TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "insurances", "document_url", "document_url TEXT NOT NULL DEFAULT ''")

        admin_exists = con.execute("SELECT 1 FROM users WHERE is_admin = 1").fetchone()
        if not admin_exists:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role) VALUES (?, ?, ?, 1, 'ADMIN')",
                ("FairFares Admin", "admin@fairfares.com", hash_password("ChangeMe123!")),
            )
        con.execute("UPDATE users SET role = 'ADMIN' WHERE is_admin = 1")

        defaults = {
            "brand": "FairFares",
            "hero_title": "Fair prices. Better rides. For students.",
            "hero_kicker": "Smart travel booking",
            "hero_body": "Affordable car rentals made for students. Wherever you go, we've got you covered.",
            "primary_cta": "Search Cars",
            "secondary_cta": "View Details",
            "poster_image": "/static/img/fairfares-poster.svg",
            "poster_caption": "Poster artwork can be replaced with your supplied campaign design.",
            "offer_title": "123 cars available",
            "offer_body": "Filter student-ready rentals by vehicle type, fuel savings, mileage, and daily price.",
            "contact_email": "hello@fairfares.com",
        }
        for key, value in defaults.items():
            con.execute(
                "INSERT OR IGNORE INTO site_content (key, value) VALUES (?, ?)",
                (key, value),
            )

        service_count = con.execute("SELECT COUNT(*) AS total FROM services").fetchone()["total"]
        if service_count == 0:
            con.executemany(
                "INSERT INTO services (title, body, icon, sort_order) VALUES (?, ?, ?, ?)",
                [
                    ("Hybrid", "Sedans & SUVs", "car", 1),
                    ("Fuel-Efficient", "Rentals", "fuel", 2),
                    ("Electric", "Vehicle Options", "bolt", 3),
                ],
            )

        car_count = con.execute("SELECT COUNT(*) AS total FROM cars").fetchone()["total"]
        if car_count == 0:
            con.executemany(
                """
                INSERT INTO cars
                (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission, daily_price, total_price, badge, color, features, location, status, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("Toyota Corolla", "Toyota", "Corolla", 2025, "Economy", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 29.99, 209.93, "Great Price", "white", "Free Cancellation|Unlimited Mileage|Fuel Efficient", "Denver International Airport (DEN)", "AVAILABLE", 1),
                    ("Nissan Sentra", "Nissan", "Sentra", 2025, "Compact", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 34.99, 244.93, "Student Deal", "charcoal", "Free Cancellation|Unlimited Mileage|Hybrid Option", "Denver International Airport (DEN)", "AVAILABLE", 2),
                    ("Hyundai Kona", "Hyundai", "Kona", 2025, "SUV", "SUV", "Electric", 5, 3, 4, "Automatic", 46.99, 328.93, "Low Deposit", "blue", "Free Cancellation|Electric Option|24/7 Support", "Denver International Airport (DEN)", "AVAILABLE", 3),
                    ("Honda Civic", "Honda", "Civic", 2025, "Midsize", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 39.99, 279.93, "Popular", "silver", "Unlimited Mileage|Safe & Reliable|Fuel Efficient", "Denver International Airport (DEN)", "AVAILABLE", 4),
                ],
            )
        con.executescript(
            """
            UPDATE cars SET brand = 'Toyota', model = 'Corolla', year = COALESCE(year, 2025), type = 'Sedan', fuel_type = 'Gasoline'
            WHERE name = 'Toyota Corolla' AND (brand = '' OR model = '' OR type = '');
            UPDATE cars SET brand = 'Nissan', model = 'Sentra', year = COALESCE(year, 2025), type = 'Sedan', fuel_type = 'Gasoline'
            WHERE name = 'Nissan Sentra' AND (brand = '' OR model = '' OR type = '');
            UPDATE cars SET brand = 'Hyundai', model = 'Kona', year = COALESCE(year, 2025), type = 'SUV', fuel_type = 'Electric'
            WHERE name = 'Hyundai Kona' AND (brand = '' OR model = '' OR type = '');
            UPDATE cars SET brand = 'Honda', model = 'Civic', year = COALESCE(year, 2025), type = 'Sedan', fuel_type = 'Gasoline'
            WHERE name = 'Honda Civic' AND (brand = '' OR model = '' OR type = '');
            UPDATE cars SET location = 'Denver International Airport (DEN)' WHERE location = '';
            UPDATE cars SET status = 'AVAILABLE' WHERE status = '';
            """
        )

        admin = con.execute("SELECT id FROM users WHERE email = ?", ("admin@fairfares.com",)).fetchone()
        toyota = con.execute("SELECT id FROM cars WHERE name = ?", ("Toyota Corolla",)).fetchone()
        booking_exists = con.execute("SELECT 1 FROM bookings WHERE booking_id = ?", ("FF123456789",)).fetchone()
        if admin and toyota and not booking_exists:
            con.execute(
                """
                INSERT INTO bookings
                (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
                 dropoff_location, dropoff_date, dropoff_time, days, total_price, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "FF123456789",
                    admin["id"],
                    toyota["id"],
                    "AVIS",
                    "Denver International Airport (DEN)",
                    "Jun 10, 2025",
                    "10:00 AM",
                    "Denver International Airport (DEN)",
                    "Jun 20, 2025",
                    "10:00 AM",
                    10,
                    209.93,
                    "CONFIRMED",
                ),
            )

        alex = con.execute("SELECT id FROM users WHERE email = ?", ("alex@student.edu",)).fetchone()
        if not alex:
            con.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                ("Alex", "alex@student.edu", hash_password("Student123!")),
            )
            alex = con.execute("SELECT id FROM users WHERE email = ?", ("alex@student.edu",)).fetchone()

        demo = con.execute("SELECT id FROM users WHERE email = ?", ("demo@fairfares.com",)).fetchone()
        if not demo:
            con.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                ("Demo Student", "demo@fairfares.com", hash_password("Demo12345!")),
            )
            demo = con.execute("SELECT id FROM users WHERE email = ?", ("demo@fairfares.com",)).fetchone()

        if demo:
            con.execute("UPDATE bookings SET user_id = ? WHERE booking_id LIKE 'FFDEMO%'", (demo["id"],))
            cars = con.execute("SELECT id, total_price FROM cars ORDER BY sort_order, id").fetchall()
            for index, car in enumerate(cars, start=1):
                demo_id = f"FFDEMO{index:03d}"
                exists = con.execute("SELECT 1 FROM bookings WHERE booking_id = ?", (demo_id,)).fetchone()
                if exists:
                    continue
                con.execute(
                    """
                    INSERT INTO bookings
                    (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
                     dropoff_location, dropoff_date, dropoff_time, days, total_price, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        demo_id,
                        demo["id"],
                        car["id"],
                        "AVIS",
                        "Denver International Airport (DEN)",
                        "Jun 10, 2025",
                        "10:00 AM",
                        "Denver International Airport (DEN)",
                        "Jun 20, 2025",
                        "10:00 AM",
                        10,
                        car["total_price"],
                        "CONFIRMED",
                    ),
                )

        if alex and toyota:
            alex_booking = con.execute("SELECT 1 FROM bookings WHERE user_id = ?", (alex["id"],)).fetchone()
            if not alex_booking:
                con.execute(
                    """
                    INSERT INTO bookings
                    (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
                     dropoff_location, dropoff_date, dropoff_time, days, total_price, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "FFALX0001",
                        alex["id"],
                        toyota["id"],
                        "AVIS",
                        "Denver International Airport (DEN)",
                        "Jun 10, 2025",
                        "10:00 AM",
                        "Denver International Airport (DEN)",
                        "Jun 20, 2025",
                        "10:00 AM",
                        10,
                        209.93,
                        "CONFIRMED",
                    ),
                )

        con.execute(
            """
            UPDATE users
            SET is_verified = 1,
                verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
            WHERE is_admin = 1
               OR email IN ('alex@student.edu', 'demo@fairfares.com')
            """
        )


def get_content() -> dict[str, str]:
    with db() as con:
        rows = con.execute("SELECT key, value FROM site_content").fetchall()
    return {row["key"]: row["value"] for row in rows}


def get_services() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM services ORDER BY sort_order, id").fetchall()


def get_cars() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM cars
            WHERE status = 'AVAILABLE'
            ORDER BY sort_order, daily_price, id
            """
        ).fetchall()


def get_inventory_locations() -> list[str]:
    with db() as con:
        rows = con.execute(
            """
            SELECT DISTINCT location FROM cars
            WHERE location != ''
            ORDER BY location
            """
        ).fetchall()
    return [row["location"] for row in rows]


def get_filter_counts() -> dict[str, list[sqlite3.Row]]:
    with db() as con:
        return {
            "types": con.execute(
                """
                SELECT COALESCE(NULLIF(category, ''), type) AS label, COUNT(*) AS total
                FROM cars
                WHERE status = 'AVAILABLE'
                GROUP BY label
                ORDER BY label
                """
            ).fetchall(),
            "fuel": con.execute(
                """
                SELECT fuel_type AS label, COUNT(*) AS total
                FROM cars
                WHERE status = 'AVAILABLE'
                GROUP BY fuel_type
                ORDER BY fuel_type
                """
            ).fetchall(),
        }


def get_active_discounts() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM discounts
            WHERE status = 'ACTIVE'
            ORDER BY valid_through, code
            """
        ).fetchall()


def get_all_discounts() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM discounts ORDER BY valid_through DESC, code").fetchall()


def get_admin_cars() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM cars ORDER BY sort_order, daily_price, id").fetchall()


def get_car(car_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute("SELECT * FROM cars WHERE id = ?", (car_id,)).fetchone()


def get_admin_bookings() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.phone,
                   users.address, users.date_of_birth,
                   cars.name AS car_name, cars.license_plate, cars.status AS car_status
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            JOIN cars ON cars.id = bookings.car_id
            ORDER BY bookings.id DESC
            LIMIT 50
            """
        ).fetchall()


def get_fleet_summary() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT COALESCE(NULLIF(category, ''), type) AS type,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available,
                   SUM(CASE WHEN status = 'BOOKED' THEN 1 ELSE 0 END) AS booked,
                   SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) AS maintenance,
                   ROUND(AVG(daily_price), 2) AS avg_daily,
                   GROUP_CONCAT(DISTINCT fuel_type) AS fuel_types
            FROM cars
            GROUP BY COALESCE(NULLIF(category, ''), type)
            ORDER BY type
            """
        ).fetchall()


def get_admin_metrics() -> dict[str, int]:
    with db() as con:
        return {
            "cars": con.execute("SELECT COUNT(*) AS total FROM cars").fetchone()["total"],
            "available": con.execute("SELECT COUNT(*) AS total FROM cars WHERE status = 'AVAILABLE'").fetchone()["total"],
            "booked": con.execute("SELECT COUNT(*) AS total FROM bookings").fetchone()["total"],
            "users": con.execute("SELECT COUNT(*) AS total FROM users WHERE is_admin = 0").fetchone()["total"],
        }


def get_booking_for_user(user_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.seats, cars.bags,
                   cars.doors, cars.transmission, cars.color
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.user_id = ?
            ORDER BY
                CASE WHEN bookings.booking_status IN ('CANCELLED', 'RETURNED') THEN 1 ELSE 0 END,
                bookings.id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()


def get_bookings_for_user(user_id: int) -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.color
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.user_id = ?
            ORDER BY bookings.id DESC
            """
            ,
            (user_id,),
        ).fetchall()


def render_user_trip_rows(bookings: list[sqlite3.Row]) -> str:
    if not bookings:
        return '<div class="mini-trip" data-trip-type="upcoming"><span>No trips yet<br><small>Book a car to see saved trips here.</small></span><b>$0.00</b></div>'
    rows = []
    for booking in bookings:
        status = booking["booking_status"]
        trip_type = "past" if status in {"CANCELLED", "RETURNED"} else "upcoming favorites"
        rows.append(
            f"""
            <div class="mini-trip" data-trip-type="{escape(trip_type)}">
              <div class="mini-car"></div>
              <span>{escape(booking["car_name"])}<br><small>{escape(booking["pickup_date"])} - {escape(booking["dropoff_date"])} · {escape(status)}</small></span>
              <b>${float(booking["total_price"]):.2f}</b>
            </div>
            """
        )
    return "\n".join(rows)


def live_status_for_booking(booking: sqlite3.Row | None) -> dict[str, str]:
    if not booking:
        return {
            "title": "No active booking yet",
            "body": "Book a car to see live pickup status here.",
            "instructions": "Pickup instructions appear after a booking is created.",
            "days": "00",
            "hours": "00",
            "mins": "00",
            "secs": "00",
        }
    status = booking["booking_status"]
    if status == "CANCELLATION_REQUESTED":
        title = "Cancellation pending approval"
        body = f"Admin is reviewing your request: {booking['cancellation_reason'] or 'Customer cancellation'}"
    elif status == "CANCELLED":
        title = "Booking cancelled"
        body = f"Cancellation reason: {booking['cancellation_reason'] or 'Customer cancellation'}"
    elif status == "PICKED_UP":
        title = "Vehicle picked up"
        body = f"{booking['car_name']} is currently with you until {booking['dropoff_date']}."
    elif status == "RETURNED":
        title = "Vehicle returned"
        body = "This trip is complete. Documents remain available in your portal."
    elif status == "MODIFIED":
        title = "Booking updated"
        body = f"Your updated pickup is {booking['pickup_date']} at {booking['pickup_time']}."
    else:
        title = "Car is ready for pickup"
        body = f"Your {booking['car_name']} is scheduled for {booking['pickup_time']} on {booking['pickup_date']}."
    return {
        "title": title,
        "body": body,
        "instructions": f"Proceed to {booking['pickup_location']} for provider counter details.",
        "days": f"{max(int(booking['days']), 0):02d}",
        "hours": "00",
        "mins": "00",
        "secs": "00",
    }


def get_demo_booking(car_id: int | None = None) -> sqlite3.Row | None:
    with db() as con:
        params: tuple[object, ...] = ()
        car_filter = ""
        if car_id:
            car_filter = "WHERE cars.id = ?"
            params = (car_id,)
        return con.execute(
            f"""
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.seats, cars.bags,
                   cars.doors, cars.transmission, cars.color
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            {car_filter}
            ORDER BY bookings.id
            LIMIT 1
            """,
            params,
        ).fetchone()


def make_booking_id() -> str:
    return f"FF{secrets.randbelow(900000000) + 100000000}"


def create_booking_for_user(user_id: int, car_id: int) -> sqlite3.Row:
    requested_car = get_car(car_id)
    available_cars = get_cars()
    car = requested_car if requested_car and requested_car["status"] == "AVAILABLE" else None
    car = car or (available_cars[0] if available_cars else get_admin_cars()[0])
    with db() as con:
        booking_id = make_booking_id()
        while con.execute("SELECT 1 FROM bookings WHERE booking_id = ?", (booking_id,)).fetchone():
            booking_id = make_booking_id()
        con.execute(
            """
            INSERT INTO bookings
            (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
             dropoff_location, dropoff_date, dropoff_time, days, total_price, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                booking_id,
                user_id,
                car["id"],
                "AVIS",
                "Denver International Airport (DEN)",
                "Jun 10, 2025",
                "10:00 AM",
                "Denver International Airport (DEN)",
                "Jun 20, 2025",
                "10:00 AM",
                10,
                car["total_price"],
                "CONFIRMED",
            ),
        )
        con.execute("UPDATE cars SET status = 'BOOKED' WHERE id = ?", (car["id"],))
    booking = get_booking_for_user(user_id)
    if not booking:
        raise RuntimeError("Booking creation failed")
    return booking


def ensure_booking_for_user(user_id: int, car_id: int | None = None) -> sqlite3.Row:
    existing = get_booking_for_user(user_id)
    if existing and not car_id:
        return existing
    if car_id:
        return create_booking_for_user(user_id, car_id)
    cars = get_cars()
    if not cars:
        cars = get_admin_cars()
    return create_booking_for_user(user_id, cars[0]["id"])


def default_agreement_text(row: sqlite3.Row) -> str:
    return (
        "VEHICLE RENTAL AGREEMENT\n\n"
        f"Agreement / Booking ID: {row['booking_id']}\n"
        f"Customer: {row['user_name']}\n"
        f"Email: {row['user_email']}\n"
        f"Phone: {row['phone'] or ''}\n"
        f"Address: {row['address'] or ''}\n\n"
        f"Vehicle: {row['car_name']}\n"
        f"License Plate: {row['license_plate'] or ''}\n"
        f"Pickup Location: {row['pickup_location']}\n"
        f"Return Location: {row['dropoff_location']}\n"
        f"Pickup Date/Time: {row['pickup_date']} {row['pickup_time']}\n"
        f"Return Date/Time: {row['dropoff_date']} {row['dropoff_time']}\n"
        f"Total Amount: ${float(row['total_price']):.2f}\n\n"
        "Customer confirms the vehicle condition, rental dates, payment responsibility, "
        "driver license information, insurance details, and return obligations. Final legal "
        "agreement wording will be replaced with the provided FairFares rental agreement template.\n\n"
        "Customer Signature: ______________________________\n"
        "FairFares Representative: ________________________\n"
    )


def get_booking_documents(booking_id: int | None) -> dict[str, dict[str, str]]:
    if not booking_id:
        return {}
    with db() as con:
        booking = con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.phone,
                   users.address, cars.name AS car_name, cars.license_plate
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.id = ?
            """,
            (booking_id,),
        ).fetchone()
        if not booking:
            return {}
        agreement = con.execute(
            "SELECT * FROM rental_agreements WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
            (booking_id,),
        ).fetchone()
        insurance = con.execute(
            "SELECT * FROM insurances WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
            (booking_id,),
        ).fetchone()
        transaction = con.execute(
            "SELECT * FROM transactions WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
            (booking_id,),
        ).fetchone()
        license_row = con.execute(
            "SELECT * FROM driver_licenses WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            (booking["user_id"],),
        ).fetchone()

    invoice_number = transaction["invoice_number"] if transaction else f"INV-{booking['booking_id']}"
    payment_method = transaction["payment_method"] if transaction else "Payment on file"
    transaction_status = transaction["transaction_status"] if transaction else booking["payment_status"]
    agreement_text = agreement["agreement_text"] if agreement else default_agreement_text(booking)
    insurance_line = (
        f"{insurance['insurance_provider']} · {insurance['insurance_type']} · Coverage ${float(insurance['coverage_amount']):.2f}"
        if insurance
        else "Insurance details not captured yet."
    )
    license_line = (
        f"{license_row['state']} license ending {license_row['license_number'][-4:]} · {license_row['verification_status']}"
        if license_row and license_row["license_number"]
        else "Driver license not captured yet."
    )
    tax_amount = float(booking["total_price"]) * 0.0825
    fee_amount = float(booking["total_price"]) * 0.045
    base_amount = float(booking["total_price"]) - tax_amount - fee_amount

    return {
        "Invoice / Receipt": {
            "title": "Invoice / Receipt",
            "content": (
                f"Invoice: {invoice_number}\n"
                f"Booking: {booking['booking_id']}\n"
                f"Customer: {booking['user_name']} · {booking['user_email']}\n"
                f"Vehicle: {booking['car_name']}\n"
                f"Dates: {booking['pickup_date']} {booking['pickup_time']} to {booking['dropoff_date']} {booking['dropoff_time']}\n"
                f"Payment: {payment_method} · {transaction_status}\n"
                f"Total paid: ${float(booking['total_price']):.2f}"
            ),
            "status": f"Generated from booking {booking['booking_id']} and admin payment records.",
        },
        "Rental Agreement": {
            "title": "Rental Agreement",
            "content": (
                f"{agreement_text}\n\n"
                f"DL: {license_line}\n"
                f"Insurance: {insurance_line}\n"
                f"Signature: {agreement['signature_text'] if agreement and agreement['signature_text'] else 'Pending'}"
            ),
            "status": "Generated from admin pickup data and saved agreement record.",
        },
        "Taxes & Fees Breakdown": {
            "title": "Taxes & Fees Breakdown",
            "content": (
                f"Booking: {booking['booking_id']}\n"
                f"Rental subtotal: ${base_amount:.2f}\n"
                f"Taxes estimate: ${tax_amount:.2f}\n"
                f"Airport/provider fees estimate: ${fee_amount:.2f}\n"
                f"Insurance: {insurance_line}\n"
                f"Final total: ${float(booking['total_price']):.2f}"
            ),
            "status": "Generated from booking total, insurance, and invoice records.",
        },
    }


def render_template(template_name: str, **context: object) -> bytes:
    template = Template((TEMPLATE_DIR / template_name).read_text())
    safe_context = {key: value for key, value in context.items()}
    return template.safe_substitute(safe_context).encode()


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


class FairFaresHandler(SimpleHTTPRequestHandler):
    server_version = "FairFares/1.0"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/static/"):
            self.serve_static(parsed.path)
            return
        routes = {
            "/": self.home,
            "/activate": self.activate_account,
            "/healthz": self.healthz,
            "/login": self.login_page,
            "/signup": self.signup_page,
            "/manage-booking": self.manage_booking,
            "/dashboard": self.dashboard,
            "/admin": self.admin_portal,
            "/admin/bookings": self.admin_bookings_page,
            "/admin/discounts": self.admin_discounts_page,
            "/admin/pickup": self.admin_pickup_page,
            "/logout": self.logout,
            "/api/site": self.api_site,
            "/api/cars": self.api_cars,
        }
        handler = routes.get(parsed.path)
        if handler:
            handler()
        else:
            self.not_found()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        routes = {
            "/login": self.login,
            "/signup": self.signup,
            "/bookings/modify": self.update_user_booking,
            "/bookings/cancel": self.cancel_user_booking,
            "/student-verification": self.update_student_verification,
            "/admin/content": self.update_content,
            "/admin/cars": self.create_admin_car,
            "/admin/cars/status": self.update_admin_car_status,
            "/admin/cars/delete": self.delete_admin_car,
            "/admin/bookings/status": self.update_admin_booking_status,
            "/admin/discounts": self.create_admin_discount,
            "/admin/discounts/delete": self.delete_admin_discount,
            "/admin/pickup-documents": self.save_pickup_documents,
        }
        handler = routes.get(parsed.path)
        if handler:
            handler()
        else:
            self.not_found()

    def read_form(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode()
        parsed = urllib.parse.parse_qs(body)
        return {key: values[0].strip() for key, values in parsed.items()}

    def current_user(self) -> sqlite3.Row | None:
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(header)
        morsel = jar.get(SESSION_COOKIE)
        if not morsel:
            return None
        with db() as con:
            return con.execute(
                """
                SELECT users.* FROM users
                JOIN sessions ON sessions.user_id = users.id
                WHERE sessions.token = ?
                """,
                (morsel.value,),
            ).fetchone()

    def send_html(self, body: bytes, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, path: str) -> None:
        self.send_response(303)
        self.send_header("Location", path)
        self.end_headers()

    def healthz(self) -> None:
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def set_session(self, user_id: int) -> None:
        token = secrets.token_urlsafe(32)
        with db() as con:
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        self.send_response(303)
        self.send_header("Location", "/dashboard")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()

    def activation_url(self, token: str) -> str:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        if public_base_url:
            return f"{public_base_url}/activate?token={urllib.parse.quote(token)}"
        host = self.headers.get("Host") or "127.0.0.1:8000"
        scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
        return f"{scheme}://{host}/activate?token={urllib.parse.quote(token)}"

    def activation_pending_page(self, email: str, outbox_file: Path, activation_link: str, message: str = "", delivery_status: str = "") -> None:
        self.send_html(
            render_template(
                "activation_pending.html",
                email=escape(email),
                outbox_file=escape(outbox_file.relative_to(BASE_DIR) if outbox_file.is_relative_to(BASE_DIR) else outbox_file),
                activation_link=escape(activation_link),
                message=escape(message or "We sent an activation link to your email."),
                delivery_status=escape(delivery_status or "Local activation backup saved."),
            )
        )

    def activation_message_page(self, title: str, message: str, action_label: str = "Back to Login", action_url: str = "/login") -> None:
        self.send_html(
            render_template(
                "activation_message.html",
                title=escape(title),
                message=escape(message),
                action_label=escape(action_label),
                action_url=escape(action_url),
            )
        )

    def home(self) -> None:
        content = get_content()
        user = self.current_user()
        services = "\n".join(
            f"""
            <div class="benefit-pill">
                <span class="circle-icon">{escape(row["icon"])}</span>
                <strong>{escape(row["title"])}</strong>
                <span>{escape(row["body"])}</span>
            </div>
            """
            for row in get_services()
        )
        car_rows = get_cars()
        cars = "\n".join(self.render_car_card(row) for row in car_rows)
        filter_counts = get_filter_counts()
        location_options = "\n".join(
            f"<option>{escape(location)}</option>"
            for location in get_inventory_locations()
        ) or "<option>Denver International Airport (DEN)</option>"
        type_filters = "\n".join(
            f'<label><input type="checkbox" value="{escape(row["label"])}" class="type-filter"> {escape(row["label"])} ({row["total"]})</label>'
            for row in filter_counts["types"]
        )
        fuel_filters = "\n".join(
            f'<label><input type="checkbox" value="{escape(row["label"])}" class="fuel-filter"> {escape(row["label"])} ({row["total"]})</label>'
            for row in filter_counts["fuel"]
        )
        discounts_json = json.dumps(
            [
                {
                    "code": row["code"],
                    "type": row["discount_type"],
                    "value": row["value"],
                    "validThrough": row["valid_through"],
                    "status": row["status"],
                }
                for row in get_active_discounts()
            ]
        )
        body = render_template(
            "index.html",
            brand=escape(content["brand"]),
            hero_title=escape(content["hero_title"]),
            hero_kicker=escape(content["hero_kicker"]),
            hero_body=escape(content["hero_body"]),
            primary_cta=escape(content["primary_cta"]),
            secondary_cta=escape(content["secondary_cta"]),
            poster_image=escape(content["poster_image"]),
            poster_caption=escape(content["poster_caption"]),
            offer_title=escape(content["offer_title"]),
            offer_body=escape(content["offer_body"]),
            contact_email=escape(content["contact_email"]),
            services=services,
            cars=cars,
            car_count=escape(len(car_rows)),
            location_options=location_options,
            type_filters=type_filters,
            fuel_filters=fuel_filters,
            discounts_json=escape(discounts_json),
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def render_car_card(self, row: sqlite3.Row) -> str:
        features = "".join(f"<li>{escape(feature)}</li>" for feature in row["features"].split("|"))
        return f"""
        <article class="car-card" data-category="{escape(row["category"])}" data-fuel="{escape(row["fuel_type"])}" data-location="{escape(row["location"])}" data-price="{row["daily_price"]}">
            <div class="car-art car-{escape(row["color"])}">
                <span class="deal-badge">{escape(row["badge"])}</span>
                <div class="car-shape"></div>
            </div>
            <div class="car-info">
                <h3>{escape(row["name"])}</h3>
                <p>or similar <span>|</span> {escape(row["category"])}</p>
                <div class="specs">
                    <span>{row["seats"]} seats</span>
                    <span>{row["bags"]} bags</span>
                    <span>{row["doors"]} doors</span>
                    <span>{escape(row["transmission"])}</span>
                </div>
                <ul>{features}</ul>
            </div>
            <div class="price-box">
                <strong>${row["daily_price"]:.2f}</strong><span>/day</span>
                <small>${row["total_price"]:.2f} total</small>
                <a class="select-button" href="/manage-booking?car_id={row["id"]}">Select</a>
                <a class="details-link" href="/api/cars">View Details</a>
            </div>
        </article>
        """

    def login_page(self, error: str = "") -> None:
        self.send_html(
            render_template(
                "auth.html",
                mode="Welcome Back!",
                submit_label="Sign In",
                action="/login",
                switch_url="/signup",
                switch_label="Sign Up",
                intro_text="Sign in to continue your journey.",
                error=escape(error),
                name_field="",
                password_autocomplete="current-password",
            )
        )

    def signup_page(self, error: str = "") -> None:
        name_field = """
        <label>
          <span>Name</span>
          <input name="name" autocomplete="name">
        </label>
        """
        self.send_html(
            render_template(
                "auth.html",
                mode="Sign up",
                submit_label="Sign Up",
                action="/signup",
                switch_url="/login",
                switch_label="Log in",
                intro_text="Create your account to start booking.",
                error=escape(error),
                name_field=name_field,
                password_autocomplete="new-password",
            )
        )

    def login(self) -> None:
        form = self.read_form()
        with db() as con:
            user = con.execute("SELECT * FROM users WHERE email = ?", (form.get("email", "").lower(),)).fetchone()
        if not user or not verify_password(form.get("password", ""), user["password_hash"]):
            self.login_page("That email and password did not match.")
            return
        if not user["is_verified"]:
            token = create_verification(user["id"], user["email"])
            link = self.activation_url(token)
            outbox_file, delivery_status = send_activation_email(user["email"], user["name"], link)
            self.activation_pending_page(
                user["email"],
                outbox_file,
                link,
                "Your account is not activated yet, so we sent a fresh activation link.",
                delivery_status,
            )
            return
        self.set_session(user["id"])

    def signup(self) -> None:
        form = self.read_form()
        name = form.get("name") or "FairFares Member"
        email = form.get("email", "").lower()
        password = form.get("password", "")
        if "@" not in email or len(password) < 8:
            self.signup_page("Use a valid email and a password with at least 8 characters.")
            return
        try:
            with db() as con:
                con.execute(
                    "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 0)",
                    (name, email, hash_password(password)),
                )
                user_id = con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        except sqlite3.IntegrityError:
            self.signup_page("An account with that email already exists.")
            return
        token = create_verification(user_id, email)
        link = self.activation_url(token)
        outbox_file, delivery_status = send_activation_email(email, name, link)
        message = "We sent an activation link to your email."
        if not delivery_status.startswith("sent"):
            message = "Your activation link is ready, but the email provider did not deliver it."
        self.activation_pending_page(email, outbox_file, link, message, delivery_status)

    def activate_account(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        token = query.get("token", [""])[0]
        if not token:
            self.activation_message_page("Activation link missing", "Please use the activation link from your FairFares email.")
            return
        with db() as con:
            verification = con.execute(
                """
                SELECT email_verifications.*, users.is_verified
                FROM email_verifications
                JOIN users ON users.id = email_verifications.user_id
                WHERE token = ?
                """,
                (token,),
            ).fetchone()
            if not verification:
                self.activation_message_page("Activation link invalid", "That activation link is not valid. Try signing in to receive a fresh link.")
                return
            if verification["used_at"] and verification["is_verified"]:
                self.activation_message_page("Account already activated", "Your FairFares account is already active.", "Go to Login", "/login")
                return
            con.execute(
                """
                UPDATE users
                SET is_verified = 1,
                    verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
                WHERE id = ?
                """,
                (verification["user_id"],),
            )
            con.execute("UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE token = ?", (token,))
        self.set_session(verification["user_id"])

    def update_user_booking(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        form = self.read_form()
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.not_found()
            return
        with db() as con:
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
                WHERE id = ? AND user_id = ?
                """,
                (
                    form.get("pickup_date") or booking["pickup_date"],
                    form.get("pickup_time") or booking["pickup_time"],
                    form.get("return_date") or booking["dropoff_date"],
                    form.get("return_time") or booking["dropoff_time"],
                    form.get("pickup_location") or booking["pickup_location"],
                    form.get("dropoff_location") or booking["dropoff_location"],
                    form.get("dropoff_location") or booking["dropoff_location"],
                    "Customer modified reservation",
                    booking["id"],
                    user["id"],
                ),
            )
        self.send_json({"ok": True, "message": "Reservation changes saved and visible to admin."})

    def cancel_user_booking(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        form = self.read_form()
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.not_found()
            return
        reason = form.get("reason") or "Customer cancellation"
        note = form.get("note", "")
        if note:
            reason = f"{reason}: {note}"
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'CANCELLATION_REQUESTED',
                    status = 'CANCELLATION_REQUESTED',
                    payment_status = CASE WHEN payment_status = 'PAID' THEN 'REFUND_REVIEW' ELSE payment_status END,
                    cancellation_reason = ?
                WHERE id = ? AND user_id = ?
                """,
                (reason, booking["id"], user["id"]),
            )
        self.send_json({"ok": True, "message": "Cancellation request sent to admin for approval."})

    def update_student_verification(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        form = self.read_form()
        student_email = form.get("student_email", "")
        student_id = form.get("student_id", "")
        verified = 1 if "@" in student_email and len(student_id) >= 4 else 0
        with db() as con:
            con.execute(
                """
                UPDATE users
                SET student_email = ?,
                    student_id = ?,
                    student_verified = ?
                WHERE id = ?
                """,
                (student_email, student_id, verified, user["id"]),
            )
        message = "Student verification saved. Discount applied." if verified else "Add a valid student email and student ID."
        self.send_json({"ok": bool(verified), "message": message})

    def dashboard(self) -> None:
        user = self.current_user()
        if not user:
            self.redirect("/login")
            return
        if user["is_admin"]:
            self.redirect("/admin")
            return
        self.render_manage_booking(user)

    def require_admin(self) -> sqlite3.Row | None:
        user = self.current_user()
        if not user:
            self.redirect("/login")
            return None
        if not user["is_admin"]:
            self.redirect("/dashboard")
            return None
        return user

    def admin_portal(self) -> None:
        user = self.require_admin()
        if not user:
            return
        metrics = get_admin_metrics()
        cars = "\n".join(self.render_admin_car_row(row) for row in get_admin_cars())
        fleet_summary = "\n".join(self.render_fleet_summary_row(row) for row in get_fleet_summary())
        body = render_template(
            "admin.html",
            admin_name=escape(user["name"]),
            total_cars=metrics["cars"],
            available_cars=metrics["available"],
            booked_count=metrics["booked"],
            user_count=metrics["users"],
            cars=cars or '<tr><td colspan="8">No inventory yet.</td></tr>',
            fleet_summary=fleet_summary or '<tr><td colspan="7">No fleet data yet.</td></tr>',
        )
        self.send_html(body)

    def admin_bookings_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        bookings = "\n".join(self.render_admin_booking_row(row) for row in get_admin_bookings())
        body = render_template(
            "admin_bookings.html",
            admin_name=escape(user["name"]),
            bookings=bookings or '<tr><td colspan="7">No bookings yet.</td></tr>',
        )
        self.send_html(body)

    def admin_discounts_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        discounts = "\n".join(self.render_discount_row(row) for row in get_all_discounts())
        body = render_template(
            "admin_discounts.html",
            admin_name=escape(user["name"]),
            discounts=discounts or '<tr><td colspan="6">No discount codes yet.</td></tr>',
        )
        self.send_html(body)

    def admin_pickup_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        records = "\n".join(self.render_pickup_record(row) for row in get_admin_bookings())
        body = render_template(
            "admin_pickup.html",
            admin_name=escape(user["name"]),
            records=records or '<p class="admin-empty">No pickup records yet.</p>',
        )
        self.send_html(body)

    def render_admin_car_row(self, row: sqlite3.Row) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["status"] == status else ""}>{status}</option>'
            for status in ("AVAILABLE", "BOOKED", "MAINTENANCE")
        )
        return f"""
        <tr>
            <td><b>{escape(row["name"])}</b><span>{escape(row["brand"] or "-")} {escape(row["model"] or "")}</span></td>
            <td>{escape(row["year"] or "-")}</td>
            <td>{escape(row["type"] or row["category"])}</td>
            <td>{escape(row["fuel_type"])}</td>
            <td>{escape(row["location"])}</td>
            <td>${row["daily_price"]:.2f}</td>
            <td>
                <form method="post" action="/admin/cars/status" class="inline-form">
                    <input type="hidden" name="car_id" value="{row["id"]}">
                    <select name="status">{status_options}</select>
                    <button type="submit">Update</button>
                </form>
            </td>
            <td>
                <form method="post" action="/admin/cars/delete" class="inline-form">
                    <input type="hidden" name="car_id" value="{row["id"]}">
                    <button class="danger-button" type="submit">Delete</button>
                </form>
            </td>
        </tr>
        """

    def render_admin_booking_row(self, row: sqlite3.Row) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["booking_status"] == status else ""}>{status}</option>'
            for status in ("CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "CANCELLED", "PICKED_UP", "RETURNED")
        )
        payment_options = "".join(
            f'<option value="{status}" {"selected" if row["payment_status"] == status else ""}>{status}</option>'
            for status in ("PENDING", "PAID", "FAILED", "REFUND_REVIEW", "REFUNDED")
        )
        request_note = ""
        if row["booking_status"] == "CANCELLATION_REQUESTED":
            request_note = '<small class="approval-note">Approval requested: choose CANCELLED to approve, or CONFIRMED/MODIFIED to keep booking.</small>'
        return f"""
        <tr>
            <td><b>{escape(row["booking_id"])}</b><span>{escape(row["booking_status"])}</span></td>
            <td>{escape(row["user_name"])}<span>{escape(row["user_email"])}</span></td>
            <td>{escape(row["car_name"])}</td>
            <td>{escape(row["pickup_date"])} - {escape(row["dropoff_date"])}</td>
            <td>${row["total_price"]:.2f}</td>
            <td>
                <form method="post" action="/admin/bookings/status" class="admin-stack-form">
                    <input type="hidden" name="booking_id" value="{row["id"]}">
                    <select name="booking_status">{status_options}</select>
                    <select name="payment_status">{payment_options}</select>
                    <input name="reason" value="{escape(row["cancellation_reason"])}" placeholder="Reason / notes">
                    {request_note}
                    <button type="submit">Save</button>
                </form>
            </td>
            <td><a class="admin-text-link" href="/admin/pickup">Open Pickup</a></td>
        </tr>
        """

    def render_pickup_record(self, row: sqlite3.Row) -> str:
        with db() as con:
            license_row = con.execute(
                "SELECT * FROM driver_licenses WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (row["user_id"],),
            ).fetchone()
            insurance = con.execute(
                "SELECT * FROM insurances WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            transaction = con.execute(
                "SELECT * FROM transactions WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            agreement = con.execute(
                "SELECT * FROM rental_agreements WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
        agreement_text = agreement["agreement_text"] if agreement else default_agreement_text(row)
        return f"""
        <article class="pickup-record" data-search="{escape((row["booking_id"] + " " + row["user_name"] + " " + row["user_email"] + " " + row["car_name"]).lower())}">
            <div class="pickup-record-head">
                <div>
                    <h2>{escape(row["booking_id"])} · {escape(row["user_name"])}</h2>
                    <p>{escape(row["user_email"])} · {escape(row["car_name"])} · {escape(row["pickup_date"])} to {escape(row["dropoff_date"])}</p>
                </div>
                <button type="button" data-print-record>Print Agreement</button>
            </div>
            <div class="pickup-status-grid">
                <span><b>DL</b>{escape(license_row["verification_status"] if license_row else "Not captured")}</span>
                <span><b>Insurance</b>{escape(insurance["insurance_provider"] if insurance else "Not captured")}</span>
                <span><b>Payment</b>{escape(transaction["transaction_status"] if transaction else row["payment_status"])}</span>
                <span><b>Agreement</b>{escape("Signed" if agreement and agreement["signature_text"] else "Pending")}</span>
            </div>
            <form method="post" action="/admin/pickup-documents" class="pickup-form">
                <input type="hidden" name="booking_id" value="{row["id"]}">
                <input type="hidden" name="user_id" value="{row["user_id"]}">
                <label><span>Customer Full Name</span><input name="customer_name" value="{escape(row["user_name"])}"></label>
                <label><span>Phone</span><input name="phone" value="{escape(row["phone"] or "")}" placeholder="Customer phone"></label>
                <label><span>Address</span><input name="address" value="{escape(row["address"] or "")}" placeholder="Customer address"></label>
                <label><span>Date of Birth</span><input name="date_of_birth" type="date" value="{escape(row["date_of_birth"] or "")}"></label>
                <label><span>DL Number</span><input name="license_number" value="{escape(license_row["license_number"] if license_row else "")}" placeholder="Scan or enter DL"></label>
                <label><span>DL State</span><input name="license_state" value="{escape(license_row["state"] if license_row else "CO")}"></label>
                <label><span>DL Expiry</span><input name="license_expiry" type="date" value="{escape(license_row["expiry_date"] if license_row else "2028-12-31")}"></label>
                <label><span>DL Front Scan URL/Path</span><input name="front_image_url" value="{escape(license_row["front_image_url"] if license_row else "")}" placeholder="Scan path or uploaded file URL"></label>
                <label><span>DL Back Scan URL/Path</span><input name="back_image_url" value="{escape(license_row["back_image_url"] if license_row else "")}" placeholder="Scan path or uploaded file URL"></label>
                <label><span>Insurance Provider</span><input name="insurance_provider" value="{escape(insurance["insurance_provider"] if insurance else "")}"></label>
                <label><span>Insurance Type</span><input name="insurance_type" value="{escape(insurance["insurance_type"] if insurance else "Rental coverage")}"></label>
                <label><span>Coverage Amount</span><input name="coverage_amount" type="number" step="0.01" value="{escape(insurance["coverage_amount"] if insurance else "0")}"></label>
                <label><span>Insurance Scan URL/Path</span><input name="insurance_document_url" value="{escape(insurance["document_url"] if insurance else "")}" placeholder="Insurance file URL or scan path"></label>
                <label><span>Payment Method</span><input name="payment_method" value="{escape(transaction["payment_method"] if transaction else "")}" placeholder="Card / Cash / Online"></label>
                <label><span>Insurance Price</span><input name="insurance_price" type="number" step="0.01" value="{escape(insurance["price"] if insurance else "0")}"></label>
                <label class="wide-field"><span>Agreement Text</span><textarea name="agreement_text" rows="7">{escape(agreement_text)}</textarea></label>
                <label><span>Signer Name</span><input name="signer_name" value="{escape(agreement["signer_name"] if agreement else row["user_name"])}"></label>
                <label><span>Signature</span><input name="signature_text" value="{escape(agreement["signature_text"] if agreement else "")}" placeholder="Typed signature"></label>
                <button type="submit">Save User Pickup Data</button>
            </form>
        </article>
        """

    def render_discount_row(self, row: sqlite3.Row) -> str:
        value = f'{row["value"]:.2f}%' if row["discount_type"] == "PERCENT" else f'${row["value"]:.2f}'
        return f"""
        <tr>
            <td><b>{escape(row["code"])}</b><span>{escape(row["description"])}</span></td>
            <td>{escape(row["discount_type"])}</td>
            <td>{value}</td>
            <td>{escape(row["valid_through"])}</td>
            <td>{escape(row["status"])}</td>
            <td>
                <form method="post" action="/admin/discounts/delete" class="inline-form">
                    <input type="hidden" name="discount_id" value="{row["id"]}">
                    <button class="danger-button" type="submit">Delete</button>
                </form>
            </td>
        </tr>
        """

    def render_fleet_summary_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
            <td><b>{escape(row["type"])}</b><span>{escape(row["fuel_types"] or "-")}</span></td>
            <td>{row["total"]}</td>
            <td>{row["available"]}</td>
            <td>{row["booked"]}</td>
            <td>{row["maintenance"]}</td>
            <td>${float(row["avg_daily"] or 0):.2f}</td>
            <td>Free maintenance tracking ready</td>
        </tr>
        """

    def create_admin_car(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        brand = form.get("brand", "")
        model = form.get("model", "")
        name = f"{brand} {model}".strip() or form.get("name", "New Car")
        daily_price = float(form.get("daily_price") or 0)
        days = int(form.get("days") or 7)
        with db() as con:
            con.execute(
                """
                INSERT INTO cars
                (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission,
                 daily_price, total_price, badge, color, features, location, image_url, status,
                 license_plate, vin_number, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    brand,
                    model,
                    int(form.get("year") or 2026),
                    form.get("category") or form.get("type") or "Economy",
                    form.get("type") or "Sedan",
                    form.get("fuel_type") or "Gasoline",
                    int(form.get("seats") or 5),
                    int(form.get("bags") or 2),
                    int(form.get("doors") or 4),
                    form.get("transmission") or "Automatic",
                    daily_price,
                    daily_price * days,
                    form.get("badge") or "Available",
                    form.get("color") or "white",
                    form.get("features") or "Free Cancellation|Unlimited Mileage|24/7 Support",
                    form.get("location") or "Denver International Airport (DEN)",
                    form.get("image_url") or "",
                    form.get("status") or "AVAILABLE",
                    form.get("license_plate") or "",
                    form.get("vin_number") or "",
                    int(form.get("sort_order") or 99),
                ),
            )
        self.redirect("/admin")

    def update_admin_car_status(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        status = form.get("status", "AVAILABLE")
        if status not in {"AVAILABLE", "BOOKED", "MAINTENANCE"}:
            status = "AVAILABLE"
        with db() as con:
            con.execute("UPDATE cars SET status = ? WHERE id = ?", (status, form.get("car_id")))
        self.redirect("/admin")

    def delete_admin_car(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            booked = con.execute("SELECT 1 FROM bookings WHERE car_id = ? LIMIT 1", (form.get("car_id"),)).fetchone()
            if booked:
                con.execute("UPDATE cars SET status = 'MAINTENANCE' WHERE id = ?", (form.get("car_id"),))
            else:
                con.execute("DELETE FROM cars WHERE id = ?", (form.get("car_id"),))
        self.redirect("/admin")

    def update_admin_booking_status(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        booking_status = form.get("booking_status", "CONFIRMED")
        payment_status = form.get("payment_status", "PAID")
        if booking_status not in {"CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "CANCELLED", "PICKED_UP", "RETURNED"}:
            booking_status = "CONFIRMED"
        if payment_status not in {"PENDING", "PAID", "FAILED", "REFUND_REVIEW", "REFUNDED"}:
            payment_status = "PAID"
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = ?,
                    payment_status = ?,
                    status = ?,
                    cancellation_reason = ?
                WHERE id = ?
                """,
                (booking_status, payment_status, booking_status, form.get("reason", ""), form.get("booking_id")),
            )
            if booking_status == "CANCELLED":
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'AVAILABLE'
                    WHERE id = (SELECT car_id FROM bookings WHERE id = ?)
                    """,
                    (form.get("booking_id"),),
                )
            elif booking_status in {"CONFIRMED", "MODIFIED", "PICKED_UP", "CANCELLATION_REQUESTED"}:
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'BOOKED'
                    WHERE id = (SELECT car_id FROM bookings WHERE id = ?)
                    """,
                    (form.get("booking_id"),),
                )
            elif booking_status == "RETURNED":
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'AVAILABLE'
                    WHERE id = (SELECT car_id FROM bookings WHERE id = ?)
                    """,
                    (form.get("booking_id"),),
                )
        self.redirect("/admin/bookings")

    def create_admin_discount(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        code = form.get("code", "").upper()
        if not code:
            self.redirect("/admin/discounts")
            return
        discount_type = form.get("discount_type", "PERCENT")
        if discount_type not in {"PERCENT", "AMOUNT"}:
            discount_type = "PERCENT"
        with db() as con:
            con.execute(
                """
                INSERT OR REPLACE INTO discounts
                (code, description, discount_type, value, valid_through, status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    code,
                    form.get("description", ""),
                    discount_type,
                    float(form.get("value") or 0),
                    form.get("valid_through") or "2026-12-31",
                    form.get("status") or "ACTIVE",
                ),
            )
        self.redirect("/admin/discounts")

    def delete_admin_discount(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM discounts WHERE id = ?", (form.get("discount_id"),))
        self.redirect("/admin/discounts")

    def save_pickup_documents(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        booking_id = form.get("booking_id")
        user_id = form.get("user_id")
        with db() as con:
            con.execute(
                """
                UPDATE users
                SET name = COALESCE(NULLIF(?, ''), name),
                    phone = COALESCE(NULLIF(?, ''), phone),
                    address = COALESCE(NULLIF(?, ''), address),
                    date_of_birth = COALESCE(NULLIF(?, ''), date_of_birth)
                WHERE id = ?
                """,
                (
                    form.get("customer_name", ""),
                    form.get("phone", ""),
                    form.get("address", ""),
                    form.get("date_of_birth", ""),
                    user_id,
                ),
            )
            if form.get("license_number"):
                con.execute(
                    """
                    INSERT INTO driver_licenses
                    (user_id, license_number, state, expiry_date, front_image_url, back_image_url, verification_status)
                    VALUES (?, ?, ?, ?, ?, ?, 'VERIFIED')
                    """,
                    (
                        user_id,
                        form.get("license_number"),
                        form.get("license_state") or "CO",
                        form.get("license_expiry") or "2028-12-31",
                        form.get("front_image_url", ""),
                        form.get("back_image_url", ""),
                    ),
                )
            if form.get("insurance_provider"):
                con.execute(
                    """
                    INSERT INTO insurances
                    (booking_id, insurance_type, coverage_amount, insurance_provider, document_url, price)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        booking_id,
                        form.get("insurance_type") or "Rental coverage",
                        float(form.get("coverage_amount") or 0),
                        form.get("insurance_provider"),
                        form.get("insurance_document_url", ""),
                        float(form.get("insurance_price") or 0),
                    ),
                )
            if form.get("payment_method"):
                invoice_number = f"INV-{secrets.randbelow(900000) + 100000}"
                amount = con.execute("SELECT total_price FROM bookings WHERE id = ?", (booking_id,)).fetchone()
                con.execute(
                    """
                    INSERT INTO transactions
                    (booking_id, payment_method, amount, transaction_status, invoice_number)
                    VALUES (?, ?, ?, 'PAID', ?)
                    """,
                    (booking_id, form.get("payment_method"), float(amount["total_price"] if amount else 0), invoice_number),
                )
            if form.get("agreement_text") or form.get("signature_text"):
                con.execute(
                    """
                    INSERT INTO rental_agreements
                    (booking_id, agreement_text, signer_name, signature_text, signed_at)
                    VALUES (?, ?, ?, ?, CASE WHEN ? != '' THEN CURRENT_TIMESTAMP ELSE NULL END)
                    """,
                    (
                        booking_id,
                        form.get("agreement_text", ""),
                        form.get("signer_name", ""),
                        form.get("signature_text", ""),
                        form.get("signature_text", ""),
                    ),
                )
        self.redirect("/admin/pickup")

    def manage_booking(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        selected_car_id = None
        try:
            selected_car_id = int(query.get("car_id", [""])[0])
        except ValueError:
            selected_car_id = None
        self.render_manage_booking(self.current_user(), selected_car_id)

    def render_manage_booking(self, user: sqlite3.Row | None, selected_car_id: int | None = None) -> None:
        if user and selected_car_id:
            booking = ensure_booking_for_user(user["id"], selected_car_id)
        elif user:
            booking = get_booking_for_user(user["id"])
        else:
            booking = get_demo_booking(selected_car_id) or get_demo_booking()
        content = get_content()
        current_car_name = booking["car_name"] if booking else "Select a car"
        available_cars = get_cars()
        user_bookings = get_bookings_for_user(user["id"]) if user else ([booking] if booking else [])
        is_first_time_user = bool(user and not user_bookings)
        trip_rows = render_user_trip_rows(user_bookings)
        upcoming_count = sum(1 for row in user_bookings if row["booking_status"] not in {"CANCELLED", "RETURNED"})
        past_count = sum(1 for row in user_bookings if row["booking_status"] in {"CANCELLED", "RETURNED"})
        live_status = live_status_for_booking(booking)
        upgrade_options = "\n".join(
            f"""
            <label>
                <input type="radio" name="vehicle" value="{escape(car["name"])}" data-price="{car["total_price"]:.2f}" {"checked" if car["name"] == current_car_name else ""}>
                <span><b>{escape(car["name"])}</b><small>{escape(car["category"])}{" | Current booking" if car["name"] == current_car_name else " | Upgrade option"}</small></span>
                <strong>${car["total_price"]:.2f}</strong>
            </label>
            """
            for car in available_cars
        )
        upgrade_select_options = "\n".join(
            f'<option value="{escape(car["name"])}" data-price="{car["total_price"]:.2f}" {"selected" if car["name"] == current_car_name else ""}>{escape(car["name"])} - {escape(car["category"])} - ${car["total_price"]:.2f}</option>'
            for car in available_cars
        )
        editable = ["hero_kicker", "hero_title", "hero_body", "primary_cta", "secondary_cta", "poster_image", "poster_caption", "offer_title", "offer_body", "contact_email"]
        fields = "\n".join(
            f"""
            <label>
                <span>{escape(key.replace("_", " ").title())}</span>
                <textarea name="{escape(key)}" rows="2">{escape(content.get(key, ""))}</textarea>
            </label>
            """
            for key in editable
        )
        admin_panel = ""
        if user and user["is_admin"]:
            admin_panel = f"""
            <section class="panel editor-panel">
                <div>
                    <p class="eyebrow">Poster CMS</p>
                    <h2>Edit homepage content</h2>
                </div>
                <form method="post" action="/admin/content" class="editor-form">
                    {fields}
                    <button type="submit">Save content</button>
                </form>
            </section>
            """
        booking_documents_json = json.dumps(get_booking_documents(booking["id"] if booking else None)).replace("</", "<\\/")
        first_booking_promo = ""
        has_current_booking = bool(booking and booking["booking_status"] not in {"CANCELLED", "RETURNED"})
        if is_first_time_user:
            dashboard_booking_title = "Start Your First Trip"
            dashboard_booking_body = "No bookings yet. Grab a student deal and your trip details will appear here after checkout."
        elif has_current_booking:
            dashboard_booking_title = "Upcoming Trip"
            dashboard_booking_body = "Your next adventure is all set! We're excited to have you on the road."
        else:
            dashboard_booking_title = "Last Booking"
            dashboard_booking_body = "You do not have a current booking. Your most recent trip details are saved here."
        if is_first_time_user:
            first_booking_promo = """
            <section class="first-booking-promo" id="upcoming">
                <img src="/static/img/referral-deals-denver.jpeg" alt="FairFares Denver referral deal">
                <div class="first-booking-promo-body">
                    <div>
                        <p class="eyebrow">First trip offer</p>
                        <h2>Start with a Denver student deal.</h2>
                        <p>No booking yet. Use the referral code when you search and your trip details will appear here after checkout.</p>
                    </div>
                    <div class="promo-code-box">
                        <span>Deal code</span>
                        <b>REFER_DUDE143</b>
                    </div>
                    <a class="select-button" href="/#results">Search Cars</a>
                </div>
            </section>
            """
        body = render_template(
            "dashboard.html",
            name=escape(user["name"] if user else "Alex"),
            role="Admin" if user and user["is_admin"] else "Student",
            admin_panel=admin_panel,
            manage_auth=(
                f'<a class="user-chip" href="/dashboard"><span></span><b>Hi, {escape(user["name"])}</b><small>Student</small></a><a href="/logout">Log out</a>'
                if user
                else '<span class="user-chip"><span></span><b>Hi, Alex</b><small>Student</small></span><a href="/login">Sign in / Join</a>'
            ),
            booking_id=escape(booking["booking_id"] if booking else "No booking yet"),
            dashboard_booking_title=escape(dashboard_booking_title),
            dashboard_booking_body=escape(dashboard_booking_body),
            first_booking_promo=first_booking_promo,
            trip_card_class="trip-card is-hidden" if is_first_time_user else "trip-card",
            provider=escape(booking["provider"] if booking else "Pending"),
            car_name=escape(booking["car_name"] if booking else "Select a car"),
            category=escape(booking["category"] if booking else "Pending"),
            seats=escape(booking["seats"] if booking else 0),
            bags=escape(booking["bags"] if booking else 0),
            transmission=escape(booking["transmission"] if booking else "Pending"),
            pickup_location=escape(booking["pickup_location"] if booking else "Choose pickup location"),
            pickup_date=escape(booking["pickup_date"] if booking else "Not scheduled"),
            pickup_time=escape(booking["pickup_time"] if booking else "Not scheduled"),
            dropoff_location=escape(booking["dropoff_location"] if booking else "Choose return location"),
            dropoff_date=escape(booking["dropoff_date"] if booking else "Not scheduled"),
            dropoff_time=escape(booking["dropoff_time"] if booking else "Not scheduled"),
            days=escape(booking["days"] if booking else 0),
            price_text=f"${float(booking['total_price'] if booking else 0):.2f}",
            status=escape(booking["status"] if booking else "NO BOOKING"),
            upgrade_options=upgrade_options,
            upgrade_select_options=upgrade_select_options,
            current_vehicle=escape(current_car_name),
            booking_documents_json=booking_documents_json,
            student_email=escape((user["student_email"] or user["email"]) if user else "alex@student.edu"),
            student_id=escape((user["student_id"] or f"STU-{user['id']:04d}") if user else "STU-2025-1042"),
            student_verified_label="Verified Student" if user and user["student_verified"] else "Student Verification Pending",
            student_discount_label="15% discount applied" if user and user["student_verified"] else "Verify to unlock student discount",
            student_verified_checks=(
                '<li>Student ID Verified</li><li>University Email Verified</li><li>Discount Applied <b>15% OFF</b></li>'
                if user and user["student_verified"]
                else '<li>Student ID pending</li><li>University email pending</li><li>Discount pending <b>0% OFF</b></li>'
            ),
            trip_rows=trip_rows,
            upcoming_count=upcoming_count,
            past_count=past_count,
            favorite_count=len(user_bookings),
            live_status_title=escape(live_status["title"]),
            live_status_body=escape(live_status["body"]),
            live_status_instructions=escape(live_status["instructions"]),
            live_days=escape(live_status["days"]),
            live_hours=escape(live_status["hours"]),
            live_mins=escape(live_status["mins"]),
            live_secs=escape(live_status["secs"]),
        )
        self.send_html(body)

    def update_content(self) -> None:
        user = self.current_user()
        if not user or not user["is_admin"]:
            self.redirect("/login")
            return
        form = self.read_form()
        with db() as con:
            for key, value in form.items():
                con.execute("UPDATE site_content SET value = ? WHERE key = ?", (value, key))
        self.redirect("/dashboard")

    def logout(self) -> None:
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie(header)
        morsel = jar.get(SESSION_COOKIE)
        if morsel:
            with db() as con:
                con.execute("DELETE FROM sessions WHERE token = ?", (morsel.value,))
        self.send_response(303)
        self.send_header("Location", "/")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; Max-Age=0; Path=/")
        self.end_headers()

    def api_site(self) -> None:
        payload = {"content": get_content(), "services": [dict(row) for row in get_services()]}
        body = json.dumps(payload, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_cars(self) -> None:
        payload = {"cars": [dict(row) for row in get_cars()]}
        body = json.dumps(payload, indent=2).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path: str) -> None:
        requested = (BASE_DIR / path.lstrip("/")).resolve()
        if not str(requested).startswith(str(STATIC_DIR.resolve())) or not requested.exists():
            self.not_found()
            return
        self.path = path
        return SimpleHTTPRequestHandler.do_GET(self)

    def not_found(self) -> None:
        self.send_html(render_template("404.html"), 404)


if __name__ == "__main__":
    load_env_file()
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), FairFaresHandler)
    print(f"FairFares running at http://{host}:{port}")
    server.serve_forever()
