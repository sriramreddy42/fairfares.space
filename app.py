from __future__ import annotations

import hashlib
import hmac
import html
import json
import math
import os
import re
import secrets
import smtplib
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from http import cookies
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from string import Template


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "fairfares.sqlite3"
DB_PATH = Path(os.environ.get("FAIRFARES_DB_PATH", DEFAULT_DB_PATH))
BACKUP_DIR = Path(os.environ.get("FAIRFARES_BACKUP_DIR", DB_PATH.parent / "backups"))
OUTBOX_DIR = DATA_DIR / "outbox"
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
SESSION_COOKIE = "fairfares_session"


def refresh_storage_paths() -> None:
    global DB_PATH, BACKUP_DIR
    DB_PATH = Path(os.environ.get("FAIRFARES_DB_PATH", DEFAULT_DB_PATH))
    BACKUP_DIR = Path(os.environ.get("FAIRFARES_BACKUP_DIR", DB_PATH.parent / "backups"))


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
    refresh_storage_paths()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def list_db_backups() -> list[Path]:
    if not BACKUP_DIR.exists():
        return []
    return sorted(BACKUP_DIR.glob("fairfares-*.sqlite3"), key=lambda path: path.stat().st_mtime, reverse=True)


def prune_db_backups() -> None:
    keep = int(os.environ.get("FAIRFARES_BACKUP_KEEP", "20"))
    for backup in list_db_backups()[keep:]:
        backup.unlink(missing_ok=True)


def create_db_backup(reason: str = "manual") -> Path:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database does not exist: {DB_PATH}")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    safe_reason = "".join(char for char in reason.lower() if char.isalnum() or char in {"-", "_"}) or "manual"
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"fairfares-{timestamp}-{safe_reason}.sqlite3"
    with sqlite3.connect(DB_PATH) as source, sqlite3.connect(backup_path) as destination:
        source.backup(destination)
    prune_db_backups()
    return backup_path


def auto_backup_on_startup() -> None:
    if os.environ.get("FAIRFARES_AUTO_BACKUP", "1") == "0":
        return
    try:
        backup_path = create_db_backup("startup")
        print(f"SQLite backup saved: {backup_path}")
    except Exception as exc:
        print(f"SQLite backup skipped: {exc}")


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


def create_verification(user_id: int, email: str, purpose: str = "ACCOUNT") -> str:
    token = secrets.token_urlsafe(32)
    with db() as con:
        con.execute(
            "INSERT INTO email_verifications (token, user_id, email, purpose) VALUES (?, ?, ?, ?)",
            (token, user_id, email, purpose),
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


def send_student_verification_email(email: str, name: str, verification_link: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Verify your FairFares student email"
    text_body = (
        f"Hi {name},\n\n"
        "Click the link below to verify your .edu email and unlock your FairFares student discount:\n"
        f"{verification_link}\n\n"
        "This protects the student discount so it only goes to verified school email owners.\n"
    )
    html_body = (
        f"<p>Hi {html.escape(name)},</p>"
        "<p>Click below to verify your .edu email and unlock your FairFares student discount.</p>"
        f'<p><a href="{html.escape(verification_link)}">Verify student email</a></p>'
        "<p>This protects the student discount so it only goes to verified school email owners.</p>"
    )
    outbox_file = OUTBOX_DIR / f"student-verification-{secrets.token_hex(8)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)
    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = email
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
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


def send_student_verified_email(email: str, name: str, code: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Your FairFares student discount is active"
    text_body = (
        f"Hi {name},\n\n"
        "Your student email is verified. Your FairFares student discount is now active.\n\n"
        f"Student discount code: {code}\n\n"
        "Use it on eligible future bookings. Terms and conditions apply.\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <h2>Your student discount is active</h2>
          <p>Hi {html.escape(name)}, your student email is verified.</p>
          <p style="font-size:18px"><b>Student discount code:</b> {html.escape(code)}</p>
          <p>Use it on eligible future bookings. Terms and conditions apply.</p>
        </div>
    """
    outbox_file = OUTBOX_DIR / f"student-verified-{secrets.token_hex(8)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)
    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = email
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
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


def send_booking_confirmation_email(email: str, name: str, booking: sqlite3.Row, origin: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = f"FairFares booking confirmed: {booking['booking_id']}"
    support_phone = "9372518688"
    poster_url = f"{origin.rstrip('/')}/static/img/booking-confirmation-promise.png"
    price_match = (
        "Found a lower quote from Avis, Enterprise, Hertz, or another major rental company? "
        "We'll match it and give you an additional 10% off. Terms and conditions apply."
    )
    booking_summary = (
        f"Booking ID: {booking['booking_id']}\n"
        f"Vehicle: {booking['category']} | {booking['car_name']} or similar\n"
        f"Pickup: {booking['pickup_location']} on {booking['pickup_date']} at {booking['pickup_time']}\n"
        f"Drop-off: {booking['dropoff_location']} on {booking['dropoff_date']} at {booking['dropoff_time']}\n"
        f"Total due at pickup: {format_money(booking['total_price'])}\n"
        f"Payment: {payment_status_label(booking['payment_status'])}\n"
        f"Questions: {support_phone}\n"
    )
    text_body = (
        f"Dear {name},\n\n"
        "Your FairFares booking is confirmed.\n\n"
        f"{booking_summary}\n"
        f"{price_match}\n\n"
        f"Booking poster: {poster_url}\n\n"
        "Thank you for choosing FairFares.\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <h2>Your car is booked.</h2>
          <p>Dear {html.escape(name)}, thank you for choosing FairFares.</p>
          <img src="{html.escape(poster_url)}" alt="FairFares price match promise" style="max-width:100%;border-radius:10px;margin:12px 0">
          <table style="border-collapse:collapse;width:100%;max-width:680px">
            <tr><td><b>Booking ID</b></td><td>{html.escape(booking['booking_id'])}</td></tr>
            <tr><td><b>Vehicle</b></td><td>{html.escape(booking['category'])} | {html.escape(booking['car_name'])} or similar</td></tr>
            <tr><td><b>Pickup</b></td><td>{html.escape(booking['pickup_location'])}<br>{html.escape(booking['pickup_date'])} at {html.escape(booking['pickup_time'])}</td></tr>
            <tr><td><b>Drop-off</b></td><td>{html.escape(booking['dropoff_location'])}<br>{html.escape(booking['dropoff_date'])} at {html.escape(booking['dropoff_time'])}</td></tr>
            <tr><td><b>Total due</b></td><td>{html.escape(format_money(booking['total_price']))}</td></tr>
            <tr><td><b>Payment</b></td><td>{html.escape(payment_status_label(booking['payment_status']))}</td></tr>
          </table>
          <p><b>Price match promise:</b> {html.escape(price_match)}</p>
          <p>Questions? Call {support_phone}.</p>
        </div>
    """

    outbox_file = OUTBOX_DIR / f"booking-confirmation-{booking['booking_id'].lower()}-{secrets.token_hex(6)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)

    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = email
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
        poster_path = STATIC_DIR / "img" / "booking-confirmation-promise.png"
        if poster_path.exists():
            message.add_attachment(
                poster_path.read_bytes(),
                maintype="image",
                subtype="png",
                filename="fairfares-price-match-promise.png",
            )
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
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )

    return outbox_file, delivery_status


def send_booking_documents_email(email: str, name: str, booking: sqlite3.Row, documents: dict[str, dict[str, str]], origin: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = f"FairFares documents ready: {booking['booking_id']}"
    poster_url = f"{origin.rstrip('/')}/static/img/download-documents-poster.png"
    document_text = "\n\n".join(
        f"{doc['title']}\n{doc['content']}\n{doc['status']}"
        for doc in documents.values()
    )
    text_body = (
        f"Hi {name},\n\n"
        f"Your FairFares documents for booking {booking['booking_id']} are ready.\n\n"
        f"Vehicle: {booking['car_name']}\n"
        f"Pickup: {booking['pickup_location']} on {booking['pickup_date']} at {booking['pickup_time']}\n"
        f"Drop-off: {booking['dropoff_location']} on {booking['dropoff_date']} at {booking['dropoff_time']}\n\n"
        f"{document_text}\n\n"
        f"Documents poster: {poster_url}\n"
    )
    html_docs = "".join(
        f"<section style='border:1px solid #d9deea;border-radius:8px;padding:14px;margin:12px 0'>"
        f"<h3>{html.escape(doc['title'])}</h3>"
        f"<p style='white-space:pre-line'>{html.escape(doc['content'])}</p>"
        f"<small>{html.escape(doc['status'])}</small>"
        f"</section>"
        for doc in documents.values()
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <h2>Your FairFares documents are ready.</h2>
          <p>Hi {html.escape(name)}, here are the saved documents for booking <b>{html.escape(booking['booking_id'])}</b>.</p>
          <img src="{html.escape(poster_url)}" alt="Download your FairFares documents" style="max-width:100%;border-radius:10px;margin:12px 0">
          {html_docs}
        </div>
    """

    outbox_file = OUTBOX_DIR / f"documents-{booking['booking_id'].lower()}-{secrets.token_hex(6)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)

    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = email
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
        poster_path = STATIC_DIR / "img" / "download-documents-poster.png"
        if poster_path.exists():
            message.add_attachment(
                poster_path.read_bytes(),
                maintype="image",
                subtype="png",
                filename="fairfares-download-documents.png",
            )
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
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def render_campaign_text(template: str, user: sqlite3.Row, origin: str) -> str:
    first_name = (user["name"] or "FairFares Member").split(" ", 1)[0]
    values = {
        "name": user["name"] or "FairFares Member",
        "first_name": first_name,
        "email": user["email"],
        "today": date.today().strftime("%b %d, %Y"),
        "manage_url": f"{origin.rstrip('/')}/manage-booking",
    }
    rendered = template or ""
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", str(value))
    return rendered


def ensure_marketing_token(user_id: int) -> str:
    with db() as con:
        row = con.execute("SELECT marketing_token FROM users WHERE id = ?", (user_id,)).fetchone()
        token = row["marketing_token"] if row and row["marketing_token"] else ""
        if not token:
            token = secrets.token_urlsafe(24)
            con.execute("UPDATE users SET marketing_token = ? WHERE id = ?", (token, user_id))
    return token


def get_marketing_recipients(audience: str = "") -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM users
            WHERE is_admin = 0
              AND is_verified = 1
              AND promo_email_opt_in = 1
              AND marketing_unsubscribed_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 500
            """
        ).fetchall()


def send_marketing_campaign_email(campaign: sqlite3.Row, user: sqlite3.Row, origin: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    token = ensure_marketing_token(user["id"])
    unsubscribe_url = f"{origin.rstrip('/')}/unsubscribe?token={urllib.parse.quote(token)}"
    subject = render_campaign_text(campaign["subject_line"], user, origin)
    headline = render_campaign_text(campaign["headline"] or "A FairFares update for you.", user, origin)
    message_body = render_campaign_text(campaign["message_body"] or campaign["notes"] or "Open FairFares to view the latest update.", user, origin)
    cta_label = campaign["cta_label"] or "Open FairFares"
    cta_url = f"{origin.rstrip('/')}/manage-booking"
    text_body = (
        f"Hi {user['name']},\n\n"
        f"{headline}\n\n"
        f"{message_body}\n\n"
        f"{cta_label}: {cta_url}\n\n"
        f"Unsubscribe: {unsubscribe_url}\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.5;background:#f5f7fb;padding:24px">
          <div style="max-width:680px;margin:auto;background:#fff;border:1px solid #d9deea;border-radius:12px;overflow:hidden">
            <div style="background:#07143f;color:#fff;padding:22px 24px">
              <h1 style="margin:0;font-size:26px">FairFares</h1>
              <p style="margin:6px 0 0">Fair prices. Better rides. For students.</p>
            </div>
            <div style="padding:24px">
              <p style="font-size:14px;color:#5d6474;text-transform:uppercase;font-weight:700">{html.escape(campaign['campaign_type'])}</p>
              <h2 style="font-size:28px;margin:0 0 12px">{html.escape(headline)}</h2>
              <p style="font-size:16px">{html.escape(message_body)}</p>
              <p style="margin:24px 0"><a href="{html.escape(cta_url)}" style="background:#ec0016;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:800">{html.escape(cta_label)}</a></p>
              <p style="font-size:13px;color:#5d6474">You are receiving this because you subscribed to FairFares promotional emails.</p>
              <p style="font-size:13px"><a href="{html.escape(unsubscribe_url)}">Unsubscribe from marketing emails</a></p>
            </div>
          </div>
        </div>
    """
    outbox_file = OUTBOX_DIR / f"marketing-{campaign['id']}-{user['id']}-{secrets.token_hex(6)}.txt"
    delivery_status = send_with_resend(user["email"], subject, text_body, html_body)
    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = os.environ.get("SMTP_FROM", "hello@fairfares.com")
        message["To"] = user["email"]
        message.set_content(text_body)
        message.add_alternative(html_body, subtype="html")
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
        f"To: {user['email']}\nSubject: {subject}\nDelivery: {delivery_status}\nUnsubscribe: {unsubscribe_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def send_marketing_campaign(campaign_id: int, origin: str, test_email: str = "") -> dict[str, str | int | bool]:
    with db() as con:
        campaign = con.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
    if not campaign:
        return {"ok": False, "message": "Campaign not found.", "sent": 0}
    if test_email:
        test_user = {
            "id": 0,
            "name": "FairFares Test",
            "email": test_email.strip().lower(),
            "marketing_token": "test",
        }
        outbox_file, delivery_status = send_marketing_campaign_email(campaign, test_user, origin)  # type: ignore[arg-type]
        return {
            "ok": True,
            "message": f"Test marketing email prepared for {test_email}.",
            "sent": 1,
            "delivery_status": delivery_status,
            "outbox_file": str(outbox_file),
        }
    recipients = get_marketing_recipients(campaign["audience"])
    sent = 0
    last_status = "no opted-in recipients"
    with db() as con:
        for user in recipients:
            outbox_file, delivery_status = send_marketing_campaign_email(campaign, user, origin)
            sent += 1
            last_status = delivery_status
            con.execute(
                """
                INSERT INTO marketing_email_sends
                (campaign_id, user_id, email, delivery_status, outbox_file)
                VALUES (?, ?, ?, ?, ?)
                """,
                (campaign_id, user["id"], user["email"], delivery_status, str(outbox_file)),
            )
        con.execute(
            """
            UPDATE email_campaigns
            SET status = CASE WHEN ? > 0 THEN 'SENT' ELSE status END,
                sent_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE sent_at END,
                sent_count = sent_count + ?,
                last_delivery_status = ?
            WHERE id = ?
            """,
            (sent, sent, sent, last_status, campaign_id),
        )
    return {"ok": True, "message": f"Marketing campaign sent to {sent} subscribed user(s).", "sent": sent, "delivery_status": last_status}


def save_booking_contact_and_send_confirmation(
    user_id: int,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    origin: str,
    promo_email_opt_in: bool | None = None,
    text_opt_in: bool | None = None,
) -> dict[str, str | bool]:
    full_name = " ".join(part for part in (first_name.strip(), last_name.strip()) if part).strip()
    clean_email = email.strip().lower()
    clean_phone = phone.strip()
    if not full_name or "@" not in clean_email or len(clean_phone) < 7:
        return {"ok": False, "message": "Please enter your full name, valid email, and phone number."}
    booking = get_booking_for_user(user_id)
    with db() as con:
        con.execute(
            """
            UPDATE users
            SET name = ?,
                email = ?,
                phone = ?,
                promo_email_opt_in = COALESCE(?, promo_email_opt_in),
                text_opt_in = COALESCE(?, text_opt_in),
                marketing_unsubscribed_at = CASE WHEN ? = 1 THEN NULL ELSE marketing_unsubscribed_at END
            WHERE id = ?
            """,
            (
                full_name,
                clean_email,
                clean_phone,
                None if promo_email_opt_in is None else int(promo_email_opt_in),
                None if text_opt_in is None else int(text_opt_in),
                int(bool(promo_email_opt_in)),
                user_id,
            ),
        )
        if booking:
            con.execute(
                """
                UPDATE bookings
                SET contact_name = ?,
                    contact_email = ?,
                    contact_phone = ?,
                    confirmation_email_sent_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (full_name, clean_email, clean_phone, booking["id"], user_id),
            )
    delivery_status = "not sent"
    outbox_file: Path | None = None
    if booking and booking["booking_status"] in {"CONFIRMED", "MODIFIED", "PICKED_UP"}:
        refreshed_booking = get_booking_for_user(user_id)
        if refreshed_booking:
            outbox_file, delivery_status = send_booking_confirmation_email(clean_email, full_name, refreshed_booking, origin)
    message = "Details saved. Booking confirmation email sent with your trip summary and price-match poster."
    if delivery_status != "not sent" and not delivery_status.startswith("sent"):
        message = "Details saved. A local confirmation email copy was created for this booking."
    return {
        "ok": True,
        "message": message,
        "delivery_status": delivery_status,
        "outbox_file": str(outbox_file) if outbox_file else "",
    }


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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
                promo_email_opt_in INTEGER NOT NULL DEFAULT 0,
                text_opt_in INTEGER NOT NULL DEFAULT 0,
                marketing_token TEXT,
                marketing_unsubscribed_at TEXT,
                guest_account INTEGER NOT NULL DEFAULT 0,
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
                purpose TEXT NOT NULL DEFAULT 'ACCOUNT',
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
                subtotal_price REAL NOT NULL DEFAULT 0,
                discount_code TEXT NOT NULL DEFAULT '',
                discount_amount REAL NOT NULL DEFAULT 0,
                total_price REAL NOT NULL,
                status TEXT NOT NULL,
                booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
                payment_status TEXT NOT NULL DEFAULT 'PAID',
                return_location TEXT NOT NULL DEFAULT '',
                cancellation_reason TEXT NOT NULL DEFAULT '',
                additional_driver_name TEXT NOT NULL DEFAULT '',
                additional_driver_age TEXT NOT NULL DEFAULT '',
                saved_by_user INTEGER NOT NULL DEFAULT 0,
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
                verification_notes TEXT NOT NULL DEFAULT '',
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
                cardholder_name TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL,
                transaction_status TEXT NOT NULL DEFAULT 'PAID',
                billing_verification_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
                billing_verification_notes TEXT NOT NULL DEFAULT '',
                invoice_number TEXT NOT NULL UNIQUE,
                invoice_pdf_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES bookings(id)
            );

            CREATE TABLE IF NOT EXISTS rental_agreements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL,
                agreement_text TEXT NOT NULL,
                agreement_data TEXT NOT NULL DEFAULT '{}',
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
                max_uses INTEGER NOT NULL DEFAULT 0,
                used_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS commercials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                video_url TEXT NOT NULL,
                embed_url TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                is_live INTEGER NOT NULL DEFAULT 0,
                duration_seconds INTEGER NOT NULL DEFAULT 12,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS support_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL UNIQUE,
                booking_id INTEGER,
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                preferred_contact TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                urgent INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL DEFAULT 'P3',
                status TEXT NOT NULL DEFAULT 'OPEN',
                claimed_by TEXT NOT NULL DEFAULT '',
                admin_comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES bookings(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS support_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                priority TEXT NOT NULL,
                channel TEXT NOT NULL,
                destination TEXT NOT NULL DEFAULT '',
                delivery_status TEXT NOT NULL DEFAULT 'QUEUED',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
            );

            CREATE TABLE IF NOT EXISTS saved_cars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                car_id INTEGER NOT NULL,
                pickup_location TEXT NOT NULL DEFAULT '',
                pickup_date TEXT NOT NULL DEFAULT '',
                pickup_time TEXT NOT NULL DEFAULT '',
                return_date TEXT NOT NULL DEFAULT '',
                return_time TEXT NOT NULL DEFAULT '',
                discount_code TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, car_id, pickup_date, pickup_time, return_date, return_time),
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(car_id) REFERENCES cars(id)
            );

            CREATE TABLE IF NOT EXISTS explorer_profiles (
                user_id INTEGER PRIMARY KEY,
                xp INTEGER NOT NULL DEFAULT 0,
                level INTEGER NOT NULL DEFAULT 1,
                trips INTEGER NOT NULL DEFAULT 0,
                badges INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS explorer_quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                city TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                quest_type TEXT NOT NULL DEFAULT '',
                duration TEXT NOT NULL DEFAULT '',
                budget TEXT NOT NULL DEFAULT '',
                travel_with TEXT NOT NULL DEFAULT '',
                total_hours REAL NOT NULL DEFAULT 0,
                total_miles REAL NOT NULL DEFAULT 0,
                total_xp INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS explorer_stops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quest_id INTEGER NOT NULL,
                stop_order INTEGER NOT NULL,
                name TEXT NOT NULL,
                lat REAL NOT NULL DEFAULT 0,
                lng REAL NOT NULL DEFAULT 0,
                xp_reward INTEGER NOT NULL DEFAULT 0,
                challenge TEXT NOT NULL DEFAULT '',
                is_secret INTEGER NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(quest_id) REFERENCES explorer_quests(id)
            );

            CREATE TABLE IF NOT EXISTS explorer_checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                stop_id INTEGER NOT NULL,
                completed INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(stop_id) REFERENCES explorer_stops(id)
            );

            CREATE TABLE IF NOT EXISTS email_campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_date TEXT NOT NULL,
                campaign_type TEXT NOT NULL,
                audience TEXT NOT NULL,
                trigger_rule TEXT NOT NULL DEFAULT '',
                subject_line TEXT NOT NULL,
                headline TEXT NOT NULL DEFAULT '',
                message_body TEXT NOT NULL DEFAULT '',
                cta_label TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'DRAFT',
                notes TEXT NOT NULL DEFAULT '',
                sent_at TEXT,
                sent_count INTEGER NOT NULL DEFAULT 0,
                last_delivery_status TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS marketing_email_sends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                user_id INTEGER,
                email TEXT NOT NULL,
                delivery_status TEXT NOT NULL DEFAULT '',
                outbox_file TEXT NOT NULL DEFAULT '',
                sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(campaign_id) REFERENCES email_campaigns(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS referral_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer_user_id INTEGER,
                referrer_name TEXT NOT NULL DEFAULT '',
                referrer_email TEXT NOT NULL DEFAULT '',
                referrer_phone TEXT NOT NULL DEFAULT '',
                code TEXT NOT NULL UNIQUE,
                referred_signups INTEGER NOT NULL DEFAULT 0,
                required_signups INTEGER NOT NULL DEFAULT 3,
                status TEXT NOT NULL DEFAULT 'PENDING',
                discount_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                claimed_at TEXT,
                FOREIGN KEY(referrer_user_id) REFERENCES users(id),
                FOREIGN KEY(discount_id) REFERENCES discounts(id)
            );

            CREATE TABLE IF NOT EXISTS referral_reward_signups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reward_id INTEGER NOT NULL,
                referred_user_id INTEGER NOT NULL,
                referred_email TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(reward_id, referred_user_id),
                FOREIGN KEY(reward_id) REFERENCES referral_rewards(id),
                FOREIGN KEY(referred_user_id) REFERENCES users(id)
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
        ensure_column(con, "users", "promo_email_opt_in", "promo_email_opt_in INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "text_opt_in", "text_opt_in INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "marketing_token", "marketing_token TEXT")
        ensure_column(con, "users", "marketing_unsubscribed_at", "marketing_unsubscribed_at TEXT")
        ensure_column(con, "users", "guest_account", "guest_account INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "is_verified", "is_verified INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "users", "verified_at", "verified_at TEXT")
        ensure_column(con, "email_verifications", "purpose", "purpose TEXT NOT NULL DEFAULT 'ACCOUNT'")
        ensure_column(con, "driver_licenses", "verification_notes", "verification_notes TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "transactions", "cardholder_name", "cardholder_name TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "transactions", "billing_verification_status", "billing_verification_status TEXT NOT NULL DEFAULT 'NOT_CHECKED'")
        ensure_column(con, "transactions", "billing_verification_notes", "billing_verification_notes TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "contact_name", "contact_name TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "contact_email", "contact_email TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "contact_phone", "contact_phone TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "confirmation_email_sent_at", "confirmation_email_sent_at TEXT")
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
        ensure_column(con, "bookings", "subtotal_price", "subtotal_price REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "discount_code", "discount_code TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "discount_amount", "discount_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "additional_driver_name", "additional_driver_name TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "additional_driver_age", "additional_driver_age TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "saved_by_user", "saved_by_user INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "actual_pickup_date", "actual_pickup_date TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "actual_pickup_time", "actual_pickup_time TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "actual_return_date", "actual_return_date TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "actual_return_time", "actual_return_time TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "late_fee_amount", "late_fee_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "late_fee_note", "late_fee_note TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "price_match_agency", "price_match_agency TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "price_match_amount", "price_match_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "price_match_discount_amount", "price_match_discount_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "price_match_original_total", "price_match_original_total REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "pickup_front_image", "pickup_front_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_back_image", "pickup_back_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_left_image", "pickup_left_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_right_image", "pickup_right_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_front_image", "return_front_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_back_image", "return_back_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_left_image", "return_left_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_right_image", "return_right_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "insurances", "document_url", "document_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "rental_agreements", "agreement_data", "agreement_data TEXT NOT NULL DEFAULT '{}'")
        ensure_column(con, "discounts", "max_uses", "max_uses INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "discounts", "used_count", "used_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "commercials", "is_live", "is_live INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "commercials", "duration_seconds", "duration_seconds INTEGER NOT NULL DEFAULT 12")
        ensure_column(con, "commercials", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "support_tickets", "priority", "priority TEXT NOT NULL DEFAULT 'P3'")
        ensure_column(con, "email_campaigns", "sent_at", "sent_at TEXT")
        ensure_column(con, "email_campaigns", "sent_count", "sent_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "email_campaigns", "last_delivery_status", "last_delivery_status TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "referral_rewards", "referrer_phone", "referrer_phone TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "referral_rewards", "discount_id", "discount_id INTEGER")
        ensure_column(con, "referral_rewards", "claimed_at", "claimed_at TEXT")

        admin_exists = con.execute("SELECT 1 FROM users WHERE is_admin = 1").fetchone()
        if not admin_exists:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_admin, role) VALUES (?, ?, ?, 1, 'ADMIN')",
                ("FairFares Admin", "admin@fairfares.com", hash_password("ChangeMe123!")),
            )
        con.execute("UPDATE users SET role = 'ADMIN' WHERE is_admin = 1")
        con.execute("UPDATE bookings SET subtotal_price = total_price WHERE subtotal_price = 0")

        seed_defaults = os.environ.get("FAIRFARES_SEED_DEFAULTS", "0").strip() == "1"
        if not seed_defaults:
            return

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
        con.execute(
            """
            INSERT OR IGNORE INTO discounts
            (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, 'PERCENT', 10, '2026-12-31', 'ACTIVE', 3, 0)
            """,
            ("REFER_DUDE143", "Default referral offer shown during booking"),
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

        commercial_count = con.execute("SELECT COUNT(*) AS total FROM commercials").fetchone()["total"]
        if commercial_count == 0:
            video_url = "https://youtu.be/vMG_P78gAOE?si=xZl2lx0ImHZsS5Ku"
            con.execute(
                """
                INSERT INTO commercials (title, video_url, embed_url, status, is_live, duration_seconds, sort_order)
                VALUES (?, ?, ?, 'ACTIVE', 0, 12, 1)
                """,
                ("FairFares Cinematic Commercial", video_url, commercial_embed_url(video_url)),
            )

        car_count = con.execute("SELECT COUNT(*) AS total FROM cars").fetchone()["total"]
        if car_count == 0:
            con.executemany(
                """
                INSERT INTO cars
                (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission, daily_price, total_price, badge, color, features, location, image_url, status, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("Toyota Corolla", "Toyota", "Corolla", 2025, "Economy", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 29.99, 209.93, "Great Price", "white", "Free Cancellation|Unlimited Mileage|Fuel Efficient", "Denver International Airport (DEN)", "/static/img/car-toyota-corolla.png", "AVAILABLE", 1),
                    ("Nissan Sentra", "Nissan", "Sentra", 2025, "Compact", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 34.99, 244.93, "Student Deal", "charcoal", "Free Cancellation|Unlimited Mileage|Hybrid Option", "Denver International Airport (DEN)", "/static/img/car-nissan-sentra.png", "AVAILABLE", 2),
                    ("Hyundai Kona", "Hyundai", "Kona", 2025, "SUV", "SUV", "Electric", 5, 3, 4, "Automatic", 46.99, 328.93, "Low Deposit", "blue", "Free Cancellation|Electric Option|24/7 Support", "Denver International Airport (DEN)", "/static/img/car-hyundai-kona.png", "AVAILABLE", 3),
                    ("Honda Civic", "Honda", "Civic", 2025, "Midsize", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 39.99, 279.93, "Popular", "silver", "Unlimited Mileage|Safe & Reliable|Fuel Efficient", "Denver International Airport (DEN)", "/static/img/car-honda-civic.png", "AVAILABLE", 4),
                ],
            )
        con.execute("UPDATE cars SET image_url = '/static/img/car-toyota-corolla.png' WHERE name = 'Toyota Corolla' AND image_url = ''")
        con.execute("UPDATE cars SET image_url = '/static/img/car-nissan-sentra.png' WHERE name = 'Nissan Sentra' AND image_url = ''")
        con.execute("UPDATE cars SET image_url = '/static/img/car-hyundai-kona.png' WHERE name = 'Hyundai Kona' AND image_url = ''")
        con.execute("UPDATE cars SET image_url = '/static/img/car-honda-civic.png' WHERE name = 'Honda Civic' AND image_url = ''")
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
            UPDATE cars SET status = UPPER(TRIM(status)) WHERE status != UPPER(TRIM(status));
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

        con.execute(
            """
            UPDATE users
            SET is_verified = 1,
                verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP)
            WHERE is_admin = 1
               OR email = 'demo@fairfares.com'
            """
        )
        con.execute("UPDATE bookings SET subtotal_price = total_price WHERE subtotal_price = 0")


def get_content() -> dict[str, str]:
    defaults = {
        "brand": "FairFares",
        "hero_title": "Fair prices. Better rides. For students.",
        "hero_kicker": "Smart travel booking",
        "hero_body": "Affordable car rentals made for students. Wherever you go, we've got you covered.",
        "primary_cta": "Search Cars",
        "secondary_cta": "View Details",
        "poster_image": "/static/img/fairfares-poster.svg",
        "poster_caption": "Poster artwork can be replaced with your supplied campaign design.",
        "offer_title": "Cars available",
        "offer_body": "Add inventory in the admin portal to publish vehicles for students.",
        "contact_email": "hello@fairfares.com",
    }
    with db() as con:
        rows = con.execute("SELECT key, value FROM site_content").fetchall()
    return {**defaults, **{row["key"]: row["value"] for row in rows}}


def commercial_embed_url(video_url: str) -> str:
    parsed = urllib.parse.urlparse(video_url.strip())
    host = parsed.netloc.lower().removeprefix("www.")
    video_id = ""
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path.startswith("/shorts/") or parsed.path.startswith("/live/") or parsed.path.startswith("/embed/"):
            parts = [part for part in parsed.path.split("/") if part]
            video_id = parts[1] if len(parts) > 1 and parts[0] in {"shorts", "live", "embed"} else ""
        else:
            query = urllib.parse.parse_qs(parsed.query)
            video_id = query.get("v", [""])[0]
    if video_id:
        return f"https://www.youtube.com/embed/{urllib.parse.quote(video_id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1"
    return video_url.strip()


def get_active_commercial() -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM commercials
            WHERE UPPER(TRIM(status)) = 'ACTIVE'
            ORDER BY is_live DESC, sort_order, id DESC
            LIMIT 1
            """
        ).fetchone()


def get_all_commercials() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM commercials
            ORDER BY is_live DESC, sort_order, id DESC
            """
        ).fetchall()


def get_services() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM services ORDER BY sort_order, id").fetchall()


def get_cars() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT cars.*,
                   active.dropoff_date AS booked_until_date,
                   active.dropoff_time AS booked_until_time,
                   active.booking_status AS active_booking_status
            FROM cars
            LEFT JOIN (
                SELECT b.*
                FROM bookings b
                JOIN (
                    SELECT car_id, MAX(id) AS latest_id
                    FROM bookings
                    WHERE booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
                    GROUP BY car_id
                ) latest ON latest.latest_id = b.id
            ) active ON active.car_id = cars.id
                    AND UPPER(TRIM(cars.status)) = 'BOOKED'
            WHERE UPPER(TRIM(cars.status)) != 'MAINTENANCE'
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
                WHERE UPPER(TRIM(status)) != 'MAINTENANCE'
                GROUP BY label
                ORDER BY label
                """
            ).fetchall(),
            "fuel": con.execute(
                """
                SELECT fuel_type AS label, COUNT(*) AS total
                FROM cars
                WHERE UPPER(TRIM(status)) != 'MAINTENANCE'
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


def get_valid_discount(code: str) -> sqlite3.Row | None:
    normalized = code.strip().upper()
    if not normalized:
        return None
    today = datetime.now().strftime("%Y-%m-%d")
    with db() as con:
        return con.execute(
            """
            SELECT * FROM discounts
            WHERE UPPER(code) = ?
              AND UPPER(TRIM(status)) = 'ACTIVE'
              AND valid_through >= ?
              AND (max_uses = 0 OR used_count < max_uses)
            """,
            (normalized, today),
        ).fetchone()


def calculate_discount_amount(total: float, discount: sqlite3.Row | None) -> float:
    if not discount:
        return 0.0
    if discount["discount_type"] == "PERCENT":
        amount = total * (float(discount["value"]) / 100)
    else:
        amount = float(discount["value"])
    return max(0.0, min(total, round(amount, 2)))


def format_money(value: object) -> str:
    return f"${float(value or 0):.2f}"


def daily_price_range(price: object) -> tuple[int, int]:
    daily = float(price or 0)
    low = max(25, round(daily * 0.85))
    high = min(52, round(daily * 1.1))
    if high < low:
        high = low
    return low, high


def default_trip_dates() -> tuple[str, str]:
    pickup = datetime.now().date() + timedelta(days=6)
    dropoff = pickup + timedelta(days=10)
    return pickup.isoformat(), dropoff.isoformat()


def display_date_to_input(value: str, fallback: str) -> str:
    for date_format in ("%Y-%m-%d", "%b %d, %Y"):
        try:
            return datetime.strptime(value, date_format).date().isoformat()
        except ValueError:
            continue
    return fallback


def time_select_options(selected: str = "10:00 AM") -> str:
    options = []
    for hour in range(0, 24):
        for minute in (0, 30):
            label = datetime.strptime(f"{hour:02d}:{minute:02d}", "%H:%M").strftime("%I:%M %p").lstrip("0")
            options.append(f'<option {"selected" if label == selected else ""}>{escape(label)}</option>')
    return "".join(options)


def evaluate_driver_license(
    license_number: str,
    state: str,
    expiry_date: str,
    front_image_url: str,
    back_image_url: str,
) -> tuple[str, str]:
    notes: list[str] = []
    cleaned_number = license_number.strip()
    cleaned_state = state.strip().upper()
    if not cleaned_number or cleaned_number == "PHOTO_CAPTURED_PENDING_NUMBER":
        notes.append("license number missing")
    elif not re.fullmatch(r"[A-Z0-9 -]{5,32}", cleaned_number.upper()):
        notes.append("license number format needs review")
    if len(cleaned_state) != 2 or not cleaned_state.isalpha():
        notes.append("state must be a 2-letter code")
    try:
        expiry = datetime.strptime(expiry_date, "%Y-%m-%d").date()
        if expiry < date.today():
            notes.append("license is expired")
    except ValueError:
        notes.append("expiry date is invalid")
    if not front_image_url.strip():
        notes.append("front DL picture missing")
    if not back_image_url.strip():
        notes.append("back DL picture missing")
    if notes:
        return "REVIEW_REQUIRED", "; ".join(notes)
    return "BASIC_CHECK_PASSED", "Number, state, expiry, and front/back DL images captured. Use a licensed ID verification provider for real/fake document authentication."


def normalize_person_name(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def evaluate_billing_name(payment_method: str, cardholder_name: str, customer_name: str, signer_name: str = "") -> tuple[str, str]:
    method = payment_method.strip().lower()
    if "card" not in method and "cc" not in method and "credit" not in method and "debit" not in method:
        return "NOT_REQUIRED", "Cardholder name match is only required for card payments."
    card_name = normalize_person_name(cardholder_name)
    customer = normalize_person_name(customer_name)
    signer = normalize_person_name(signer_name)
    if not card_name:
        return "REVIEW_REQUIRED", "Cardholder name is required for card payments."
    allowed_names = {name for name in (customer, signer) if name}
    if card_name in allowed_names:
        return "MATCHED", "Cardholder name matches customer/signature name."
    return "REJECTED", "Cardholder name does not match the customer or agreement signer. Do not accept this card."


def referral_code_for_username(username: str) -> str:
    cleaned = username.strip().lstrip("@").lower()
    cleaned = "".join(char if char.isalnum() else "_" for char in cleaned)
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    if not cleaned:
        cleaned = "student"
    return f"REFERRAL_{cleaned[:32].upper()}"


def create_referral_discount(username: str) -> str:
    code = referral_code_for_username(username)
    handle = username.strip().lstrip("@") or "student"
    description = f"Instagram follow referral for @{handle} · max 3 referrals"
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO discounts
            (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, 'PERCENT', 10, '2026-12-31', 'ACTIVE', 3,
                    COALESCE((SELECT used_count FROM discounts WHERE code = ?), 0))
            """,
            (code, description, code),
        )
    return code


def referral_reward_code(name: str, email: str = "") -> str:
    base = name.strip() or email.split("@")[0] or "FairFares"
    cleaned = "".join(char if char.isalnum() else "_" for char in base.upper())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    if not cleaned:
        cleaned = "FAIRFARES"
    return f"{cleaned[:34]}_REFER_COUPON"


def referral_signup_discount_code(name: str, email: str = "") -> str:
    base = name.strip() or email.split("@")[0] or "FairFares"
    cleaned = "".join(char if char.isalnum() else "_" for char in base.upper())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    if not cleaned:
        cleaned = "FAIRFARES"
    return f"{cleaned[:34]}_SIGNUP10"


def create_referred_signup_discount(user_id: int, name: str, email: str) -> str:
    code = referral_signup_discount_code(name, email)
    holder = name.strip() or email.strip().lower() or f"User {user_id}"
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO discounts
            (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, 'PERCENT', 10, '2027-12-31', 'ACTIVE', 1,
                    COALESCE((SELECT used_count FROM discounts WHERE code = ?), 0))
            """,
            (code, f"Referral signup bonus for {holder} · first booking", code),
        )
    return code


def student_discount_code(name: str, email: str) -> str:
    base = email.split("@")[0] or name or "student"
    cleaned = "".join(char if char.isalnum() else "_" for char in base.upper())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return f"STUDENT_{(cleaned or 'VERIFIED')[:30]}_15"


def create_student_discount(user_id: int, name: str, student_email: str) -> str:
    code = student_discount_code(name, student_email)
    holder = name.strip() or student_email.strip().lower() or f"User {user_id}"
    with db() as con:
        con.execute(
            """
            INSERT OR REPLACE INTO discounts
            (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, 'PERCENT', 15, '2027-12-31', 'ACTIVE', 0,
                    COALESCE((SELECT used_count FROM discounts WHERE code = ?), 0))
            """,
            (code, f"Verified student discount for {holder} · .edu verified", code),
        )
    return code


def ensure_referral_reward(user_id: int | None, name: str, email: str, phone: str = "") -> sqlite3.Row | None:
    clean_email = email.strip().lower()
    clean_phone = phone.strip()
    if not clean_email and not clean_phone:
        return None
    code = referral_reward_code(name, clean_email)
    with db() as con:
        existing = con.execute(
            """
            SELECT * FROM referral_rewards
            WHERE code = ?
               OR (? != '' AND LOWER(referrer_email) = ?)
               OR (? != '' AND referrer_phone = ?)
            ORDER BY id DESC
            LIMIT 1
            """,
            (code, clean_email, clean_email, clean_phone, clean_phone),
        ).fetchone()
        if existing:
            con.execute(
                """
                UPDATE referral_rewards
                SET referrer_user_id = COALESCE(referrer_user_id, ?),
                    referrer_name = COALESCE(NULLIF(?, ''), referrer_name),
                    referrer_email = COALESCE(NULLIF(?, ''), referrer_email),
                    referrer_phone = COALESCE(NULLIF(?, ''), referrer_phone)
                WHERE id = ?
                """,
                (user_id, name.strip(), clean_email, clean_phone, existing["id"]),
            )
            return con.execute("SELECT * FROM referral_rewards WHERE id = ?", (existing["id"],)).fetchone()
        con.execute(
            """
            INSERT INTO referral_rewards
            (referrer_user_id, referrer_name, referrer_email, referrer_phone, code)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, name.strip(), clean_email, clean_phone, code),
        )
        return con.execute("SELECT * FROM referral_rewards WHERE code = ?", (code,)).fetchone()


def attach_referral_rewards_to_user(user_id: int, email: str, phone: str, name: str) -> None:
    clean_email = email.strip().lower()
    clean_phone = phone.strip()
    with db() as con:
        con.execute(
            """
            UPDATE referral_rewards
            SET referrer_user_id = ?,
                referrer_name = COALESCE(NULLIF(?, ''), referrer_name)
            WHERE referrer_user_id IS NULL
              AND ((? != '' AND LOWER(referrer_email) = ?) OR (? != '' AND referrer_phone = ?))
            """,
            (user_id, name.strip(), clean_email, clean_email, clean_phone, clean_phone),
        )


def record_referral_signup(referral_code: str, referred_user_id: int, referred_email: str, referred_name: str = "") -> dict[str, object]:
    code = referral_code.strip().upper()
    if not code:
        return {"ok": False, "message": "No referral code supplied."}
    clean_email = referred_email.strip().lower()
    with db() as con:
        reward = con.execute("SELECT * FROM referral_rewards WHERE UPPER(code) = ?", (code,)).fetchone()
        if not reward:
            return {"ok": False, "message": "Referral code not found."}
        if reward["referrer_user_id"] == referred_user_id or reward["referrer_email"].lower() == clean_email:
            return {"ok": False, "message": "Referral owner cannot use their own referral code."}
        con.execute(
            """
            INSERT OR IGNORE INTO referral_reward_signups
            (reward_id, referred_user_id, referred_email)
            VALUES (?, ?, ?)
            """,
            (reward["id"], referred_user_id, clean_email),
        )
        count = con.execute(
            "SELECT COUNT(*) AS total FROM referral_reward_signups WHERE reward_id = ?",
            (reward["id"],),
        ).fetchone()["total"]
        status = "READY" if count >= int(reward["required_signups"] or 3) and reward["status"] == "PENDING" else reward["status"]
        con.execute(
            "UPDATE referral_rewards SET referred_signups = ?, status = ? WHERE id = ?",
            (count, status, reward["id"]),
        )
    signup_discount = create_referred_signup_discount(referred_user_id, referred_name, clean_email)
    return {
        "ok": True,
        "message": f"Referral credited. {count}/3 signups complete. Signup coupon {signup_discount} is ready for the new customer.",
        "count": count,
        "status": status,
        "signup_discount": signup_discount,
    }


def get_ready_referral_reward(user_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM referral_rewards
            WHERE referrer_user_id = ? AND status = 'READY'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()


def claim_referral_reward(user_id: int) -> dict[str, object]:
    with db() as con:
        reward = con.execute(
            "SELECT * FROM referral_rewards WHERE referrer_user_id = ? AND status = 'READY' ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        if not reward:
            return {"ok": False, "message": "No referral bonus is ready to claim yet."}
        con.execute(
            """
            INSERT OR REPLACE INTO discounts
            (code, description, discount_type, value, valid_through, status, max_uses, used_count)
            VALUES (?, ?, 'PERCENT', 10, '2027-12-31', 'ACTIVE', 3,
                    COALESCE((SELECT used_count FROM discounts WHERE code = ?), 0))
            """,
            (
                reward["code"],
                f"Referral bonus for {reward['referrer_name'] or reward['referrer_email']} · 3 uses",
                reward["code"],
            ),
        )
        discount = con.execute("SELECT * FROM discounts WHERE code = ?", (reward["code"],)).fetchone()
        con.execute(
            "UPDATE referral_rewards SET status = 'CLAIMED', discount_id = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (discount["id"], reward["id"]),
        )
    return {"ok": True, "message": f"Coupon {reward['code']} is ready. Use it on your next booking, up to 3 times.", "code": reward["code"]}


def referral_claim_modal(reward: sqlite3.Row | None) -> str:
    if not reward:
        return ""
    return f"""
  <section class="booking-referral-backdrop" id="referralClaimModal" data-auto-show="true" hidden>
    <div class="booking-referral-modal" role="dialog" aria-modal="true" aria-labelledby="referralClaimTitle">
      <button class="guest-offer-close" type="button" data-claim-close aria-label="Close referral claim">x</button>
      <img class="guest-offer-logo" src="/static/img/logo-dark-header.png" alt="FairFares logo">
      <p class="eyebrow">Referral bonus ready</p>
      <h2 id="referralClaimTitle">You referred 3 people.</h2>
      <p>Your referral reward is ready. Claim it now and use this 10% coupon on up to 3 future bookings.</p>
      <div class="guest-offer-code">
        <span>Coupon code</span>
        <b>{escape(reward["code"])}</b>
      </div>
      <button class="guest-offer-primary" type="button" id="claimReferralReward">Claim Coupon</button>
      <p class="modify-status" id="referralClaimStatus" aria-live="polite"></p>
    </div>
  </section>
"""


EXPLORER_DENVER_STOPS = [
    {
        "name": "Union Station",
        "lat": 39.7530,
        "lng": -105.0008,
        "tags": {"Food", "Coffee", "Photography", "Hidden Gems"},
        "challenge": "Snap your starting point and write one line about the vibe.",
        "xp": 25,
    },
    {
        "name": "Confluence Park",
        "lat": 39.7547,
        "lng": -105.0087,
        "tags": {"Nature", "Scenic Drive", "Photography"},
        "challenge": "Check in near the water and capture a skyline angle.",
        "xp": 35,
    },
    {
        "name": "RiNo Art District",
        "lat": 39.7690,
        "lng": -104.9794,
        "tags": {"Food", "Music", "Hidden Gems", "Photography"},
        "challenge": "Find a mural and upload the most FairFares-looking shot.",
        "xp": 40,
    },
    {
        "name": "City Park Overlook",
        "lat": 39.7475,
        "lng": -104.9481,
        "tags": {"Sunset", "Nature", "Date Night", "Photography"},
        "challenge": "Capture the mountain line or sunset light.",
        "xp": 50,
    },
    {
        "name": "Red Rocks Trading Post",
        "lat": 39.6654,
        "lng": -105.2057,
        "tags": {"Adventure", "Scenic Drive", "Music", "Sunset"},
        "challenge": "Take one scenic photo and rate the drive.",
        "xp": 60,
    },
    {
        "name": "Lookout Mountain Pull-Off",
        "lat": 39.7320,
        "lng": -105.2399,
        "tags": {"Adventure", "Nature", "Scenic Drive", "Hidden Gems", "Sunset"},
        "challenge": "Pull over safely, capture the overlook, and rate the scenic drive.",
        "xp": 75,
    },
]


def get_explorer_profile(user_id: int | None) -> dict[str, int]:
    if not user_id:
        return {"xp": 0, "level": 1, "trips": 0, "badges": 0}
    with db() as con:
        profile = con.execute("SELECT * FROM explorer_profiles WHERE user_id = ?", (user_id,)).fetchone()
        if not profile:
            con.execute("INSERT OR IGNORE INTO explorer_profiles (user_id) VALUES (?)", (user_id,))
            profile = con.execute("SELECT * FROM explorer_profiles WHERE user_id = ?", (user_id,)).fetchone()
    return {
        "xp": int(profile["xp"] or 0),
        "level": int(profile["level"] or 1),
        "trips": int(profile["trips"] or 0),
        "badges": int(profile["badges"] or 0),
    }


def generate_explorer_quest(city: str, moods: list[str], duration: str, budget: str, travel_with: str, fairfares_booked: bool) -> dict[str, object]:
    selected_moods = set(moods[:3]) or {"Scenic Drive"}
    scored = []
    for stop in EXPLORER_DENVER_STOPS:
        score = len(selected_moods & stop["tags"])
        scored.append((score, stop))
    scored.sort(key=lambda item: (-item[0], item[1]["name"]))
    visible_stops = [item[1] for item in scored[:4]]
    remaining_stops = [stop for stop in EXPLORER_DENVER_STOPS if stop not in visible_stops]
    secret_stop = next((stop for stop in remaining_stops if "Hidden Gems" in stop["tags"]), remaining_stops[0] if remaining_stops else EXPLORER_DENVER_STOPS[-1])
    stops = visible_stops + [secret_stop]
    quest_type = " + ".join(list(selected_moods)[:2])
    total_xp = sum(int(stop["xp"]) for stop in stops) + (100 if fairfares_booked else 0)
    duration_hours = {"2 Hours": 2, "Half Day": 4, "Full Day": 8, "Weekend": 18}.get(duration, 4)
    total_miles = 14 if duration == "2 Hours" else 36 if duration == "Half Day" else 72 if duration == "Full Day" else 140
    title_mood = "Sunset" if "Sunset" in selected_moods else "Hidden Gem" if "Hidden Gems" in selected_moods else next(iter(selected_moods))
    title_city = city.split(",", 1)[0].strip() or "Denver"
    payload_stops = [
        {
            "order": index + 1,
            "name": stop["name"],
            "lat": stop["lat"],
            "lng": stop["lng"],
            "xp_reward": stop["xp"],
            "challenge": stop["challenge"],
            "is_secret": 1 if index == len(stops) - 1 else 0,
        }
        for index, stop in enumerate(stops)
    ]
    return {
        "title": f"{title_city} {title_mood} Adventure",
        "city": city,
        "quest_type": quest_type,
        "duration": duration,
        "budget": budget,
        "travel_with": travel_with,
        "total_hours": duration_hours,
        "total_miles": total_miles,
        "total_xp": total_xp,
        "fairfares_bonus": 100 if fairfares_booked else 0,
        "stops": payload_stops,
    }


def get_admin_cars() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM cars ORDER BY sort_order, daily_price, id").fetchall()


def get_car(car_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute("SELECT * FROM cars WHERE id = ?", (car_id,)).fetchone()


def get_car_by_name(name: str) -> sqlite3.Row | None:
    if not name.strip():
        return None
    with db() as con:
        return con.execute(
            "SELECT * FROM cars WHERE name = ? AND UPPER(TRIM(status)) != 'MAINTENANCE'",
            (name.strip(),),
        ).fetchone()


def get_admin_bookings() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.phone,
                   users.address, users.date_of_birth,
                   cars.name AS car_name, cars.brand AS car_brand, cars.model AS car_model,
                   cars.year AS car_year, cars.category AS car_category, cars.type AS car_type,
                   cars.color AS car_color, cars.daily_price, cars.license_plate, cars.vin_number, cars.status AS car_status
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            JOIN cars ON cars.id = bookings.car_id
            ORDER BY bookings.id DESC
            LIMIT 50
            """
        ).fetchall()


def get_admin_users() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT users.*,
                   COUNT(DISTINCT bookings.id) AS booking_count,
                   COUNT(DISTINCT CASE WHEN bookings.booking_status = 'CANCELLED' THEN bookings.id END) AS cancelled_count,
                   COUNT(DISTINCT CASE WHEN bookings.booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP') THEN bookings.id END) AS current_count,
                   COUNT(DISTINCT transactions.id) AS transaction_count,
                   COALESCE(SUM(transactions.amount), 0) AS transaction_total,
                   MAX(bookings.booking_id) AS latest_booking_id
            FROM users
            LEFT JOIN bookings ON bookings.user_id = users.id
            LEFT JOIN transactions ON transactions.booking_id = bookings.id
            WHERE users.is_admin = 0
            GROUP BY users.id
            ORDER BY users.name COLLATE NOCASE
            LIMIT 100
            """
        ).fetchall()


def get_admin_user_profile(user_id: int) -> dict[str, list[sqlite3.Row] | sqlite3.Row | None]:
    with db() as con:
        user = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        bookings = con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.license_plate, cars.vin_number
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.user_id = ?
            ORDER BY bookings.id DESC
            """,
            (user_id,),
        ).fetchall()
        licenses = con.execute(
            "SELECT * FROM driver_licenses WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()
        transactions = con.execute(
            """
            SELECT transactions.*, bookings.booking_id
            FROM transactions
            JOIN bookings ON bookings.id = transactions.booking_id
            WHERE bookings.user_id = ?
            ORDER BY transactions.id DESC
            """,
            (user_id,),
        ).fetchall()
        insurances = con.execute(
            """
            SELECT insurances.*, bookings.booking_id
            FROM insurances
            JOIN bookings ON bookings.id = insurances.booking_id
            WHERE bookings.user_id = ?
            ORDER BY insurances.id DESC
            """,
            (user_id,),
        ).fetchall()
        agreements = con.execute(
            """
            SELECT rental_agreements.*, bookings.booking_id
            FROM rental_agreements
            JOIN bookings ON bookings.id = rental_agreements.booking_id
            WHERE bookings.user_id = ?
            ORDER BY rental_agreements.id DESC
            """,
            (user_id,),
        ).fetchall()
    return {
        "user": user,
        "bookings": bookings,
        "licenses": licenses,
        "transactions": transactions,
        "insurances": insurances,
        "agreements": agreements,
    }


def get_fleet_summary() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT COALESCE(NULLIF(category, ''), type) AS type,
                   COUNT(*) AS total,
                   SUM(CASE WHEN UPPER(TRIM(status)) = 'AVAILABLE' THEN 1 ELSE 0 END) AS available,
                   SUM(CASE WHEN UPPER(TRIM(status)) = 'BOOKED' THEN 1 ELSE 0 END) AS booked,
                   SUM(CASE WHEN UPPER(TRIM(status)) = 'MAINTENANCE' THEN 1 ELSE 0 END) AS maintenance,
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
            "available": con.execute("SELECT COUNT(*) AS total FROM cars WHERE UPPER(TRIM(status)) = 'AVAILABLE'").fetchone()["total"],
            "booked": con.execute("SELECT COUNT(*) AS total FROM bookings").fetchone()["total"],
            "users": con.execute("SELECT COUNT(*) AS total FROM users WHERE is_admin = 0").fetchone()["total"],
        }


def get_booking_for_user(user_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.seats, cars.bags,
                   cars.doors, cars.transmission, cars.color, cars.image_url
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
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.color, cars.image_url
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.user_id = ?
            ORDER BY bookings.id DESC
            """
            ,
            (user_id,),
        ).fetchall()


def render_user_trip_rows(bookings: list[sqlite3.Row], saved_cars: list[sqlite3.Row] | None = None) -> str:
    saved_cars = saved_cars or []
    if not bookings and not saved_cars:
        return '<div class="mini-trip mini-trip-empty"><span>No trips yet<br><small>Book or save a car to see trip details here.</small></span><b>Empty</b></div>'
    rows = []
    for booking in bookings:
        status = booking["booking_status"]
        trip_type = "past" if status in {"CANCELLED", "RETURNED"} else "upcoming"
        if row_value(booking, "saved_by_user"):
            trip_type = f"{trip_type} favorites"
        status_text = "Cancelled" if status == "CANCELLED" else ("Not picked up" if status not in {"PICKED_UP", "RETURNED"} else status.replace("_", " ").title())
        details = {
            "bookingId": booking["booking_id"],
            "car": booking["car_name"],
            "status": status,
            "statusText": status_text,
            "pickup": f"{booking['pickup_location']} | {booking['pickup_date']} {booking['pickup_time']}",
            "dropoff": f"{booking['dropoff_location']} | {booking['dropoff_date']} {booking['dropoff_time']}",
            "provider": booking["provider"],
            "reason": row_value(booking, "cancellation_reason") or "No request notes saved.",
            "image": row_value(booking, "image_url") or "",
            "price": format_money(booking["total_price"]),
        }
        details_json = escape(json.dumps(details))
        rows.append(
            f"""
            <button class="mini-trip" type="button" data-trip-type="{escape(trip_type)}" data-trip-details="{details_json}">
              {'<img src="' + escape(details["image"]) + '" alt="' + escape(booking["car_name"]) + '">' if details["image"] else '<div class="mini-car"></div>'}
              <span>{escape(booking["car_name"])}<br><small>{escape(booking["pickup_date"])} - {escape(booking["dropoff_date"])} · {escape(status)}</small></span>
              <b>{escape(status_text)}</b>
            </button>
            """
        )
    for saved in saved_cars:
        low, high = daily_price_range(saved["daily_price"])
        details = {
            "bookingId": "Saved car",
            "car": saved["car_name"],
            "status": "SAVED",
            "statusText": "Saved",
            "pickup": f"{saved['pickup_location'] or saved['location']} | {saved['pickup_date'] or 'Choose dates'} {saved['pickup_time'] or ''}",
            "dropoff": f"{saved['return_date'] or 'Choose return date'} {saved['return_time'] or ''}",
            "provider": "FairFares",
            "reason": "Saved from search. Select this car when you are ready to book.",
            "image": row_value(saved, "image_url") or "",
            "price": f"${low}-${high}/day est.",
        }
        details_json = escape(json.dumps(details))
        rows.append(
            f"""
            <div class="mini-trip saved-mini-trip" role="button" tabindex="0" data-trip-type="favorites" data-trip-details="{details_json}">
              {'<img src="' + escape(details["image"]) + '" alt="' + escape(saved["car_name"]) + '">' if details["image"] else '<div class="mini-car"></div>'}
              <span>{escape(saved["car_name"])}<br><small>{escape(details["pickup"])} · Saved car</small></span>
              <button class="light-button mini-trip-remove" type="button" data-unsave-car-id="{saved["car_id"]}">Remove saved</button>
            </div>
            """
        )
    return "\n".join(rows)


def booking_status_label(status: str, payment_status: str = "") -> str:
    if status == "CONFIRMED":
        return "Confirmed / Pay at pickup"
    labels = {
        "CANCELLATION_REQUESTED": "Request sent to admin",
        "CANCELLED": "Cancelled",
        "MODIFIED": "Modification sent to admin",
        "PICKED_UP": "Picked up",
        "RETURNED": "Returned",
    }
    return labels.get(status, status.replace("_", " ").title())


def booking_status_class(status: str) -> str:
    if status in {"CANCELLATION_REQUESTED", "MODIFIED"}:
        return "status-pending"
    if status in {"CANCELLED", "RETURNED"}:
        return "status-muted"
    return "status-confirmed"


def payment_status_label(status: str) -> str:
    labels = {
        "PAY_AT_PICKUP": "Pay at pickup",
        "PAID": "Paid",
        "PENDING": "Payment pending",
        "REFUND_REVIEW": "Refund review",
        "REFUNDED": "Refunded",
        "FAILED": "Payment failed",
    }
    return labels.get(status, status.replace("_", " ").title())


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
        title = "Modification pending approval"
        body = f"Admin is reviewing your requested change: {booking['cancellation_reason'] or 'Trip modification'}"
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


def make_ticket_id() -> str:
    return f"FF-SUP-{secrets.randbelow(900000) + 100000}"


SUPPORT_PRIORITY_RULES = {
    "P0": {
        "label": "P0 urgent pager",
        "sla": "Immediate pager alert",
        "minutes": 15,
        "channels": "Pager / phone / email / text",
    },
    "P1": {
        "label": "P1 emergency",
        "sla": "Response within 1 hour",
        "minutes": 60,
        "channels": "Text / email / call",
    },
    "P2": {
        "label": "P2 high priority",
        "sla": "Response within 2 hours",
        "minutes": 120,
        "channels": "Email / dashboard alert",
    },
    "P3": {
        "label": "P3 normal support",
        "sla": "Response within 1-2 hours",
        "minutes": 120,
        "channels": "Email / dashboard alert",
    },
}


def normalize_support_priority(priority: str) -> str:
    priority = (priority or "").strip().upper()
    return priority if priority in SUPPORT_PRIORITY_RULES else "P3"


def support_sla_text(priority: str) -> str:
    return SUPPORT_PRIORITY_RULES[normalize_support_priority(priority)]["sla"]


def support_due_at(priority: str) -> str:
    rule = SUPPORT_PRIORITY_RULES[normalize_support_priority(priority)]
    return (datetime.now() + timedelta(minutes=int(rule["minutes"]))).strftime("%Y-%m-%d %I:%M %p")


def classify_support_priority(topic: str, urgent: bool, message: str = "") -> str:
    text = f"{topic} {message}".lower()
    if "p0" in text or "unsafe" in text or "accident" in text or "stranded" in text:
        return "P0"
    if urgent or "emergency" in text or "roadside" in text:
        return "P1"
    if "billing" in text or "payment" in text or "vehicle issue" in text or "provider contact" in text:
        return "P2"
    return "P3"


def alert_channels_for_priority(priority: str) -> list[str]:
    priority = normalize_support_priority(priority)
    if priority == "P0":
        return ["pager", "phone", "text", "email"]
    if priority == "P1":
        return ["text", "email", "phone"]
    if priority in {"P2", "P3"}:
        return ["email"]
    return ["email"]


def support_alert_destination(channel: str) -> str:
    env_map = {
        "email": "SUPPORT_ALERT_EMAIL",
        "text": "SUPPORT_ALERT_PHONE",
        "phone": "SUPPORT_ALERT_PHONE",
        "pager": "SUPPORT_PAGER_PHONE",
    }
    defaults = {
        "email": os.environ.get("SMTP_FROM", "support@fairfares.com"),
        "text": "",
        "phone": "",
        "pager": "",
    }
    return os.environ.get(env_map.get(channel, ""), defaults.get(channel, ""))


def queue_support_alerts(con: sqlite3.Connection, ticket_pk: int, ticket_id: str, priority: str, subject: str, body: str) -> None:
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    for channel in alert_channels_for_priority(priority):
        destination = support_alert_destination(channel)
        if channel == "email" and destination:
            delivery_status = send_with_resend(destination, subject, body, f"<pre>{html.escape(body)}</pre>")
        elif destination:
            delivery_status = f"queued for {channel} provider"
        else:
            delivery_status = f"{channel} destination not configured"
        con.execute(
            """
            INSERT INTO support_alerts
            (ticket_id, priority, channel, destination, delivery_status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (ticket_pk, normalize_support_priority(priority), channel, destination, delivery_status),
        )
        outbox_file = OUTBOX_DIR / f"support-alert-{ticket_id}-{channel}-{secrets.token_hex(4)}.txt"
        outbox_file.write_text(
            f"Ticket: {ticket_id}\nPriority: {priority}\nChannel: {channel}\nDestination: {destination or 'not configured'}\nDelivery: {delivery_status}\n\n{body}",
            encoding="utf-8",
        )


def get_admin_tickets() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT support_tickets.*, users.name AS user_name, users.email AS user_email,
                   bookings.booking_id,
                   (
                       SELECT GROUP_CONCAT(channel || ': ' || delivery_status, ' | ')
                       FROM support_alerts
                       WHERE support_alerts.ticket_id = support_tickets.id
                   ) AS alert_summary
            FROM support_tickets
            JOIN users ON users.id = support_tickets.user_id
            LEFT JOIN bookings ON bookings.id = support_tickets.booking_id
            ORDER BY CASE support_tickets.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'FOLLOWUP' THEN 2 ELSE 3 END,
                     CASE support_tickets.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                     support_tickets.urgent DESC,
                     support_tickets.id DESC
            LIMIT 100
            """
        ).fetchall()


def get_latest_ticket_for_user(user_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM support_tickets
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()


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
                   cars.doors, cars.transmission, cars.color, cars.image_url
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


def format_booking_date(value: str, fallback: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%b %-d, %Y")
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d").strftime("%b %#d, %Y")
        except ValueError:
            return fallback


def parse_booking_datetime(date_value: str, time_value: str) -> datetime | None:
    if not date_value:
        return None
    for date_format in ("%Y-%m-%d", "%b %d, %Y"):
        try:
            parsed_date = datetime.strptime(date_value, date_format)
            break
        except ValueError:
            parsed_date = None
    if not parsed_date:
        return None
    try:
        parsed_time = datetime.strptime(time_value or "10:00 AM", "%I:%M %p").time()
    except ValueError:
        parsed_time = datetime.strptime("10:00 AM", "%I:%M %p").time()
    return datetime.combine(parsed_date.date(), parsed_time)


def active_booking_for_car(car_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.car_id = ?
              AND UPPER(TRIM(cars.status)) = 'BOOKED'
              AND bookings.booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
            ORDER BY bookings.id DESC
            LIMIT 1
            """,
            (car_id,),
        ).fetchone()


def booking_datetime_from_row(row: sqlite3.Row, date_key: str, time_key: str) -> datetime | None:
    return parse_booking_datetime(row_value(row, date_key), row_value(row, time_key))


def calculate_late_fee(row: sqlite3.Row, actual_return_date: str, actual_return_time: str) -> tuple[float, str]:
    scheduled_return = booking_datetime_from_row(row, "dropoff_date", "dropoff_time")
    actual_return = parse_booking_datetime(actual_return_date, actual_return_time)
    if not scheduled_return or not actual_return or actual_return <= scheduled_return:
        return 0.0, ""
    late_hours = math.ceil((actual_return - scheduled_return).total_seconds() / 3600)
    hourly_rate = max(0.0, float(row_value(row, "daily_price") or 0) / 24)
    fee = round(late_hours * hourly_rate, 2)
    note = f"{late_hours} hour(s) late at {format_money(hourly_rate)}/hour based on the daily rate."
    return fee, note


def make_cancellation_task(
    con: sqlite3.Connection,
    booking: sqlite3.Row,
    user: sqlite3.Row,
    reason: str,
    auto_cancelled: bool,
) -> str:
    ticket_id = make_ticket_id()
    while con.execute("SELECT 1 FROM support_tickets WHERE ticket_id = ?", (ticket_id,)).fetchone():
        ticket_id = make_ticket_id()
    mode = "Auto-cancelled before the 24-hour pickup cutoff." if auto_cancelled else "Admin cancellation review required."
    message = (
        f"{mode}\n"
        f"Booking: {booking['booking_id']}\n"
        f"Customer: {user['name']} · {user['email']} · {user['phone'] or 'No phone'}\n"
        f"Pickup: {booking['pickup_date']} {booking['pickup_time']}\n"
        f"Reason: {reason}"
    )
    con.execute(
        """
        INSERT INTO support_tickets
        (ticket_id, booking_id, user_id, topic, preferred_contact, message, urgent, priority)
        VALUES (?, ?, ?, 'Cancellation request', 'Email', ?, 0, 'P3')
        """,
        (ticket_id, booking["id"], user["id"], message),
    )
    ticket_pk = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
    queue_support_alerts(con, ticket_pk, ticket_id, "P3", f"P3 FairFares cancellation task {ticket_id}", message)
    return ticket_id


def create_booking_for_user(
    user_id: int,
    car_id: int,
    discount_code: str = "",
    days: int = 10,
    pickup_date: str = "",
    return_date: str = "",
    pickup_time: str = "10:00 AM",
    return_time: str = "10:00 AM",
    pickup_location: str = "",
    return_location: str = "",
) -> sqlite3.Row:
    requested_car = get_car(car_id)
    default_pickup, default_return = default_trip_dates()
    pickup_date = pickup_date or default_pickup
    return_date = return_date or default_return
    requested_start = parse_booking_datetime(pickup_date, pickup_time)
    requested_end = parse_booking_datetime(return_date, return_time)
    if requested_start and requested_end and requested_end <= requested_start:
        raise ValueError("Return date and time must be after pickup date and time.")
    candidates = [requested_car] if requested_car else get_cars()
    car = None
    for candidate in candidates:
        if not candidate:
            continue
        if candidate["status"].strip().upper() == "MAINTENANCE":
            continue
        active_booking = active_booking_for_car(candidate["id"])
        active_return = parse_booking_datetime(
            active_booking["dropoff_date"],
            active_booking["dropoff_time"],
        ) if active_booking else None
        if requested_start and active_return and requested_start < active_return:
            if requested_car and candidate["id"] == requested_car["id"] and requested_start.date() == active_return.date():
                pickup_date = active_return.strftime("%Y-%m-%d")
                pickup_time = active_return.strftime("%I:%M %p").lstrip("0")
                car = candidate
                break
            continue
        car = candidate
        break
    if not car:
        raise RuntimeError("Selected car is not available for that pickup time.")
    with db() as con:
        user = con.execute("SELECT name, email, phone FROM users WHERE id = ?", (user_id,)).fetchone()
        booking_id = make_booking_id()
        while con.execute("SELECT 1 FROM bookings WHERE booking_id = ?", (booking_id,)).fetchone():
            booking_id = make_booking_id()
        discount = get_valid_discount(discount_code)
        rental_days = max(1, min(int(days or 1), 366))
        subtotal = round(float(car["daily_price"]) * rental_days, 2)
        discount_amount = calculate_discount_amount(subtotal, discount)
        final_total = round(subtotal - discount_amount, 2)
        applied_code = discount["code"] if discount else ""
        con.execute(
            """
            INSERT INTO bookings
            (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
             dropoff_location, dropoff_date, dropoff_time, days, subtotal_price, discount_code, discount_amount,
             total_price, status, booking_status, payment_status, contact_name, contact_email, contact_phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'PAY_AT_PICKUP', ?, ?, ?)
            """,
            (
                booking_id,
                user_id,
                car["id"],
                "AVIS",
                pickup_location or car["location"] or "Denver International Airport (DEN)",
                format_booking_date(pickup_date, format_booking_date(default_pickup, "Upcoming pickup")),
                pickup_time or "10:00 AM",
                return_location or pickup_location or car["location"] or "Denver International Airport (DEN)",
                format_booking_date(return_date, format_booking_date(default_return, "Upcoming return")),
                return_time or "10:00 AM",
                rental_days,
                subtotal,
                applied_code,
                discount_amount,
                final_total,
                "CONFIRMED",
                (user["name"] or "") if user else "",
                (user["email"] or "") if user else "",
                (user["phone"] or "") if user else "",
            ),
        )
        if applied_code:
            con.execute("UPDATE discounts SET used_count = used_count + 1 WHERE code = ?", (applied_code,))
        con.execute("UPDATE cars SET status = 'BOOKED' WHERE id = ?", (car["id"],))
    booking = get_booking_for_user(user_id)
    if not booking:
        raise RuntimeError("Booking creation failed")
    return booking


def build_booking_preview(
    car_id: int,
    discount_code: str = "",
    days: int = 10,
    pickup_date: str = "",
    return_date: str = "",
    pickup_time: str = "10:00 AM",
    return_time: str = "10:00 AM",
    pickup_location: str = "",
    return_location: str = "",
) -> dict[str, object] | None:
    car = get_car(car_id)
    if not car:
        return None
    default_pickup, default_return = default_trip_dates()
    rental_days = max(1, min(int(days or 1), 366))
    subtotal = round(float(car["daily_price"]) * rental_days, 2)
    discount = get_valid_discount(discount_code)
    discount_amount = calculate_discount_amount(subtotal, discount)
    return {
        "id": None,
        "booking_id": "Pending details",
        "car_id": car["id"],
        "provider": "AVIS",
        "pickup_location": pickup_location or car["location"] or "Denver International Airport (DEN)",
        "pickup_date": format_booking_date(pickup_date or default_pickup, "Upcoming pickup"),
        "pickup_time": pickup_time or "10:00 AM",
        "dropoff_location": return_location or pickup_location or car["location"] or "Denver International Airport (DEN)",
        "dropoff_date": format_booking_date(return_date or default_return, "Upcoming return"),
        "dropoff_time": return_time or "10:00 AM",
        "days": rental_days,
        "subtotal_price": subtotal,
        "discount_code": discount["code"] if discount else "",
        "discount_amount": discount_amount,
        "total_price": round(subtotal - discount_amount, 2),
        "status": "CONFIRMED",
        "booking_status": "CONFIRMED",
        "payment_status": "PAY_AT_PICKUP",
        "car_name": car["name"],
        "category": car["category"],
        "seats": car["seats"],
        "bags": car["bags"],
        "doors": car["doors"],
        "transmission": car["transmission"],
        "color": car["color"],
        "image_url": car["image_url"],
    }


def find_or_create_guest_user(full_name: str, email: str, phone: str) -> int:
    clean_email = email.strip().lower()
    clean_phone = phone.strip()
    with db() as con:
        existing = con.execute("SELECT * FROM users WHERE email = ?", (clean_email,)).fetchone()
        if existing and row_value(existing, "guest_account") not in {"1", "True", "true"}:
            raise ValueError("An account already exists for this email. Please sign in to add this booking.")
        if not existing and clean_phone:
            existing = con.execute(
                "SELECT * FROM users WHERE phone = ? AND guest_account = 1 ORDER BY id DESC LIMIT 1",
                (clean_phone,),
            ).fetchone()
        if existing:
            con.execute(
                """
                UPDATE users
                SET name = COALESCE(NULLIF(?, ''), name),
                    email = COALESCE(NULLIF(?, ''), email),
                    phone = COALESCE(NULLIF(?, ''), phone),
                    promo_email_opt_in = 1
                WHERE id = ?
                """,
                (full_name, clean_email, clean_phone, existing["id"]),
            )
            return int(existing["id"])
        con.execute(
            """
            INSERT INTO users
            (name, email, phone, password_hash, is_verified, guest_account, promo_email_opt_in)
            VALUES (?, ?, ?, ?, 0, 1, 1)
            """,
            (full_name or "FairFares Guest", clean_email, clean_phone, hash_password(secrets.token_urlsafe(18))),
        )
        return int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])


def ensure_booking_for_user(
    user_id: int,
    car_id: int | None = None,
    discount_code: str = "",
    days: int = 10,
    pickup_date: str = "",
    return_date: str = "",
    pickup_time: str = "10:00 AM",
    return_time: str = "10:00 AM",
    pickup_location: str = "",
    return_location: str = "",
) -> sqlite3.Row | None:
    existing = get_booking_for_user(user_id)
    if existing and not car_id:
        return existing
    if car_id:
        requested_car = get_car(car_id)
        if requested_car and requested_car["status"].strip().upper() != "MAINTENANCE":
            try:
                return create_booking_for_user(user_id, car_id, discount_code, days, pickup_date, return_date, pickup_time, return_time, pickup_location, return_location)
            except (RuntimeError, ValueError):
                return existing
        return None
    cars = get_cars()
    if not cars:
        return None
    return create_booking_for_user(user_id, cars[0]["id"], discount_code, days, pickup_date, return_date, pickup_time, return_time, pickup_location, return_location)


def get_saved_cars_for_user(user_id: int) -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT saved_cars.*, cars.name AS car_name, cars.category, cars.image_url,
                   cars.location, cars.daily_price
            FROM saved_cars
            JOIN cars ON cars.id = saved_cars.car_id
            WHERE saved_cars.user_id = ?
            ORDER BY saved_cars.id DESC
            LIMIT 50
            """,
            (user_id,),
        ).fetchall()


def get_saved_car_ids_for_user(user_id: int | None) -> set[int]:
    if not user_id:
        return set()
    with db() as con:
        return {
            row["car_id"]
            for row in con.execute("SELECT DISTINCT car_id FROM saved_cars WHERE user_id = ?", (user_id,)).fetchall()
        }


EMAIL_MARKETING_DRAFTS = [
    {
        "type": "Transactional",
        "timing": "Immediately after booking",
        "audience": "New booking customers",
        "subject": "Your FairFares booking is confirmed: {booking_id}",
        "headline": "Your car is booked.",
        "body": "Thanks for choosing FairFares. Your trip is confirmed for {pickup_date}. Bring a lower quote from Avis, Enterprise, Hertz, or another major rental company and we will match it plus give an additional 10% off after review.",
        "cta": "Manage Booking",
    },
    {
        "type": "Transactional",
        "timing": "When pickup is completed",
        "audience": "Picked-up customers",
        "subject": "Your FairFares documents are ready",
        "headline": "Download your trip documents anytime.",
        "body": "Your invoice, rental agreement, and taxes & fees breakdown are ready in your FairFares portal. Keep them for your records or email them to yourself.",
        "cta": "Download Documents",
    },
    {
        "type": "Reminder",
        "timing": "24 hours before pickup",
        "audience": "Upcoming trips",
        "subject": "Your FairFares trip starts tomorrow",
        "headline": "Pickup is almost here.",
        "body": "Your FairFares car is scheduled for pickup at {pickup_location}. Please bring your driver license, insurance details, and any lower quote you want us to review.",
        "cta": "View Trip",
    },
    {
        "type": "Reminder",
        "timing": "2 hours before pickup",
        "audience": "Same-day pickup customers",
        "subject": "Your FairFares pickup starts in 2 hours",
        "headline": "We are getting your car ready.",
        "body": "Your pickup window is coming up. If plans changed, open Manage Booking or contact support before arrival.",
        "cta": "Open Live Status",
    },
    {
        "type": "Post-trip",
        "timing": "After return is completed",
        "audience": "Returned customers",
        "subject": "Thank you for choosing FairFares",
        "headline": "We appreciate your trip.",
        "body": "Thank you for renting with FairFares. We hope the ride was fair, clean, and simple. Your documents stay saved in your portal.",
        "cta": "Book Again",
    },
    {
        "type": "Review",
        "timing": "24 hours after trip",
        "audience": "Completed trips",
        "subject": "How was your FairFares experience?",
        "headline": "Tell us how we did.",
        "body": "Your feedback helps us keep prices transparent and service reliable for students and travelers.",
        "cta": "Leave Feedback",
    },
    {
        "type": "Re-engagement",
        "timing": "30 days inactive",
        "audience": "Inactive users",
        "subject": "We miss you: student-ready rentals are waiting",
        "headline": "Your next FairFares trip can still cost less.",
        "body": "Need a ride again? Search FairFares and bring us a lower quote from a major rental company. We will match it and add 10% off after review.",
        "cta": "Search Cars",
    },
    {
        "type": "Referral",
        "timing": "7 days after trip",
        "audience": "Happy customers",
        "subject": "Invite friends and earn FairFares rewards",
        "headline": "Share fair prices with friends.",
        "body": "Give friends your referral code. Referral codes can be limited in Admin Discounts, including max uses and valid-through dates.",
        "cta": "Get Referral Code",
    },
]


EMAIL_SEASONAL_PLAN = [
    ("January", "New Year travel deals", "Jan 1-15"),
    ("March", "Spring break specials", "Mar 1-20"),
    ("May", "Summer travel begins", "May 1-31"),
    ("July", "Independence Day travel", "Jun 15-Jul 4"),
    ("August", "Back-to-school offers", "Aug 1-31"),
    ("September", "Labor Day travel", "Aug 15-Sep 5"),
    ("October", "Fall travel deals", "Oct 1-31"),
    ("November", "Thanksgiving travel", "Nov 1-25"),
    ("December", "Holiday and New Year travel", "Dec 1-31"),
]


def get_email_campaigns() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM email_campaigns
            ORDER BY campaign_date ASC, id DESC
            LIMIT 100
            """
        ).fetchall()


def get_marketing_subscriber_count() -> int:
    with db() as con:
        return con.execute(
            """
            SELECT COUNT(*) AS total
            FROM users
            WHERE is_admin = 0
              AND is_verified = 1
              AND promo_email_opt_in = 1
              AND marketing_unsubscribed_at IS NULL
            """
        ).fetchone()["total"]


AGREEMENT_FIELD_GROUPS = (
    (
        "Customer",
        "customer",
        (
            ("lessee_name", "Lessee name"),
            ("lessee_address", "Lessee address"),
            ("license_state", "DL state"),
            ("license_number", "DL number"),
            ("license_expiry", "DL expiration"),
            ("insurance_company", "Insurance company"),
            ("insurance_policy", "Policy number"),
            ("customer_signature", "Customer signature"),
        ),
    ),
    (
        "Issuer",
        "issuer",
        (
            ("agreement_date", "Agreement date"),
            ("lessor_name", "Lessor name"),
            ("lessor_address", "Lessor address"),
            ("lessor_email", "Lessor email"),
            ("lessor_phone", "Lessor phone"),
            ("vehicle_mileage", "Vehicle mileage"),
            ("security_deposit", "Security deposit"),
            ("monthly_payment", "Monthly payment"),
            ("payment_due_day", "Payment due day"),
            ("mileage_allowed", "Mileage allowed"),
            ("extra_mile_rate", "Extra mile rate"),
            ("issuer_name", "Issuer name"),
            ("issuer_signature", "Issuer signature"),
        ),
    ),
)
AGREEMENT_FIELD_KEYS = tuple(field for _, _, fields in AGREEMENT_FIELD_GROUPS for field, _ in fields)


def row_value(row: sqlite3.Row | dict[str, object], key: str, default: str = "") -> str:
    if isinstance(row, dict):
        value = row.get(key, default)
        return str(value if value is not None else default)
    return str(row[key] if key in row.keys() and row[key] is not None else default)


def saved_agreement_data(agreement: sqlite3.Row | None) -> dict[str, str]:
    if not agreement:
        return {}
    try:
        data = json.loads(agreement["agreement_data"] or "{}")
    except json.JSONDecodeError:
        return {}
    return {key: str(value) for key, value in data.items() if key in AGREEMENT_FIELD_KEYS}


def agreement_default_values(
    row: sqlite3.Row,
    license_row: sqlite3.Row | None = None,
    insurance: sqlite3.Row | None = None,
    agreement: sqlite3.Row | None = None,
) -> dict[str, str]:
    values = {
        "agreement_date": datetime.now().strftime("%Y-%m-%d"),
        "lessor_name": "FairFares",
        "lessor_address": "",
        "lessor_email": "fairfars@gmail.com",
        "lessor_phone": "9372518688",
        "lessee_name": row_value(row, "user_name"),
        "lessee_address": row_value(row, "address"),
        "license_state": row_value(license_row, "state", "CO") if license_row else "CO",
        "license_number": row_value(license_row, "license_number") if license_row else "",
        "license_expiry": row_value(license_row, "expiry_date") if license_row else "",
        "vehicle_mileage": "",
        "insurance_company": row_value(insurance, "insurance_provider") if insurance else "",
        "insurance_policy": "",
        "security_deposit": "250.00",
        "monthly_payment": f"{float(row['total_price']):.2f}",
        "payment_due_day": "5th",
        "mileage_allowed": "3500",
        "extra_mile_rate": "0.15",
        "customer_signature": row_value(agreement, "signature_text") if agreement else "",
        "issuer_name": "FairFares Representative",
        "issuer_signature": "",
    }
    values.update(saved_agreement_data(agreement))
    return values


def vehicle_make(row: sqlite3.Row) -> str:
    return row_value(row, "car_brand") or row_value(row, "car_name").split(" ")[0]


def vehicle_model(row: sqlite3.Row) -> str:
    if row_value(row, "car_model"):
        return row_value(row, "car_model")
    name_parts = row_value(row, "car_name").split(" ", 1)
    return name_parts[1] if len(name_parts) > 1 else row_value(row, "car_name")


def build_rental_agreement_text(row: sqlite3.Row, values: dict[str, str]) -> str:
    price_match_agency = row_value(row, "price_match_agency")
    price_match_amount = float(row_value(row, "price_match_amount") or 0)
    price_match_discount = float(row_value(row, "price_match_discount_amount") or 0)
    price_match_original = float(row_value(row, "price_match_original_total") or row_value(row, "subtotal_price") or row_value(row, "total_price") or 0)
    late_fee = float(row_value(row, "late_fee_amount") or 0)
    price_match_line = (
        f"Price match: {price_match_agency} quote matched at {format_money(price_match_amount)}; additional 10% FairFares discount {format_money(price_match_discount)}; original FairFares total before match {format_money(price_match_original)}."
        if price_match_agency and price_match_amount
        else "Price match: None submitted."
    )
    late_fee_line = (
        f"Late return charge: {format_money(late_fee)} ({row_value(row, 'late_fee_note')})."
        if late_fee
        else "Late return charge: None."
    )
    return f"""SHORT TERM VEHICLE RENTAL AGREEMENT

This agreement is entered into this day, {values.get('agreement_date', '')} between

Lessor:
Name: {values.get('lessor_name', '')}
Address: {values.get('lessor_address', '')}
Email: {values.get('lessor_email', '')}
Phone: {values.get('lessor_phone', '')}

Lessee:
Name: {values.get('lessee_name', '')}
Address: {values.get('lessee_address', '')}
Driving License Information: State: {values.get('license_state', '')} Number: {values.get('license_number', '')} Expiration Date: {values.get('license_expiry', '')}
Email: {row_value(row, 'user_email')}
Phone: {row_value(row, 'phone')}
Additional Driver: {row_value(row, 'additional_driver_name') or 'None'} {f"({row_value(row, 'additional_driver_age')})" if row_value(row, 'additional_driver_age') else ""}

1. RECITALS.
WHEREAS, the Lessor is authorized to lease the Vehicle, and the Lessee is desirous of leasing the Vehicle from the Lessor on the terms set out in this Vehicle Lease Agreement. This Agreement is a lease only and Lessee will have no right, title, or interest in or to the Vehicle except for use of the Vehicle as described in this Agreement.

2. DESCRIPTION OF RENTED VEHICLE.
Make: {vehicle_make(row)}
Model: {vehicle_model(row)}
Color: {row_value(row, 'car_color')}
Year: {row_value(row, 'car_year')}
Body: {row_value(row, 'car_type') or row_value(row, 'car_category')}
Mileage: {values.get('vehicle_mileage', '')}
License Plate: {row_value(row, 'license_plate')}
VIN: {row_value(row, 'vin_number')}
Insurance Company: {values.get('insurance_company', '')}
Policy#: {values.get('insurance_policy', '')}
Purpose: Personal Use Only

3. AMOUNT DUE AT LEASE SIGNING.
A refundable security deposit shall be paid in the amount of ${values.get('security_deposit', '250.00')}.
Rental subtotal: {format_money(row_value(row, 'subtotal_price') or row_value(row, 'total_price'))}
Discount applied: {row_value(row, 'discount_code') or 'None'} - {format_money(row_value(row, 'discount_amount'))}
{price_match_line}
{late_fee_line}
Final total due: {format_money(row_value(row, 'total_price'))}
FairFares price promise: Found a lower quote from Avis, Enterprise, Hertz, or another major rental company? We'll match it and give you an additional 10% off.

4. LEASE PAYMENT.
As consideration of this lease, Lessee shall pay ${values.get('monthly_payment', '')} monthly on a month-to-month basis.

5. TERM.
This is a month-to-month rental agreement. Either party may end the lease with 15 days of advanced written notice by email or personal text message. Returning in advance of the agreed date will not automatically entitle Lessee to prorated lease payment.

6. FORM OF PAYMENT.
Monthly payments are to be made on the {values.get('payment_due_day', '')} day of each month. Payments may be made by cashier's check, money order, certified check, Zelle, cash, or any other means agreed upon by the Lessor and Lessee.

7. SECURITY DEPOSIT.
The security deposit will be returned at termination, subject to the Lessor applying it against lease charges, tolls, damages, cleaning, smoking, or other amounts due.

8. LATE PAYMENT FEES.
A late fee of $50.00 per day will be charged on payments made after the due date.

9. MILEAGE PERMITTED.
Lessee may drive the Vehicle for a maximum of {values.get('mileage_allowed', '')} miles per month and will be charged ${values.get('extra_mile_rate', '')} per extra mile.

10. USAGE OF THE VEHICLE.
The vehicle may be used for personal purposes only, such as commuting to work or school. Commercial use including Uber, Lyft, DoorDash, or similar applications is not permitted and is a material breach of this Agreement.

11. GAP LIABILITY NOTICE.
In the event of theft or total loss, Lessee is liable for any gap between the amount due and insurance settlement proceeds or deductible.

12. INSURANCE.
Lessee must maintain automobile liability insurance, collision, and comprehensive coverage as required by applicable law, with deductible no greater than $500.00 per claim. Proof of insurance must be provided to Lessor upon request. Driving without insurance coverage is a material breach.

13. EXCESSIVE WEAR AND USE.
Lessee may be charged for excessive wear including damaged glass, body panels, lights, paint, smoking, interior damage, worn tires, or mechanical damage that interferes with safe operation.

14. NOTICE.
All notices required under this Lease are deemed delivered when delivered in person, by email, or by mail to the appropriate party.

15. ASSIGNMENT.
Lessee may not assign, transfer, or sublet obligations, rights, or interest under this Agreement without Lessor's prior written consent.

16. TERMINATION AND DEFAULT.
Lessor may terminate immediately if Lessee fails to pay, misrepresents information, damages the vehicle, fails to maintain insurance, fails to return the vehicle, or breaches this Agreement. If Lessee terminates without prior notice, a $100.00 fee may be charged and deposit may not be returned.

17. VEHICLE RETURN.
Vehicle must be returned clean, with the same fuel level, and in the care of Lessor. Dirty vehicles may incur a $50.00 cleaning fee and smoking inside the vehicle may incur a $200.00 charge.

18. COSTS, EXPENSES, FEES, AND CHARGES.
Lessee agrees to pay all fines, tickets, toll charges, penalties, and expenses incurred in connection with operation of the vehicle during the term.

19. MAINTENANCE.
Lessor will maintain the vehicle for normal wear and tear. Lessee must bring the vehicle for scheduled maintenance when requested and may not conduct maintenance without permission.

20. ACCEPTABLE DRIVERS AND LIMITATIONS.
Only Lessee may operate the vehicle. Car sharing is not allowed under any circumstances. Lessee may not modify the vehicle without prior written consent.

21. WARRANTIES.
The Vehicle is provided in "as is" condition and Lessor makes no express or implied warranties regarding condition, quality, durability, capability, or suitability.

22. GOVERNING LAW.
This Lease shall be construed in accordance with the laws of Texas.

23. SIGNATORIES.
LESSEE:
By: {values.get('customer_signature', '') or '_________________'}
Date: {values.get('agreement_date', '')}

LESSOR:
By: {values.get('issuer_signature', '') or '_________________'}
Name: {values.get('issuer_name', '')}
Date: {values.get('agreement_date', '')}
"""


def default_agreement_text(row: sqlite3.Row) -> str:
    return build_rental_agreement_text(row, agreement_default_values(row))


def render_agreement_fields(values: dict[str, str]) -> str:
    groups = []
    input_types = {
        "agreement_date": "date",
        "license_expiry": "date",
        "security_deposit": "number",
        "monthly_payment": "number",
        "mileage_allowed": "number",
        "extra_mile_rate": "number",
        "vehicle_mileage": "number",
    }
    for title, role, fields in AGREEMENT_FIELD_GROUPS:
        field_html = []
        for key, label in fields:
            step = ' step="0.01"' if input_types.get(key) == "number" else ""
            field_html.append(
                f'<label class="agreement-field agreement-{role}"><span>{escape(label)} <b>{escape(title)}</b></span>'
                f'<input name="agreement_{key}" type="{input_types.get(key, "text")}"{step} value="{escape(values.get(key, ""))}"></label>'
            )
        groups.append(f'<div class="agreement-group agreement-group-{role}"><h3>{escape(title)} fields</h3>{"".join(field_html)}</div>')
    return "".join(groups)


def get_booking_documents(booking_id: int | None) -> dict[str, dict[str, str]]:
    if not booking_id:
        return {}
    with db() as con:
        booking = con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.phone,
                   users.address, cars.name AS car_name, cars.brand AS car_brand, cars.model AS car_model,
                   cars.year AS car_year, cars.category AS car_category, cars.type AS car_type,
                   cars.color AS car_color, cars.license_plate, cars.vin_number
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
    payment_method = transaction["payment_method"] if transaction else payment_status_label(booking["payment_status"])
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
    status_line = f"Trip status: {booking_status_label(booking['booking_status'], booking['payment_status'])}"

    return {
        "Invoice / Receipt": {
            "title": "Invoice / Receipt",
            "content": (
                f"{status_line}\n"
                f"Invoice: {invoice_number}\n"
                f"Booking: {booking['booking_id']}\n"
                f"Customer: {booking['user_name']} · {booking['user_email']}\n"
                f"Vehicle: {booking['car_name']}\n"
                f"Dates: {booking['pickup_date']} {booking['pickup_time']} to {booking['dropoff_date']} {booking['dropoff_time']}\n"
                f"Payment: {payment_method} · {transaction_status}\n"
                f"Subtotal: {format_money(booking['subtotal_price'] or booking['total_price'])}\n"
                f"Discount: {booking['discount_code'] or 'None'} · -{format_money(booking['discount_amount'])}\n"
                f"Total due: {format_money(booking['total_price'])}"
            ),
            "status": f"Generated from booking {booking['booking_id']} and admin payment records.",
        },
        "Rental Agreement": {
            "title": "Rental Agreement",
            "content": (
                f"{status_line}\n\n"
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
                f"{status_line}\n"
                f"Booking: {booking['booking_id']}\n"
                f"Rental subtotal: ${base_amount:.2f}\n"
                f"Discount: {booking['discount_code'] or 'None'} · -{format_money(booking['discount_amount'])}\n"
                f"Taxes estimate: ${tax_amount:.2f}\n"
                f"Airport/provider fees estimate: ${fee_amount:.2f}\n"
                f"Insurance: {insurance_line}\n"
                f"Final total: ${float(booking['total_price']):.2f}"
            ),
            "status": "Generated from booking total, insurance, and invoice records.",
        },
    }


def get_user_document_sets(user_id: int | None, active_booking_id: int | None = None) -> list[dict[str, object]]:
    if not user_id:
        return []
    document_sets: list[dict[str, object]] = []
    for booking in get_bookings_for_user(user_id):
        status = row_value(booking, "booking_status")
        payment_status = row_value(booking, "payment_status")
        locked = status not in {"PICKED_UP", "RETURNED", "CANCELLED"}
        if locked:
            lock_message = "Documents can be retrieved once pickup is completed."
        elif status == "CANCELLED":
            lock_message = "This booking was cancelled. Documents are shown for recordkeeping."
        else:
            lock_message = ""
        document_sets.append(
            {
                "id": booking["id"],
                "bookingId": row_value(booking, "booking_id"),
                "vehicle": row_value(booking, "car_name") or "Booked vehicle",
                "dates": f"{row_value(booking, 'pickup_date')} - {row_value(booking, 'dropoff_date')}",
                "status": status,
                "statusLabel": booking_status_label(status, payment_status),
                "locked": locked,
                "lockMessage": lock_message,
                "docs": get_booking_documents(booking["id"]),
            }
        )
    document_sets.sort(key=lambda item: (0 if item["id"] == active_booking_id else 1, str(item["bookingId"])))
    return document_sets


def render_template(template_name: str, **context: object) -> bytes:
    template = Template((TEMPLATE_DIR / template_name).read_text())
    safe_context = {key: value for key, value in context.items()}
    return template.safe_substitute(safe_context).encode()


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def guest_offer_modal() -> str:
    return """
  <section class="guest-offer-backdrop" id="guestOfferModal" hidden>
    <div class="guest-offer-modal" role="dialog" aria-modal="true" aria-labelledby="guestOfferTitle">
      <button class="guest-offer-close" type="button" data-offer-close aria-label="Close offer">x</button>
      <img class="guest-offer-logo" src="/static/img/logo-dark-header.png" alt="FairFares logo">
      <p class="eyebrow">Referral student deal</p>
      <h2 id="guestOfferTitle">Claim 10% off before booking.</h2>
      <p>Use the FairFares referral deal on this eligible booking. Follow us, generate your own referral code, or start with our current deal code while the offer is active.</p>
      <div class="guest-offer-code" aria-label="Referral deal code">
        <span>Deal code</span>
        <b>REFER_DUDE143</b>
      </div>
      <button class="guest-offer-primary" type="button" data-offer-apply>Claim 10% off</button>
      <button class="guest-offer-decline" type="button" data-offer-decline>Continue without deal</button>
      <a class="guest-offer-terms" href="/deals">Terms apply</a>
    </div>
  </section>
"""


class FairFaresHandler(SimpleHTTPRequestHandler):
    server_version = "FairFares/1.0"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/static/"):
            self.serve_static(parsed.path)
            return
        routes = {
            "/": self.home,
            "/buy-cars": self.buy_cars_page,
            "/deals": self.deals_page,
            "/explorer": self.explorer_page,
            "/activate": self.activate_account,
            "/student-verify": self.verify_student_email,
            "/unsubscribe": self.unsubscribe_marketing,
            "/healthz": self.healthz,
            "/login": self.login_page,
            "/signup": self.signup_page,
            "/manage-booking": self.manage_booking,
            "/dashboard": self.dashboard,
            "/admin": self.admin_portal,
            "/admin/bookings": self.admin_bookings_page,
            "/admin/users": self.admin_users_page,
            "/admin/tickets": self.admin_tickets_page,
            "/admin/discounts": self.admin_discounts_page,
            "/admin/commercials": self.admin_commercials_page,
            "/admin/email-marketing": self.admin_email_marketing_page,
            "/admin/pickup": self.admin_pickup_page,
            "/admin/backups/download": self.download_admin_backup,
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
            "/bookings/request-cancel": self.cancel_booking_request,
            "/bookings/save": self.save_current_booking,
            "/saved-cars": self.save_search_car,
            "/documents/email": self.email_booking_documents,
            "/guest-booking": self.create_guest_booking,
            "/explorer/quest": self.create_explorer_quest,
            "/explorer/checkin": self.checkin_explorer_stop,
            "/profile/update": self.update_user_profile,
            "/support/tickets": self.create_support_ticket,
            "/student-verification": self.update_student_verification,
            "/referrals/generate": self.generate_referral_code,
            "/referrals/claim": self.claim_referral_bonus,
            "/admin/content": self.update_content,
            "/admin/cars": self.create_admin_car,
            "/admin/cars/status": self.update_admin_car_status,
            "/admin/cars/delete": self.delete_admin_car,
            "/admin/bookings/status": self.update_admin_booking_status,
            "/admin/discounts": self.create_admin_discount,
            "/admin/discounts/delete": self.delete_admin_discount,
            "/admin/commercials": self.create_admin_commercial,
            "/admin/commercials/status": self.update_admin_commercial_status,
            "/admin/commercials/delete": self.delete_admin_commercial,
            "/admin/email-marketing": self.create_email_campaign,
            "/admin/email-marketing/delete": self.delete_email_campaign,
            "/admin/email-marketing/send": self.send_email_campaign_now,
            "/admin/email-marketing/test": self.send_email_campaign_test,
            "/admin/pickup-documents": self.save_pickup_documents,
            "/admin/tickets/update": self.update_admin_ticket,
            "/admin/backups/create": self.create_admin_backup,
        }
        handler = routes.get(parsed.path)
        if handler:
            if not self.allow_post_from_same_origin(parsed.path):
                self.send_json({"ok": False, "message": "Request origin not allowed."}, 403)
                return
            handler()
        else:
            self.not_found()

    def allow_post_from_same_origin(self, path: str) -> bool:
        if path in {"/login", "/signup"}:
            return True
        expected_host = (self.headers.get("Host") or "").split(":", 1)[0]
        for header_name in ("Origin", "Referer"):
            value = self.headers.get(header_name)
            if not value:
                continue
            parsed = urllib.parse.urlparse(value)
            if parsed.hostname and parsed.hostname != expected_host:
                return False
        return True

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
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" or os.environ.get("PUBLIC_BASE_URL", "").startswith("https://") else ""
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/{secure}")
        self.end_headers()

    def activation_url(self, token: str) -> str:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        if public_base_url:
            return f"{public_base_url}/activate?token={urllib.parse.quote(token)}"
        host = self.headers.get("Host") or "127.0.0.1:8000"
        scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
        return f"{scheme}://{host}/activate?token={urllib.parse.quote(token)}"

    def student_verification_url(self, token: str) -> str:
        return f"{self.public_origin().rstrip('/')}/student-verify?token={urllib.parse.quote(token)}"

    def public_origin(self) -> str:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        if public_base_url:
            return public_base_url
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "127.0.0.1:8000"
        scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
        return f"{scheme}://{host}"

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
        saved_car_ids = get_saved_car_ids_for_user(user["id"] if user else None)
        cars = "\n".join(self.render_car_card(row, saved_car_ids) for row in car_rows)
        default_pickup, default_return = default_trip_dates()
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
                    "maxUses": row["max_uses"],
                    "usedCount": row["used_count"],
                }
                for row in get_active_discounts()
            ]
        )
        commercial = get_active_commercial()
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
            default_pickup_date=escape(default_pickup),
            default_return_date=escape(default_return),
            location_options=location_options,
            pickup_time_options=time_select_options("10:00 AM"),
            return_time_options=time_select_options("10:00 AM"),
            type_filters=type_filters,
            fuel_filters=fuel_filters,
            discounts_json=escape(discounts_json),
            commercial_title=escape(commercial["title"] if commercial else "FairFares commercial"),
            commercial_embed_url=escape(commercial["embed_url"] if commercial else ""),
            commercial_duration=escape(commercial["duration_seconds"] if commercial else 12),
            commercial_live=escape("1" if commercial and commercial["is_live"] else "0"),
            commercial_badge=escape("Live now" if commercial and commercial["is_live"] else "Play feature"),
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
            guest_offer_modal="" if user else guest_offer_modal(),
            referral_claim_modal=referral_claim_modal(get_ready_referral_reward(user["id"]) if user else None),
        )
        self.send_html(body)

    def explorer_page(self) -> None:
        user = self.current_user()
        profile = get_explorer_profile(user["id"] if user else None)
        has_booking = bool(get_booking_for_user(user["id"])) if user else False
        body = render_template(
            "explorer.html",
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
            level=escape(str(profile["level"])),
            xp=escape(str(profile["xp"])),
            trips=escape(str(profile["trips"])),
            badges=escape(str(profile["badges"])),
            booked_checked="checked" if has_booking else "",
            exploring_checked="" if has_booking else "checked",
        )
        self.send_html(body)

    def create_explorer_quest(self) -> None:
        user = self.current_user()
        form = self.read_form()
        moods = [item.strip() for item in form.get("moods", "").split(",") if item.strip()]
        city = form.get("city", "Denver, Colorado") or "Denver, Colorado"
        fairfares_booked = form.get("fairfares_booked") == "yes"
        quest = generate_explorer_quest(
            city,
            moods,
            form.get("duration", "Half Day"),
            form.get("budget", "$$"),
            form.get("travel_with", "Friends"),
            fairfares_booked,
        )
        quest_id = None
        if user:
            with db() as con:
                con.execute(
                    """
                    INSERT INTO explorer_quests
                    (user_id, city, title, quest_type, duration, budget, travel_with, total_hours, total_miles, total_xp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user["id"],
                        quest["city"],
                        quest["title"],
                        quest["quest_type"],
                        quest["duration"],
                        quest["budget"],
                        quest["travel_with"],
                        quest["total_hours"],
                        quest["total_miles"],
                        quest["total_xp"],
                    ),
                )
                quest_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
                for stop in quest["stops"]:
                    con.execute(
                        """
                        INSERT INTO explorer_stops
                        (quest_id, stop_order, name, lat, lng, xp_reward, challenge, is_secret)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            quest_id,
                            stop["order"],
                            stop["name"],
                            stop["lat"],
                            stop["lng"],
                            stop["xp_reward"],
                            stop["challenge"],
                            stop["is_secret"],
                        ),
                    )
                    stop["stop_id"] = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
                if fairfares_booked:
                    con.execute(
                        """
                        INSERT INTO explorer_profiles (user_id, xp, level, trips, badges)
                        VALUES (?, 100, 1, 0, 1)
                        ON CONFLICT(user_id) DO UPDATE SET
                            xp = xp + 100,
                            level = MAX(1, ((xp + 100) / 250) + 1),
                            badges = MAX(badges, 1),
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (user["id"],),
                    )
        quest["quest_id"] = quest_id
        self.send_json({"ok": True, "quest": quest})

    def checkin_explorer_stop(self) -> None:
        user = self.current_user()
        form = self.read_form()
        try:
            stop_id = int(form.get("stop_id", "0"))
        except ValueError:
            stop_id = 0
        if not user or not stop_id:
            self.send_json({"ok": True, "message": "Guest check-in saved locally.", "xp": 20})
            return
        with db() as con:
            stop = con.execute("SELECT * FROM explorer_stops WHERE id = ?", (stop_id,)).fetchone()
            if not stop:
                self.send_json({"ok": False, "message": "Explorer stop not found."}, 404)
                return
            con.execute("UPDATE explorer_stops SET completed = 1 WHERE id = ?", (stop_id,))
            con.execute(
                "INSERT INTO explorer_checkins (user_id, stop_id) VALUES (?, ?)",
                (user["id"], stop_id),
            )
            earned = int(stop["xp_reward"] or 20)
            con.execute(
                """
                INSERT INTO explorer_profiles (user_id, xp, level, trips, badges)
                VALUES (?, ?, 1, 0, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    xp = xp + ?,
                    level = MAX(1, ((xp + ?) / 250) + 1),
                    badges = MAX(badges, CASE WHEN xp + ? >= 250 THEN 2 ELSE badges END),
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user["id"], earned, earned, earned, earned),
            )
        self.send_json({"ok": True, "message": f"Check-in complete. +{earned} XP", "xp": earned})

    def deals_page(self, code: str = "", message: str = "") -> None:
        user = self.current_user()
        body = render_template(
            "deals.html",
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
            generated_code=escape(code),
            referral_message=escape(message),
            generated_class="" if code else "is-hidden",
        )
        self.send_html(body)

    def buy_cars_page(self) -> None:
        user = self.current_user()
        body = render_template(
            "buy_cars.html",
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def render_car_card(self, row: sqlite3.Row, saved_car_ids: set[int] | None = None) -> str:
        features = "".join(f"<li>{escape(feature)}</li>" for feature in row["features"].split("|"))
        car_visual = (
            f'<img class="car-card-image" src="{escape(row["image_url"])}" alt="{escape(row["name"])}">'
            if row["image_url"]
            else '<div class="car-shape"></div>'
        )
        booked_until_date = row_value(row, "booked_until_date")
        booked_until_time = row_value(row, "booked_until_time")
        low, high = daily_price_range(row["daily_price"])
        is_saved = bool(saved_car_ids and row["id"] in saved_car_ids)
        save_label = "Unsave" if is_saved else "Save Trip"
        return f"""
        <article class="car-card" data-category="{escape(row["category"])}" data-fuel="{escape(row["fuel_type"])}" data-location="{escape(row["location"])}" data-price="{row["daily_price"]}" data-booked-until-date="{escape(booked_until_date)}" data-booked-until-time="{escape(booked_until_time)}">
            <div class="car-art car-{escape(row["color"])}">
                <span class="deal-badge">{escape(row["badge"])}</span>
                {car_visual}
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
                <strong data-price-range>${low}-${high}</strong><span>/day est.</span>
                <small class="availability-note" data-availability-note></small>
                <em>Found a lower quote from Avis, Enterprise, Hertz, or another major rental company? We'll match it and give you an additional 10% off.</em>
                <div class="card-actions-row">
                    <button class="light-button save-search-trip" type="button" data-car-id="{row["id"]}" data-save-car="{escape(row["name"])}" data-saved="{str(is_saved).lower()}">{save_label}</button>
                    <a class="select-button" href="/manage-booking?car_id={row["id"]}">Select</a>
                </div>
                <details class="car-terms">
                    <summary>View Details</summary>
                    <p>Bring a lower quote for the same rental period from Avis, Enterprise, Hertz, or another major rental company. FairFares will match it and give you an additional 10% off after review. Terms and conditions apply.</p>
                </details>
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
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        referral_prefill = query.get("referral_code", [""])[0]
        name_field = """
        <label>
          <span>Name</span>
          <input name="name" autocomplete="name">
        </label>
        <label>
          <span>Phone Number <small>(optional)</small></span>
          <input name="phone" autocomplete="tel" placeholder="Used to find guest bookings">
        </label>
        <label>
          <span>Referral Code <small>(optional)</small></span>
          <input name="referral_code" autocomplete="off" placeholder="Friend referral code" value="%s">
        </label>
        """ % escape(referral_prefill)
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
        email = form.get("email", "").lower().strip()
        phone = form.get("phone", "").strip()
        referral_code = form.get("referral_code", "").strip()
        password = form.get("password", "")
        if "@" not in email or len(password) < 8:
            self.signup_page("Use a valid email and a password with at least 8 characters.")
            return
        try:
            with db() as con:
                guest = con.execute(
                    "SELECT * FROM users WHERE email = ? AND guest_account = 1 LIMIT 1",
                    (email,),
                ).fetchone()
                if not guest and phone:
                    guest = con.execute(
                        "SELECT * FROM users WHERE phone = ? AND guest_account = 1 ORDER BY id DESC LIMIT 1",
                        (phone,),
                    ).fetchone()
                if guest:
                    email_owner = con.execute(
                        "SELECT * FROM users WHERE email = ? AND id != ? LIMIT 1",
                        (email, guest["id"]),
                    ).fetchone()
                    if email_owner:
                        raise sqlite3.IntegrityError
                    con.execute(
                        """
                        UPDATE users
                        SET name = ?,
                            email = ?,
                            phone = COALESCE(NULLIF(?, ''), phone),
                            password_hash = ?,
                            is_verified = 0,
                            guest_account = 0
                        WHERE id = ?
                        """,
                        (name, email, phone, hash_password(password), guest["id"]),
                    )
                    user_id = guest["id"]
                else:
                    con.execute(
                        "INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, 0)",
                        (name, email, phone, hash_password(password)),
                    )
                    user_id = con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        except sqlite3.IntegrityError:
            self.signup_page("An account with that email already exists.")
            return
        attach_referral_rewards_to_user(user_id, email, phone, name)
        if referral_code:
            record_referral_signup(referral_code, user_id, email, name)
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
                WHERE token = ? AND purpose = 'ACCOUNT'
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
        new_pickup_date = form.get("pickup_date") or booking["pickup_date"]
        new_pickup_time = form.get("pickup_time") or booking["pickup_time"]
        new_return_date = form.get("return_date") or booking["dropoff_date"]
        new_return_time = form.get("return_time") or booking["dropoff_time"]
        new_pickup_location = form.get("pickup_location") or booking["pickup_location"]
        new_dropoff_location = form.get("dropoff_location") or booking["dropoff_location"]
        requested_vehicle = (form.get("vehicle") or "").strip()
        requested_car = get_car_by_name(requested_vehicle)
        if requested_vehicle and not requested_car:
            self.send_json({"ok": False, "message": "Selected vehicle is no longer available."}, 400)
            return
        requested_start = parse_booking_datetime(new_pickup_date, new_pickup_time)
        requested_end = parse_booking_datetime(new_return_date, new_return_time)
        if requested_start and requested_end and requested_end <= requested_start:
            self.send_json({"ok": False, "message": "Return date and time must be after pickup date and time."}, 400)
            return
        if requested_car and requested_car["id"] != booking["car_id"]:
            active_booking = active_booking_for_car(requested_car["id"])
            active_return = parse_booking_datetime(active_booking["dropoff_date"], active_booking["dropoff_time"]) if active_booking else None
            if requested_start and active_return and requested_start < active_return:
                self.send_json(
                    {
                        "ok": False,
                        "message": f"{requested_car['name']} is available after {active_return.strftime('%-I:%M %p') if os.name != 'nt' else active_return.strftime('%I:%M %p').lstrip('0')} on {active_return.strftime('%b %d, %Y')}.",
                    },
                    409,
                )
                return
        current_pickup_iso = display_date_to_input(booking["pickup_date"], new_pickup_date)
        current_return_iso = display_date_to_input(booking["dropoff_date"], new_return_date)
        changes = []
        if new_pickup_date != current_pickup_iso or new_pickup_time != booking["pickup_time"]:
            changes.append(f"Pickup changed to {format_booking_date(new_pickup_date, new_pickup_date)} at {new_pickup_time}")
        if new_return_date != current_return_iso or new_return_time != booking["dropoff_time"]:
            changes.append(f"Return changed to {format_booking_date(new_return_date, new_return_date)} at {new_return_time}")
        if new_pickup_location != booking["pickup_location"]:
            changes.append(f"Pickup location changed to {new_pickup_location}")
        if new_dropoff_location != booking["dropoff_location"]:
            changes.append(f"Drop-off location changed to {new_dropoff_location}")
        if requested_car and requested_car["id"] != booking["car_id"]:
            changes.append(f"Vehicle change requested from {booking['car_name']} to {requested_car['name']}")
        if form.get("driver_name"):
            changes.append(f"Additional driver added: {form.get('driver_name')}")
        change_note = "; ".join(changes) or "Timing/location review requested"
        car_id = requested_car["id"] if requested_car and requested_car["id"] != booking["car_id"] else booking["car_id"]
        subtotal = float(booking["subtotal_price"] or booking["total_price"])
        discount_amount = float(booking["discount_amount"] or 0)
        total_price = float(booking["total_price"])
        if requested_car and requested_car["id"] != booking["car_id"]:
            subtotal = round(float(requested_car["daily_price"]) * int(booking["days"] or 1), 2)
            discount_amount = calculate_discount_amount(subtotal, get_valid_discount(booking["discount_code"]))
            total_price = round(subtotal - discount_amount, 2)
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET car_id = ?,
                    pickup_date = ?,
                    pickup_time = ?,
                    dropoff_date = ?,
                    dropoff_time = ?,
                    pickup_location = ?,
                    dropoff_location = ?,
                    return_location = ?,
                    subtotal_price = ?,
                    discount_amount = ?,
                    total_price = ?,
                    additional_driver_name = ?,
                    additional_driver_age = ?,
                    booking_status = 'MODIFIED',
                    status = 'MODIFIED',
                    cancellation_reason = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    car_id,
                    format_booking_date(new_pickup_date, new_pickup_date),
                    new_pickup_time,
                    format_booking_date(new_return_date, new_return_date),
                    new_return_time,
                    new_pickup_location,
                    new_dropoff_location,
                    new_dropoff_location,
                    subtotal,
                    discount_amount,
                    total_price,
                    form.get("driver_name", ""),
                    form.get("driver_age", "") if form.get("driver_name") else "",
                    change_note,
                    booking["id"],
                    user["id"],
                ),
            )
            if requested_car and requested_car["id"] != booking["car_id"]:
                con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ?", (booking["car_id"],))
                con.execute("UPDATE cars SET status = 'BOOKED' WHERE id = ?", (requested_car["id"],))
        self.send_json(
            {
                "ok": True,
                "message": f"Modification request sent: {change_note}",
                "status_label": booking_status_label("MODIFIED"),
                "status_class": booking_status_class("MODIFIED"),
            }
        )

    def cancel_booking_request(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        booking = get_booking_for_user(user["id"])
        if not booking or booking["booking_status"] not in {"MODIFIED", "CANCELLATION_REQUESTED"}:
            self.send_json({"ok": False, "message": "No pending request to cancel."})
            return
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'CONFIRMED',
                    status = 'CONFIRMED',
                    cancellation_reason = ''
                WHERE id = ? AND user_id = ?
                """,
                (booking["id"], user["id"]),
            )
        self.send_json({
            "ok": True,
            "message": "Pending request cancelled. Your booking is confirmed for pay at pickup.",
            "status_label": booking_status_label("CONFIRMED", "PAY_AT_PICKUP"),
            "status_class": booking_status_class("CONFIRMED"),
        })

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
        pickup_at = booking_datetime_from_row(booking, "pickup_date", "pickup_time")
        auto_cancel = bool(pickup_at and pickup_at - datetime.now() >= timedelta(hours=24))
        next_status = "CANCELLED" if auto_cancel else "CANCELLATION_REQUESTED"
        next_payment_status = "REFUND_REVIEW" if booking["payment_status"] == "PAID" else booking["payment_status"]
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = ?,
                    status = ?,
                    payment_status = ?,
                    cancellation_reason = ?
                WHERE id = ? AND user_id = ?
                """,
                (next_status, next_status, next_payment_status, reason, booking["id"], user["id"]),
            )
            if auto_cancel:
                con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ?", (booking["car_id"],))
            ticket_id = make_cancellation_task(con, booking, user, reason, auto_cancel)
        self.send_json({
            "ok": True,
            "message": (
                f"Booking cancelled automatically. Task {ticket_id} was created for admin refund follow-up."
                if auto_cancel
                else f"Cancellation request sent to admin for approval. Task {ticket_id} was created."
            ),
            "booking_status": next_status,
            "status_label": booking_status_label(next_status, next_payment_status),
            "status_class": booking_status_class(next_status),
        })

    def save_current_booking(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.send_json({"ok": False, "message": "No booking available to save."})
            return
        with db() as con:
            con.execute("UPDATE bookings SET saved_by_user = 1 WHERE id = ? AND user_id = ?", (booking["id"], user["id"]))
        self.send_json({"ok": True, "message": "Current trip saved."})

    def save_search_car(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to save this car to your trips."}, 401)
            return
        form = self.read_form()
        try:
            car_id = int(form.get("car_id", "0"))
        except ValueError:
            car_id = 0
        if not get_car(car_id):
            self.send_json({"ok": False, "message": "Car not found."}, 404)
            return
        action = form.get("action", "toggle")
        with db() as con:
            existing = con.execute(
                "SELECT id FROM saved_cars WHERE user_id = ? AND car_id = ? LIMIT 1",
                (user["id"], car_id),
            ).fetchone()
            if action == "unsave" or (action == "toggle" and existing):
                con.execute("DELETE FROM saved_cars WHERE user_id = ? AND car_id = ?", (user["id"], car_id))
                self.send_json({"ok": True, "saved": False, "message": "Save Trip"})
                return
            con.execute(
                """
                INSERT OR IGNORE INTO saved_cars
                (user_id, car_id, pickup_location, pickup_date, pickup_time, return_date, return_time, discount_code)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    car_id,
                    form.get("pickup_location", ""),
                    form.get("pickup_date", ""),
                    form.get("pickup_time", ""),
                    form.get("return_date", ""),
                    form.get("return_time", ""),
                    form.get("discount_code", ""),
                ),
            )
        self.send_json({"ok": True, "saved": True, "message": "Unsave"})

    def email_booking_documents(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to email documents."}, 401)
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id", "0"))
        except ValueError:
            booking_id = 0
        email = (form.get("email") or user["email"] or "").strip()
        with db() as con:
            booking = con.execute(
                """
                SELECT bookings.*, cars.name AS car_name, cars.category, cars.image_url
                FROM bookings
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ? AND bookings.user_id = ?
                """,
                (booking_id, user["id"]),
            ).fetchone()
        if not booking:
            self.send_json({"ok": False, "message": "Booking documents not found."}, 404)
            return
        if booking["booking_status"] not in {"PICKED_UP", "RETURNED", "CANCELLED"}:
            self.send_json({"ok": False, "message": "Documents can be retrieved once pickup is completed."}, 400)
            return
        documents = get_booking_documents(booking["id"])
        if not documents:
            self.send_json({"ok": False, "message": "Documents are not generated yet."}, 404)
            return
        outbox_file, delivery_status = send_booking_documents_email(email, user["name"], booking, documents, self.public_origin())
        message = f"Documents emailed to {email}."
        if not delivery_status.startswith("sent"):
            message = f"Documents email copy saved for {email}."
        self.send_json({
            "ok": True,
            "message": message,
            "delivery_status": delivery_status,
            "outbox_file": str(outbox_file),
        })

    def update_user_profile(self) -> None:
        user = self.current_user()
        if not user:
            self.not_found()
            return
        form = self.read_form()
        first_name = form.get("first_name", "").strip()
        last_name = form.get("last_name", "").strip()
        result = save_booking_contact_and_send_confirmation(
            user["id"],
            first_name,
            last_name,
            form.get("email", ""),
            form.get("phone", ""),
            self.public_origin(),
            form.get("promo_email_opt_in") == "on",
            form.get("text_opt_in") == "on",
        )
        reward = None
        if result.get("ok"):
            reward = ensure_referral_reward(user["id"], " ".join(part for part in (first_name, last_name) if part), form.get("email", ""), form.get("phone", ""))
            if reward:
                result["referral_code"] = reward["code"]
                result["referral_status"] = reward["status"]
        self.send_json(result, 200 if result["ok"] else 400)

    def create_guest_booking(self) -> None:
        form = self.read_form()
        first_name = form.get("first_name", "").strip()
        last_name = form.get("last_name", "").strip()
        full_name = " ".join(part for part in (first_name, last_name) if part).strip()
        email = form.get("email", "").strip().lower()
        phone = form.get("phone", "").strip()
        if not full_name or "@" not in email or len(phone) < 7:
            self.send_json({"ok": False, "message": "Please enter your full name, valid email, and phone number."}, 400)
            return
        try:
            car_id = int(form.get("car_id", "0"))
            days = int(form.get("days", "10"))
        except ValueError:
            self.send_json({"ok": False, "message": "Please select a valid vehicle."}, 400)
            return
        try:
            user_id = find_or_create_guest_user(full_name, email, phone)
        except ValueError as error:
            self.send_json({"ok": False, "message": str(error)}, 400)
            return
        try:
            booking = create_booking_for_user(
                user_id,
                car_id,
                form.get("discount_code", ""),
                max(1, min(days, 366)),
                form.get("pickup_date", ""),
                form.get("return_date", ""),
                form.get("pickup_time", "10:00 AM"),
                form.get("return_time", "10:00 AM"),
                form.get("pickup_location", ""),
                form.get("return_location", ""),
            )
        except (RuntimeError, ValueError) as error:
            self.send_json({"ok": False, "message": str(error)}, 400)
            return
        result = save_booking_contact_and_send_confirmation(
            user_id,
            first_name,
            last_name,
            email,
            phone,
            self.public_origin(),
            form.get("promo_email_opt_in") == "on",
            form.get("text_opt_in") == "on",
        )
        reward = ensure_referral_reward(user_id, full_name, email, phone)
        self.send_json({
            "ok": True,
            "booking_id": booking["booking_id"],
            "message": result.get("message") or "Booking details saved. Create an account with this email to see this trip later.",
            "referral_code": reward["code"] if reward else referral_reward_code(full_name, email),
            "referral_status": reward["status"] if reward else "PENDING",
        })

    def create_support_ticket(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to create a support ticket."}, 401)
            return
        form = self.read_form()
        booking = get_booking_for_user(user["id"])
        ticket_id = make_ticket_id()
        topic = form.get("topic") or "Pickup help"
        message = form.get("message") or ""
        urgent = form.get("urgent") == "1"
        priority = classify_support_priority(topic, urgent, message)
        due_at = support_due_at(priority)
        with db() as con:
            while con.execute("SELECT 1 FROM support_tickets WHERE ticket_id = ?", (ticket_id,)).fetchone():
                ticket_id = make_ticket_id()
            con.execute(
                """
                INSERT INTO support_tickets
                (ticket_id, booking_id, user_id, topic, preferred_contact, message, urgent, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ticket_id,
                    booking["id"] if booking else None,
                    user["id"],
                    topic,
                    form.get("preferred_contact") or "Chat in browser",
                    message,
                    1 if urgent else 0,
                    priority,
                ),
            )
            ticket_pk = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            alert_body = (
                f"{priority} support ticket created\n"
                f"SLA: {support_sla_text(priority)}\n"
                f"Ticket: {ticket_id}\n"
                f"Customer: {user['name']} · {user['email']} · {user['phone'] or 'No phone'}\n"
                f"Topic: {topic}\n"
                f"Preferred contact: {form.get('preferred_contact') or 'Chat in browser'}\n"
                f"Message: {message or '-'}"
            )
            queue_support_alerts(con, ticket_pk, ticket_id, priority, f"{priority} FairFares support ticket {ticket_id}", alert_body)
        self.send_json({
            "ok": True,
            "ticket_id": ticket_id,
            "priority": priority,
            "sla": support_sla_text(priority),
            "message": f"Ticket {ticket_id} created as {priority}. SLA: {support_sla_text(priority)}. Target response by {due_at}.",
        })

    def generate_referral_code(self) -> None:
        form = self.read_form()
        username = form.get("instagram_username", "")
        code = create_referral_discount(username)
        self.deals_page(
            code,
            "Referral code generated and saved in Admin Discounts. Use is limited to 3 referrals.",
        )

    def claim_referral_bonus(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "message": "Please sign in to claim your referral coupon."}, 401)
            return
        result = claim_referral_reward(user["id"])
        self.send_json(result, 200 if result.get("ok") else 400)

    def update_student_verification(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to update student verification."}, 401)
            return
        form = self.read_form()
        student_email = form.get("student_email", "").strip().lower()
        student_id = form.get("student_id", "").strip()
        if "@" not in student_email or not student_email.endswith(".edu") or len(student_id) < 4:
            self.send_json({
                "ok": False,
                "message": "Use your real .edu email and a valid student ID. Gmail or personal emails cannot unlock student pricing.",
                "verified": False,
                "verified_label": "Student Verification Pending",
                "discount_label": "Verify to unlock student discount",
                "checks_html": "<li>Student ID pending</li><li>University email pending</li><li>Discount pending <b>0% OFF</b></li>",
            }, 400)
            return
        with db() as con:
            con.execute(
                """
                UPDATE users
                SET student_email = ?,
                    student_id = ?,
                    student_verified = 0
                WHERE id = ?
                """,
                (student_email, student_id, user["id"]),
            )
        token = create_verification(user["id"], student_email, "STUDENT")
        link = self.student_verification_url(token)
        _outbox_file, delivery_status = send_student_verification_email(student_email, user["name"], link)
        message = "Verification email sent to your .edu inbox. Click the link there to activate the student discount."
        if not delivery_status.startswith("sent"):
            message = "Your .edu verification link is ready, but the email provider did not deliver it. Check local outbox for the backup link."
        self.send_json({
            "ok": True,
            "message": message,
            "verified": False,
            "verified_label": "Check your .edu inbox",
            "discount_label": "Student discount pending email verification",
            "checks_html": "<li>Student ID saved</li><li>University email verification sent</li><li>Discount pending <b>0% OFF</b></li>",
        })

    def verify_student_email(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        token = query.get("token", [""])[0]
        if not token:
            self.activation_message_page("Student verification link missing", "Please use the student verification link from your FairFares email.", "Open Dashboard", "/dashboard")
            return
        with db() as con:
            verification = con.execute(
                """
                SELECT email_verifications.*, users.name, users.student_id
                FROM email_verifications
                JOIN users ON users.id = email_verifications.user_id
                WHERE token = ? AND purpose = 'STUDENT'
                """,
                (token,),
            ).fetchone()
            if not verification:
                self.activation_message_page("Student verification link invalid", "That student verification link is not valid. Please request a fresh link from your dashboard.", "Open Dashboard", "/dashboard")
                return
            if verification["used_at"]:
                self.activation_message_page("Student email already verified", "Your FairFares student discount is already active.", "Open Dashboard", "/dashboard")
                return
            if not verification["email"].lower().endswith(".edu"):
                self.activation_message_page("School email required", "Only verified .edu inboxes can unlock student pricing.", "Open Dashboard", "/dashboard")
                return
            con.execute(
                """
                UPDATE users
                SET student_email = ?,
                    student_verified = 1
                WHERE id = ?
                """,
                (verification["email"].lower(), verification["user_id"]),
            )
            con.execute("UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE token = ?", (token,))
        code = create_student_discount(verification["user_id"], verification["name"], verification["email"])
        send_student_verified_email(verification["email"], verification["name"], code)
        self.activation_message_page(
            "Student email verified",
            f"Your FairFares student discount is active. Use code {code} on eligible bookings.",
            "Open Dashboard",
            "/dashboard",
        )

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
        backup_rows = "\n".join(self.render_backup_row(path) for path in list_db_backups()[:5])
        body = render_template(
            "admin.html",
            admin_name=escape(user["name"]),
            total_cars=metrics["cars"],
            available_cars=metrics["available"],
            booked_count=metrics["booked"],
            user_count=metrics["users"],
            cars=cars or '<tr><td colspan="8">No inventory yet.</td></tr>',
            fleet_summary=fleet_summary or '<tr><td colspan="7">No fleet data yet.</td></tr>',
            db_path=escape(DB_PATH),
            backup_dir=escape(BACKUP_DIR),
            backup_rows=backup_rows or '<tr><td colspan="4">No backups yet.</td></tr>',
        )
        self.send_html(body)

    def render_backup_row(self, path: Path) -> str:
        size_kb = path.stat().st_size / 1024
        modified = datetime.fromtimestamp(path.stat().st_mtime).strftime("%b %d, %Y %I:%M %p")
        href = f"/admin/backups/download?file={urllib.parse.quote(path.name)}"
        return f"""
        <tr>
            <td><b>{escape(path.name)}</b><span>{escape(modified)}</span></td>
            <td>{size_kb:.1f} KB</td>
            <td>{escape(path.parent)}</td>
            <td><a class="admin-text-link" href="{href}">Download</a></td>
        </tr>
        """

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

    def admin_users_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        users = "\n".join(self.render_admin_user_card(row) for row in get_admin_users())
        body = render_template(
            "admin_users.html",
            admin_name=escape(user["name"]),
            users=users or '<p class="admin-empty">No users yet.</p>',
        )
        self.send_html(body)

    def admin_tickets_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        tickets = "\n".join(self.render_ticket_row(row) for row in get_admin_tickets())
        body = render_template(
            "admin_tickets.html",
            admin_name=escape(user["name"]),
            tickets=tickets or '<tr><td colspan="8">No support tickets yet.</td></tr>',
        )
        self.send_html(body)

    def render_ticket_row(self, row: sqlite3.Row) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["status"] == status else ""}>{status.replace("_", " ").title()}</option>'
            for status in ("OPEN", "IN_PROGRESS", "FOLLOWUP", "CLOSED")
        )
        priority = normalize_support_priority(row["priority"] if "priority" in row.keys() else "")
        urgent = '<span class="ticket-urgent">URGENT</span>' if row["urgent"] or priority in {"P0", "P1"} else ""
        priority_badge = f'<span class="ticket-priority ticket-priority-{priority.lower()}">{escape(priority)}</span>'
        sla = support_sla_text(priority)
        return f"""
        <tr class="{'ticket-open ticket-critical' if row["status"] != "CLOSED" and priority in {"P0", "P1"} else 'ticket-open' if row["status"] != "CLOSED" else ''}">
            <td><b>{escape(row["ticket_id"])}</b><span>{escape(row["created_at"])}</span>{urgent}</td>
            <td>{escape(row["user_name"])}<span>{escape(row["user_email"])}</span></td>
            <td>{escape(row["booking_id"] or "No booking")}</td>
            <td>{priority_badge}<span>{escape(sla)}</span><span>{escape(row["alert_summary"] or "Dashboard alert queued")}</span></td>
            <td>{escape(row["topic"])}<span>{escape(row["preferred_contact"])}</span></td>
            <td>{escape(row["message"] or "-")}</td>
            <td>
                <form method="post" action="/admin/tickets/update" class="admin-stack-form">
                    <input type="hidden" name="ticket_id" value="{row["id"]}">
                    <input name="claimed_by" value="{escape(row["claimed_by"])}" placeholder="Claimed by">
                    <select name="status">{status_options}</select>
                    <textarea name="admin_comment" rows="2" placeholder="Comment / follow-up">{escape(row["admin_comment"])}</textarea>
                    <button type="submit">Update Ticket</button>
                </form>
            </td>
            <td>{escape(row["claimed_by"] or "Unclaimed")}</td>
        </tr>
        """

    def render_admin_user_card(self, row: sqlite3.Row) -> str:
        profile = get_admin_user_profile(row["id"])
        bookings = profile["bookings"]
        licenses = profile["licenses"]
        transactions = profile["transactions"]
        insurances = profile["insurances"]
        agreements = profile["agreements"]
        search_text = " ".join(
            [
                str(row["id"]),
                row["name"] or "",
                row["email"] or "",
                row["phone"] or "",
                row["student_id"] or "",
                row["latest_booking_id"] or "",
            ]
        ).lower()
        booking_rows = "".join(
            f"""
            <tr>
                <td><b>{escape(booking["booking_id"])}</b><span>{escape(booking["car_name"])}</span></td>
                <td>{escape(booking_status_label(booking["booking_status"], booking["payment_status"]))}</td>
                <td>{escape(booking["pickup_date"])} - {escape(booking["dropoff_date"])}</td>
                <td>{escape(booking["discount_code"] or "None")}</td>
                <td>{format_money(booking["total_price"])}</td>
            </tr>
            """
            for booking in bookings
        ) or '<tr><td colspan="5">No bookings.</td></tr>'
        license_rows = "".join(
            f"""
            <tr>
                <td>{escape(license_row["state"])} · {escape(license_row["license_number"])}</td>
                <td>{escape(license_row["expiry_date"])}</td>
                <td>{escape(license_row["verification_status"])}<span>{escape(license_row["verification_notes"] if "verification_notes" in license_row.keys() else "")}</span></td>
                <td>{'Front saved' if license_row["front_image_url"] else 'No front'} / {'Back saved' if license_row["back_image_url"] else 'No back'}</td>
            </tr>
            """
            for license_row in licenses
        ) or '<tr><td colspan="4">No driver license data.</td></tr>'
        transaction_rows = "".join(
            f"""
            <tr>
                <td>{escape(transaction["invoice_number"])}</td>
                <td>{escape(transaction["booking_id"])}</td>
                <td>{escape(transaction["payment_method"])}</td>
                <td>{escape(transaction["cardholder_name"] if "cardholder_name" in transaction.keys() else "")}</td>
                <td>{format_money(transaction["amount"])}</td>
                <td>{escape(transaction["transaction_status"])}<span>{escape((transaction["billing_verification_status"] if "billing_verification_status" in transaction.keys() else "") or "")}</span></td>
            </tr>
            """
            for transaction in transactions
        ) or '<tr><td colspan="6">No transactions.</td></tr>'
        insurance_rows = "".join(
            f"""
            <tr>
                <td>{escape(insurance["booking_id"])}</td>
                <td>{escape(insurance["insurance_provider"])}</td>
                <td>{escape(insurance["insurance_type"])}</td>
                <td>{format_money(insurance["coverage_amount"])}</td>
            </tr>
            """
            for insurance in insurances
        ) or '<tr><td colspan="4">No insurance data.</td></tr>'
        agreement_rows = "".join(
            f"""
            <tr>
                <td>{escape(agreement["booking_id"])}</td>
                <td>{escape(agreement["signer_name"] or "Pending")}</td>
                <td>{escape("Signed" if agreement["signature_text"] else "Pending")}</td>
                <td>{escape(agreement["created_at"])}</td>
            </tr>
            """
            for agreement in agreements
        ) or '<tr><td colspan="4">No rental agreements.</td></tr>'
        return f"""
        <details class="admin-user-card" data-admin-user-card data-search="{escape(search_text)}">
            <summary>
                <span><b>{escape(row["name"])}</b><small>#{row["id"]} · {escape(row["email"])}</small></span>
                <span>{escape(row["phone"] or "No phone")}</span>
                <span>{row["booking_count"]} bookings</span>
                <span>{row["cancelled_count"] or 0} cancelled</span>
                <span>{format_money(row["transaction_total"])}</span>
            </summary>
            <div class="admin-user-detail">
                <div class="admin-user-metrics">
                    <span><b>Current</b>{row["current_count"] or 0}</span>
                    <span><b>Transactions</b>{row["transaction_count"] or 0}</span>
                    <span><b>Student</b>{'Verified' if row["student_verified"] else 'Not verified'}</span>
                    <span><b>DOB</b>{escape(row["date_of_birth"] or "Not captured")}</span>
                    <span><b>Address</b>{escape(row["address"] or "Not captured")}</span>
                </div>
                <h3>Bookings</h3>
                <table class="admin-mini-table"><tbody>{booking_rows}</tbody></table>
                <h3>Driver License</h3>
                <table class="admin-mini-table"><tbody>{license_rows}</tbody></table>
                <h3>Transactions</h3>
                <table class="admin-mini-table"><tbody>{transaction_rows}</tbody></table>
                <h3>Insurance</h3>
                <table class="admin-mini-table"><tbody>{insurance_rows}</tbody></table>
                <h3>Rental Agreements</h3>
                <table class="admin-mini-table"><tbody>{agreement_rows}</tbody></table>
            </div>
        </details>
        """

    def admin_discounts_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        discounts = "\n".join(self.render_discount_row(row) for row in get_all_discounts())
        body = render_template(
            "admin_discounts.html",
            admin_name=escape(user["name"]),
            discounts=discounts or '<tr><td colspan="7">No discount codes yet.</td></tr>',
        )
        self.send_html(body)

    def admin_commercials_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        commercials = "\n".join(self.render_commercial_row(row) for row in get_all_commercials())
        body = render_template(
            "admin_commercials.html",
            admin_name=escape(user["name"]),
            commercials=commercials or '<tr><td colspan="6">No commercials yet.</td></tr>',
        )
        self.send_html(body)

    def admin_email_marketing_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        draft_cards = "\n".join(self.render_email_draft_card(draft) for draft in EMAIL_MARKETING_DRAFTS)
        seasonal_rows = "\n".join(
            f"<li><b>{escape(month)}</b><span>{escape(title)}</span><small>{escape(window)}</small></li>"
            for month, title, window in EMAIL_SEASONAL_PLAN
        )
        campaign_rows = "\n".join(self.render_email_campaign_row(row) for row in get_email_campaigns())
        today = date.today().isoformat()
        body = render_template(
            "admin_email_marketing.html",
            admin_name=escape(user["name"]),
            draft_cards=draft_cards,
            seasonal_rows=seasonal_rows,
            campaign_rows=campaign_rows or '<tr><td colspan="7">No planned campaigns yet.</td></tr>',
            today=escape(today),
            subscriber_count=escape(str(get_marketing_subscriber_count())),
        )
        self.send_html(body)

    def render_email_draft_card(self, draft: dict[str, str]) -> str:
        return f"""
        <article class="email-draft-card">
          <div><span>{escape(draft["type"])}</span><b>{escape(draft["timing"])}</b></div>
          <h3>{escape(draft["subject"])}</h3>
          <p><strong>{escape(draft["headline"])}</strong><br>{escape(draft["body"])}</p>
          <small>Audience: {escape(draft["audience"])} · CTA: {escape(draft["cta"])}</small>
        </article>
        """

    def render_email_campaign_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row["campaign_date"])}</b><span>{escape(row["status"])}</span></td>
          <td>{escape(row["campaign_type"])}<span>{escape(row["audience"])}</span></td>
          <td>{escape(row["trigger_rule"] or "Manual send")}</td>
          <td><b>{escape(row["subject_line"])}</b><span>{escape(row["headline"])}</span></td>
          <td>{escape(row["cta_label"] or "No CTA")}</td>
          <td>{escape(row["notes"] or "-")}<span>Sent: {escape(str(row["sent_count"]))}{(" · " + escape(row["last_delivery_status"])) if row["last_delivery_status"] else ""}</span></td>
          <td>
            <form method="post" action="/admin/email-marketing/test" class="inline-form">
              <input type="hidden" name="campaign_id" value="{row["id"]}">
              <input name="test_email" type="email" placeholder="test@email.com" required>
              <button type="submit">Send Test</button>
            </form>
            <form method="post" action="/admin/email-marketing/send" class="inline-form">
              <input type="hidden" name="campaign_id" value="{row["id"]}">
              <button type="submit">Send to Subscribers</button>
            </form>
            <form method="post" action="/admin/email-marketing/delete" class="inline-form">
              <input type="hidden" name="campaign_id" value="{row["id"]}">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>
        """

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
            <td><input form="car-update-{row["id"]}" name="location" value="{escape(row["location"])}" aria-label="Vehicle location"></td>
            <td><input form="car-update-{row["id"]}" name="daily_price" type="number" step="0.01" value="{row["daily_price"]:.2f}" aria-label="Daily price"></td>
            <td>
                <form id="car-update-{row["id"]}" method="post" action="/admin/cars/status" class="inline-form">
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

    def render_commercial_row(self, row: sqlite3.Row) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["status"] == status else ""}>{status}</option>'
            for status in ("ACTIVE", "INACTIVE")
        )
        live_checked = "checked" if row["is_live"] else ""
        preview_src = escape(row["embed_url"])
        return f"""
        <tr>
            <td><b>{escape(row["title"])}</b><span>{escape(row["video_url"])}</span></td>
            <td><iframe class="commercial-preview" src="{preview_src}" title="{escape(row["title"])}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></td>
            <td><span class="status-badge {'status-live' if row["is_live"] else ''}">{'LIVE' if row["is_live"] else escape(row["status"])}</span></td>
            <td>{escape(row["duration_seconds"])}s</td>
            <td>
                <form method="post" action="/admin/commercials/status" class="admin-stack-form">
                    <input type="hidden" name="commercial_id" value="{row["id"]}">
                    <input name="title" value="{escape(row["title"])}" placeholder="Title">
                    <input name="video_url" value="{escape(row["video_url"])}" placeholder="YouTube or live link">
                    <select name="status">{status_options}</select>
                    <label class="check-row"><input type="checkbox" name="is_live" value="1" {live_checked}> Live feature</label>
                    <input name="duration_seconds" type="number" min="6" value="{escape(row["duration_seconds"])}">
                    <input name="sort_order" type="number" value="{escape(row["sort_order"])}">
                    <button type="submit">Save</button>
                </form>
            </td>
            <td>
                <form method="post" action="/admin/commercials/delete" class="inline-form">
                    <input type="hidden" name="commercial_id" value="{row["id"]}">
                    <button class="danger-button" type="submit">Delete</button>
                </form>
            </td>
        </tr>
        """

    def render_admin_booking_row(self, row: sqlite3.Row) -> str:
        is_request = row["booking_status"] in {"MODIFIED", "CANCELLATION_REQUESTED"}
        booking_status_options = (
            ("CONFIRMED", "Confirmed / Pay at pickup"),
            ("MODIFIED", "Modification pending"),
            ("CANCELLATION_REQUESTED", "Cancellation requested"),
            ("CANCELLED", "Cancelled"),
            ("PICKED_UP", "Picked up"),
            ("RETURNED", "Returned"),
        )
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["booking_status"] == status else ""}>{escape(label)}</option>'
            for status, label in booking_status_options
        )
        payment_options = '<option value="PAY_AT_PICKUP" selected>Pay at pickup</option>'
        request_note = ""
        if is_request:
            request_type = "Cancellation approval requested" if row["booking_status"] == "CANCELLATION_REQUESTED" else "Modification approval requested"
            action_copy = "Choose CANCELLED to approve cancellation, or CONFIRMED to keep booking." if row["booking_status"] == "CANCELLATION_REQUESTED" else "Review requested changes, then choose CONFIRMED to approve or keep MODIFIED while pending."
            request_note = f'<small class="approval-note"><b>{escape(request_type)}</b>{escape(action_copy)}</small>'
        return f"""
        <tr class="{'admin-request-row' if is_request else ''}">
            <td><b>{escape(row["booking_id"])}</b><span>{escape(booking_status_label(row["booking_status"], row["payment_status"]))}</span></td>
            <td>{escape(row["user_name"])}<span>{escape(row["user_email"])}</span></td>
            <td>{escape(row["car_name"])}</td>
            <td>{escape(row["pickup_date"])} - {escape(row["dropoff_date"])}</td>
            <td>${row["total_price"]:.2f}</td>
            <td>
                {f'<div class="admin-request-summary">{escape(row["cancellation_reason"] or "No request details saved.")}</div>' if is_request else ''}
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
        agreement_values = agreement_default_values(row, license_row, insurance, agreement)
        agreement_text = agreement["agreement_text"] if agreement else build_rental_agreement_text(row, agreement_values)
        agreement_fields = render_agreement_fields(agreement_values)
        front_scan = license_row["front_image_url"] if license_row else ""
        back_scan = license_row["back_image_url"] if license_row else ""
        insurance_scan = insurance["document_url"] if insurance else ""
        actual_pickup_date = row["actual_pickup_date"] or display_date_to_input(row["pickup_date"], "")
        actual_return_date = row["actual_return_date"] or display_date_to_input(row["dropoff_date"], "")
        actual_pickup_time = row["actual_pickup_time"] or row["pickup_time"]
        actual_return_time = row["actual_return_time"] or row["dropoff_time"]
        status_summary = booking_status_label(row["booking_status"], row["payment_status"])
        dl_status = license_row["verification_status"] if license_row else "Not captured"
        dl_note = (license_row["verification_notes"] if license_row and "verification_notes" in license_row.keys() else "") or ""
        billing_status = transaction["billing_verification_status"] if transaction and "billing_verification_status" in transaction.keys() else ""
        billing_note = transaction["billing_verification_notes"] if transaction and "billing_verification_notes" in transaction.keys() else ""

        def capture_field(name: str, label: str, value: str, saved_copy: str = "Photo saved") -> str:
            legacy_dl_attr = ""
            if name == "front_image_url":
                legacy_dl_attr = ' data-dl-camera="front"'
            elif name == "back_image_url":
                legacy_dl_attr = ' data-dl-camera="back"'
            return (
                f'<label class="dl-capture-field"><span>{escape(label)}</span>'
                f'<input type="file" accept="image/*" capture="environment" data-photo-capture="{escape(name)}"{legacy_dl_attr}>'
                f'<input type="hidden" name="{escape(name)}" value="{escape(value or "")}">'
                f'<small>{escape(saved_copy if value else "Take picture or choose photo")}</small></label>'
            )

        return f"""
        <details class="pickup-record" data-search="{escape((row["booking_id"] + " " + row["user_name"] + " " + row["user_email"] + " " + row["car_name"]).lower())}">
            <summary class="pickup-record-head">
                <div>
                    <h2>{escape(row["booking_id"])} · {escape(row["user_name"])} <span>{escape(status_summary)}</span></h2>
                    <p>{escape(row["user_email"])} · {escape(row["car_name"])} · {escape(row["pickup_date"])} to {escape(row["dropoff_date"])}</p>
                </div>
                <b>Open pickup / return file</b>
            </summary>
            <div class="pickup-status-grid">
                <span><b>DL</b>{escape(dl_status)}{f'<small>{escape(dl_note)}</small>' if dl_note else ''}</span>
                <span><b>Insurance</b>{escape(insurance["insurance_provider"] if insurance else "Not captured")}</span>
                <span><b>Payment</b>{escape(transaction["transaction_status"] if transaction else row["payment_status"])}{f'<small>{escape(billing_status)} · {escape(billing_note)}</small>' if billing_status else ''}</span>
                <span><b>Discount</b>{escape((row["discount_code"] or "None") + (" · -" + format_money(row["discount_amount"]) if row["discount_amount"] else ""))}</span>
                <span><b>Total</b>{escape(format_money(row["total_price"]))}</span>
                <span><b>Late fee</b>{escape(format_money(row["late_fee_amount"])) if row["late_fee_amount"] else "None"}</span>
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
                {capture_field("front_image_url", "DL Front Picture", front_scan, "Front image saved")}
                {capture_field("back_image_url", "DL Back Picture", back_scan, "Back image saved")}
                <label><span>Insurance Provider</span><input name="insurance_provider" value="{escape(insurance["insurance_provider"] if insurance else "")}"></label>
                <label><span>Insurance Type</span><input name="insurance_type" value="{escape(insurance["insurance_type"] if insurance else "Rental coverage")}"></label>
                <label><span>Coverage Amount</span><input name="coverage_amount" type="number" step="0.01" value="{escape(insurance["coverage_amount"] if insurance else "0")}"></label>
                {capture_field("insurance_document_url", "Insurance Scan", insurance_scan, "Insurance image saved")}
                <label><span>Payment Method</span><input name="payment_method" value="{escape(transaction["payment_method"] if transaction else "")}" placeholder="Card / Cash / Online"></label>
                <label><span>Cardholder Name</span><input name="cardholder_name" value="{escape(transaction["cardholder_name"] if transaction and "cardholder_name" in transaction.keys() else "")}" placeholder="Required for card payments"></label>
                <label><span>Insurance Price</span><input name="insurance_price" type="number" step="0.01" value="{escape(insurance["price"] if insurance else "0")}"></label>
                <label><span>Actual Pickup Date</span><input name="actual_pickup_date" type="date" value="{escape(actual_pickup_date)}"></label>
                <label><span>Actual Pickup Time</span><select name="actual_pickup_time">{time_select_options(actual_pickup_time)}</select></label>
                <label><span>Actual Return Date</span><input name="actual_return_date" type="date" value="{escape(actual_return_date)}"></label>
                <label><span>Actual Return Time</span><select name="actual_return_time">{time_select_options(actual_return_time)}</select></label>
                <label><span>Price Match Agency</span><input name="price_match_agency" value="{escape(row["price_match_agency"])}" placeholder="Avis, Enterprise, Hertz"></label>
                <label><span>Matched Quote Total</span><input name="price_match_amount" type="number" step="0.01" value="{escape(row["price_match_amount"] or "")}" placeholder="Lower quote total"></label>
                {capture_field("pickup_front_image", "Pickup Front Picture", row["pickup_front_image"])}
                {capture_field("pickup_back_image", "Pickup Back Picture", row["pickup_back_image"])}
                {capture_field("pickup_left_image", "Pickup Left Side", row["pickup_left_image"])}
                {capture_field("pickup_right_image", "Pickup Right Side", row["pickup_right_image"])}
                {capture_field("return_front_image", "Return Front Picture", row["return_front_image"])}
                {capture_field("return_back_image", "Return Back Picture", row["return_back_image"])}
                {capture_field("return_left_image", "Return Left Side", row["return_left_image"])}
                {capture_field("return_right_image", "Return Right Side", row["return_right_image"])}
                <div class="agreement-builder wide-field">
                    <div class="agreement-builder-head">
                        <div>
                            <b>Rental Agreement Builder</b>
                            <span>Red fields are customer-provided. Blue fields are issuer/admin-provided.</span>
                        </div>
                    </div>
                    <div class="agreement-field-grid">{agreement_fields}</div>
                </div>
                <div class="agreement-print-area wide-field">
                    <label><span>Generated Agreement Text</span><textarea name="agreement_text" rows="12">{escape(agreement_text)}</textarea></label>
                    <div class="signature-row">
                        <label><span>Signer Name</span><input name="signer_name" value="{escape(agreement["signer_name"] if agreement else row["user_name"])}"></label>
                        <label><span>Signature</span><input name="signature_text" value="{escape(agreement["signature_text"] if agreement else "")}" placeholder="Typed signature"></label>
                    </div>
                    <button class="secondary-print-button" type="button" data-print-record>Print Agreement</button>
                </div>
                <button type="submit">Save User Pickup Data</button>
            </form>
        </details>
        """

    def render_discount_row(self, row: sqlite3.Row) -> str:
        value = f'{row["value"]:.2f}%' if row["discount_type"] == "PERCENT" else f'${row["value"]:.2f}'
        usage = f'{row["used_count"]}/{row["max_uses"]}' if row["max_uses"] else f'{row["used_count"]}/Unlimited'
        return f"""
        <tr>
            <td><b>{escape(row["code"])}</b><span>{escape(row["description"])}</span></td>
            <td>{escape(row["discount_type"])}</td>
            <td>{value}</td>
            <td>{usage}</td>
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

    def create_admin_backup(self) -> None:
        user = self.require_admin()
        if not user:
            return
        create_db_backup("admin")
        self.redirect("/admin")

    def download_admin_backup(self) -> None:
        user = self.require_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        filename = Path(query.get("file", [""])[0]).name
        requested = (BACKUP_DIR / filename).resolve()
        backup_root = BACKUP_DIR.resolve()
        if not filename or not str(requested).startswith(str(backup_root)) or not requested.exists():
            self.not_found()
            return
        body = requested.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.sqlite3")
        self.send_header("Content-Disposition", f'attachment; filename="{requested.name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
        try:
            daily_price = max(0.0, float(form.get("daily_price") or 0))
        except ValueError:
            daily_price = 0.0
        location = form.get("location", "").strip()
        with db() as con:
            current = con.execute("SELECT daily_price, location FROM cars WHERE id = ?", (form.get("car_id"),)).fetchone()
            con.execute(
                "UPDATE cars SET status = ?, daily_price = ?, location = ? WHERE id = ?",
                (
                    status,
                    daily_price or (current["daily_price"] if current else 0),
                    location or (current["location"] if current else "Denver International Airport (DEN)"),
                    form.get("car_id"),
                ),
            )
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
        payment_status = form.get("payment_status", "PAY_AT_PICKUP")
        if booking_status not in {"CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "CANCELLED", "PICKED_UP", "RETURNED"}:
            booking_status = "CONFIRMED"
        if payment_status != "PAY_AT_PICKUP":
            payment_status = "PAY_AT_PICKUP"
        reason = form.get("reason", "")
        if booking_status in {"CONFIRMED", "PICKED_UP", "RETURNED"}:
            reason = ""
        if booking_status == "CANCELLED" and not reason:
            reason = "Cancelled by admin approval."
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
                (booking_status, payment_status, booking_status, reason, form.get("booking_id")),
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

    def update_admin_ticket(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        status = form.get("status", "OPEN")
        if status not in {"OPEN", "IN_PROGRESS", "FOLLOWUP", "CLOSED"}:
            status = "OPEN"
        with db() as con:
            con.execute(
                """
                UPDATE support_tickets
                SET claimed_by = ?,
                    status = ?,
                    admin_comment = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    form.get("claimed_by") or user["name"],
                    status,
                    form.get("admin_comment", ""),
                    form.get("ticket_id"),
                ),
            )
        self.redirect("/admin/tickets")

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
                (code, description, discount_type, value, valid_through, status, max_uses, used_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT used_count FROM discounts WHERE code = ?), 0))
                """,
                (
                    code,
                    form.get("description", ""),
                    discount_type,
                    float(form.get("value") or 0),
                    form.get("valid_through") or "2026-12-31",
                    form.get("status") or "ACTIVE",
                    int(form.get("max_uses") or 0),
                    code,
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

    def create_admin_commercial(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        video_url = form.get("video_url", "")
        if not video_url:
            self.redirect("/admin/commercials")
            return
        status = form.get("status") if form.get("status") in {"ACTIVE", "INACTIVE"} else "ACTIVE"
        with db() as con:
            con.execute(
                """
                INSERT INTO commercials (title, video_url, embed_url, status, is_live, duration_seconds, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    form.get("title") or "FairFares Commercial",
                    video_url,
                    commercial_embed_url(video_url),
                    status,
                    1 if form.get("is_live") == "1" else 0,
                    int(form.get("duration_seconds") or 12),
                    int(form.get("sort_order") or 99),
                ),
            )
        self.redirect("/admin/commercials")

    def update_admin_commercial_status(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        video_url = form.get("video_url", "")
        status = form.get("status") if form.get("status") in {"ACTIVE", "INACTIVE"} else "ACTIVE"
        with db() as con:
            con.execute(
                """
                UPDATE commercials
                SET title = ?,
                    video_url = ?,
                    embed_url = ?,
                    status = ?,
                    is_live = ?,
                    duration_seconds = ?,
                    sort_order = ?
                WHERE id = ?
                """,
                (
                    form.get("title") or "FairFares Commercial",
                    video_url,
                    commercial_embed_url(video_url),
                    status,
                    1 if form.get("is_live") == "1" else 0,
                    int(form.get("duration_seconds") or 12),
                    int(form.get("sort_order") or 99),
                    form.get("commercial_id"),
                ),
            )
        self.redirect("/admin/commercials")

    def delete_admin_commercial(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM commercials WHERE id = ?", (form.get("commercial_id"),))
        self.redirect("/admin/commercials")

    def create_email_campaign(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute(
                """
                INSERT INTO email_campaigns
                (campaign_date, campaign_type, audience, trigger_rule, subject_line, headline, message_body, cta_label, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    form.get("campaign_date") or date.today().isoformat(),
                    form.get("campaign_type", "Transactional"),
                    form.get("audience", "All customers"),
                    form.get("trigger_rule", ""),
                    form.get("subject_line", "FairFares update"),
                    form.get("headline", ""),
                    form.get("message_body", ""),
                    form.get("cta_label", ""),
                    form.get("status", "DRAFT"),
                    form.get("notes", ""),
                ),
            )
        self.redirect("/admin/email-marketing")

    def delete_email_campaign(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM email_campaigns WHERE id = ?", (form.get("campaign_id"),))
        self.redirect("/admin/email-marketing")

    def send_email_campaign_now(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            campaign_id = int(form.get("campaign_id", "0"))
        except ValueError:
            campaign_id = 0
        send_marketing_campaign(campaign_id, self.public_origin())
        self.redirect("/admin/email-marketing")

    def send_email_campaign_test(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            campaign_id = int(form.get("campaign_id", "0"))
        except ValueError:
            campaign_id = 0
        send_marketing_campaign(campaign_id, self.public_origin(), form.get("test_email", ""))
        self.redirect("/admin/email-marketing")

    def unsubscribe_marketing(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        token = urllib.parse.parse_qs(parsed.query).get("token", [""])[0]
        updated = False
        if token:
            with db() as con:
                result = con.execute(
                    """
                    UPDATE users
                    SET promo_email_opt_in = 0,
                        marketing_unsubscribed_at = CURRENT_TIMESTAMP
                    WHERE marketing_token = ?
                    """,
                    (token,),
                )
                updated = result.rowcount > 0
        title = "You are unsubscribed" if updated else "Unsubscribe link not found"
        message = (
            "You will no longer receive FairFares marketing emails. Booking confirmations and important trip emails may still be sent."
            if updated
            else "This unsubscribe link is invalid or already expired."
        )
        self.send_html(
            f"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>{escape(title)} | FairFares</title>
              <link rel="stylesheet" href="/static/css/styles.css">
            </head>
            <body>
              <main class="auth-main">
                <section class="auth-card">
                  <h1>{escape(title)}</h1>
                  <p>{escape(message)}</p>
                  <a class="select-button" href="/">Back to FairFares</a>
                </section>
              </main>
            </body>
            </html>
            """
        )

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
            if form.get("license_number") or form.get("front_image_url") or form.get("back_image_url"):
                license_number = form.get("license_number") or "PHOTO_CAPTURED_PENDING_NUMBER"
                license_state = form.get("license_state") or "CO"
                license_expiry = form.get("license_expiry") or "2028-12-31"
                front_image_url = form.get("front_image_url", "")
                back_image_url = form.get("back_image_url", "")
                dl_status, dl_notes = evaluate_driver_license(
                    license_number,
                    license_state,
                    license_expiry,
                    front_image_url,
                    back_image_url,
                )
                con.execute(
                    """
                    INSERT INTO driver_licenses
                    (user_id, license_number, state, expiry_date, front_image_url, back_image_url, verification_status, verification_notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        license_number,
                        license_state,
                        license_expiry,
                        front_image_url,
                        back_image_url,
                        dl_status,
                        dl_notes,
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
            booking_for_fees = con.execute(
                """
                SELECT bookings.*, cars.daily_price
                FROM bookings
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (booking_id,),
            ).fetchone()
            late_fee_amount, late_fee_note = calculate_late_fee(
                booking_for_fees,
                form.get("actual_return_date", ""),
                form.get("actual_return_time", ""),
            ) if booking_for_fees else (0.0, "")
            try:
                matched_total = max(0.0, float(form.get("price_match_amount") or 0))
            except ValueError:
                matched_total = 0.0
            original_total = float(row_value(booking_for_fees, "price_match_original_total") or 0) if booking_for_fees else 0.0
            if not original_total and booking_for_fees:
                original_total = max(0.0, float(booking_for_fees["total_price"] or 0) - float(booking_for_fees["late_fee_amount"] or 0))
            price_match_discount = round(matched_total * 0.10, 2) if matched_total else 0.0
            revised_total = round((matched_total - price_match_discount if matched_total else original_total) + late_fee_amount, 2)
            con.execute(
                """
                UPDATE bookings
                SET actual_pickup_date = ?,
                    actual_pickup_time = ?,
                    actual_return_date = ?,
                    actual_return_time = ?,
                    late_fee_amount = ?,
                    late_fee_note = ?,
                    price_match_agency = ?,
                    price_match_amount = ?,
                    price_match_discount_amount = ?,
                    price_match_original_total = ?,
                    total_price = ?,
                    pickup_front_image = ?,
                    pickup_back_image = ?,
                    pickup_left_image = ?,
                    pickup_right_image = ?,
                    return_front_image = ?,
                    return_back_image = ?,
                    return_left_image = ?,
                    return_right_image = ?
                WHERE id = ?
                """,
                (
                    form.get("actual_pickup_date", ""),
                    form.get("actual_pickup_time", ""),
                    form.get("actual_return_date", ""),
                    form.get("actual_return_time", ""),
                    late_fee_amount,
                    late_fee_note,
                    form.get("price_match_agency", ""),
                    matched_total,
                    price_match_discount,
                    original_total,
                    revised_total,
                    form.get("pickup_front_image", ""),
                    form.get("pickup_back_image", ""),
                    form.get("pickup_left_image", ""),
                    form.get("pickup_right_image", ""),
                    form.get("return_front_image", ""),
                    form.get("return_back_image", ""),
                    form.get("return_left_image", ""),
                    form.get("return_right_image", ""),
                    booking_id,
                ),
            )
            if form.get("payment_method"):
                invoice_number = f"INV-{secrets.randbelow(900000) + 100000}"
                amount = con.execute("SELECT total_price FROM bookings WHERE id = ?", (booking_id,)).fetchone()
                billing_status, billing_notes = evaluate_billing_name(
                    form.get("payment_method", ""),
                    form.get("cardholder_name", ""),
                    form.get("customer_name", ""),
                    form.get("signer_name", ""),
                )
                transaction_status = "PAID" if billing_status in {"MATCHED", "NOT_REQUIRED"} else "BILLING_REVIEW"
                con.execute(
                    """
                    INSERT INTO transactions
                    (booking_id, payment_method, cardholder_name, amount, transaction_status, billing_verification_status, billing_verification_notes, invoice_number)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        booking_id,
                        form.get("payment_method"),
                        form.get("cardholder_name", ""),
                        float(amount["total_price"] if amount else 0),
                        transaction_status,
                        billing_status,
                        billing_notes,
                        invoice_number,
                    ),
                )
            agreement_data = {key: form.get(f"agreement_{key}", "").strip() for key in AGREEMENT_FIELD_KEYS}
            if form.get("signature_text") and not agreement_data.get("customer_signature"):
                agreement_data["customer_signature"] = form.get("signature_text", "").strip()
            booking_row = con.execute(
                """
                SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.phone,
                       users.address, users.date_of_birth,
                       cars.name AS car_name, cars.brand AS car_brand, cars.model AS car_model,
                       cars.year AS car_year, cars.category AS car_category, cars.type AS car_type,
                       cars.color AS car_color, cars.daily_price, cars.license_plate, cars.vin_number
                FROM bookings
                JOIN users ON users.id = bookings.user_id
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (booking_id,),
            ).fetchone()
            generated_agreement_text = build_rental_agreement_text(booking_row, agreement_data) if booking_row else form.get("agreement_text", "")
            if any(agreement_data.values()) or form.get("agreement_text") or form.get("signature_text"):
                con.execute(
                    """
                    INSERT INTO rental_agreements
                    (booking_id, agreement_text, agreement_data, signer_name, signature_text, signed_at)
                    VALUES (?, ?, ?, ?, ?, CASE WHEN ? != '' THEN CURRENT_TIMESTAMP ELSE NULL END)
                    """,
                    (
                        booking_id,
                        generated_agreement_text,
                        json.dumps(agreement_data),
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
        discount_code = query.get("discount_code", [""])[0]
        try:
            days = int(query.get("days", ["10"])[0])
        except ValueError:
            days = 10
        self.render_manage_booking(
            self.current_user(),
            selected_car_id,
            discount_code,
            max(1, min(days, 366)),
            query.get("pickup_date", [""])[0],
            query.get("return_date", [""])[0],
            query.get("pickup_time", ["10:00 AM"])[0],
            query.get("return_time", ["10:00 AM"])[0],
            query.get("pickup_location", [""])[0],
            query.get("return_location", [""])[0],
        )

    def render_manage_booking(
        self,
        user: sqlite3.Row | None,
        selected_car_id: int | None = None,
        discount_code: str = "",
        days: int = 10,
        pickup_date: str = "",
        return_date: str = "",
        pickup_time: str = "10:00 AM",
        return_time: str = "10:00 AM",
        pickup_location: str = "",
        return_location: str = "",
    ) -> None:
        if user and selected_car_id:
            booking = ensure_booking_for_user(user["id"], selected_car_id, discount_code, days, pickup_date, return_date, pickup_time, return_time, pickup_location, return_location)
        elif not user and selected_car_id:
            booking = build_booking_preview(selected_car_id, discount_code, days, pickup_date, return_date, pickup_time, return_time, pickup_location, return_location)
        elif user:
            booking = get_booking_for_user(user["id"])
        else:
            booking = None
        content = get_content()
        current_car_name = booking["car_name"] if booking else "Select a car"
        available_cars = get_cars()
        user_bookings = get_bookings_for_user(user["id"]) if user else []
        saved_cars = get_saved_cars_for_user(user["id"]) if user else []
        latest_ticket = get_latest_ticket_for_user(user["id"]) if user else None
        is_first_time_user = bool(user and not user_bookings)
        is_guest_checkout = bool(not user and booking and selected_car_id)
        show_start_experience = bool(user and is_first_time_user and not selected_car_id)
        show_signed_out_empty = bool(not user and not selected_car_id)
        trip_rows = render_user_trip_rows(user_bookings, saved_cars)
        upcoming_count = sum(1 for row in user_bookings if row["booking_status"] not in {"CANCELLED", "RETURNED"})
        past_count = sum(1 for row in user_bookings if row["booking_status"] in {"CANCELLED", "RETURNED"})
        live_status = live_status_for_booking(booking)
        default_pickup, default_return = default_trip_dates()
        modify_pickup_date = display_date_to_input(booking["pickup_date"] if booking else "", default_pickup)
        modify_return_date = display_date_to_input(booking["dropoff_date"] if booking else "", default_return)
        no_upgrade_option = f"""
            <label class="upgrade-current">
                <input type="radio" name="vehicle" value="" data-price="0" checked>
                <span><b>No upgrade</b><small>Keep current vehicle and change timing/location only</small></span>
                <strong>Current total</strong>
            </label>
        """
        upgrade_options = no_upgrade_option + "\n" + "\n".join(
            f"""
            <label>
                <input type="radio" name="vehicle" value="{escape(car["name"])}" data-price="{car["total_price"]:.2f}">
                <span><b>{escape(car["name"])}</b><small>{escape(car["category"])} | Upgrade option</small></span>
                <strong>${daily_price_range(car["daily_price"])[0]}-{daily_price_range(car["daily_price"])[1]}/day est.</strong>
            </label>
            """
            for car in available_cars if car["name"] != current_car_name
        )
        upgrade_select_options = '<option value="" data-price="0">No vehicle change</option>\n' + "\n".join(
            f'<option value="{escape(car["name"])}" data-price="{daily_price_range(car["daily_price"])[0]}-{daily_price_range(car["daily_price"])[1]}">{escape(car["name"])} - {escape(car["category"])} - ${daily_price_range(car["daily_price"])[0]}-{daily_price_range(car["daily_price"])[1]}/day est.</option>'
            for car in available_cars if car["name"] != current_car_name
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
            <details class="panel editor-panel">
                <summary>
                    <p class="eyebrow">Poster CMS</p>
                    <h2>Edit homepage content</h2>
                </summary>
                <form method="post" action="/admin/content" class="editor-form">
                    {fields}
                    <button type="submit">Save content</button>
                </form>
            </details>
            """
        booking_document_sets = get_user_document_sets(user["id"] if user else None, booking["id"] if booking else None)
        booking_documents_json = json.dumps(
            {"activeId": booking["id"] if booking else None, "sets": booking_document_sets}
        ).replace("</", "<\\/")
        active_document_set = booking_document_sets[0] if booking_document_sets else None
        documents_locked = bool(not active_document_set or active_document_set.get("locked"))
        first_booking_promo = ""
        booking_confirmation_card = ""
        has_current_booking = bool(booking and booking["booking_status"] not in {"CANCELLED", "RETURNED"})
        if is_guest_checkout:
            dashboard_booking_title = "Complete Your Booking"
            dashboard_booking_body = "Enter your contact details and we will save this trip under your email and phone."
        elif show_signed_out_empty:
            dashboard_booking_title = "Start Booking"
            dashboard_booking_body = "Select a vehicle first, then enter your details to save the trip."
        elif show_start_experience:
            dashboard_booking_title = "Start Your First Trip"
            dashboard_booking_body = (
                "No bookings yet. Grab a student deal and your trip details will appear here after checkout."
            )
        elif has_current_booking:
            dashboard_booking_title = "Upcoming Trip"
            dashboard_booking_body = "Your next adventure is all set! We're excited to have you on the road."
        else:
            dashboard_booking_title = "Last Booking"
            dashboard_booking_body = "You do not have a current booking. Your most recent trip details are saved here."
        sidebar_title = "Start Booking" if (show_start_experience or show_signed_out_empty or is_guest_checkout) else "Manage Booking"
        sidebar_primary_label = "Complete Booking" if is_guest_checkout else ("Find Your First Car" if (show_start_experience or show_signed_out_empty) else "Upcoming Trips")
        sidebar_primary_body = (
            "Add your name, email, and phone to reserve this vehicle."
            if is_guest_checkout
            else ("Select a car to begin booking" if show_signed_out_empty else ("Search student deals and create your first booking" if is_first_time_user else "View and manage your upcoming bookings"))
        )
        booking_link_class = "is-hidden" if (show_start_experience or show_signed_out_empty or is_guest_checkout) else ""
        car_color_class = escape(f"car-{booking['color']}" if booking and booking["color"] else "car-charcoal")
        if booking and booking["image_url"]:
            booking_car_visual = f'<img class="trip-car-image" src="{escape(booking["image_url"])}" alt="{escape(booking["car_name"])}">'
        else:
            booking_car_visual = f'<div class="car-art {car_color_class}"><div class="car-shape"></div></div>'
        first_time_manage_content = ""
        if show_start_experience or show_signed_out_empty:
            first_time_manage_content = """
            <section class="first-time-founder-card">
                <img src="/static/img/founders-note-fairfares.png" alt="FairFares founders note">
                <div class="first-time-founder-actions">
                    <div>
                        <p class="eyebrow">Founders note</p>
                        <h2>Fair prices before the first booking.</h2>
                        <p>When you book, your modify, cancel, documents, and live trip tools will appear here automatically.</p>
                    </div>
                    <a class="select-button" href="/#results">Browse Cars</a>
                </div>
            </section>
            """
            upgrade_options = ""
            upgrade_select_options = ""
        if show_start_experience or show_signed_out_empty:
            first_booking_promo = f"""
            <section class="first-booking-promo" id="upcoming">
                <img src="/static/img/referral-deals-denver.jpeg" alt="FairFares Denver referral deal">
                <div class="first-booking-promo-body">
                    <div>
                        <p class="eyebrow">First trip offer</p>
                        <h2>Start with a Denver student deal.</h2>
                        <p>{"Login to save this deal and keep your documents under your real email." if show_signed_out_empty else "No booking yet. Use the referral code when you search and your trip details will appear here after checkout."}</p>
                    </div>
                    <div class="promo-code-box">
                        <span>Deal code</span>
                        <b>REFER_DUDE143</b>
                    </div>
                    <a class="select-button" href="/#results">Search Cars</a>
                </div>
            </section>
            """
        if booking and selected_car_id:
            name_parts = ((user["name"] if user else "") or "").split(" ", 1)
            first_name = name_parts[0] if name_parts else ""
            last_name = name_parts[1] if len(name_parts) > 1 else ""
            promo_checked = " checked" if (
                not user
                or row_value(user, "promo_email_opt_in") in {1, "1", True}
                or (not row_value(user, "marketing_unsubscribed_at") and not row_value(user, "phone"))
            ) else ""
            text_checked = " checked" if user and row_value(user, "text_opt_in") in {1, "1", True} else ""
            submit_endpoint_hint = " data-guest-booking=\"true\"" if is_guest_checkout else ""
            hidden_guest_fields = ""
            guest_account_note = ""
            student_button = ""
            guest_after_save_actions = ""
            if is_guest_checkout:
                hidden_guest_fields = f"""
                    <input type="hidden" name="car_id" value="{escape(booking["car_id"])}">
                    <input type="hidden" name="days" value="{escape(booking["days"])}">
                    <input type="hidden" name="pickup_date" value="{escape(pickup_date)}">
                    <input type="hidden" name="return_date" value="{escape(return_date)}">
                    <input type="hidden" name="pickup_time" value="{escape(pickup_time)}">
                    <input type="hidden" name="return_time" value="{escape(return_time)}">
                    <input type="hidden" name="pickup_location" value="{escape(booking["pickup_location"])}">
                    <input type="hidden" name="return_location" value="{escape(booking["dropoff_location"])}">
                    <input type="hidden" name="discount_code" value="{escape(discount_code)}">
                """
                guest_account_note = "<p class=\"guest-booking-note\">Create an account later with this same email or phone and this trip will appear in your dashboard.</p>"
                guest_after_save_actions = """
                    <div class="guest-after-save-actions" id="guestAfterSaveActions" hidden>
                        <a class="light-button" href="/signup">Modify Reservation</a>
                        <a class="light-button" href="/signup">Cancel Reservation</a>
                        <a class="select-button" href="/signup">Download Invoice</a>
                        <a class="light-button" href="/signup">View Details</a>
                        <a class="light-button" href="/signup">Support Center</a>
                        <small>Create your account with this same email or phone to manage this booking, download documents after pickup, or contact support.</small>
                    </div>
                """
            else:
                student_button = '<button class="light-button" type="button" data-manage-tab="details" data-detail-jump="student">Student Verification</button>'
            referral_share_url = f"{self.public_origin()}/deals"
            booking_confirmation_card = f"""
            <section class="booking-confirmation-card" id="bookingConfirmation">
                <div>
                    <p class="eyebrow">Confirmed / Pay at pickup</p>
                    <h2>Your car is booked.</h2>
                    <p>We promise a fair rental price. If you show us a lower quote from Avis, Enterprise, Hertz, or another major rental company, we'll match it and give you an additional 10% off.</p>
                    {guest_account_note}
                </div>
                <form class="customer-info-form" id="customerInfoForm"{submit_endpoint_hint}>
                    {hidden_guest_fields}
                    <label><span>First Name *</span><input name="first_name" value="{escape(first_name)}" required></label>
                    <label><span>Last Name *</span><input name="last_name" value="{escape(last_name)}" required></label>
                    <label><span>Email Address *</span><input name="email" type="email" value="{escape(user["email"] if user else "")}" required></label>
                    <label><span>Mobile Number *</span><input name="phone" value="{escape((user["phone"] if user else "") or "")}" required></label>
                    <label class="toggle-row"><input name="promo_email_opt_in" type="checkbox"{promo_checked}> I want to receive emails for promotional offers and upcoming rentals</label>
                    <label class="toggle-row"><input name="text_opt_in" type="checkbox"{text_checked}> Yes, send text updates about my current and upcoming rentals</label>
                    <div class="booking-confirmation-actions">
                        <button type="submit">Save Details</button>
                        {student_button}
                    </div>
                    {guest_after_save_actions}
                    <p class="modify-status" id="customerInfoStatus" aria-live="polite"></p>
                </form>
            </section>
            <section class="booking-referral-backdrop" id="bookingReferralModal" data-share-url="{escape(referral_share_url)}" hidden>
                <div class="booking-referral-modal" role="dialog" aria-modal="true" aria-labelledby="bookingReferralTitle">
                    <button class="guest-offer-close" type="button" data-referral-close aria-label="Close referral offer">x</button>
                    <img class="guest-offer-logo" src="/static/img/logo-dark-header.png" alt="FairFares logo">
                    <p class="eyebrow">Referral bonus</p>
                    <h2 id="bookingReferralTitle">Refer 3 friends. Unlock 10% off future bookings.</h2>
                    <p>Create your account with the same email or phone used on this booking. Share this code with friends through WhatsApp or email. After 3 referred people sign up with your code, we will add your 10% coupon to your account. The coupon can be used up to 3 times.</p>
                    <label class="referral-phone-field"><span>Your phone number</span><input id="referralSharePhone" inputmode="tel" placeholder="Phone number for referral follow-up"></label>
                    <div class="guest-offer-code">
                        <span>Your future coupon</span>
                        <b id="bookingReferralCode">YOURNAME_REFER_COUPON</b>
                    </div>
                    <div class="booking-referral-actions">
                        <a class="guest-offer-primary" id="shareReferralWhatsapp" href="#" target="_blank" rel="noopener">Share on WhatsApp</a>
                        <a class="light-button" id="shareReferralEmail" href="#">Share by Email</a>
                        <a class="light-button" id="bookingReferralSignup" href="/signup">Create Account</a>
                    </div>
                    <button class="guest-offer-decline" type="button" data-referral-close>Maybe later</button>
                </div>
            </section>
            """
        request_notice = ""
        if booking and booking["booking_status"] in {"MODIFIED", "CANCELLATION_REQUESTED"}:
            label = "Modification request" if booking["booking_status"] == "MODIFIED" else "Cancellation request"
            request_notice = f"""
            <div class="request-notice" id="requestNotice">
                <div><b>{escape(label)} sent to admin</b><span>{escape(row_value(booking, "cancellation_reason") or "Admin review pending.")}</span></div>
                <button class="light-button" type="button" id="cancelPendingRequest">Cancel Request</button>
            </div>
            """
        support_ticket_message = ""
        if latest_ticket:
            owner = row_value(latest_ticket, "claimed_by") or "FairFares support"
            comment = row_value(latest_ticket, "admin_comment")
            status = row_value(latest_ticket, "status").replace("_", " ").title()
            support_ticket_message = (
                f"<div class=\"support-summary support-ticket-state\"><b>{escape(owner)} is working on ticket {escape(latest_ticket['ticket_id'])}</b>"
                f"<span>Status: {escape(status)}{(' · ' + escape(comment)) if comment else ''}</span></div>"
            )
        signed_out_auth = '<a class="user-chip" href="/login"><span></span><b>Sign in</b><small>Join FairFares</small></a><a href="/login">Sign in / Join</a>'
        body = render_template(
            "dashboard.html",
            name=escape(user["name"] if user else "FairFares Member"),
            role="Admin" if user and user["is_admin"] else "Student",
            admin_panel=admin_panel,
            manage_auth=(
                f'<a class="user-chip" href="/dashboard"><span></span><b>Hi, {escape(user["name"])}</b><small>Student</small></a><a href="/logout">Log out</a>'
                if user
                else signed_out_auth
            ),
            booking_id=escape(booking["booking_id"] if booking else "No booking yet"),
            dashboard_booking_title=escape(dashboard_booking_title),
            dashboard_booking_body=escape(dashboard_booking_body),
            sidebar_title=escape(sidebar_title),
            sidebar_primary_label=escape(sidebar_primary_label),
            sidebar_primary_body=escape(sidebar_primary_body),
            booking_link_class=booking_link_class,
            first_booking_promo=first_booking_promo,
            booking_confirmation_card=booking_confirmation_card,
            request_notice=request_notice,
            trip_card_class="trip-card" if booking else "trip-card is-hidden",
            booking_car_visual=booking_car_visual,
            first_time_manage_content=first_time_manage_content,
            support_ticket_message=support_ticket_message,
            manage_panels_class="manage-panels" if (user and booking and not show_start_experience) else "manage-panels is-hidden",
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
            price_match_note=escape("Found a lower quote from Avis, Enterprise, Hertz, or another major rental company? We'll match it and give you an additional 10% off."),
            status=escape(booking_status_label(booking["booking_status"], booking["payment_status"]) if booking else "NO BOOKING"),
            status_class=escape(booking_status_class(booking["booking_status"]) if booking else "status-muted"),
            upgrade_options=upgrade_options,
            upgrade_select_options=upgrade_select_options,
            current_vehicle=escape(current_car_name),
            modify_pickup_date=escape(modify_pickup_date),
            modify_return_date=escape(modify_return_date),
            booking_documents_json=booking_documents_json,
            documents_locked="1" if documents_locked else "0",
            documents_locked_class="documents-locked" if documents_locked else "",
            documents_locked_message=(
                active_document_set.get("lockMessage")
                if active_document_set
                else "Book a car first, then documents can be retrieved once pickup is completed."
            ) if documents_locked else "",
            document_email=escape(user["email"] if user else ""),
            pickup_time_options=time_select_options(booking["pickup_time"] if booking else "10:00 AM"),
            return_time_options=time_select_options(booking["dropoff_time"] if booking else "10:00 AM"),
            student_email=escape((user["student_email"] or user["email"]) if user else ""),
            student_id=escape((user["student_id"] or f"STU-{user['id']:04d}") if user else ""),
            student_verified_label="Verified Student" if user and user["student_verified"] else "Student Verification Pending",
            student_discount_label="15% discount applied" if user and user["student_verified"] else "Verify to unlock student discount",
            student_verified_box_class="" if user and user["student_verified"] else "is-pending",
            student_verified_checks=(
                '<li>Student ID Verified</li><li>University Email Verified</li><li>Discount Applied <b>15% OFF</b></li>'
                if user and user["student_verified"]
                else '<li>Student ID pending</li><li>University email pending</li><li>Discount pending <b>0% OFF</b></li>'
            ),
            trip_rows=trip_rows,
            upcoming_count=upcoming_count,
            past_count=past_count,
            favorite_count=sum(1 for row in user_bookings if row_value(row, "saved_by_user")) + len(saved_cars),
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
        public_fields = (
            "id", "name", "brand", "model", "year", "category", "type", "fuel_type",
            "seats", "bags", "doors", "transmission", "daily_price", "badge",
            "features", "location", "image_url", "booked_until_date", "booked_until_time",
        )
        payload = {"cars": [{field: row_value(row, field) for field in public_fields} for row in get_cars()]}
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
    auto_backup_on_startup()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), FairFaresHandler)
    print(f"FairFares running at http://{host}:{port}")
    server.serve_forever()
