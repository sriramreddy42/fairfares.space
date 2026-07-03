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
import base64
import mimetypes
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.parser import BytesParser
from email.policy import default as EMAIL_POLICY
from http import cookies
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from string import Template

UTC = timezone.utc


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "fairfares.sqlite3"
DB_PATH = Path(os.environ.get("FAIRFARES_DB_PATH", DEFAULT_DB_PATH))
BACKUP_DIR = Path(os.environ.get("FAIRFARES_BACKUP_DIR", DB_PATH.parent / "backups"))
OUTBOX_DIR = DATA_DIR / "outbox"
STATIC_DIR = BASE_DIR / "static"
TEMPLATE_DIR = BASE_DIR / "templates"
SESSION_COOKIE = "fairfares_session"
MAX_PROFILE_PHOTO_DATA_URL_LENGTH = 2_500_000
MAX_DRIVE_UPLOAD_BYTES = 12_000_000
DEFAULT_ADMIN_EMAIL = "admin@fairfares.com"
DEFAULT_ADMIN_PASSWORD = "ChangeMe123!"
DEFAULT_PROMOTED_ADMIN_EMAILS = "sriramreddy42@gmail.com"
DEFAULT_REVOKED_ADMIN_EMAILS = "loki@gmail.com"
ROLE_CUSTOMER = "CUSTOMER"
ROLE_EMPLOYEE = "EMPLOYEE"
ROLE_ADMIN = "ADMIN"
VALID_USER_ROLES = {ROLE_CUSTOMER, ROLE_EMPLOYEE, ROLE_ADMIN}
BOOKING_HOLD_MINUTES = 10
FULL_PAYMENT_DISCOUNT_AMOUNT = 10.00
SECURITY_DEPOSIT_AMOUNT = 250.00
SECURITY_DEPOSIT_RELEASE_COPY = (
    "Refundable security deposit authorization. Release after vehicle return review for damage, tickets, tolls, "
    "cleaning, fuel, keys, misuse, and other post-return charges."
)
POST_RETURN_FEE_RULES = (
    ("Cleaning fee", "FLAT", 50.00, "Dirty vehicle return after staff review", 10),
    ("Smoking fee", "FLAT", 200.00, "Smoke odor, ash, burns, or smoking evidence", 20),
    ("Late payment / late return fee", "DAILY", 50.00, "Per day when applicable after review", 30),
    ("Service call fee", "FLAT", 150.00, "Customer-requested service call caused by renter issue", 40),
    ("Extra mileage", "PER_MILE", 0.15, "Mileage over agreed allowance", 50),
)
ASSET_VERSION = "20260703contact24h1"
OPENAI_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o-mini")
OPENAI_AGENT_MCP_SERVERS_ENV = "OPENAI_AGENT_MCP_SERVERS"
OPENAI_AGENT_MCP_ALLOW_UNRESTRICTED_ENV = "OPENAI_AGENT_MCP_ALLOW_UNRESTRICTED"
BLOG_POSTS = [
    {
        "slug": "cheap-car-rental-denver-guide",
        "title": "Cheap Car Rental Denver: How to Compare Real Trip Costs",
        "description": "Learn how to compare cheap car rental Denver options by daily rate, taxes, fees, pickup balance, discounts, and price match savings.",
        "date": "2026-06-30",
        "category": "Denver rentals",
        "hero": "Cheap car rental Denver",
        "image": "/static/img/price-match-guarantee-poster.png",
        "video_title": "How FairFares shows price match savings before pickup",
        "video_summary": "A short FairFares overview for comparing Denver rental costs, price match savings, and booking confidence.",
        "gallery": [
            ("/static/img/hero-road.png", "Denver rental car route preview"),
            ("/static/img/referral-deals-denver.jpeg", "Denver FairFares referral deal"),
            ("/static/img/download-documents-poster.png", "Booking documents and receipts"),
        ],
        "intro": "A low daily rate is only one part of a rental. The better question is what the full Denver trip costs before you pick up the keys.",
        "sections": [
            ("Start with the full trip window", "Compare rentals using the exact pickup date, return date, and pickup time. A ten-day rental and a fifteen-day rental should never be treated the same, because taxes, fees, and pickup balance change with the rental length."),
            ("Look past the daily rate", "A cheap car rental Denver search should show the rental subtotal, taxes and fees, due-now hold, discount savings, and due-at-pickup balance before payment. FairFares keeps those pieces visible so you can compare the real cost."),
            ("Use price match when it matters", "If you find a comparable lower quote from a major rental provider, save the details. FairFares can review eligible lower quotes and apply the Price Match Guarantee plus an additional 10% off after approval."),
        ],
        "cta": ("Search Denver rentals", "/car-rental-denver"),
    },
    {
        "slug": "denver-airport-car-rental-pickup-checklist",
        "title": "Denver Airport Car Rental Pickup Checklist",
        "description": "Use this Denver Airport car rental checklist for pickup timing, insurance proof, driver license review, payments, and road trip planning.",
        "date": "2026-06-30",
        "category": "Airport pickup",
        "hero": "Denver Airport car rental",
        "image": "/static/img/hero-road.png",
        "video_title": "Airport pickup rental planning with FairFares",
        "video_summary": "Watch how FairFares helps customers move from online booking to pickup-ready rental details.",
        "gallery": [
            ("/static/img/checkout-denver-bg.png", "Denver checkout and pickup view"),
            ("/static/img/booking-confirmation-promise.png", "Booking confirmation promise"),
            ("/static/img/policy-family-car.png", "Pickup and rental policy reminder"),
        ],
        "intro": "Airport pickups are smoother when payment, license, insurance, and timing details are handled before the counter rush.",
        "sections": [
            ("Confirm arrival and pickup time", "Choose a pickup time that gives you room for baggage, rideshare movement, and airport delays. For Denver Airport car rental, a realistic pickup time protects both the customer and the rental team."),
            ("Bring license and insurance proof", "FairFares pickup flow expects driver license and insurance information before release. If rental coverage is needed, staff can record that separately from the base vehicle price."),
            ("Plan the first drive", "Once the booking is ready, use Explorer to map a Colorado road trip car rental route, food stop, campus visit, or mountain drive after airport pickup."),
        ],
        "cta": ("Book airport pickup", "/denver-airport-car-rental"),
    },
    {
        "slug": "student-car-rental-denver-colorado",
        "title": "Student Car Rental in Denver and Colorado",
        "description": "A student car rental guide for Denver and Colorado: .edu verification, referral deals, insurance proof, pickup timing, and receipts.",
        "date": "2026-06-30",
        "category": "Student rentals",
        "hero": "Student car rental",
        "image": "/static/img/referral-follow-offer.png",
        "video_title": "FairFares student rental and deal flow",
        "video_summary": "A quick visual guide to student deals, referral savings, and rental documents.",
        "gallery": [
            ("/static/img/referral-deals-denver.jpeg", "Student referral deal"),
            ("/static/img/fairfares-glow-logo.png", "FairFares student rental brand"),
            ("/static/img/download-documents-poster.png", "Student rental documents"),
        ],
        "intro": "Students need rental cars for more than vacations: internships, moves, airport pickups, campus visits, and weekend routes all count.",
        "sections": [
            ("Verify before the next booking", "Student discounts work best when the profile name and school email are ready before checkout. Verify the .edu email in the dashboard, then use eligible student codes on future bookings."),
            ("Keep documents in one place", "A strong student car rental flow should keep receipts, agreement details, insurance proof, pickup records, and payment status easy to find."),
            ("Choose the right vehicle class", "A sedan rental Denver option may be enough for one student and two bags. SUV rental Colorado options make more sense for group travel, mountain drives, or move-in weekends."),
        ],
        "cta": ("Open student rentals", "/student-car-rental"),
    },
    {
        "slug": "monthly-car-rental-colorado-guide",
        "title": "Monthly and Long-Term Car Rental Colorado Guide",
        "description": "Compare monthly car rental and long-term car rental Colorado options for internships, school terms, temporary work, and extended stays.",
        "date": "2026-06-30",
        "category": "Long-term rentals",
        "hero": "Long-term car rental Colorado",
        "image": "/static/img/hero-road.png",
        "video_title": "Planning longer Colorado rentals with FairFares",
        "video_summary": "See how longer trips connect date selection, pickup balance, documents, and Colorado routes.",
        "gallery": [
            ("/static/img/honda-civic-sedan-denver-rental.png", "Honda Civic sedan rental available in Denver, Colorado"),
            ("/static/img/hyundai-kona-electric-suv-denver-rental.png", "Hyundai Kona electric SUV rental available in Denver, Colorado"),
            ("/static/img/hero-road.png", "Colorado long-term route planning"),
        ],
        "intro": "Longer rentals need clearer math because a small daily difference can become meaningful over several weeks.",
        "sections": [
            ("Use exact rental dates", "Monthly car rental pricing depends on the full pickup and return range. Always compare vehicles using the actual dates instead of estimating from a daily rate alone."),
            ("Review pickup balance and payment status", "For long-term car rental Colorado bookings, review the hold amount, pickup balance, payment status, insurance coverage, and any refundable deposit authorization before release."),
            ("Match the car to the month", "Sedans can be efficient for school or work commutes. SUVs may be better for gear, mountain trips, family visits, or temporary housing moves."),
        ],
        "cta": ("Compare monthly rentals", "/monthly-car-rental"),
    },
]
SEO_LANDING_PAGES = {
    "/car-rental-denver": {
        "title": "Car Rental Denver | FairFares",
        "description": "Book affordable car rental in Denver with FairFares. Compare sedans, SUVs, student-friendly rates, airport pickup, and price match savings.",
        "kicker": "Denver rentals",
        "h1": "Car rental Denver students and travelers can book fast",
        "intro": "FairFares helps Denver drivers compare rental cars, see clear pickup costs, and book with secure payments before a Colorado trip.",
        "body": "Use this page when you need rental cars Denver can trust for campus visits, internships, weekend routes, or daily transportation. Choose dates, compare available sedans and SUVs, then review taxes, fees, discounts, and pickup balance before confirming.",
        "features": [
            ("Denver-first booking", "Start with local pickup options and inventory near Denver."),
            ("Clear price review", "Daily rate, taxes, 10% hold, and pickup balance are shown before confirmation."),
            ("Price Match Guarantee", "Found a lower comparable quote? Submit it for review and possible additional 10% off."),
        ],
        "links": [("Search Denver rentals", "/#results"), ("Student deals", "/deals"), ("Explore Denver routes", "/explorer")],
    },
    "/denver-airport-car-rental": {
        "title": "Denver Airport Car Rental | FairFares",
        "description": "Need Denver Airport car rental? FairFares offers affordable airport pickup rental options with clear checkout, secure payments, and price match review.",
        "kicker": "Airport pickup",
        "h1": "Denver Airport car rental with simple pickup planning",
        "intro": "Book airport pickup rental options for Denver International Airport and nearby Colorado routes with FairFares.",
        "body": "FairFares is built for travelers who want transparent Denver Airport car rental pricing before arrival. Search by pickup date, compare vehicles, keep booking documents together, and use Explorer to plan the drive after landing.",
        "features": [
            ("Airport-ready timing", "Choose pickup and return times that match your arrival and return plans."),
            ("Secure online hold", "Confirm the booking online, then manage pickup details in your dashboard."),
            ("Road trip support", "Use Explorer for Colorado road trip car rental ideas after pickup."),
        ],
        "links": [("Book airport pickup", "/#results"), ("Manage booking", "/manage-booking"), ("Open Explorer", "/explorer")],
    },
    "/cheap-car-rental-colorado": {
        "title": "Cheap Car Rental Colorado | FairFares",
        "description": "Find cheap car rental Colorado options with FairFares. Compare affordable sedans and SUVs, use student discounts, and request price match review.",
        "kicker": "Colorado value",
        "h1": "Cheap car rental Colorado options without hidden guesswork",
        "intro": "FairFares keeps affordable car rental Colorado pricing readable from search through checkout.",
        "body": "Compare car rental Colorado inventory for city drives, campus travel, mountain routes, and family visits. FairFares shows the daily inventory rate, estimated fees, eligible discounts, hold amount, and pickup balance before you commit.",
        "features": [
            ("Affordable daily rates", "Inventory pricing is visible before checkout, with low-to-high sorting."),
            ("Discount-ready booking", "Use student, referral, promo, and price match savings when eligible."),
            ("Colorado coverage", "Search sedans, SUVs, fuel-efficient cars, and electric options for local routes."),
        ],
        "links": [("Search Colorado cars", "/#results"), ("View deals", "/deals"), ("Ask FairFares", "/wiki")],
    },
    "/student-car-rental": {
        "title": "Student Car Rental | FairFares",
        "description": "FairFares offers student car rental options in Denver and Colorado with .edu verification, referral deals, clear checkout, and secure payments.",
        "kicker": "Student rentals",
        "h1": "Student car rental built around school schedules",
        "intro": "FairFares gives students a simpler way to compare rentals, verify .edu discounts, and manage booking documents.",
        "body": "Use FairFares for student car rental in Denver, Colorado road trips, airport pickup, internships, campus moves, and weekend plans. Verify your student profile, apply eligible discounts, and keep receipts, agreements, insurance, and pickup details organized.",
        "features": [
            ("Student discount flow", "Verify your .edu email in the dashboard before using student savings."),
            ("Flexible vehicle mix", "Compare sedan rental Denver options, SUV rental Colorado options, and fuel-efficient cars."),
            ("Booking documents", "Access receipts, agreement details, and pickup information from your account."),
        ],
        "links": [("Verify student profile", "/dashboard#student"), ("Search student rentals", "/#results"), ("Referral deals", "/deals")],
    },
    "/suv-rental": {
        "title": "SUV Rental Colorado | FairFares",
        "description": "Compare SUV rental Colorado options with FairFares. Find affordable SUVs for Denver, airport pickup, mountain drives, and long weekend trips.",
        "kicker": "SUV rentals",
        "h1": "SUV rental Colorado options for bigger plans",
        "intro": "Need more space for bags, friends, or mountain routes? FairFares helps you compare available Colorado SUVs.",
        "body": "SUV rental Colorado searches should be clear about seats, bags, transmission, daily rate, and pickup balance. FairFares keeps that information visible so you can decide whether an SUV is worth it for airport pickup, ski weekends, moves, or long drives.",
        "features": [
            ("Space-focused search", "Filter by SUV inventory and compare seats, bags, and vehicle details."),
            ("Trip-friendly options", "Use SUVs for Denver Airport pickup, mountain routes, and group travel."),
            ("Price match review", "Submit comparable lower quotes for eligible review before pickup."),
        ],
        "links": [("Browse SUVs", "/#results"), ("Colorado trip ideas", "/explorer"), ("Deals", "/deals")],
    },
    "/monthly-car-rental": {
        "title": "Long-Term Car Rental Colorado | FairFares",
        "description": "Need long-term car rental Colorado options? FairFares helps compare monthly rentals, student-friendly rates, clear pickup costs, and secure checkout.",
        "kicker": "Long-term rentals",
        "h1": "Long-term car rental Colorado planning made clearer",
        "intro": "FairFares supports longer rental windows for internships, school terms, temporary work, and extended Colorado stays.",
        "body": "Monthly car rental should make the total cost easy to understand. Choose longer pickup and return dates, compare eligible vehicles, review estimated rental length, and check discounts or price match review before confirming.",
        "features": [
            ("Longer rental windows", "Date selection supports extended rentals and shows the rental length."),
            ("Student-friendly planning", "Good for school terms, internships, temporary housing, and campus moves."),
            ("Transparent totals", "Review subtotal, taxes, discounts, hold payment, and pickup balance before payment."),
        ],
        "links": [("Search monthly rentals", "/#results"), ("Manage booking", "/manage-booking"), ("Student discounts", "/dashboard#student")],
    },
    "/cheap-car-rental-denver-airport": {
        "title": "Cheap Car Rental Near Denver Airport | FairFares",
        "description": "Find cheap car rental near Denver Airport with FairFares. Compare affordable airport pickup rentals, clear checkout, and price match savings.",
        "kicker": "Near Denver Airport",
        "h1": "Cheap car rental near Denver Airport without surprise math",
        "intro": "FairFares helps travelers compare affordable rentals near Denver Airport with pickup timing, discounts, and payment status in one flow.",
        "body": "When you search for cheap car rental near Denver Airport, the real question is total trip cost. FairFares shows daily inventory rates, estimated taxes and fees, online hold amount, pickup balance, and eligible savings before confirmation.",
        "features": [
            ("Airport pickup timing", "Choose pickup and return times that fit flight arrival, baggage, and return plans."),
            ("Clear checkout", "Review due-now hold, full payment, discounts, and pickup balance before paying."),
            ("Colorado trip ready", "Use Explorer after booking to plan routes from Denver Airport into Colorado."),
        ],
        "links": [("Search airport rentals", "/#results"), ("Denver Airport guide", "/denver-airport-car-rental"), ("Pickup checklist", "/blog/denver-airport-car-rental-pickup-checklist")],
    },
    "/cheap-car-rental-downtown-denver": {
        "title": "Cheap Car Rental Downtown Denver | FairFares",
        "description": "Compare cheap car rental downtown Denver options with FairFares. Find affordable sedans, SUVs, student deals, and clear pickup costs.",
        "kicker": "Downtown Denver",
        "h1": "Cheap car rental downtown Denver for city and campus plans",
        "intro": "FairFares gives downtown Denver renters a simpler way to compare cars, pickup details, discounts, and final booking costs.",
        "body": "Downtown Denver rentals are useful for campus visits, errands, weekend trips, internships, and temporary transportation. FairFares keeps the rental length, vehicle class, daily rate, discounts, and pickup balance visible before checkout.",
        "features": [
            ("City-friendly vehicles", "Compare sedan rental Denver options for efficient local driving."),
            ("Student-friendly flow", "Use .edu verification and referral deals when eligible."),
            ("Weekend ready", "Book shorter rentals for errands, local travel, and Colorado weekend plans."),
        ],
        "links": [("Search Denver rentals", "/#results"), ("Student rentals", "/student-car-rental"), ("Weekend rentals", "/weekend-car-rental-colorado")],
    },
    "/student-car-rental-colorado": {
        "title": "Student Car Rental Colorado | FairFares",
        "description": "FairFares offers student car rental Colorado options with .edu verification, referral deals, airport pickup, receipts, and clear checkout.",
        "kicker": "Colorado students",
        "h1": "Student car rental Colorado options for school, work, and trips",
        "intro": "FairFares helps students rent cars for Colorado campuses, airport pickup, internships, move-in weekends, and road trips.",
        "body": "Student car rental Colorado searches should make discounts, documents, insurance proof, pickup details, and payment status easy to manage. FairFares keeps those pieces tied to the booking so students and staff can review them later.",
        "features": [
            ("Student verification", "Verify your .edu email in the dashboard before using eligible student codes."),
            ("Documents together", "Keep receipts, agreement details, and pickup records connected to your booking."),
            ("Flexible vehicle classes", "Choose sedan, SUV, fuel-efficient, or electric options based on the trip."),
        ],
        "links": [("Search student cars", "/#results"), ("Student rental guide", "/blog/student-car-rental-denver-colorado"), ("Verify student profile", "/dashboard#student")],
    },
    "/affordable-suv-rental-denver": {
        "title": "Affordable SUV Rental Denver | FairFares",
        "description": "Compare affordable SUV rental Denver options with FairFares for airport pickup, mountain routes, group travel, and Colorado weekends.",
        "kicker": "Denver SUVs",
        "h1": "Affordable SUV rental Denver options for bigger Colorado trips",
        "intro": "Need more room for people, bags, or mountain gear? FairFares helps compare Denver SUV rentals with clear pickup costs.",
        "body": "Affordable SUV rental Denver searches work best when seats, bags, daily price, rental length, taxes, hold amount, and pickup balance are visible together. FairFares keeps those details readable before payment.",
        "features": [
            ("Space for groups", "Use SUVs for airport pickup, campus moves, mountain routes, and family visits."),
            ("Transparent pricing", "See rental subtotal, taxes, discounts, and pickup balance before confirmation."),
            ("Price match review", "Submit comparable lower SUV quotes before pickup for eligible review."),
        ],
        "links": [("Browse SUV rentals", "/#results"), ("SUV rental Colorado", "/suv-rental"), ("Colorado route ideas", "/explorer")],
    },
    "/colorado-road-trip-rental": {
        "title": "Colorado Road Trip Rental | FairFares",
        "description": "Plan a Colorado road trip rental with FairFares. Compare Denver rental cars, SUVs, airport pickup, weekend trips, and Explorer routes.",
        "kicker": "Road trip rentals",
        "h1": "Colorado road trip rental planning with cars, routes, and savings",
        "intro": "FairFares connects rental car booking with Explorer route planning for Denver drives, mountain stops, and weekend escapes.",
        "body": "A Colorado road trip rental needs the right vehicle, pickup time, rental length, and route plan. FairFares helps compare sedans, SUVs, and fuel-efficient cars, then Explorer helps turn the drive into a plan.",
        "features": [
            ("Route-ready booking", "Choose a vehicle that fits the route, passengers, bags, and trip length."),
            ("Explorer planning", "Use Explorer for Denver drives, mountain routes, stops, photos, and memories."),
            ("Clear travel costs", "Review daily rate, taxes, discounts, hold amount, and pickup balance before checkout."),
        ],
        "links": [("Search road trip cars", "/#results"), ("Open Explorer", "/explorer"), ("Weekend rentals", "/weekend-car-rental-colorado")],
    },
    "/weekend-car-rental-colorado": {
        "title": "Weekend Car Rental Colorado | FairFares",
        "description": "Book weekend car rental Colorado options with FairFares for Denver, airport pickup, mountain drives, student trips, and short rentals.",
        "kicker": "Weekend rentals",
        "h1": "Weekend car rental Colorado options for short, useful trips",
        "intro": "FairFares helps drivers compare weekend rentals for Denver errands, airport pickup, campus visits, and Colorado getaways.",
        "body": "Weekend car rental Colorado planning should be fast and clear. Pick your dates, compare available vehicles, review discounts and payment status, and use Explorer if you want route ideas for the trip.",
        "features": [
            ("Short-trip friendly", "Good for errands, campus visits, mountain drives, and quick airport pickup."),
            ("Vehicle choice", "Compare sedans for efficiency or SUVs for space and gear."),
            ("Easy next step", "Book online, manage documents, and review pickup details from your dashboard."),
        ],
        "links": [("Search weekend rentals", "/#results"), ("Denver rentals", "/car-rental-denver"), ("Road trip rental", "/colorado-road-trip-rental")],
    },
}
BLOG_POST_BY_SLUG = {post["slug"]: post for post in BLOG_POSTS}
OPENAI_READONLY_MCP_SERVER_URLS = {"https://developers.openai.com/mcp"}
DRIVE_ROOT_ENV = "GOOGLE_DRIVE_ROOT_FOLDER_ID"
DRIVE_SERVICE_ACCOUNT_ENV = "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"
DRIVE_FOLDER_ENVS = {
    "driver_license": "DRIVE_DRIVER_LICENSES_FOLDER_ID",
    "insurance": "DRIVE_INSURANCE_DOCUMENTS_FOLDER_ID",
    "agreement": "DRIVE_RENTAL_AGREEMENTS_FOLDER_ID",
    "pickup_return": "DRIVE_PICKUP_RETURN_PHOTOS_FOLDER_ID",
    "invoice_receipt": "DRIVE_INVOICES_RECEIPTS_FOLDER_ID",
    "roi": "DRIVE_ROI_FILES_FOLDER_ID",
    "support": "DRIVE_SUPPORT_ATTACHMENTS_FOLDER_ID",
    "archive": "DRIVE_ARCHIVE_FOLDER_ID",
}
WORKSPACE_REACTIONS = (
    ("LIKE", "👍", "Like"),
    ("LOVE", "❤️", "Love"),
    ("CARE", "🥰", "Care"),
    ("HAHA", "😄", "Haha"),
    ("WOW", "😮", "Wow"),
    ("SAD", "😢", "Sad"),
    ("ANGRY", "😡", "Angry"),
)
BASE_STYLESHEETS = [
    f"/static/css/sections/00-base-home.css?v={ASSET_VERSION}",
    f"/static/css/sections/10-auth.css?v={ASSET_VERSION}",
    f"/static/css/sections/20-admin.css?v={ASSET_VERSION}",
    f"/static/css/sections/30-dashboard-manage.css?v={ASSET_VERSION}",
    f"/static/css/sections/40-explorer.css?v={ASSET_VERSION}",
    f"/static/css/sections/50-home-results-late-explorer.css?v={ASSET_VERSION}",
    f"/static/css/sections/60-payment-admin-final.css?v={ASSET_VERSION}",
    f"/static/css/sections/70-mobile-polish.css?v={ASSET_VERSION}",
]
PAGE_STYLESHEETS = {
    "admin_wiki.html": [f"/static/css/wiki.css?v={ASSET_VERSION}"],
    "index.html": [f"/static/css/booking-form.css?v={ASSET_VERSION}"],
    "wiki.html": [f"/static/css/wiki.css?v={ASSET_VERSION}"],
}
SHARED_STYLESHEETS = [f"/static/css/app-feedback.css?v={ASSET_VERSION}"]


def refresh_storage_paths() -> None:
    global DB_PATH, BACKUP_DIR
    DB_PATH = Path(os.environ.get("FAIRFARES_DB_PATH", DEFAULT_DB_PATH))
    BACKUP_DIR = Path(os.environ.get("FAIRFARES_BACKUP_DIR", DB_PATH.parent / "backups"))


def normalize_drive_folder_id(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    match = re.search(r"(?:^|/)folders/([A-Za-z0-9_-]+)", value)
    if match:
        return match.group(1)
    parsed = urllib.parse.urlparse(value)
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("id", "folderId"):
        if query.get(key):
            return query[key][0].strip()
    if parsed.scheme and parsed.netloc:
        return ""
    return value


def drive_folder_id(folder_key: str) -> str:
    env_name = DRIVE_FOLDER_ENVS.get(folder_key, DRIVE_ROOT_ENV)
    return normalize_drive_folder_id(os.environ.get(env_name) or os.environ.get(DRIVE_ROOT_ENV) or "")


def google_drive_config_status() -> dict[str, object]:
    service_json = (os.environ.get(DRIVE_SERVICE_ACCOUNT_ENV) or "").strip()
    folders = {
        key: {
            "configured": bool((os.environ.get(env) or "").strip()),
            "folder_id": drive_folder_id(key),
            "env": env,
        }
        for key, env in DRIVE_FOLDER_ENVS.items()
    }
    return {
        "configured": bool(service_json and drive_folder_id("root")),
        "service_account": bool(service_json),
        "root_folder": bool(drive_folder_id("root")),
        "root_folder_id": drive_folder_id("root"),
        "folders": folders,
    }


def data_url_upload_parts(value: str, fallback_name: str) -> tuple[str, str, bytes] | None:
    if not value or not value.startswith("data:") or ";base64," not in value:
        return None
    header, encoded = value.split(";base64,", 1)
    mime_type = header.replace("data:", "", 1).strip() or "application/octet-stream"
    if not re.match(r"^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$", mime_type):
        return None
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        return None
    if not payload or len(payload) > MAX_DRIVE_UPLOAD_BYTES:
        return None
    extension = mimetypes.guess_extension(mime_type) or ".bin"
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", fallback_name).strip("-") or "fairfares-upload"
    if not safe_name.lower().endswith(extension.lower()):
        safe_name = f"{safe_name}{extension}"
    return safe_name, mime_type, payload


def google_drive_access_token() -> tuple[bool, str]:
    service_json = (os.environ.get(DRIVE_SERVICE_ACCOUNT_ENV) or "").strip()
    if not service_json:
        return False, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not configured."
    try:
        service_info = json.loads(service_json)
    except json.JSONDecodeError:
        return False, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON."
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
    except Exception:
        return False, "google-auth is not installed."
    try:
        credentials = service_account.Credentials.from_service_account_info(
            service_info,
            scopes=["https://www.googleapis.com/auth/drive"],
        )
        credentials.refresh(Request())
    except Exception as exc:
        return False, f"Google Drive auth failed: {exc}"
    return True, credentials.token or ""


def upload_bytes_to_google_drive(folder_key: str, filename: str, mime_type: str, payload: bytes) -> tuple[bool, dict[str, object] | str]:
    folder_id = drive_folder_id(folder_key)
    if not folder_id:
        return False, f"Drive folder is not configured for {folder_key}."
    token_ok, token_or_error = google_drive_access_token()
    if not token_ok:
        return False, token_or_error
    boundary = f"fairfares-{secrets.token_hex(12)}"
    metadata = {"name": filename, "parents": [folder_id]}
    body = b"".join(
        (
            f"--{boundary}\r\n".encode(),
            b"Content-Type: application/json; charset=UTF-8\r\n\r\n",
            json.dumps(metadata).encode("utf-8"),
            b"\r\n",
            f"--{boundary}\r\n".encode(),
            f"Content-Type: {mime_type}\r\n\r\n".encode(),
            payload,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        )
    )
    request = urllib.request.Request(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink",
        data=body,
        headers={
            "Authorization": f"Bearer {token_or_error}",
            "Content-Type": f"multipart/related; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        return False, f"Google Drive upload failed ({exc.code}): {details[:300]}"
    except Exception as exc:
        return False, f"Google Drive upload failed: {exc}"
    result["folder_id"] = folder_id
    result["size"] = int(result.get("size") or len(payload))
    return True, result


def save_drive_file_record(
    con: sqlite3.Connection,
    *,
    folder_key: str,
    file_scope: str,
    drive_file: dict[str, object],
    uploaded_by: int | str | None = None,
    user_id: int | str | None = None,
    booking_id: int | str | None = None,
    car_id: int | str | None = None,
    expense_id: int | str | None = None,
) -> None:
    con.execute(
        """
        INSERT INTO drive_files
        (file_scope, folder_key, drive_file_id, drive_folder_id, drive_web_view_link,
         original_filename, mime_type, size_bytes, uploaded_by, user_id, booking_id, car_id, expense_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            file_scope,
            folder_key,
            str(drive_file.get("id") or ""),
            str(drive_file.get("folder_id") or ""),
            str(drive_file.get("webViewLink") or ""),
            str(drive_file.get("name") or ""),
            str(drive_file.get("mimeType") or ""),
            int(drive_file.get("size") or 0),
            uploaded_by,
            user_id,
            booking_id,
            car_id,
            expense_id,
        ),
    )


def save_drive_upload_failure_record(
    con: sqlite3.Connection,
    *,
    folder_key: str,
    file_scope: str,
    error: object,
    uploaded_by: int | str | None = None,
    user_id: int | str | None = None,
    booking_id: int | str | None = None,
    car_id: int | str | None = None,
    expense_id: int | str | None = None,
) -> None:
    folder_id = drive_folder_id(folder_key)
    safe_error = str(error or "Google Drive upload failed.")[:500]
    con.execute(
        """
        INSERT INTO drive_files
        (file_scope, folder_key, drive_file_id, drive_folder_id, drive_web_view_link,
         original_filename, mime_type, size_bytes, uploaded_by, user_id, booking_id, car_id, expense_id)
        VALUES (?, ?, 'UPLOAD_FAILED', ?, ?, '', '', 0, ?, ?, ?, ?, ?)
        """,
        (
            file_scope,
            folder_key,
            folder_id,
            safe_error,
            uploaded_by,
            user_id,
            booking_id,
            car_id,
            expense_id,
        ),
    )


def upload_data_url_to_drive(
    con: sqlite3.Connection,
    *,
    folder_key: str,
    file_scope: str,
    data_url: str,
    fallback_name: str,
    uploaded_by: int | str | None = None,
    user_id: int | str | None = None,
    booking_id: int | str | None = None,
    car_id: int | str | None = None,
    expense_id: int | str | None = None,
) -> str:
    parts = data_url_upload_parts(data_url, fallback_name)
    if not parts:
        return data_url
    filename, mime_type, payload = parts
    ok, result = upload_bytes_to_google_drive(folder_key, filename, mime_type, payload)
    if not ok or not isinstance(result, dict):
        save_drive_upload_failure_record(
            con,
            folder_key=folder_key,
            file_scope=file_scope,
            error=result,
            uploaded_by=uploaded_by,
            user_id=user_id,
            booking_id=booking_id,
            car_id=car_id,
            expense_id=expense_id,
        )
        return data_url
    save_drive_file_record(
        con,
        folder_key=folder_key,
        file_scope=file_scope,
        drive_file=result,
        uploaded_by=uploaded_by,
        user_id=user_id,
        booking_id=booking_id,
        car_id=car_id,
        expense_id=expense_id,
    )
    return f"drive://{result.get('id')}"


def upload_file_payload_to_drive(
    con: sqlite3.Connection,
    *,
    folder_key: str,
    file_scope: str,
    file_data: dict[str, object] | None,
    uploaded_by: int | str | None = None,
    user_id: int | str | None = None,
    booking_id: int | str | None = None,
    car_id: int | str | None = None,
    expense_id: int | str | None = None,
) -> str:
    if not file_data:
        return ""
    payload = file_data.get("payload")
    if not isinstance(payload, bytes) or not payload:
        return ""
    filename = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(file_data.get("filename") or "fairfares-file")).strip("-")
    mime_type = str(file_data.get("mime_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream")
    ok, result = upload_bytes_to_google_drive(folder_key, filename or "fairfares-file", mime_type, payload)
    if not ok or not isinstance(result, dict):
        save_drive_upload_failure_record(
            con,
            folder_key=folder_key,
            file_scope=file_scope,
            error=result,
            uploaded_by=uploaded_by,
            user_id=user_id,
            booking_id=booking_id,
            car_id=car_id,
            expense_id=expense_id,
        )
        return ""
    save_drive_file_record(
        con,
        folder_key=folder_key,
        file_scope=file_scope,
        drive_file=result,
        uploaded_by=uploaded_by,
        user_id=user_id,
        booking_id=booking_id,
        car_id=car_id,
        expense_id=expense_id,
    )
    return f"drive://{result.get('id')}"


def save_file_payload_locally(
    *,
    folder_name: str,
    file_data: dict[str, object] | None,
    fallback_name: str,
) -> str:
    if not file_data:
        return ""
    payload = file_data.get("payload")
    if not isinstance(payload, bytes) or not payload:
        return ""
    filename = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(file_data.get("filename") or fallback_name)).strip("-")
    if not filename:
        filename = fallback_name
    extension = Path(filename).suffix or mimetypes.guess_extension(str(file_data.get("mime_type") or "")) or ".bin"
    safe_name = f"{Path(filename).stem[:80]}-{secrets.token_hex(8)}{extension}"
    upload_dir = DB_PATH.parent / "uploads" / folder_name
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = (upload_dir / safe_name).resolve()
    if not str(target).startswith(str(upload_dir.resolve())):
        return ""
    target.write_bytes(payload)
    return f"local://uploads/{folder_name}/{safe_name}"


def local_upload_parts(value: str) -> tuple[str, str, bytes] | None:
    if not value.startswith("local://uploads/"):
        return None
    relative = value.replace("local://uploads/", "", 1)
    upload_root = (DB_PATH.parent / "uploads").resolve()
    target = (upload_root / relative).resolve()
    if not str(target).startswith(str(upload_root)) or not target.is_file():
        return None
    payload = target.read_bytes()
    if not payload or len(payload) > MAX_DRIVE_UPLOAD_BYTES:
        return None
    filename = target.name
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return filename, mime_type, payload


def upload_existing_reference_to_drive(
    con: sqlite3.Connection,
    *,
    folder_key: str,
    file_scope: str,
    current_value: str,
    fallback_name: str,
    uploaded_by: int | str | None = None,
    user_id: int | str | None = None,
    booking_id: int | str | None = None,
    car_id: int | str | None = None,
    expense_id: int | str | None = None,
) -> tuple[str, str]:
    current_value = (current_value or "").strip()
    if not current_value or current_value.startswith("drive://"):
        return current_value, "skipped"
    parts = data_url_upload_parts(current_value, fallback_name) if current_value.startswith("data:") else local_upload_parts(current_value)
    if not parts:
        return current_value, "unsupported"
    filename, mime_type, payload = parts
    ok, result = upload_bytes_to_google_drive(folder_key, filename, mime_type, payload)
    if not ok or not isinstance(result, dict):
        save_drive_upload_failure_record(
            con,
            folder_key=folder_key,
            file_scope=file_scope,
            error=result,
            uploaded_by=uploaded_by,
            user_id=user_id,
            booking_id=booking_id,
            car_id=car_id,
            expense_id=expense_id,
        )
        return current_value, "failed"
    save_drive_file_record(
        con,
        folder_key=folder_key,
        file_scope=file_scope,
        drive_file=result,
        uploaded_by=uploaded_by,
        user_id=user_id,
        booking_id=booking_id,
        car_id=car_id,
        expense_id=expense_id,
    )
    return f"drive://{result.get('id')}", "uploaded"


def migrate_existing_uploads_to_drive(uploaded_by: int | str | None = None, limit: int = 500) -> dict[str, int]:
    summary = {"uploaded": 0, "failed": 0, "skipped": 0, "unsupported": 0}

    def remember(status: str) -> None:
        if status not in summary:
            summary[status] = 0
        summary[status] += 1

    with db() as con:
        processed = 0
        for row in con.execute("SELECT * FROM driver_licenses ORDER BY id ASC").fetchall():
            for column, scope, suffix in (
                ("front_image_url", "driver_license_front", "dl-front"),
                ("back_image_url", "driver_license_back", "dl-back"),
            ):
                if processed >= limit:
                    break
                new_value, status = upload_existing_reference_to_drive(
                    con,
                    folder_key="driver_license",
                    file_scope=scope,
                    current_value=row_value(row, column),
                    fallback_name=f"driver-license-{row_value(row, 'id')}-{suffix}",
                    uploaded_by=uploaded_by,
                    user_id=row_value(row, "user_id"),
                )
                remember(status)
                if status != "skipped":
                    processed += 1
                if status == "uploaded":
                    con.execute(f"UPDATE driver_licenses SET {column} = ? WHERE id = ?", (new_value, row_value(row, "id")))

        for row in con.execute(
            """
            SELECT insurances.*, bookings.user_id, bookings.booking_id AS public_booking_id
            FROM insurances
            LEFT JOIN bookings ON bookings.id = insurances.booking_id
            ORDER BY insurances.id ASC
            """
        ).fetchall():
            if processed >= limit:
                break
            new_value, status = upload_existing_reference_to_drive(
                con,
                folder_key="insurance",
                file_scope="insurance_document",
                current_value=row_value(row, "document_url"),
                fallback_name=f"{row_value(row, 'public_booking_id') or row_value(row, 'booking_id')}-insurance",
                uploaded_by=uploaded_by,
                user_id=row_value(row, "user_id"),
                booking_id=row_value(row, "booking_id"),
            )
            remember(status)
            if status != "skipped":
                processed += 1
            if status == "uploaded":
                con.execute("UPDATE insurances SET document_url = ? WHERE id = ?", (new_value, row_value(row, "id")))

        booking_photo_fields = (
            "pickup_front_image",
            "pickup_back_image",
            "pickup_left_image",
            "pickup_right_image",
            "return_front_image",
            "return_back_image",
            "return_left_image",
            "return_right_image",
        )
        for row in con.execute("SELECT * FROM bookings ORDER BY id ASC").fetchall():
            for column in booking_photo_fields:
                if processed >= limit:
                    break
                new_value, status = upload_existing_reference_to_drive(
                    con,
                    folder_key="pickup_return",
                    file_scope=column,
                    current_value=row_value(row, column),
                    fallback_name=f"{row_value(row, 'booking_id') or row_value(row, 'id')}-{column}",
                    uploaded_by=uploaded_by,
                    user_id=row_value(row, "user_id"),
                    booking_id=row_value(row, "id"),
                    car_id=row_value(row, "car_id"),
                )
                remember(status)
                if status != "skipped":
                    processed += 1
                if status == "uploaded":
                    con.execute(f"UPDATE bookings SET {column} = ? WHERE id = ?", (new_value, row_value(row, "id")))

        for row in con.execute("SELECT * FROM cars ORDER BY id ASC").fetchall():
            if processed >= limit:
                break
            new_value, status = upload_existing_reference_to_drive(
                con,
                folder_key="roi",
                file_scope="vehicle_purchase_receipt",
                current_value=row_value(row, "purchase_receipt_url"),
                fallback_name=f"vehicle-{row_value(row, 'id')}-purchase-receipt",
                uploaded_by=uploaded_by,
                car_id=row_value(row, "id"),
            )
            remember(status)
            if status != "skipped":
                processed += 1
            if status == "uploaded":
                con.execute("UPDATE cars SET purchase_receipt_url = ? WHERE id = ?", (new_value, row_value(row, "id")))

        for row in con.execute("SELECT * FROM car_service_costs ORDER BY id ASC").fetchall():
            if processed >= limit:
                break
            new_value, status = upload_existing_reference_to_drive(
                con,
                folder_key="roi",
                file_scope="vehicle_service_receipt",
                current_value=row_value(row, "receipt_url"),
                fallback_name=f"vehicle-{row_value(row, 'car_id')}-service-{row_value(row, 'id')}",
                uploaded_by=uploaded_by,
                car_id=row_value(row, "car_id"),
                expense_id=row_value(row, "id"),
            )
            remember(status)
            if status != "skipped":
                processed += 1
            if status == "uploaded":
                con.execute("UPDATE car_service_costs SET receipt_url = ? WHERE id = ?", (new_value, row_value(row, "id")))

        summary["processed"] = processed
    return summary


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


class FairFaresConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, factory=FairFaresConnection)
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


def normalize_email(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def normalized_email_sql(column: str = "email") -> str:
    return f"LOWER(REPLACE(REPLACE(REPLACE(REPLACE({column}, ' ', ''), char(9), ''), char(10), ''), char(13), ''))"


def find_user_by_email(con: sqlite3.Connection, email: object) -> sqlite3.Row | None:
    clean_email = normalize_email(email)
    if not clean_email:
        return None
    user = con.execute("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1", (clean_email,)).fetchone()
    if user:
        return user
    return con.execute(
        f"SELECT * FROM users WHERE {normalized_email_sql('email')} = ? LIMIT 1",
        (clean_email,),
    ).fetchone()


def log_login_failure(email: str, reason: str) -> None:
    safe_email = normalize_email(email)
    print(f"Login failed: {reason} for {safe_email or 'blank-email'}")


def ensure_column(con: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in con.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def configured_admin_credentials() -> tuple[str, str]:
    email = normalize_email(os.environ.get("FAIRFARES_ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL))
    password = os.environ.get("FAIRFARES_ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD)
    return email, password


def configured_email_set(env_name: str, default_value: str = "") -> set[str]:
    raw_value = os.environ.get(env_name, default_value)
    return {normalize_email(email) for email in raw_value.split(",") if normalize_email(email)}


def normalized_user_role(value: object) -> str:
    role = str(value or "").strip().upper()
    return role if role in VALID_USER_ROLES else ROLE_CUSTOMER


def user_role_flags(role: str) -> tuple[int, str]:
    normalized = normalized_user_role(role)
    return (1 if normalized == ROLE_ADMIN else 0, normalized)


def ensure_admin_account(con: sqlite3.Connection, email: str, password: str) -> None:
    email = normalize_email(email)
    if not email or not password:
        return
    admin = find_user_by_email(con, email)
    password_hash = hash_password(password)
    if not admin:
        con.execute(
            """
            INSERT INTO users
            (name, email, password_hash, is_admin, role, is_verified, verified_at)
            VALUES (?, ?, ?, 1, 'ADMIN', 1, CURRENT_TIMESTAMP)
            """,
            ("FairFares Admin", email, password_hash),
        )
        return
    if not verify_password(password, admin["password_hash"]):
        con.execute(
            """
            UPDATE users
            SET name = COALESCE(NULLIF(name, ''), 'FairFares Admin'),
                password_hash = ?,
                is_admin = 1,
                role = 'ADMIN',
                is_verified = 1,
                verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                guest_account = 0
            WHERE id = ?
            """,
            (password_hash, admin["id"]),
        )
    else:
        con.execute(
            """
            UPDATE users
            SET is_admin = 1,
                role = 'ADMIN',
                is_verified = 1,
                verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                guest_account = 0
            WHERE id = ?
            """,
            (admin["id"],),
        )


def repair_normalized_auth_emails(con: sqlite3.Connection) -> None:
    for row in con.execute("SELECT id, email FROM users").fetchall():
        clean_email = normalize_email(row["email"])
        if not clean_email or clean_email == row["email"]:
            continue
        conflict = con.execute(
            "SELECT id FROM users WHERE LOWER(email) = ? AND id != ? LIMIT 1",
            (clean_email, row["id"]),
        ).fetchone()
        if not conflict:
            con.execute("UPDATE users SET email = ? WHERE id = ?", (clean_email, row["id"]))
    for row in con.execute("SELECT id, email FROM staff_account_requests").fetchall():
        clean_email = normalize_email(row["email"])
        if clean_email and clean_email != row["email"]:
            con.execute("UPDATE staff_account_requests SET email = ? WHERE id = ?", (clean_email, row["id"]))


def ensure_default_admin(con: sqlite3.Connection) -> None:
    ensure_admin_account(con, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD)
    configured_email, configured_password = configured_admin_credentials()
    if configured_email != DEFAULT_ADMIN_EMAIL or configured_password != DEFAULT_ADMIN_PASSWORD:
        ensure_admin_account(con, configured_email, configured_password)


def normalize_user_roles(con: sqlite3.Connection) -> None:
    con.execute(
        """
        UPDATE users
        SET role = 'ADMIN',
            is_admin = 1
        WHERE is_admin = 1 OR UPPER(TRIM(role)) = 'ADMIN'
        """
    )
    con.execute(
        """
        UPDATE users
        SET role = 'EMPLOYEE',
            is_admin = 0
        WHERE UPPER(TRIM(role)) = 'EMPLOYEE'
        """
    )
    con.execute(
        """
        UPDATE users
        SET role = 'CUSTOMER',
            is_admin = 0
        WHERE UPPER(TRIM(role)) NOT IN ('ADMIN', 'EMPLOYEE', 'CUSTOMER')
           OR role IS NULL
           OR TRIM(role) = ''
        """
    )
    con.execute(
        """
        UPDATE users
        SET is_admin = 0
        WHERE role = 'CUSTOMER'
        """
    )


def apply_staff_role_overrides(con: sqlite3.Connection) -> None:
    promoted_admins = configured_email_set("FAIRFARES_PROMOTED_ADMIN_EMAILS", DEFAULT_PROMOTED_ADMIN_EMAILS)
    revoked_admins = configured_email_set("FAIRFARES_REVOKED_ADMIN_EMAILS", DEFAULT_REVOKED_ADMIN_EMAILS)
    for email in revoked_admins:
        con.execute(
            """
            UPDATE users
            SET is_admin = 0,
                role = 'CUSTOMER'
            WHERE lower(email) = ?
            """,
            (email,),
        )
    for email in promoted_admins - revoked_admins:
        con.execute(
            """
            UPDATE users
            SET is_admin = 1,
                role = 'ADMIN',
                is_verified = 1,
                verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                guest_account = 0
            WHERE lower(email) = ?
            """,
            (email,),
        )


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


def email_delivery_succeeded(status: str) -> bool:
    normalized = (status or "").lower()
    return normalized.startswith("sent through ") or "test capture" in normalized


SLACK_WEBHOOK_ENV = {
    "bookings": "SLACK_WEBHOOK_BOOKINGS",
    "pickups": "SLACK_WEBHOOK_PICKUPS",
    "support": "SLACK_WEBHOOK_SUPPORT",
    "vehicles": "SLACK_WEBHOOK_VEHICLES",
    "payments": "SLACK_WEBHOOK_PAYMENTS",
    "admin": "SLACK_WEBHOOK_ADMIN",
}

SLACK_CHANNEL_DEFAULTS = {
    "bookings": "#bookings",
    "pickups": "#pickups",
    "returns": "#returns",
    "support": "#customer-support",
    "vehicles": "#vehicle-maintenance",
    "payments": "#payments",
    "admin": "#admin",
    "ai": "#ai-agent",
    "general": "#general",
}

SLACK_CHANNEL_ENV = {
    "bookings": "SLACK_CHANNEL_BOOKINGS",
    "pickups": "SLACK_CHANNEL_PICKUPS",
    "returns": "SLACK_CHANNEL_RETURNS",
    "support": "SLACK_CHANNEL_SUPPORT",
    "vehicles": "SLACK_CHANNEL_VEHICLES",
    "payments": "SLACK_CHANNEL_PAYMENTS",
    "admin": "SLACK_CHANNEL_ADMIN",
    "ai": "SLACK_CHANNEL_AI",
    "general": "SLACK_CHANNEL_GENERAL",
}


def slack_bot_token() -> str:
    load_env_file()
    return os.environ.get("SLACK_BOT_TOKEN", "").strip()


def slack_webhook_for(kind: str) -> str:
    load_env_file()
    env_name = SLACK_WEBHOOK_ENV.get(kind, "SLACK_WEBHOOK_ADMIN")
    return os.environ.get(env_name) or os.environ.get("SLACK_WEBHOOK_URL", "")


def slack_channel_for(kind: str) -> str:
    load_env_file()
    env_name = SLACK_CHANNEL_ENV.get(kind, "SLACK_CHANNEL_ADMIN")
    return os.environ.get(env_name) or SLACK_CHANNEL_DEFAULTS.get(kind, "#admin")


def slack_api_request(method: str, payload: dict[str, object]) -> tuple[dict[str, object], str]:
    token = slack_bot_token()
    if not token:
        return {}, "not configured"
    request = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "fairfares-slack/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8") or "{}")
            status = "ok" if data.get("ok") else f"Slack API rejected {method}: {data.get('error', 'unknown_error')}"
            return data, status
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        return {}, f"Slack API HTTP {error.code}: {detail}"
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as error:
        return {}, f"Slack API request failed: {error}"


def normalize_slack_channel_name(name: str) -> str:
    clean = re.sub(r"[^a-z0-9_-]+", "-", (name or "").lower()).strip("-_")
    clean = re.sub(r"[-_]{2,}", "-", clean)
    return f"ff-{clean or 'workspace'}"[:80].strip("-_")


def create_slack_channel_for_workspace_group(name: str) -> tuple[str, str, str, str]:
    channel_name = normalize_slack_channel_name(name)
    data, status = slack_api_request("conversations.create", {"name": channel_name, "is_private": False})
    if not data.get("ok"):
        return "", channel_name, "", status
    channel = data.get("channel") if isinstance(data.get("channel"), dict) else {}
    channel_id = str(channel.get("id") or "")
    created_name = str(channel.get("name") or channel_name)
    channel_url = f"https://slack.com/app_redirect?channel={urllib.parse.quote(channel_id)}" if channel_id else ""
    if channel_id:
        slack_api_request(
            "chat.postMessage",
            {
                "channel": channel_id,
                "text": f"FairFares workspace group created: {name}",
            },
        )
    return channel_id, created_name, channel_url, "created"


def send_slack_notification(kind: str, text: str, blocks: list[dict[str, object]] | None = None) -> str:
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    payload: dict[str, object] = {"text": text}
    if blocks:
        payload["blocks"] = blocks
    status = "not configured"
    channel = slack_channel_for(kind)
    bot_payload = dict(payload)
    bot_payload["channel"] = channel
    data, bot_status = slack_api_request("chat.postMessage", bot_payload)
    if data.get("ok"):
        status = f"sent to Slack channel {channel}"
    else:
        webhook_url = slack_webhook_for(kind)
        status = bot_status
    if status != f"sent to Slack channel {channel}" and webhook_url:
        request = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "fairfares-slack/1.0"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                status = f"sent to Slack ({response.status})" if 200 <= response.status < 300 else f"Slack returned {response.status}"
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace").strip()
            status = f"Slack rejected notification ({error.code}): {detail}"
        except (OSError, TimeoutError, urllib.error.URLError) as error:
            status = f"Slack request failed: {error}"
    outbox_file = OUTBOX_DIR / f"slack-{kind}-{secrets.token_hex(6)}.json"
    outbox_file.write_text(
        json.dumps({"kind": kind, "status": status, "payload": payload}, indent=2),
        encoding="utf-8",
    )
    return status


def booking_payment_confirmed(booking: sqlite3.Row | dict[str, object] | None) -> bool:
    return row_value(booking, "payment_status") in {"HOLD_PAID", "PAID"}


def stripe_secret_key() -> str:
    load_env_file()
    return os.environ.get("STRIPE_SECRET_KEY", "").strip()


def stripe_publishable_key() -> str:
    load_env_file()
    return os.environ.get("STRIPE_PUBLISHABLE_KEY", "").strip()


def stripe_webhook_secret() -> str:
    load_env_file()
    return os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()


def idscan_api_key() -> str:
    load_env_file()
    return os.environ.get("IDSCAN_API_KEY", "").strip()


def idscan_verify_url() -> str:
    load_env_file()
    return os.environ.get("IDSCAN_VERIFY_URL", "").strip()


def stripe_identity_enabled() -> bool:
    return bool(stripe_secret_key())


def masked_env_status(env_name: str) -> dict[str, str]:
    load_env_file()
    value = os.environ.get(env_name, "").strip()
    if not value:
        return {"name": env_name, "status": "Missing", "detail": "Runtime process does not see this variable."}
    prefix = value.split("_", 1)[0] if "_" in value else value[:4]
    return {
        "name": env_name,
        "status": "Configured",
        "detail": f"Starts with {prefix}..., length {len(value)}",
    }


def masked_identifier(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return "Missing"
    if len(value) <= 10:
        return f"{value[:3]}..."
    return f"{value[:6]}...{value[-4:]}"


def stripe_api_request(path: str, params: dict[str, object], idempotency_key: str = "") -> tuple[dict[str, object], str]:
    secret = stripe_secret_key()
    if not secret:
        return {}, "Stripe secret key is not configured."
    body = urllib.parse.urlencode({key: str(value) for key, value in params.items()}).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "fairfares-stripe/1.0",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    request = urllib.request.Request(
        f"https://api.stripe.com/v1/{path.lstrip('/')}",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8") or "{}"), "ok"
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        return {}, f"Stripe rejected the request ({error.code}): {detail}"
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as error:
        return {}, f"Stripe request failed: {error}"


def stripe_api_get(path: str) -> tuple[dict[str, object], str]:
    secret = stripe_secret_key()
    if not secret:
        return {}, "Stripe secret key is not configured."
    request = urllib.request.Request(
        f"https://api.stripe.com/v1/{path.lstrip('/')}",
        headers={
            "Authorization": f"Bearer {secret}",
            "User-Agent": "fairfares-stripe/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8") or "{}"), "ok"
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        return {}, f"Stripe rejected the request ({error.code}): {detail}"
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as error:
        return {}, f"Stripe request failed: {error}"


def stripe_dashboard_payment_url(payment_intent_id: str) -> str:
    payment_intent_id = (payment_intent_id or "").strip()
    if not payment_intent_id:
        return ""
    live_prefix = "test/" if stripe_secret_key().startswith("sk_test_") else ""
    return f"https://dashboard.stripe.com/{live_prefix}payments/{urllib.parse.quote(payment_intent_id)}"


def normalize_identity_status(provider_status: str, last_error: str = "") -> str:
    status = (provider_status or "").upper().strip()
    if status == "VERIFIED":
        return "VERIFIED"
    if status in {"REQUIRES_INPUT", "CANCELED"}:
        return "REVIEW_REQUIRED" if last_error else "ACTION_REQUIRED"
    if status == "PROCESSING":
        return "PROCESSING"
    return "PENDING"


def identity_status_copy(status: str) -> tuple[str, str]:
    normalized = (status or "PENDING").upper().strip()
    if normalized == "VERIFIED":
        return "Identity verified", "Stripe Identity verified the license/selfie session."
    if normalized == "PROCESSING":
        return "Identity processing", "Stripe is still reviewing the document/selfie result."
    if normalized in {"ACTION_REQUIRED", "REVIEW_REQUIRED"}:
        return "Identity needs review", "Customer may need to retry or admin must review before release."
    return "Identity not verified", "Start Stripe Identity during pickup before releasing the vehicle."


def identity_status_detail(row: sqlite3.Row | None) -> str:
    if not row:
        return "No Stripe Identity session has been started for this booking."
    details = []
    raw_status = row_value(row, "raw_status")
    last_error = row_value(row, "last_error")
    updated_at = row_value(row, "updated_at")
    if raw_status:
        details.append(f"Stripe status: {raw_status}")
    if last_error:
        details.append(f"Reason: {last_error}")
    if updated_at:
        details.append(f"Updated: {updated_at}")
    return " · ".join(details) or "Stripe session saved. Refresh after the customer completes verification."


def latest_identity_verification(user_id: int | None = None, booking_id: int | None = None) -> sqlite3.Row | None:
    filters = []
    params: list[object] = []
    if booking_id:
        filters.append("booking_id = ?")
        params.append(booking_id)
    if user_id:
        filters.append("user_id = ?")
        params.append(user_id)
    if not filters:
        return None
    where_clause = " AND ".join(filters)
    with db() as con:
        return con.execute(
            f"""
            SELECT *
            FROM identity_verifications
            WHERE {where_clause}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            params,
        ).fetchone()


def refresh_identity_verification_from_stripe(row: sqlite3.Row | None) -> sqlite3.Row | None:
    if not row:
        return None
    session_id = row_value(row, "provider_session_id")
    if not session_id or row_value(row, "status") == "VERIFIED":
        return row
    session, status = stripe_api_get(f"identity/verification_sessions/{urllib.parse.quote(session_id)}")
    if session.get("id"):
        save_identity_verification_from_session(
            session,
            int(row_value(row, "user_id") or 0),
            int(row_value(row, "booking_id") or 0),
        )
        return latest_identity_verification(int(row_value(row, "user_id") or 0), int(row_value(row, "booking_id") or 0))
    if status and status != "ok":
        with db() as con:
            con.execute(
                """
                UPDATE identity_verifications
                SET last_error = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (status[:500], row["id"]),
            )
        return latest_identity_verification(int(row_value(row, "user_id") or 0), int(row_value(row, "booking_id") or 0))
    return row


def create_stripe_identity_session_for(
    user: sqlite3.Row,
    booking: sqlite3.Row,
    return_url: str,
) -> tuple[dict[str, object], str]:
    if not stripe_identity_enabled():
        return {}, "Stripe Identity is not configured on this server."
    params = {
        "type": "document",
        "return_url": return_url,
        "metadata[user_id]": row_value(user, "id"),
        "metadata[booking_id]": row_value(booking, "id"),
        "metadata[public_booking_id]": row_value(booking, "booking_id"),
        "provided_details[email]": row_value(user, "email"),
        "provided_details[phone]": row_value(user, "phone") or "",
        "options[document][allowed_types][]": "driving_license",
        "options[document][require_matching_selfie]": "true",
        "options[document][require_live_capture]": "true",
    }
    return stripe_api_request(
        "identity/verification_sessions",
        params,
        idempotency_key=f"identity-{row_value(user, 'id')}-{row_value(booking, 'id')}-{date.today().isoformat()}",
    )


def latest_external_identity_check(user_id: int | None = None, booking_id: int | None = None) -> sqlite3.Row | None:
    filters = []
    params: list[object] = []
    if booking_id:
        filters.append("booking_id = ?")
        params.append(booking_id)
    if user_id:
        filters.append("user_id = ?")
        params.append(user_id)
    if not filters:
        return None
    where_clause = " AND ".join(filters)
    with db() as con:
        return con.execute(
            f"""
            SELECT *
            FROM external_identity_checks
            WHERE {where_clause}
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            params,
        ).fetchone()


def external_identity_status_copy(row: sqlite3.Row | None) -> tuple[str, str]:
    provider = row_value(row, "provider") if row else "AAMVA/DLDV"
    status = str(row_value(row, "status") if row else "NOT_CONFIGURED").upper().strip()
    if status == "VERIFIED":
        return f"{provider} verified", row_value(row, "result_summary") or "Provider check passed."
    if status in {"PENDING", "PROCESSING"}:
        return f"{provider} pending", "External provider check is in progress."
    if status in {"FAILED", "REVIEW_REQUIRED"}:
        return f"{provider} review", row_value(row, "result_summary") or "Provider returned a review result."
    return "AAMVA/DLDV not configured", "Use Stripe Identity now; add Entrust or IDScan.net credentials before DMV-record checks."


def compact_data_url_payload(value: str) -> str:
    text = (value or "").strip()
    if ";base64," in text:
        return text.split(";base64,", 1)[1]
    return text


def truthy_result(value: object) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "pass", "passed", "valid", "verified", "match"}


def falsey_result(value: object) -> bool:
    if isinstance(value, bool):
        return not value
    return str(value).strip().lower() in {"false", "0", "no", "fail", "failed", "invalid", "expired", "no_match"}


def parse_idscan_result(payload: dict[str, object]) -> tuple[str, str]:
    document_valid = payload.get("documentValid", payload.get("document_valid", payload.get("valid")))
    ocr_successful = payload.get("ocrSuccessful", payload.get("ocr_successful", payload.get("ocr")))
    expired = payload.get("expired", payload.get("documentExpired", payload.get("isExpired")))
    face_match = payload.get("faceMatch", payload.get("face_match", payload.get("selfieMatch")))
    dmv_match = payload.get("dmvMatch", payload.get("dmv_match", payload.get("aamvaMatch")))
    parts = [
        f"documentValid={document_valid}",
        f"ocrSuccessful={ocr_successful}",
        f"expired={expired}",
    ]
    if face_match is not None:
        parts.append(f"faceMatch={face_match}")
    if dmv_match is not None:
        parts.append(f"dmvMatch={dmv_match}")
    document_ok = truthy_result(document_valid)
    ocr_ok = truthy_result(ocr_successful) or ocr_successful is None
    not_expired = not truthy_result(expired)
    face_ok = face_match is None or truthy_result(face_match)
    dmv_ok = dmv_match is None or truthy_result(dmv_match)
    if document_ok and ocr_ok and not_expired and face_ok and dmv_ok:
        return "VERIFIED", "; ".join(parts)
    if falsey_result(document_valid) or truthy_result(expired) or falsey_result(face_match) or falsey_result(dmv_match):
        return "FAILED", "; ".join(parts)
    return "REVIEW_REQUIRED", "; ".join(parts)


def save_external_identity_check(
    user_id: int,
    booking_id: int | None,
    provider: str,
    status: str,
    reason: str,
    summary: str,
    requested_by: int | None = None,
    provider_reference: str = "",
) -> None:
    with db() as con:
        con.execute(
            """
            INSERT INTO external_identity_checks
            (user_id, booking_id, provider, status, request_reason, provider_reference, result_summary, requested_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, booking_id, provider, status, reason, provider_reference, summary, requested_by),
        )


def run_idscan_verification(
    user_id: int,
    booking_id: int,
    front_image: str,
    back_image: str,
    requested_by: int,
    reason: str = "Admin pickup verification",
) -> tuple[bool, str, str]:
    front = compact_data_url_payload(front_image)
    back = compact_data_url_payload(back_image)
    if not front or not back:
        message = "DL front and back images are required before IDScan verification."
        save_external_identity_check(user_id, booking_id, "IDSCAN", "REVIEW_REQUIRED", reason, message, requested_by)
        return False, "REVIEW_REQUIRED", message
    api_key = idscan_api_key()
    verify_url = idscan_verify_url()
    if not api_key or not verify_url:
        message = "IDScan.net is not configured. Set IDSCAN_API_KEY and IDSCAN_VERIFY_URL after onboarding."
        save_external_identity_check(user_id, booking_id, "IDSCAN", "NOT_CONFIGURED", reason, message, requested_by)
        return False, "NOT_CONFIGURED", message
    payload = json.dumps(
        {
            "frontImage": front,
            "backImage": back,
            "metadata": {"userId": user_id, "bookingId": booking_id, "source": "FairFares pickup"},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        verify_url,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "fairfares-idscan/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()[:500]
        message = f"IDScan.net rejected the request ({error.code}): {detail}"
        save_external_identity_check(user_id, booking_id, "IDSCAN", "FAILED", reason, message, requested_by)
        return False, "FAILED", message
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as error:
        message = f"IDScan.net request failed: {error}"
        save_external_identity_check(user_id, booking_id, "IDSCAN", "FAILED", reason, message, requested_by)
        return False, "FAILED", message
    status, summary = parse_idscan_result(result if isinstance(result, dict) else {})
    provider_reference = str(result.get("id") or result.get("reference") or result.get("transactionId") or "") if isinstance(result, dict) else ""
    save_external_identity_check(user_id, booking_id, "IDSCAN", status, reason, summary, requested_by, provider_reference)
    return status == "VERIFIED", status, summary


def verified_outputs_summary(session: dict[str, object]) -> tuple[str, str, str]:
    outputs = session.get("verified_outputs") if isinstance(session.get("verified_outputs"), dict) else {}
    first_name = str(outputs.get("first_name") or "").strip()
    last_name = str(outputs.get("last_name") or "").strip()
    name = " ".join(part for part in (first_name, last_name) if part).strip()
    dob = str(outputs.get("dob") or "").strip()
    address = outputs.get("address") if isinstance(outputs.get("address"), dict) else {}
    address_parts = [
        str(address.get("line1") or "").strip(),
        str(address.get("line2") or "").strip(),
        str(address.get("city") or "").strip(),
        str(address.get("state") or "").strip(),
        str(address.get("postal_code") or "").strip(),
        str(address.get("country") or "").strip(),
    ]
    return name, dob, ", ".join(part for part in address_parts if part)


def save_identity_verification_from_session(session: dict[str, object], fallback_user_id: int = 0, fallback_booking_id: int = 0) -> None:
    session_id = str(session.get("id") or "").strip()
    if not session_id:
        return
    metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
    try:
        user_id = int(metadata.get("user_id") or fallback_user_id or 0)
    except (TypeError, ValueError):
        user_id = fallback_user_id
    try:
        booking_id = int(metadata.get("booking_id") or fallback_booking_id or 0) or None
    except (TypeError, ValueError):
        booking_id = fallback_booking_id or None
    if not user_id:
        return
    raw_status = str(session.get("status") or "").strip()
    last_error_obj = session.get("last_error") if isinstance(session.get("last_error"), dict) else {}
    last_error = str(last_error_obj.get("reason") or last_error_obj.get("code") or "").strip()
    status = normalize_identity_status(raw_status, last_error)
    verified_name, verified_dob, verified_address = verified_outputs_summary(session)
    with db() as con:
        con.execute(
            """
            INSERT INTO identity_verifications
            (user_id, booking_id, provider, provider_session_id, status, verification_type,
             verified_name, verified_dob, verified_address, last_error, raw_status)
            VALUES (?, ?, 'STRIPE_IDENTITY', ?, ?, 'DOCUMENT_SELFIE', ?, ?, ?, ?, ?)
            ON CONFLICT(provider_session_id) DO UPDATE SET
                booking_id = COALESCE(excluded.booking_id, identity_verifications.booking_id),
                status = excluded.status,
                verified_name = excluded.verified_name,
                verified_dob = excluded.verified_dob,
                verified_address = excluded.verified_address,
                last_error = excluded.last_error,
                raw_status = excluded.raw_status,
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, booking_id, session_id, status, verified_name, verified_dob, verified_address, last_error, raw_status),
        )


def verify_stripe_signature(payload: bytes, signature_header: str) -> bool:
    secret = stripe_webhook_secret()
    if not secret or not signature_header:
        return False
    parts = {}
    for item in signature_header.split(","):
        if "=" not in item:
            continue
        key, value = item.split("=", 1)
        parts.setdefault(key, []).append(value)
    timestamp = parts.get("t", [""])[0]
    signatures = parts.get("v1", [])
    if not timestamp or not signatures:
        return False
    signed_payload = timestamp.encode("utf-8") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


def slack_link(origin: str, path: str, label: str) -> str:
    origin = (origin or os.environ.get("PUBLIC_BASE_URL", "")).rstrip("/")
    if not origin:
        return label
    return f"<{origin}{path}|{label}>"


def notify_slack_payment(booking: sqlite3.Row, message: str, origin: str = "") -> None:
    text = (
        f"FairFares payment update\n"
        f"Booking: {row_value(booking, 'booking_id')}\n"
        f"Customer: {row_value(booking, 'contact_name') or row_value(booking, 'user_name') or 'Customer'}\n"
        f"Vehicle: {row_value(booking, 'car_name')}\n"
        f"Status: {message}\n"
        f"{slack_link(origin, '/admin/bookings', 'Open bookings')}"
    )
    send_slack_notification("payments", text)


def notify_slack_support_ticket(ticket_id: str, priority: str, topic: str, user: sqlite3.Row, origin: str = "", escalated: bool = False) -> None:
    prefix = "On-call escalation" if escalated else "New support ticket"
    text = (
        f"{prefix}: {ticket_id}\n"
        f"Priority: {normalize_support_priority(priority)}\n"
        f"Customer: {row_value(user, 'name')} - {row_value(user, 'email')}\n"
        f"Topic: {topic}\n"
        f"{slack_link(origin, '/admin/tickets', 'Open tickets')}"
    )
    send_slack_notification("support", text)


def notify_slack_vehicle(car: sqlite3.Row | None, status: str, origin: str = "", note: str = "") -> None:
    if not car:
        return
    note_line = f"Note: {note}\n" if note else ""
    text = (
        f"Vehicle update\n"
        f"Vehicle: {row_value(car, 'name')}\n"
        f"Status: {status}\n"
        f"{note_line}"
        f"{slack_link(origin, '/admin', 'Open fleet')}"
    )
    send_slack_notification("vehicles", text)


def shared_email_poster_url(origin: str = "") -> str:
    origin = (origin or os.environ.get("PUBLIC_BASE_URL", "")).rstrip("/")
    return f"{origin}/static/img/booking-confirmation-promise.png" if origin else ""


def shared_email_poster_from_link(link: str) -> str:
    parsed = urllib.parse.urlparse(link)
    if parsed.scheme and parsed.netloc:
        return shared_email_poster_url(f"{parsed.scheme}://{parsed.netloc}")
    return shared_email_poster_url()


def render_email_poster(poster_url: str, alt: str = "FairFares price promise") -> str:
    if not poster_url:
        return ""
    return f'<img src="{html.escape(poster_url)}" alt="{html.escape(alt)}" style="max-width:100%;border-radius:10px;margin:12px 0">'


def send_activation_email(email: str, name: str, activation_link: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Activate your FairFares account"
    poster_url = shared_email_poster_from_link(activation_link)
    text_body = (
        f"Hi {name},\n\n"
        "Welcome to FairFares. Activate your account with this link:\n"
        f"{activation_link}\n\n"
        f"{'FairFares poster: ' + poster_url + chr(10) + chr(10) if poster_url else ''}"
        "After activation, you can sign in and manage your booking.\n"
    )
    html_body = (
        f"<p>Hi {html.escape(name)},</p>"
        "<p>Welcome to FairFares. Activate your account to finish signup.</p>"
        f"{render_email_poster(poster_url)}"
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
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )

    return outbox_file, delivery_status


def send_student_verification_email(email: str, name: str, verification_link: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Verify your FairFares student email"
    poster_url = shared_email_poster_from_link(verification_link)
    text_body = (
        f"Hi {name},\n\n"
        "Click the link below to verify your .edu email and unlock your FairFares student discount:\n"
        f"{verification_link}\n\n"
        f"{'FairFares poster: ' + poster_url + chr(10) + chr(10) if poster_url else ''}"
        "This protects the student discount so it only goes to verified school email owners.\n"
    )
    html_body = (
        f"<p>Hi {html.escape(name)},</p>"
        "<p>Click below to verify your .edu email and unlock your FairFares student discount.</p>"
        f"{render_email_poster(poster_url)}"
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
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def send_student_verified_email(email: str, name: str, code: str, origin: str = "") -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Your FairFares student discount is active"
    poster_url = shared_email_poster_url(origin)
    text_body = (
        f"Hi {name},\n\n"
        "Your student email is verified. Your FairFares student discount is now active.\n\n"
        f"Student discount code: {code}\n\n"
        f"{'FairFares poster: ' + poster_url + chr(10) + chr(10) if poster_url else ''}"
        "Use it on eligible future bookings. Terms and conditions apply.\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <h2>Your student discount is active</h2>
          <p>Hi {html.escape(name)}, your student email is verified.</p>
          {render_email_poster(poster_url)}
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
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def send_booking_confirmation_email(email: str, name: str, booking: sqlite3.Row, origin: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = f"FairFares booking confirmed: {booking['booking_id']}"
    support_phone = "+1 9372518688"
    poster_url = f"{origin.rstrip('/')}/static/img/booking-confirmation-promise.png"
    savings_or_price_promise = booking_savings_explainer(booking, include_terms=True)
    breakdown = booking_price_breakdown(booking)
    price_match_summary = booking_price_match_summary(booking, multiline=True)
    price_match_html = booking_price_match_summary(booking)
    paid_in_full = row_value(booking, "payment_status") == "PAID"
    payment_lines = (
        f"Paid today: {format_money(breakdown['total'])}\n"
        "Due at pickup: $0.00\n"
        if paid_in_full
        else f"10% booking hold: {format_money(breakdown['booking_hold'])}\n"
        f"Due at pickup after hold: {format_money(breakdown['due_at_pickup'])}\n"
    )
    booking_summary = (
        f"Booking ID: {booking['booking_id']}\n"
        f"Vehicle: {booking['category']} | {booking['car_name']} or similar\n"
        f"Pickup: {booking['pickup_location']} on {booking['pickup_date']} at {booking['pickup_time']}\n"
        f"Drop-off: {booking['dropoff_location']} on {booking['dropoff_date']} at {booking['dropoff_time']}\n"
        f"Rental subtotal: {format_money(breakdown['base'])}\n"
        f"Taxes and fees estimate: {format_money(breakdown['tax_fee_amount'])}\n"
        f"FairFares total: {format_money(breakdown['total'])}\n"
        f"{price_match_summary}"
        f"{payment_lines}"
        f"Refundable security deposit authorization at pickup: {format_money(SECURITY_DEPOSIT_AMOUNT)}\n"
        f"Deposit release: {SECURITY_DEPOSIT_RELEASE_COPY}\n"
        f"Payment: {payment_status_label(booking['payment_status'])}\n"
        f"Questions: {support_phone}\n"
    )
    text_body = (
        f"Dear {name},\n\n"
        "Your FairFares booking is confirmed.\n\n"
        f"{booking_summary}\n"
        f"{savings_or_price_promise}\n\n"
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
            <tr><td><b>Rental subtotal</b></td><td>{html.escape(format_money(breakdown['base']))}</td></tr>
            <tr><td><b>Taxes and fees</b></td><td>{html.escape(format_money(breakdown['tax_fee_amount']))}</td></tr>
            <tr><td><b>Price match</b></td><td>{html.escape(price_match_html or 'None')}</td></tr>
            <tr><td><b>FairFares total</b></td><td>{html.escape(format_money(breakdown['total']))}</td></tr>
            <tr><td><b>{'Paid today' if paid_in_full else '10% booking hold'}</b></td><td>{html.escape(format_money(breakdown['total'] if paid_in_full else breakdown['booking_hold']))}</td></tr>
            <tr><td><b>Due at pickup</b></td><td>{html.escape('$0.00' if paid_in_full else format_money(breakdown['due_at_pickup']))}</td></tr>
            <tr><td><b>Security deposit</b></td><td>{html.escape(format_money(SECURITY_DEPOSIT_AMOUNT))} refundable authorization at pickup. {html.escape(SECURITY_DEPOSIT_RELEASE_COPY)}</td></tr>
            <tr><td><b>Payment</b></td><td>{html.escape(payment_status_label(booking['payment_status']))}</td></tr>
          </table>
          <p><b>{'FairFares savings' if float(row_value(booking, 'discount_amount') or 0) > 0 else 'Price match promise'}:</b> {html.escape(savings_or_price_promise)}</p>
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


def booking_price_match_summary(booking: sqlite3.Row | dict[str, object], *, multiline: bool = False) -> str:
    agency = row_value(booking, "price_match_agency").strip()
    matched_total = float(row_value(booking, "price_match_amount") or 0)
    discount = float(row_value(booking, "price_match_discount_amount") or 0)
    original_total = float(
        row_value(booking, "price_match_original_total")
        or row_value(booking, "subtotal_price")
        or row_value(booking, "total_price")
        or 0
    )
    if not agency or matched_total <= 0:
        return ""
    if multiline:
        return (
            f"Price match agency: {agency}\n"
            f"Original FairFares total: {format_money(original_total)}\n"
            f"Matched quote total: {format_money(matched_total)}\n"
            f"Additional 10% price-match discount: {format_money(discount)}\n"
            f"Updated FairFares total: {format_money(row_value(booking, 'total_price'))}\n"
        )
    return (
        f"{agency} quote matched at {format_money(matched_total)}. "
        f"Additional 10% price-match discount: {format_money(discount)}. "
        f"Original FairFares total: {format_money(original_total)}. "
        f"Updated total: {format_money(row_value(booking, 'total_price'))}."
    )


def send_booking_pricing_update_email(email: str, name: str, booking: sqlite3.Row, origin: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = f"FairFares pricing updated: {booking['booking_id']}"
    poster_url = f"{origin.rstrip('/')}/static/img/booking-confirmation-promise.png"
    breakdown = booking_price_breakdown(booking)
    price_match_text = booking_price_match_summary(booking, multiline=True)
    price_match_html = booking_price_match_summary(booking)
    payment_label, pickup_label = admin_payment_summary(booking)
    text_body = (
        f"Dear {name},\n\n"
        "Your FairFares booking pricing was updated.\n\n"
        f"Booking ID: {booking['booking_id']}\n"
        f"Vehicle: {booking['category']} | {booking['car_name']} or similar\n"
        f"Rental subtotal: {format_money(breakdown['base'])}\n"
        f"Taxes and fees estimate: {format_money(breakdown['tax_fee_amount'])}\n"
        f"{price_match_text}"
        f"FairFares total: {format_money(breakdown['total'])}\n"
        f"Payment: {payment_label}\n"
        f"{pickup_label}\n\n"
        f"Refundable security deposit authorization at pickup: {format_money(SECURITY_DEPOSIT_AMOUNT)}\n"
        f"Deposit release: {SECURITY_DEPOSIT_RELEASE_COPY}\n\n"
        f"Booking poster: {poster_url}\n\n"
        "Thank you for choosing FairFares.\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <h2>Your FairFares pricing was updated.</h2>
          <p>Dear {html.escape(name)}, your booking now includes the approved pricing changes below.</p>
          <img src="{html.escape(poster_url)}" alt="FairFares price match promise" style="max-width:100%;border-radius:10px;margin:12px 0">
          <table style="border-collapse:collapse;width:100%;max-width:680px">
            <tr><td><b>Booking ID</b></td><td>{html.escape(booking['booking_id'])}</td></tr>
            <tr><td><b>Vehicle</b></td><td>{html.escape(booking['category'])} | {html.escape(booking['car_name'])} or similar</td></tr>
            <tr><td><b>Rental subtotal</b></td><td>{html.escape(format_money(breakdown['base']))}</td></tr>
            <tr><td><b>Taxes and fees</b></td><td>{html.escape(format_money(breakdown['tax_fee_amount']))}</td></tr>
            <tr><td><b>Price match</b></td><td>{html.escape(price_match_html or 'None')}</td></tr>
            <tr><td><b>FairFares total</b></td><td>{html.escape(format_money(breakdown['total']))}</td></tr>
            <tr><td><b>Payment</b></td><td>{html.escape(payment_label)}</td></tr>
            <tr><td><b>Pickup balance</b></td><td>{html.escape(pickup_label)}</td></tr>
            <tr><td><b>Security deposit</b></td><td>{html.escape(format_money(SECURITY_DEPOSIT_AMOUNT))} refundable authorization at pickup. {html.escape(SECURITY_DEPOSIT_RELEASE_COPY)}</td></tr>
          </table>
        </div>
    """
    outbox_file = OUTBOX_DIR / f"pricing-update-{booking['booking_id'].lower()}-{secrets.token_hex(6)}.txt"
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


def send_automated_lifecycle_email(
    email: str,
    name: str,
    subject: str,
    headline: str,
    body: str,
    cta_label: str,
    cta_path: str,
    origin: str,
    poster_path: str = "/static/img/booking-confirmation-promise.png",
) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    clean_origin = origin.rstrip("/")
    cta_url = f"{clean_origin}{cta_path}"
    poster_url = f"{clean_origin}{poster_path}" if clean_origin else poster_path
    text_body = (
        f"Hi {name},\n\n"
        f"{headline}\n\n"
        f"{body}\n\n"
        f"Poster: {poster_url}\n\n"
        f"{cta_label}: {cta_url}\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.5;background:#f5f7fb;padding:24px">
          <div style="max-width:680px;margin:auto;background:#fff;border:1px solid #d9deea;border-radius:12px;overflow:hidden">
            <div style="background:#07143f;color:#fff;padding:22px 24px">
              <h1 style="margin:0;font-size:26px">FairFares</h1>
              <p style="margin:6px 0 0">Fair prices. Better rides. For students.</p>
            </div>
            <div style="padding:24px">
              <h2 style="font-size:28px;margin:0 0 12px">{html.escape(headline)}</h2>
              {render_email_poster(poster_url)}
              <p style="font-size:16px">{html.escape(body)}</p>
              <p style="margin:24px 0"><a href="{html.escape(cta_url)}" style="background:#ec0016;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:800">{html.escape(cta_label)}</a></p>
            </div>
          </div>
        </div>
    """
    outbox_file = OUTBOX_DIR / f"automation-{secrets.token_hex(10)}.txt"
    delivery_status = send_with_resend(email, subject, text_body, html_body)
    smtp_host = os.environ.get("SMTP_HOST")
    if delivery_status == "not configured" and smtp_host:
        try:
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
        except Exception as exc:
            delivery_status = f"SMTP failed: {exc}"
    outbox_file.write_text(
        f"To: {email}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def send_password_reset_email(email: str, name: str, reset_link: str) -> tuple[Path, str]:
    load_env_file()
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    subject = "Reset your FairFares password"
    poster_url = shared_email_poster_from_link(reset_link)
    text_body = (
        f"Hi {name},\n\n"
        "We received a request to reset your FairFares password. Click the link below to set a new password:\n"
        f"{reset_link}\n\n"
        f"{'FairFares poster: ' + poster_url + chr(10) + chr(10) if poster_url else ''}"
        "This link expires in 30 minutes for your security.\n\n"
        "If you didn't request a password reset, ignore this email and your password will remain unchanged.\n"
    )
    html_body = f"""
        <div style="font-family:Arial,sans-serif;color:#07143f;line-height:1.45">
          <p>Hi {html.escape(name)},</p>
          <p>We received a request to reset your FairFares password.</p>
          {render_email_poster(poster_url)}
          <p><a href="{html.escape(reset_link)}" style="background:#e60019;color:#fff;padding:12px 24px;border-radius:5px;text-decoration:none;display:inline-block;font-weight:700">Reset Password</a></p>
          <p><small>This link expires in 30 minutes for your security.</small></p>
          <p><small>If you didn't request a password reset, ignore this email and your password will remain unchanged.</small></p>
        </div>
    """

    outbox_file = OUTBOX_DIR / f"password-reset-{secrets.token_hex(8)}.txt"
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
            WHERE role = 'CUSTOMER'
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
    poster_url = shared_email_poster_url(origin)
    subject = render_campaign_text(campaign["subject_line"], user, origin)
    headline = render_campaign_text(campaign["headline"] or "A FairFares update for you.", user, origin)
    message_body = render_campaign_text(campaign["message_body"] or campaign["notes"] or "Open FairFares to view the latest update.", user, origin)
    cta_label = campaign["cta_label"] or "Open FairFares"
    cta_url = f"{origin.rstrip('/')}/manage-booking"
    text_body = (
        f"Hi {user['name']},\n\n"
        f"{headline}\n\n"
        f"{message_body}\n\n"
        f"{'FairFares poster: ' + poster_url + chr(10) + chr(10) if poster_url else ''}"
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
              {render_email_poster(poster_url)}
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
        try:
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
        except Exception as exc:
            delivery_status = f"SMTP failed: {exc}"
    outbox_file.write_text(
        f"To: {user['email']}\nSubject: {subject}\nDelivery: {delivery_status}\nPoster: {poster_url}\nUnsubscribe: {unsubscribe_url}\n\n{text_body}",
        encoding="utf-8",
    )
    return outbox_file, delivery_status


def send_marketing_campaign(campaign_id: int, origin: str, test_email: str = "") -> dict[str, str | int | bool]:
    with db() as con:
        campaign = con.execute("SELECT * FROM email_campaigns WHERE id = ?", (campaign_id,)).fetchone()
    if not campaign:
        return {"ok": False, "message": "Campaign not found.", "sent": 0, "attempted": 0, "failed": 0}
    if test_email:
        clean_test_email = normalize_email(test_email)
        if "@" not in clean_test_email:
            return {"ok": False, "message": "Enter a valid test email.", "sent": 0, "attempted": 0, "failed": 0}
        test_user = {
            "id": 0,
            "name": "FairFares Test",
            "email": clean_test_email,
            "marketing_token": "test",
        }
        outbox_file, delivery_status = send_marketing_campaign_email(campaign, test_user, origin)  # type: ignore[arg-type]
        delivered = 1 if email_delivery_succeeded(delivery_status) else 0
        return {
            "ok": bool(delivered),
            "message": f"Test marketing email {'sent' if delivered else 'failed'} for {clean_test_email}.",
            "sent": delivered,
            "attempted": 1,
            "failed": 0 if delivered else 1,
            "delivery_status": delivery_status,
            "outbox_file": str(outbox_file),
        }
    recipients = get_marketing_recipients(campaign["audience"])
    deliveries = []
    delivered = 0
    last_status = "no opted-in recipients"
    for user in recipients:
        outbox_file, delivery_status = send_marketing_campaign_email(campaign, user, origin)
        is_delivered = email_delivery_succeeded(delivery_status)
        delivered += 1 if is_delivered else 0
        last_status = delivery_status
        deliveries.append((user["id"], user["email"], delivery_status, str(outbox_file)))
    attempted = len(deliveries)
    failed = attempted - delivered
    with db() as con:
        con.executemany(
            """
            INSERT INTO marketing_email_sends
            (campaign_id, user_id, email, delivery_status, outbox_file)
            VALUES (?, ?, ?, ?, ?)
            """,
            [(campaign_id, user_id, email, status, outbox_file) for user_id, email, status, outbox_file in deliveries],
        )
        con.execute(
            """
            UPDATE email_campaigns
            SET status = CASE WHEN ? > 0 THEN 'SENT' WHEN ? > 0 THEN 'FAILED' ELSE status END,
                sent_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE sent_at END,
                sent_count = sent_count + ?,
                last_delivery_status = ?
            WHERE id = ?
            """,
            (delivered, attempted, delivered, delivered, last_status, campaign_id),
        )
    if attempted == 0:
        message = "No opted-in, verified customer subscribers found."
    else:
        message = f"Marketing campaign delivered to {delivered}/{attempted} subscribed user(s)."
    return {
        "ok": delivered > 0,
        "message": message,
        "sent": delivered,
        "attempted": attempted,
        "failed": failed,
        "delivery_status": last_status,
    }


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
    clean_email = normalize_email(email)
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
                    saved_by_user = 1
                WHERE id = ? AND user_id = ?
                """,
                (full_name, clean_email, clean_phone, booking["id"], user_id),
            )
    delivery_status = "not sent"
    outbox_file: Path | None = None
    if booking and booking_payment_confirmed(booking) and booking["booking_status"] in {"CONFIRMED", "MODIFIED", "PICKED_UP"}:
        outbox_file, delivery_status = send_confirmed_booking_email_once(booking["id"], origin)
    if booking and booking["booking_status"] == "PENDING_HOLD":
        message = "Details saved. Pay the 10% hold within the reservation window to confirm this car."
    elif delivery_status == "already sent":
        message = "Details saved. Booking confirmation email was already sent."
    elif delivery_status in {"not sent", "payment not confirmed"}:
        message = "Details saved. Complete payment to confirm this car."
    else:
        message = "Details saved. Booking confirmation email sent with your trip summary and price-match poster."
    if delivery_status not in {"not sent", "already sent", "payment not confirmed"} and not delivery_status.startswith("sent"):
        message = "Details saved. A local confirmation email copy was created for this booking."
    return {
        "ok": True,
        "message": message,
        "delivery_status": delivery_status,
        "outbox_file": str(outbox_file) if outbox_file else "",
    }


def get_booking_by_id(booking_id: int) -> sqlite3.Row | None:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.seats, cars.bags,
                   cars.doors, cars.transmission, cars.color, cars.image_url, cars.daily_price
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.id = ?
            """,
            (booking_id,),
        ).fetchone()


def send_confirmed_booking_email_once(booking_id: int, origin: str) -> tuple[Path | None, str]:
    booking = get_booking_by_id(booking_id)
    if not booking:
        return None, "booking not found"
    if not booking_payment_confirmed(booking):
        return None, "payment not confirmed"
    if row_value(booking, "confirmation_email_sent_at"):
        return None, "already sent"
    email = row_value(booking, "contact_email")
    if not email or "@" not in email:
        return None, "missing customer email"
    name = row_value(booking, "contact_name") or "FairFares customer"
    outbox_file, delivery_status = send_booking_confirmation_email(email, name, booking, origin)
    with db() as con:
        con.execute(
            """
            UPDATE bookings
            SET confirmation_email_sent_at = CURRENT_TIMESTAMP
            WHERE id = ? AND confirmation_email_sent_at IS NULL
            """,
            (booking_id,),
        )
    return outbox_file, delivery_status


def automation_event_already_reserved(
    con: sqlite3.Connection,
    event_key: str,
    booking_id: int | None,
    user_id: int | None,
    email: str,
    subject: str,
) -> bool:
    booking_id = int(booking_id or 0)
    user_id = int(user_id or 0)
    try:
        con.execute(
            """
            INSERT INTO email_automation_sends (event_key, booking_id, user_id, email, subject, delivery_status)
            VALUES (?, ?, ?, ?, ?, 'reserved')
            """,
            (event_key, booking_id, user_id, email, subject),
        )
        return False
    except sqlite3.IntegrityError:
        return True


def update_automation_delivery(
    event_key: str,
    booking_id: int | None,
    user_id: int | None,
    email: str,
    delivery_status: str,
    outbox_file: Path | None,
) -> None:
    booking_id = int(booking_id or 0)
    user_id = int(user_id or 0)
    with db() as con:
        con.execute(
            """
            UPDATE email_automation_sends
            SET delivery_status = ?,
                outbox_file = ?
            WHERE event_key = ?
              AND COALESCE(booking_id, 0) = ?
              AND COALESCE(user_id, 0) = ?
              AND email = ?
            """,
            (delivery_status, str(outbox_file or ""), event_key, booking_id, user_id, email),
        )


def reserve_and_send_automation(
    event_key: str,
    booking_id: int | None,
    user_id: int | None,
    email: str,
    name: str,
    subject: str,
    headline: str,
    body: str,
    cta_label: str,
    cta_path: str,
    origin: str,
) -> dict[str, object]:
    clean_email = normalize_email(email)
    if "@" not in clean_email:
        return {"event": event_key, "sent": False, "status": "missing email"}
    with db() as con:
        if automation_event_already_reserved(con, event_key, booking_id, user_id, clean_email, subject):
            return {"event": event_key, "sent": False, "status": "already sent"}
    outbox_file, delivery_status = send_automated_lifecycle_email(
        clean_email,
        name or "FairFares customer",
        subject,
        headline,
        body,
        cta_label,
        cta_path,
        origin,
    )
    update_automation_delivery(event_key, booking_id, user_id, clean_email, delivery_status, outbox_file)
    return {
        "event": event_key,
        "sent": email_delivery_succeeded(delivery_status),
        "status": delivery_status,
        "outbox_file": str(outbox_file),
    }


def booking_email_context(row: sqlite3.Row) -> dict[str, str]:
    booking_id = row_value(row, "booking_id")
    car_name = row_value(row, "car_name") or "your FairFares car"
    pickup = f"{row_value(row, 'pickup_date')} at {row_value(row, 'pickup_time')}".strip()
    dropoff = f"{row_value(row, 'dropoff_date')} at {row_value(row, 'dropoff_time')}".strip()
    pickup_location = row_value(row, "pickup_location") or "your pickup location"
    return {
        "booking_id": booking_id,
        "car_name": car_name,
        "pickup": pickup,
        "dropoff": dropoff,
        "pickup_location": pickup_location,
        "manage_path": "/manage-booking",
        "dashboard_path": "/dashboard",
    }


def automated_booking_email(
    event_key: str,
    booking: sqlite3.Row,
    origin: str,
    subject: str,
    headline: str,
    body: str,
    cta_label: str = "Manage Booking",
    cta_path: str = "/manage-booking",
) -> dict[str, object]:
    return reserve_and_send_automation(
        event_key,
        int(row_value(booking, "id") or 0),
        int(row_value(booking, "user_id") or 0),
        row_value(booking, "contact_email") or row_value(booking, "user_email"),
        row_value(booking, "contact_name") or row_value(booking, "user_name") or "FairFares customer",
        subject,
        headline,
        body,
        cta_label,
        cta_path,
        origin,
    )


def active_customer_bookings() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email, users.promo_email_opt_in,
                   cars.name AS car_name, cars.category, cars.daily_price
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.booking_status IN ('CONFIRMED', 'MODIFIED', 'PICKED_UP', 'RETURNED', 'PENDING_HOLD', 'EXPIRED_HOLD')
              AND COALESCE(bookings.payment_status, '') NOT IN ('REFUNDED')
            ORDER BY bookings.id DESC
            LIMIT 2000
            """
        ).fetchall()


def opted_in_customer_users() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM users
            WHERE role = 'CUSTOMER'
              AND is_verified = 1
              AND promo_email_opt_in = 1
              AND marketing_unsubscribed_at IS NULL
            ORDER BY id DESC
            LIMIT 2000
            """
        ).fetchall()


def user_has_active_booking(user_id: int) -> bool:
    with db() as con:
        row = con.execute(
            """
            SELECT 1
            FROM bookings
            WHERE user_id = ?
              AND booking_status IN ('PENDING_HOLD', 'CONFIRMED', 'MODIFIED', 'PICKED_UP', 'CANCELLATION_REQUESTED')
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    return bool(row)


def latest_customer_trip_end(user_id: int) -> datetime | None:
    with db() as con:
        rows = con.execute(
            """
            SELECT dropoff_date, dropoff_time
            FROM bookings
            WHERE user_id = ?
              AND booking_status IN ('RETURNED', 'CANCELLED', 'EXPIRED_HOLD')
            ORDER BY id DESC
            LIMIT 20
            """,
            (user_id,),
        ).fetchall()
    for row in rows:
        trip_end = parse_booking_datetime(row_value(row, "dropoff_date"), row_value(row, "dropoff_time"))
        if trip_end:
            return trip_end
    return None


def run_email_automations(origin: str, now: datetime | None = None) -> dict[str, object]:
    now = now or datetime.now()
    expire_stale_booking_holds()
    results: list[dict[str, object]] = []
    for booking in active_customer_bookings():
        ctx = booking_email_context(booking)
        pickup_at = parse_booking_datetime(row_value(booking, "pickup_date"), row_value(booking, "pickup_time"))
        return_at = parse_booking_datetime(
            row_value(booking, "actual_return_date") or row_value(booking, "dropoff_date"),
            row_value(booking, "actual_return_time") or row_value(booking, "dropoff_time"),
        )
        booking_status = row_value(booking, "booking_status")
        if pickup_at and booking_status in {"CONFIRMED", "MODIFIED"} and booking_payment_confirmed(booking):
            until_pickup = pickup_at - now
            if timedelta(hours=2) < until_pickup <= timedelta(hours=24):
                results.append(
                    automated_booking_email(
                        "pickup_24h",
                        booking,
                        origin,
                        f"Your FairFares trip starts tomorrow: {ctx['booking_id']}",
                        "Pickup is almost here.",
                        f"Your {ctx['car_name']} is scheduled for {ctx['pickup']}. Bring your driver license, insurance details, payment method, and any lower quote you want FairFares to review.",
                        "View Trip",
                    )
                )
            if timedelta(0) < until_pickup <= timedelta(hours=2):
                results.append(
                    automated_booking_email(
                        "pickup_2h",
                        booking,
                        origin,
                        f"Final FairFares pickup reminder: {ctx['booking_id']}",
                        "Your pickup starts soon.",
                        f"Your {ctx['car_name']} pickup window is at {ctx['pickup_location']} today. Open Manage Booking for status, documents, or support.",
                        "Open Live Status",
                    )
                )
        if booking_status == "RETURNED":
            results.append(
                automated_booking_email(
                    "trip_completed",
                    booking,
                    origin,
                    f"Thanks for choosing FairFares: {ctx['booking_id']}",
                    "Your trip is complete.",
                    f"Thank you for renting {ctx['car_name']} with FairFares. Your invoice, receipt, and rental documents stay available in your portal.",
                    "Open Documents",
                    "/dashboard#documents",
                )
            )
            if return_at and now - return_at >= timedelta(hours=24):
                results.append(
                    automated_booking_email(
                        "review_24h",
                        booking,
                        origin,
                        f"How was your FairFares trip? {ctx['booking_id']}",
                        "Tell us how we did.",
                        "Your feedback helps FairFares keep pricing transparent, pickup clean, and support responsive for the next renter.",
                        "Leave Feedback",
                        "/manage-booking#support",
                    )
                )
            if return_at and now - return_at >= timedelta(days=7):
                results.append(
                    automated_booking_email(
                        "repeat_customer_7d",
                        booking,
                        origin,
                        "Welcome back to FairFares",
                        "Your next ride should feel simple too.",
                        "Your profile and trip documents are ready when you need another FairFares booking.",
                        "Book Again",
                        "/",
                    )
                )
    for user in opted_in_customer_users():
        user_id = int(row_value(user, "id") or 0)
        user_email = row_value(user, "email")
        user_name = row_value(user, "name") or "FairFares customer"
        if row_value(user, "date_of_birth"):
            try:
                birthday = datetime.strptime(row_value(user, "date_of_birth"), "%Y-%m-%d").date()
                if birthday.month == now.month and birthday.day == now.day:
                    results.append(
                        reserve_and_send_automation(
                            f"birthday_{now.year}",
                            None,
                            user_id,
                            user_email,
                            user_name,
                            "A birthday ride from FairFares",
                            "Celebrate with a fairer trip.",
                            "Happy birthday from FairFares. Open your dashboard to check current offers and book when you are ready.",
                            "Open Dashboard",
                            "/dashboard",
                            origin,
                        )
                    )
            except ValueError:
                pass
        if not user_has_active_booking(user_id):
            last_trip_end = latest_customer_trip_end(user_id)
            if last_trip_end:
                inactive_days = (now - last_trip_end).days
                reengagement = None
                if inactive_days >= 90:
                    reengagement = (90, "Ready for another fair ride?", "Come back and save.")
                elif inactive_days >= 60:
                    reengagement = (60, "A FairFares offer is waiting for your next ride", "Come back with a cleaner deal.")
                elif inactive_days >= 30:
                    reengagement = (30, "We miss you: student-ready rentals are waiting", "Your next FairFares trip can still cost less.")
                if reengagement:
                    day_count, subject, headline = reengagement
                    results.append(
                        reserve_and_send_automation(
                            f"reengagement_{day_count}d",
                            None,
                            user_id,
                            user_email,
                            user_name,
                            subject,
                            headline,
                            "Search FairFares and bring us a lower quote from a major rental company. We will review eligible matches and show your savings before booking.",
                            "Search Cars",
                            "/",
                            origin,
                        )
                    )
        results.append(
            reserve_and_send_automation(
                f"location_monthly_{now:%Y_%m}",
                None,
                user_id,
                user_email,
                user_name,
                "Popular FairFares routes near you",
                "Find a nearby ride and a memory worth keeping.",
                "See current FairFares cars, local pickup options, and Explorer ideas for your next trip.",
                "Explore Nearby",
                "/explorer",
                origin,
            )
        )
    sent = sum(1 for result in results if result.get("sent"))
    skipped = sum(1 for result in results if result.get("status") == "already sent")
    failed = len(results) - sent - skipped
    return {"ok": True, "attempted": len(results), "sent": sent, "skipped": skipped, "failed": failed, "results": results[:50]}


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

            CREATE TABLE IF NOT EXISTS staff_account_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                requested_by INTEGER NOT NULL,
                approved_by INTEGER,
                target_user_id INTEGER,
                created_user_id INTEGER,
                admin_note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TEXT,
                FOREIGN KEY(requested_by) REFERENCES users(id),
                FOREIGN KEY(approved_by) REFERENCES users(id),
                FOREIGN KEY(target_user_id) REFERENCES users(id),
                FOREIGN KEY(created_user_id) REFERENCES users(id)
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
                purchase_cost REAL NOT NULL DEFAULT 0,
                purchase_receipt_url TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS car_service_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                car_id INTEGER NOT NULL,
                cost_type TEXT NOT NULL DEFAULT 'MAINTENANCE',
                amount REAL NOT NULL DEFAULT 0,
                service_date TEXT NOT NULL DEFAULT CURRENT_DATE,
                vendor TEXT NOT NULL DEFAULT '',
                receipt_url TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(car_id) REFERENCES cars(id)
            );

            CREATE TABLE IF NOT EXISTS business_expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                expense_date TEXT NOT NULL DEFAULT CURRENT_DATE,
                amount REAL NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS drive_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_scope TEXT NOT NULL,
                folder_key TEXT NOT NULL,
                drive_file_id TEXT NOT NULL,
                drive_folder_id TEXT NOT NULL DEFAULT '',
                drive_web_view_link TEXT NOT NULL DEFAULT '',
                original_filename TEXT NOT NULL DEFAULT '',
                mime_type TEXT NOT NULL DEFAULT '',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                uploaded_by INTEGER,
                user_id INTEGER,
                booking_id INTEGER,
                car_id INTEGER,
                expense_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                tax_fee_amount REAL NOT NULL DEFAULT 0,
                booking_hold_amount REAL NOT NULL DEFAULT 0,
                due_at_pickup_amount REAL NOT NULL DEFAULT 0,
                estimated_market_total REAL NOT NULL DEFAULT 0,
                fairfares_savings_amount REAL NOT NULL DEFAULT 0,
                total_price REAL NOT NULL,
                status TEXT NOT NULL,
                booking_status TEXT NOT NULL DEFAULT 'CONFIRMED',
                payment_status TEXT NOT NULL DEFAULT 'PAID',
                return_location TEXT NOT NULL DEFAULT '',
                cancellation_reason TEXT NOT NULL DEFAULT '',
                additional_driver_name TEXT NOT NULL DEFAULT '',
                additional_driver_age TEXT NOT NULL DEFAULT '',
                saved_by_user INTEGER NOT NULL DEFAULT 0,
                hold_started_at TEXT,
                hold_expires_at TEXT,
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

            CREATE TABLE IF NOT EXISTS identity_verifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                booking_id INTEGER,
                provider TEXT NOT NULL,
                provider_session_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'PENDING',
                verification_type TEXT NOT NULL DEFAULT 'DOCUMENT_SELFIE',
                verified_name TEXT NOT NULL DEFAULT '',
                verified_dob TEXT NOT NULL DEFAULT '',
                verified_address TEXT NOT NULL DEFAULT '',
                last_error TEXT NOT NULL DEFAULT '',
                raw_status TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(booking_id) REFERENCES bookings(id)
            );

            CREATE TABLE IF NOT EXISTS external_identity_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                booking_id INTEGER,
                provider TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
                request_reason TEXT NOT NULL DEFAULT '',
                provider_reference TEXT NOT NULL DEFAULT '',
                result_summary TEXT NOT NULL DEFAULT '',
                requested_by INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(booking_id) REFERENCES bookings(id),
                FOREIGN KEY(requested_by) REFERENCES users(id)
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

            CREATE TABLE IF NOT EXISTS tax_fee_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL,
                rule_type TEXT NOT NULL DEFAULT 'DAILY',
                value REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(label, rule_type)
            );

            CREATE TABLE IF NOT EXISTS post_return_fee_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                label TEXT NOT NULL,
                rule_type TEXT NOT NULL DEFAULT 'FLAT',
                value REAL NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(label, rule_type)
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
                escalated_to_oncall INTEGER NOT NULL DEFAULT 0,
                escalated_by INTEGER,
                escalation_reason TEXT NOT NULL DEFAULT '',
                escalated_at TEXT,
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

            CREATE TABLE IF NOT EXISTS oncall_shifts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shift_date TEXT NOT NULL UNIQUE,
                admin_user_id INTEGER NOT NULL,
                assigned_by INTEGER,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(admin_user_id) REFERENCES users(id),
                FOREIGN KEY(assigned_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS app_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                rating INTEGER NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                page TEXT NOT NULL DEFAULT '',
                user_agent TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS wiki_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subtitle TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                visibility TEXT NOT NULL DEFAULT 'PUBLIC',
                status TEXT NOT NULL DEFAULT 'PUBLISHED',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(created_by) REFERENCES users(id)
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
                city_lat REAL NOT NULL DEFAULT 0,
                city_lng REAL NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                quest_type TEXT NOT NULL DEFAULT '',
                difficulty INTEGER NOT NULL DEFAULT 2,
                duration TEXT NOT NULL DEFAULT '',
                budget TEXT NOT NULL DEFAULT '',
                travel_with TEXT NOT NULL DEFAULT '',
                fairfares_booked INTEGER NOT NULL DEFAULT 0,
                total_hours REAL NOT NULL DEFAULT 0,
                total_miles REAL NOT NULL DEFAULT 0,
                total_xp INTEGER NOT NULL DEFAULT 0,
                stop_count INTEGER NOT NULL DEFAULT 0,
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
                tips TEXT NOT NULL DEFAULT '',
                reference_photo_url TEXT NOT NULL DEFAULT '',
                is_secret INTEGER NOT NULL DEFAULT 0,
                locked INTEGER NOT NULL DEFAULT 0,
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

            CREATE TABLE IF NOT EXISTS explorer_xp_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                quest_id INTEGER,
                stop_id INTEGER,
                event_type TEXT NOT NULL DEFAULT '',
                xp_amount INTEGER NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(quest_id) REFERENCES explorer_quests(id),
                FOREIGN KEY(stop_id) REFERENCES explorer_stops(id)
            );

            CREATE TABLE IF NOT EXISTS explorer_badges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                icon TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                xp_required INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS explorer_user_badges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                badge_id INTEGER NOT NULL,
                earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, badge_id),
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(badge_id) REFERENCES explorer_badges(id)
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

            CREATE TABLE IF NOT EXISTS email_automation_sends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_key TEXT NOT NULL,
                booking_id INTEGER,
                user_id INTEGER,
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                delivery_status TEXT NOT NULL DEFAULT '',
                outbox_file TEXT NOT NULL DEFAULT '',
                sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(event_key, booking_id, user_id, email),
                FOREIGN KEY(booking_id) REFERENCES bookings(id),
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

            CREATE TABLE IF NOT EXISTS workspace_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id INTEGER NOT NULL,
                post_type TEXT NOT NULL DEFAULT 'UPDATE',
                body TEXT NOT NULL,
                media_url TEXT NOT NULL DEFAULT '',
                image_data TEXT NOT NULL DEFAULT '',
                visibility TEXT NOT NULL DEFAULT 'STAFF',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(author_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workspace_post_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(post_id) REFERENCES workspace_posts(id),
                FOREIGN KEY(author_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workspace_post_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                reaction TEXT NOT NULL DEFAULT 'LIKE',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, user_id, reaction),
                FOREIGN KEY(post_id) REFERENCES workspace_posts(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workspace_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                slack_url TEXT NOT NULL DEFAULT '',
                slack_channel_id TEXT NOT NULL DEFAULT '',
                slack_channel_name TEXT NOT NULL DEFAULT '',
                created_by INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(created_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workspace_group_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id),
                FOREIGN KEY(group_id) REFERENCES workspace_groups(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
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
        ensure_column(con, "users", "profile_photo_url", "profile_photo_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "staff_account_requests", "phone", "phone TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "staff_account_requests", "admin_note", "admin_note TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "staff_account_requests", "target_user_id", "target_user_id INTEGER")
        ensure_column(con, "staff_account_requests", "created_user_id", "created_user_id INTEGER")
        ensure_column(con, "car_service_costs", "receipt_url", "receipt_url TEXT NOT NULL DEFAULT ''")
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
        ensure_column(con, "cars", "purchase_cost", "purchase_cost REAL NOT NULL DEFAULT 0")
        ensure_column(con, "cars", "purchase_receipt_url", "purchase_receipt_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "booking_status", "booking_status TEXT NOT NULL DEFAULT 'CONFIRMED'")
        ensure_column(con, "bookings", "payment_status", "payment_status TEXT NOT NULL DEFAULT 'PAID'")
        ensure_column(con, "bookings", "return_location", "return_location TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "cancellation_reason", "cancellation_reason TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "subtotal_price", "subtotal_price REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "discount_code", "discount_code TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "discount_amount", "discount_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "tax_fee_amount", "tax_fee_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "booking_hold_amount", "booking_hold_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "due_at_pickup_amount", "due_at_pickup_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "estimated_market_total", "estimated_market_total REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "fairfares_savings_amount", "fairfares_savings_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "hold_started_at", "hold_started_at TEXT")
        ensure_column(con, "bookings", "hold_expires_at", "hold_expires_at TEXT")
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
        ensure_column(con, "bookings", "pickup_odometer", "pickup_odometer INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "return_odometer", "return_odometer INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "pickup_fuel_level", "pickup_fuel_level TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_fuel_level", "return_fuel_level TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_condition_status", "pickup_condition_status TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_condition_status", "return_condition_status TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "new_damage_found", "new_damage_found TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_customer_signature", "pickup_customer_signature TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_staff_signature", "pickup_staff_signature TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_customer_signature", "return_customer_signature TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_staff_signature", "return_staff_signature TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_review_status", "return_review_status TEXT NOT NULL DEFAULT 'PENDING'")
        ensure_column(con, "bookings", "security_deposit_status", "security_deposit_status TEXT NOT NULL DEFAULT 'NOT_AUTHORIZED'")
        ensure_column(con, "bookings", "security_deposit_amount", "security_deposit_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "security_deposit_payment_intent_id", "security_deposit_payment_intent_id TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "post_return_charge_amount", "post_return_charge_amount REAL NOT NULL DEFAULT 0")
        ensure_column(con, "bookings", "post_return_charge_notes", "post_return_charge_notes TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_odometer_image", "pickup_odometer_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_fuel_image", "pickup_fuel_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_interior_front_image", "pickup_interior_front_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "pickup_interior_rear_image", "pickup_interior_rear_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_odometer_image", "return_odometer_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_fuel_image", "return_fuel_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_interior_front_image", "return_interior_front_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "return_interior_rear_image", "return_interior_rear_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "bookings", "damage_photo_image", "damage_photo_image TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "insurances", "document_url", "document_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "rental_agreements", "agreement_data", "agreement_data TEXT NOT NULL DEFAULT '{}'")
        ensure_column(con, "discounts", "max_uses", "max_uses INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "discounts", "used_count", "used_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "tax_fee_rules", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "post_return_fee_rules", "description", "description TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "post_return_fee_rules", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "commercials", "is_live", "is_live INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "commercials", "duration_seconds", "duration_seconds INTEGER NOT NULL DEFAULT 12")
        ensure_column(con, "commercials", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "support_tickets", "priority", "priority TEXT NOT NULL DEFAULT 'P3'")
        ensure_column(con, "support_tickets", "escalated_to_oncall", "escalated_to_oncall INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "support_tickets", "escalated_by", "escalated_by INTEGER")
        ensure_column(con, "support_tickets", "escalation_reason", "escalation_reason TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "support_tickets", "escalated_at", "escalated_at TEXT")
        con.execute(
            """
            UPDATE support_tickets
            SET escalated_to_oncall = 1,
                escalation_reason = COALESCE(NULLIF(escalation_reason, ''), 'Auto-escalated because this ticket is P0.'),
                escalated_at = COALESCE(escalated_at, created_at)
            WHERE priority = 'P0'
            """
        )
        ensure_column(con, "wiki_articles", "tags", "tags TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "wiki_articles", "visibility", "visibility TEXT NOT NULL DEFAULT 'PUBLIC'")
        ensure_column(con, "wiki_articles", "status", "status TEXT NOT NULL DEFAULT 'PUBLISHED'")
        ensure_column(con, "wiki_articles", "created_by", "created_by INTEGER")
        ensure_column(con, "wiki_articles", "updated_at", "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
        ensure_column(con, "email_campaigns", "sent_at", "sent_at TEXT")
        ensure_column(con, "email_campaigns", "sent_count", "sent_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "email_campaigns", "last_delivery_status", "last_delivery_status TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "referral_rewards", "referrer_phone", "referrer_phone TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "referral_rewards", "discount_id", "discount_id INTEGER")
        ensure_column(con, "referral_rewards", "claimed_at", "claimed_at TEXT")
        ensure_column(con, "workspace_posts", "post_type", "post_type TEXT NOT NULL DEFAULT 'UPDATE'")
        ensure_column(con, "workspace_posts", "media_url", "media_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "workspace_posts", "image_data", "image_data TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "workspace_posts", "visibility", "visibility TEXT NOT NULL DEFAULT 'STAFF'")
        ensure_column(con, "workspace_posts", "group_id", "group_id INTEGER")
        ensure_column(con, "workspace_posts", "updated_at", "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
        ensure_column(con, "workspace_groups", "slack_url", "slack_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "workspace_groups", "slack_channel_id", "slack_channel_id TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "workspace_groups", "slack_channel_name", "slack_channel_name TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_quests", "city_lat", "city_lat REAL NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_quests", "city_lng", "city_lng REAL NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_quests", "description", "description TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_quests", "difficulty", "difficulty INTEGER NOT NULL DEFAULT 2")
        ensure_column(con, "explorer_quests", "fairfares_booked", "fairfares_booked INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_quests", "stop_count", "stop_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_stops", "tips", "tips TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_stops", "reference_photo_url", "reference_photo_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_stops", "locked", "locked INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_stops", "place_id", "place_id TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_stops", "address", "address TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_stops", "rating", "rating REAL NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_stops", "review_count", "review_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(con, "explorer_stops", "reviews_json", "reviews_json TEXT NOT NULL DEFAULT '[]'")
        ensure_column(con, "explorer_stops", "google_url", "google_url TEXT NOT NULL DEFAULT ''")
        ensure_column(con, "explorer_stops", "source", "source TEXT NOT NULL DEFAULT 'LOCAL'")

        for badge in (
            ("First Explorer", "compass", "Complete your first FairFares city quest.", 0),
            ("Hidden Gem Hunter", "gem", "Unlock and complete a mystery stop.", 250),
            ("Road Warrior", "road", "Keep exploring across multiple quests.", 500),
        ):
            con.execute(
                """
                INSERT OR IGNORE INTO explorer_badges (name, icon, description, xp_required)
                VALUES (?, ?, ?, ?)
                """,
                badge,
            )

        ensure_default_admin(con)
        repair_normalized_auth_emails(con)
        normalize_user_roles(con)
        apply_staff_role_overrides(con)
        normalize_user_roles(con)
        con.execute("UPDATE bookings SET subtotal_price = total_price WHERE subtotal_price = 0")

        default_wiki_articles = [
            (
                "How FairFares savings work",
                "Where discounts, price-match review, receipts, and rental agreements connect.",
                "FairFares keeps the savings story visible from search to checkout. If a student or promo discount is applied, the saved amount appears on the booking, receipt, rental agreement, and confirmation email. If a customer brings a lower comparable quote before pickup, FairFares can review it, match the eligible price, and add another 10% off after review.",
                "savings, discount, receipt, agreement, price match",
                "PUBLIC",
            ),
            (
                "Explorer personal travel guide",
                "Routes, weather-smart stops, XP, badges, and memories in one travel book.",
                "Explorer helps customers turn a rental day into a personal travel guide. It can suggest timing, weather fit, stop types, and memory prompts so the trip becomes easier to plan and easier to remember.",
                "explorer, travel guide, memories, route, weather",
                "PUBLIC",
            ),
            (
                "Cheapest cars and best value",
                "How to find low daily rates, compact cars, and student-ready deals.",
                "To find the cheapest cars, sort results by Price (Low to High), compare compact and economy vehicles first, and check the savings note on each car card. FairFares also highlights fuel-efficient and electric options when they can reduce trip costs beyond the daily rate.",
                "cheapest cars, low price, economy, compact, deals, student savings",
                "PUBLIC",
            ),
            (
                "Refund and cancellation policy",
                "What customers should know before canceling or changing a booking.",
                "Most bookings can be reviewed for cancellation before pickup. If a booking has a provider rule, late cancellation window, no-show condition, or discount restriction, FairFares shows the status in Manage Booking and keeps support available for review. Refund timing depends on the booking status, payment record, and provider terms.",
                "refund policy, cancellation, cancel booking, manage booking, provider terms",
                "PUBLIC",
            ),
            (
                "Insurance Requirement",
                "Proof of valid auto insurance coverage is required before vehicle release.",
                "To rent a vehicle through FairFares, you must provide proof of a valid auto insurance policy that extends coverage to rental vehicles. We recommend that your policy includes collision coverage, comprehensive coverage, liability coverage, rental vehicle coverage if required by your insurer, and roadside assistance. If your current policy does not provide adequate coverage for rental vehicles, contact your insurance provider to discuss available coverage options before completing your booking. FairFares reserves the right to verify insurance coverage before releasing a vehicle.",
                "insurance requirement, proof of insurance, rental vehicle coverage, collision coverage, comprehensive coverage, liability coverage, roadside assistance, pickup documents",
                "PUBLIC",
            ),
            (
                "OpenAI + RAG knowledge flow",
                "Future admin-only plan for files, vector search, and GPT answers.",
                "Your files flow into a vector database. Search retrieves the closest safe passages, then GPT-4o or GPT-5 writes an answer. Internal files and private operational notes must stay admin-only and must never be returned to public Wiki search.",
                "rag, openai, vector database, internal files, gpt",
                "INTERNAL",
            ),
            (
                "Booking help FAQ",
                "How customers book, change, extend, shorten, check status, and contact support.",
                "Q: How do I book a car? A: Search cars, choose Select, review the checkout window, save your details, and pay the 10% amount due now to confirm. Q: How far in advance can I book? A: Book as early as inventory is shown on FairFares; earlier booking gives better vehicle choice. Q: Can I modify my booking? A: Use Manage Booking to request date, time, location, or vehicle changes. Q: Can I cancel my booking? A: Use Manage Booking > Cancel Reservation. Some cancellations are automatic before the cutoff; others go to admin review. Q: What is the cancellation policy? A: Cancellation depends on pickup timing, provider terms, payment record, no-show rules, and discounts. Q: Can I extend my rental? A: Ask support or use Manage Booking before the return time; approval depends on vehicle availability. Q: Can I shorten my rental? A: Ask support before return; unused days may depend on provider terms and discount rules. Q: How do I check booking status? A: Open Manage Booking or ask the assistant while signed in. Q: How do I retrieve my booking confirmation? A: Check email or Manage Booking documents. Q: How do I contact support regarding a booking? A: Use Manage Booking > Support Center.",
                "booking, book a car, advance booking, modify booking, cancel booking, cancellation policy, extend rental, shorten rental, booking status, booking confirmation, booking support",
                "PUBLIC",
            ),
            (
                "Pricing and discounts FAQ",
                "Daily rates, taxes, deposits, hidden fees, price match, and student savings.",
                "Q: How much does it cost to rent a car? A: The car card shows the daily inventory rate; checkout shows taxes, fees, due now, and due at pickup. Q: What is included in the rental price? A: The rental subtotal covers the selected vehicle period; taxes, fees, mileage, insurance, and pickup rules are shown separately when applicable. Q: Are taxes included? A: Taxes and fees are itemized in checkout before confirmation. Q: Are airport fees included? A: Airport and location fees appear in the taxes and fees section when applicable. Q: Are there hidden fees? A: FairFares is designed to show the estimate, taxes, fees, due-now amount, and pickup balance before confirmation. Q: What is the security deposit? A: Deposit rules depend on vehicle, provider, payment method, and risk review. Q: When is the security deposit returned? A: Release timing depends on bank and provider review after return. Q: Do you offer discounts? A: FairFares can show student, promo, referral, and campaign discounts. Q: What is the FairFares price match guarantee? A: Bring a comparable lower quote before pickup; FairFares reviews eligibility and can match the price. Q: How does the additional 10% discount work? A: If the price match qualifies, FairFares can apply another 10% off after review.",
                "pricing, cost, rental price, taxes, airport fees, hidden fees, security deposit, discounts, price match guarantee, additional 10 discount, student savings",
                "PUBLIC",
            ),
            (
                "Driver eligibility FAQ",
                "Age, license, international drivers, additional drivers, and required documents.",
                "Q: How old do I need to be to rent? A: Age eligibility depends on FairFares and provider rules shown during checkout or support review. Q: Can international drivers rent? A: International drivers may need a valid license, passport, and any required international driving permit. Q: Can I rent with a temporary license? A: Temporary licenses require review and may not be accepted by every provider. Q: Can I rent with a learner permit? A: Learner permits are generally not enough to rent. Q: Can someone else drive my rental? A: Only approved drivers listed on the booking or agreement may drive. Q: How do I add an additional driver? A: Use Manage Booking or pickup review to add driver information. Q: Are there extra driver fees? A: Additional driver fees depend on provider and rental terms. Q: What documents are required? A: Bring driver's license, payment method, insurance information if required, student ID or verification when using student benefits, and booking confirmation.",
                "driver eligibility, age, international driver, temporary license, learner permit, additional driver, driver fees, required documents, license",
                "PUBLIC",
            ),
            (
                "Payment FAQ",
                "Payment methods, debit cards, card holds, refunds, declines, and split payment.",
                "Q: Which payment methods are accepted? A: Accepted methods depend on the checkout and provider; card payment is used for the due-now amount in the FairFares flow. Q: Do you accept debit cards? A: Debit cards may require extra review and may have provider restrictions. Q: Do you accept prepaid cards? A: Prepaid cards are usually restricted and may not satisfy deposit or identity rules. Q: Can I pay with cash? A: Cash depends on provider and pickup approval; online due-now payment must follow checkout rules. Q: When will my card be charged? A: The due-now amount is charged during checkout; pickup balance is handled at pickup. Q: Why is there a hold on my card? A: A card hold can secure the booking, deposit, or provider authorization. Q: How long does a refund take? A: Refund timing depends on admin review, provider timing, and bank processing. Q: Why was my payment declined? A: Declines can happen due to bank rules, card mismatch, insufficient funds, or verification failure. Q: Can I split payment between two cards? A: Split payment requires support/provider review and is not always available.",
                "payment, debit card, prepaid card, cash, card charged, hold on card, refund time, payment declined, split payment, due now",
                "PUBLIC",
            ),
            (
                "Pickup and return FAQ",
                "Pickup requirements, late arrival, inspection, return location, fuel, cleaning, and after-hours return.",
                "Q: What do I need to bring for pickup? A: Bring license, payment method, booking confirmation, insurance if required, and any student verification. Q: Where do I pick up the car? A: Your booking shows pickup location and time in Manage Booking. Q: Can someone else pick up the vehicle? A: The primary renter or approved driver must pick up unless support approves otherwise. Q: What if I arrive late? A: Contact support; late arrival can affect availability or provider rules. Q: Can I inspect the vehicle before accepting it? A: Yes, inspect and document photos before pickup acceptance. Q: What if I find damage before pickup? A: Report it before leaving and capture photos. Q: Where do I return the vehicle? A: Return location is listed in Manage Booking and rental agreement. Q: What happens if I return late? A: Late return may create extra charges or support review. Q: What happens if I return early? A: Early return refunds depend on provider and booking terms. Q: Do I get a refund for unused days? A: Not always; refund review depends on terms and timing. Q: Do I need to refill the fuel tank? A: Follow the fuel level and agreement rules. Q: What happens if the car is dirty? A: Excess cleaning can create a cleaning fee. Q: Can I return after hours? A: After-hours return depends on location and provider instructions.",
                "pickup, bring for pickup, pickup location, late pickup, inspect vehicle, damage before pickup, return location, late return, early return, unused days, fuel tank, dirty car, after hours return",
                "PUBLIC",
            ),
            (
                "Insurance and accident FAQ",
                "Insurance requirements, accidents, deductibles, damage responsibility, and reporting steps.",
                "Q: Do I need insurance? A: Insurance requirements depend on provider, vehicle, and location; bring proof if required. Q: What insurance is required? A: Required coverage is shown in rental terms or support review. Q: Does my personal insurance cover rentals? A: Ask your insurer; FairFares cannot guarantee personal policy coverage. Q: What happens if I have no insurance? A: Pickup may be blocked or require provider-approved coverage. Q: What happens if I get into an accident? A: Make sure everyone is safe, call emergency services if needed, contact support/provider, document photos, and collect information. Q: What is my deductible? A: Deductible depends on insurance and agreement terms. Q: What damages am I responsible for? A: You may be responsible for damage, loss, cleaning, tire, glass, key, toll, ticket, or misuse charges under the agreement. Q: Does FairFares offer insurance products? A: Insurance products depend on provider and market availability. Q: Who do I call after an accident? A: Call emergency services if needed, then FairFares support/provider. Q: How do I submit an accident report? A: Use support and provide photos, police report if any, other driver info, location, and time. Q: Will my insurance be contacted? A: Insurance contact depends on claim and agreement requirements. Q: Am I responsible if someone hits me? A: Liability depends on facts, police/insurance review, and agreement terms.",
                "insurance, accident, deductible, damages, personal insurance, no insurance, accident report, roadside accident, claim, responsible for damage",
                "PUBLIC",
            ),
            (
                "Vehicle rules and availability FAQ",
                "Available cars, cleaning, inspections, SUVs, EVs, vans, pets, and smoking.",
                "Q: What cars are available? A: Search results show current available inventory and daily rates. Q: Are vehicles cleaned before rental? A: Vehicles should be prepared before pickup; report concerns immediately. Q: Are vehicles inspected? A: Vehicles are reviewed before/after rentals according to provider processes. Q: Do you offer SUVs? A: SUV inventory appears when available. Q: Do you offer electric vehicles? A: Electric options appear when available, like EV badges or fuel type Electric. Q: Do you offer luxury cars? A: Luxury inventory depends on market availability. Q: Do you offer vans? A: Vans appear when available. Q: Are pets allowed? A: Pet rules depend on provider agreement and may require cleaning review. Q: Is smoking allowed? A: Smoking is not allowed and can lead to cleaning or smoking fees.",
                "available cars, cleaned vehicles, inspected vehicles, SUV, electric vehicles, luxury cars, vans, pets allowed, smoking allowed, vehicle rules",
                "PUBLIC",
            ),
            (
                "Fees, tolls, tickets, and roadside FAQ",
                "Smoking fee, cleaning fee, keys, tires, windshield, tolls, citations, and breakdown help.",
                "Q: What is the smoking fee? A: Smoking fees depend on cleaning/damage review and agreement terms. Q: What is the cleaning fee? A: Cleaning fees apply for excessive dirt, smoke, pet mess, spills, or misuse. Q: What happens if I lose the keys? A: Lost keys can create replacement, towing, downtime, and admin charges. Q: What happens if I damage a tire? A: Tire damage may be renter responsibility unless covered by terms. Q: What happens if I damage the windshield? A: Glass damage is reviewed under insurance/agreement responsibility. Q: What is the late return fee? A: Late fees depend on provider rules and length of delay. Q: What happens if I run out of fuel? A: You may need roadside help and may be responsible for fuel/service charges. Q: Who pays tolls? A: The renter is responsible for tolls during the rental. Q: Who pays parking tickets? A: The renter is responsible for parking tickets. Q: Who pays traffic tickets? A: The renter is responsible for traffic citations. Q: What happens if I receive a citation? A: Report it and pay/resolve according to instructions. Q: Why was I charged after returning the vehicle? A: Post-return charges can include tolls, tickets, fuel, cleaning, damage, late return, or admin fees. Q: What do I do if the car breaks down? A: Move to safety and contact support/provider roadside assistance. Q: What do I do if I lock the keys inside? A: Contact support/provider roadside assistance. Q: What do I do if I get a flat tire? A: Stop safely, contact roadside assistance, and document the issue. Q: What do I do if the battery dies? A: Contact roadside assistance. Q: What do I do if I run out of gas? A: Get to safety and contact roadside/support.",
                "smoking fee, cleaning fee, lost keys, tire damage, windshield damage, late return fee, fuel, tolls, parking tickets, traffic tickets, citation, charged after return, breakdown, locked keys, flat tire, battery dies, roadside assistance",
                "PUBLIC",
            ),
            (
                "Explorer FAQ",
                "Quests, stop selection, XP, badges, cities, uploads, reels, and rewards.",
                "Q: What is FairFares Explorer? A: Explorer is a personal travel guide that turns a rental into routes, timed stops, memories, XP, and badges. Q: How does Explorer work? A: Choose vibes, city, timing, and trip context; Explorer generates stops with weather and timing guidance. Q: How do I start a quest? A: Open Explorer, choose preferences, and generate a quest. Q: How are quest locations selected? A: Stops are selected from vibe, timing, travel style, available place data, and local context. Q: Can I create my own quest? A: Custom quest options can be supported through Explorer preferences and future tools. Q: How do I earn XP? A: Complete stops, check in, upload memories, and finish challenges. Q: What are Explorer badges? A: Badges mark achievements such as first quest, hidden gems, or repeat exploring. Q: How do I unlock new cities? A: Progress, XP, and future city availability can unlock more areas. Q: Can I upload photos? A: Yes, memory uploads can attach trip proof and profile photos. Q: Can I upload reels? A: Reels/video proof can be part of memory challenges when supported. Q: How do Explorer rewards work? A: Rewards are tied to XP, badges, memory challenges, and FairFares campaigns.",
                "Explorer, FairFares Explorer, quest, quest locations, create quest, XP, badges, unlock cities, upload photos, upload reels, Explorer rewards, memories",
                "PUBLIC",
            ),
            (
                "Price match FAQ",
                "Competitor quotes, screenshots, eligibility, and the additional 10% discount.",
                "Q: How does price matching work? A: Bring a comparable lower quote for the same rental period, location, vehicle class, and terms before pickup. FairFares reviews it and can match eligible quotes. Q: Which competitors qualify? A: Major rental companies such as Avis, Enterprise, Hertz, and comparable providers may qualify when terms match. Q: How do I submit a quote? A: Upload or send the quote through support/admin review before pickup. Q: When do I receive the additional 10% discount? A: After FairFares verifies the comparable quote and approves the match. Q: Can I submit a screenshot? A: Yes, screenshots can help, but they must clearly show provider, dates, vehicle class, price, fees, and terms.",
                "price match, competitors, Avis, Enterprise, Hertz, submit quote, screenshot, additional 10 discount, lower quote",
                "PUBLIC",
            ),
            (
                "Account FAQ",
                "Accounts, password reset, email changes, account deletion, and driver info.",
                "Q: How do I create an account? A: Use Sign in / Join and register with your email. Q: How do I reset my password? A: Use Forgot Password on the login page. Q: How do I change my email? A: Update profile or contact support if verification is required. Q: How do I delete my account? A: Contact support/admin for deletion review, because bookings, receipts, agreements, and legal records may need retention. Q: How do I update my driver information? A: Use Manage Booking/profile details or upload required documents when available.",
                "account, create account, reset password, change email, delete account, update driver information, profile",
                "PUBLIC",
            ),
            (
                "Marketplace and future host program FAQ",
                "Future owner/host questions about listing cars, pricing, screening, damage, insurance, and payouts.",
                "Q: Can I list my car on FairFares? A: A future host marketplace can allow owners to list vehicles after eligibility, insurance, and screening rules are ready. Q: How much can I earn? A: Earnings would depend on vehicle type, market demand, price, availability, and utilization. Q: How do I set pricing? A: FairFares can suggest prices from market data, vehicle class, season, and demand. Q: How does FairFares suggest prices? A: Suggested pricing can consider location, demand, competitor rates, vehicle age, class, fuel type, and availability. Q: What insurance is required? A: Host insurance requirements must be approved before launch. Q: How are renters screened? A: Screening can include identity, license, payment, booking history, and risk checks. Q: What happens if my vehicle is damaged? A: Damage handling would follow host agreement, insurance, photos, renter responsibility, and claims review. Q: How do I get paid? A: Host payouts would follow completed rental, inspection, fees, claims, and payout schedule.",
                "marketplace, host program, list my car, host earnings, set pricing, suggested prices, host insurance, renter screening, vehicle damaged, host payout",
                "PUBLIC",
            ),
            (
                "Assistant actions and safety",
                "What the FairFares Assistant can answer or help start, and what still needs confirmation.",
                "The FairFares Assistant can answer questions using public wiki content, signed-in user booking data, car inventory, and admin-only data when the viewer is an admin. It can guide users to book, cancel, modify, view documents, or contact support, but final actions like payment, cancellation, account changes, and admin changes require the user to confirm in the app.",
                "assistant, AI agent, actions, book through assistant, cancel through assistant, permissions, admin data, user data, safety",
                "PUBLIC",
            ),
        ]
        for article in default_wiki_articles:
            con.execute(
                """
                INSERT INTO wiki_articles (title, subtitle, body, tags, visibility, status)
                SELECT ?, ?, ?, ?, ?, 'PUBLISHED'
                WHERE NOT EXISTS (
                    SELECT 1 FROM wiki_articles WHERE title = ? AND status = 'PUBLISHED'
                )
                """,
                (*article, article[0]),
            )

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
        tax_fee_rule_count = con.execute("SELECT COUNT(*) AS total FROM tax_fee_rules").fetchone()["total"]
        if tax_fee_rule_count == 0:
            con.executemany(
                """
                INSERT INTO tax_fee_rules
                (label, rule_type, value, status, sort_order)
                VALUES (?, ?, ?, 'ACTIVE', ?)
                """,
                [
                    ("CO road safety fee", "DAILY", 2.44, 10),
                    ("CO congestion impact fee", "DAILY", 3.13, 20),
                    ("VLF recovery", "DAILY", 0.20, 30),
                    ("Ownership tax", "PERCENT", 2.0, 40),
                    ("Sales tax", "PERCENT", 4.0, 50),
                    ("Rental tax items", "PERCENT", 7.25, 60),
                ],
            )
        post_return_rule_count = con.execute("SELECT COUNT(*) AS total FROM post_return_fee_rules").fetchone()["total"]
        if post_return_rule_count == 0:
            con.executemany(
                """
                INSERT INTO post_return_fee_rules
                (label, rule_type, value, description, status, sort_order)
                VALUES (?, ?, ?, ?, 'ACTIVE', ?)
                """,
                POST_RETURN_FEE_RULES,
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
                    ("Toyota Corolla", "Toyota", "Corolla", 2025, "Economy", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 29.99, 209.93, "Great Price", "white", "Free Cancellation|Unlimited Mileage|Fuel Efficient", "Denver International Airport (DEN)", "/static/img/toyota-corolla-sedan-denver-rental.png", "AVAILABLE", 1),
                    ("Nissan Sentra", "Nissan", "Sentra", 2025, "Compact", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 34.99, 244.93, "Student Deal", "charcoal", "Free Cancellation|Unlimited Mileage|Hybrid Option", "Denver International Airport (DEN)", "/static/img/nissan-sentra-sedan-denver-rental.png", "AVAILABLE", 2),
                    ("Hyundai Kona", "Hyundai", "Kona", 2025, "SUV", "SUV", "Electric", 5, 3, 4, "Automatic", 46.99, 328.93, "Low Deposit", "blue", "Free Cancellation|Electric Option|24/7 Support", "Denver International Airport (DEN)", "/static/img/hyundai-kona-electric-suv-denver-rental.png", "AVAILABLE", 3),
                    ("Honda Civic", "Honda", "Civic", 2025, "Midsize", "Sedan", "Gasoline", 5, 2, 4, "Automatic", 39.99, 279.93, "Popular", "silver", "Unlimited Mileage|Safe & Reliable|Fuel Efficient", "Denver International Airport (DEN)", "/static/img/honda-civic-sedan-denver-rental.png", "AVAILABLE", 4),
                ],
            )
        con.execute("UPDATE cars SET image_url = '/static/img/toyota-corolla-sedan-denver-rental.png' WHERE name = 'Toyota Corolla' AND image_url IN ('', '/static/img/car-toyota-corolla.png', '/static/img/toyota-corolla-denver-rental.png')")
        con.execute("UPDATE cars SET image_url = '/static/img/nissan-sentra-sedan-denver-rental.png' WHERE name = 'Nissan Sentra' AND image_url IN ('', '/static/img/car-nissan-sentra.png', '/static/img/nissan-sentra-denver-rental.png')")
        con.execute("UPDATE cars SET image_url = '/static/img/hyundai-kona-electric-suv-denver-rental.png' WHERE name = 'Hyundai Kona' AND image_url IN ('', '/static/img/car-hyundai-kona.png', '/static/img/hyundai-kona-denver-suv-rental.png')")
        con.execute("UPDATE cars SET image_url = '/static/img/honda-civic-sedan-denver-rental.png' WHERE name = 'Honda Civic' AND image_url IN ('', '/static/img/car-honda-civic.png', '/static/img/honda-civic-denver-rental.png')")
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
    expire_stale_booking_holds()
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
                       OR (
                           booking_status = 'PENDING_HOLD'
                           AND payment_status = 'HOLD_PENDING'
                           AND hold_expires_at IS NOT NULL
                           AND datetime(hold_expires_at) > datetime('now')
                       )
                    GROUP BY car_id
                ) latest ON latest.latest_id = b.id
            ) active ON active.car_id = cars.id
                    AND UPPER(TRIM(cars.status)) IN ('BOOKED', 'HOLD')
            WHERE UPPER(TRIM(cars.status)) NOT IN ('MAINTENANCE', 'DELETED')
            ORDER BY daily_price ASC, sort_order, id
            """
        ).fetchall()


def split_inventory_locations(value: object) -> list[str]:
    raw = str(value or "")
    primary_parts = [part.strip() for part in re.split(r"[\n;|]+", raw) if part.strip()]
    parts: list[str] = []
    for part in primary_parts:
        comma_parts = [piece.strip() for piece in part.split(",") if piece.strip()]
        has_address_comma = any(re.fullmatch(r"[A-Z]{2}", piece) for piece in comma_parts[1:])
        if len(comma_parts) > 1 and not has_address_comma:
            parts.extend(comma_parts)
        else:
            parts.append(part)
    locations: list[str] = []
    seen: set[str] = set()
    for part in parts:
        key = part.casefold()
        if key in seen:
            continue
        seen.add(key)
        locations.append(part)
    return locations


def normalize_inventory_locations(value: object, fallback: str = "Denver International Airport (DEN)") -> str:
    locations = split_inventory_locations(value)
    return "\n".join(locations) if locations else fallback


def primary_inventory_location(value: object, fallback: str = "Denver International Airport (DEN)") -> str:
    locations = split_inventory_locations(value)
    return locations[0] if locations else fallback


def get_inventory_locations() -> list[str]:
    with db() as con:
        rows = con.execute(
            """
            SELECT DISTINCT location FROM cars
            WHERE location != ''
              AND UPPER(TRIM(status)) != 'DELETED'
            ORDER BY location
            """
        ).fetchall()
    locations: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for location in split_inventory_locations(row["location"]):
            key = location.casefold()
            if key in seen:
                continue
            seen.add(key)
            locations.append(location)
    return sorted(locations, key=str.casefold)


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


def calculate_booking_discount_amount(daily_price: object, days: object, discount: sqlite3.Row | None) -> float:
    if not discount:
        return 0.0
    pre_discount = rental_price_breakdown(daily_price, days, 0)
    return calculate_discount_amount(float(pre_discount["total"]), discount)


def format_money(value: object) -> str:
    return f"${float(value or 0):.2f}"


def rental_day_count(start: datetime | None, end: datetime | None, fallback: object = 1) -> int:
    if start and end and end > start:
        seconds = (end - start).total_seconds()
        return max(1, min(math.ceil(seconds / 86400), 366))
    return max(1, min(int(float(fallback or 1)), 366))


def normalize_booking_window(
    days: object = 10,
    pickup_date: str = "",
    return_date: str = "",
    pickup_time: str = "10:00 AM",
    return_time: str = "10:00 AM",
    *,
    strict: bool = True,
) -> tuple[str, str, str, str, int, datetime, datetime]:
    default_pickup, default_return = default_trip_dates()
    pickup_date = (pickup_date or default_pickup).strip()
    pickup_time = (pickup_time or "10:00 AM").strip()
    return_time = (return_time or "10:00 AM").strip()
    requested_start = parse_booking_datetime(pickup_date, pickup_time)
    if not return_date:
        try:
            fallback_days = max(1, min(int(float(days or 10)), 366))
        except (TypeError, ValueError):
            fallback_days = 10
        if requested_start:
            return_date = (requested_start.date() + timedelta(days=fallback_days)).isoformat()
        else:
            return_date = default_return
    return_date = return_date.strip()
    requested_start = parse_booking_datetime(pickup_date, pickup_time)
    requested_end = parse_booking_datetime(return_date, return_time)
    if not requested_start or not requested_end:
        if strict:
            raise ValueError("Please select valid pickup and return dates.")
        pickup_date, return_date = default_pickup, default_return
        pickup_time, return_time = "10:00 AM", "10:00 AM"
        requested_start = parse_booking_datetime(pickup_date, pickup_time)
        requested_end = parse_booking_datetime(return_date, return_time)
    if not requested_start or not requested_end:
        raise ValueError("Please select valid pickup and return dates.")
    if requested_start.date() < date.today():
        if strict:
            raise ValueError("Pickup date cannot be in the past.")
        pickup_date, return_date = default_pickup, default_return
        pickup_time, return_time = "10:00 AM", "10:00 AM"
        requested_start = parse_booking_datetime(pickup_date, pickup_time)
        requested_end = parse_booking_datetime(return_date, return_time)
    if not requested_start or not requested_end or requested_end <= requested_start:
        if strict:
            raise ValueError("Return date and time must be after pickup date and time.")
        pickup_date, return_date = default_pickup, default_return
        pickup_time, return_time = "10:00 AM", "10:00 AM"
        requested_start = parse_booking_datetime(pickup_date, pickup_time)
        requested_end = parse_booking_datetime(return_date, return_time)
    if not requested_start or not requested_end or requested_end <= requested_start:
        raise ValueError("Return date and time must be after pickup date and time.")
    rental_days = rental_day_count(requested_start, requested_end, days)
    return requested_start.date().isoformat(), requested_end.date().isoformat(), pickup_time, return_time, rental_days, requested_start, requested_end


def daily_price_range(price: object) -> tuple[int, int]:
    daily = float(price or 0)
    average = round(daily)
    low = max(25, average - 5)
    high = max(low, average + 5)
    return min(low, high), max(low, high)


BOOKING_HOLD_RATE = 0.10
DURATION_DISCOUNT_TIERS = (
    (30, 0.30, "Monthly rate"),
    (7, 0.15, "Weekly rate"),
)


def full_payment_total(total: object) -> float:
    return round(max(0.0, float(total or 0) - FULL_PAYMENT_DISCOUNT_AMOUNT), 2)


def duration_discount_for_days(days: object) -> dict[str, object]:
    rental_days = max(1, min(int(float(days or 1)), 366))
    for minimum_days, rate, label in DURATION_DISCOUNT_TIERS:
        if rental_days >= minimum_days:
            return {"rate": rate, "label": label, "days": rental_days}
    return {"rate": 0.0, "label": "Standard rate", "days": rental_days}


def duration_savings_label(daily_price: object, days: object) -> str:
    tier = duration_discount_for_days(days)
    rate = float(tier["rate"] or 0)
    rental_days = int(tier["days"] or 1)
    if rate <= 0:
        return "Daily rate applies for 1-6 day rentals."
    standard_base = round(float(daily_price or 0) * rental_days, 2)
    savings = round(standard_base * rate, 2)
    return f"{tier['label']} applied: save {format_money(savings)} vs standard daily pricing."


MARKET_COMPARISON_RATE = 0.12
DEFAULT_TAX_FEE_RULES = (
    {"label": "CO road safety fee", "rule_type": "DAILY", "value": 2.44, "sort_order": 10},
    {"label": "CO congestion impact fee", "rule_type": "DAILY", "value": 3.13, "sort_order": 20},
    {"label": "VLF recovery", "rule_type": "DAILY", "value": 0.20, "sort_order": 30},
    {"label": "Ownership tax", "rule_type": "PERCENT", "value": 2.0, "sort_order": 40},
    {"label": "Sales tax", "rule_type": "PERCENT", "value": 4.0, "sort_order": 50},
    {"label": "Rental tax items", "rule_type": "PERCENT", "value": 7.25, "sort_order": 60},
)


def get_active_tax_fee_rules() -> list[sqlite3.Row] | list[dict[str, object]]:
    try:
        with db() as con:
            con.execute("SELECT 1 FROM tax_fee_rules LIMIT 1").fetchone()
            rules = con.execute(
                """
                SELECT * FROM tax_fee_rules
                WHERE UPPER(TRIM(status)) = 'ACTIVE'
                ORDER BY sort_order, label
                """
            ).fetchall()
            return rules or list(DEFAULT_TAX_FEE_RULES)
    except sqlite3.Error:
        return list(DEFAULT_TAX_FEE_RULES)


def get_all_tax_fee_rules() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM tax_fee_rules
            ORDER BY sort_order, label
            """
        ).fetchall()


def get_active_post_return_fee_rules() -> list[sqlite3.Row] | list[dict[str, object]]:
    try:
        with db() as con:
            con.execute("SELECT 1 FROM post_return_fee_rules LIMIT 1").fetchone()
            rules = con.execute(
                """
                SELECT * FROM post_return_fee_rules
                WHERE UPPER(TRIM(status)) = 'ACTIVE'
                ORDER BY sort_order, label
                """
            ).fetchall()
            if rules:
                return rules
    except sqlite3.Error:
        pass
    return [
        {"label": label, "rule_type": rule_type, "value": value, "description": description, "sort_order": sort_order}
        for label, rule_type, value, description, sort_order in POST_RETURN_FEE_RULES
    ]


def get_all_post_return_fee_rules() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT * FROM post_return_fee_rules
            ORDER BY sort_order, label
            """
        ).fetchall()


def tax_fee_rule_value(rule: sqlite3.Row | dict[str, object], key: str, default: object = "") -> object:
    if isinstance(rule, sqlite3.Row):
        return rule[key] if key in rule.keys() and rule[key] is not None else default
    return rule.get(key, default)


def post_return_fee_rule_summary() -> str:
    parts = []
    for rule in get_active_post_return_fee_rules():
        label = str(tax_fee_rule_value(rule, "label", "Fee")).strip()
        rule_type = str(tax_fee_rule_value(rule, "rule_type", "FLAT")).strip().upper()
        value = float(tax_fee_rule_value(rule, "value", 0) or 0)
        if rule_type == "PER_MILE":
            amount = f"{format_money(value)}/mile"
        elif rule_type == "DAILY":
            amount = f"{format_money(value)}/day"
        else:
            amount = format_money(value)
        parts.append(f"{label}: {amount}")
    return "; ".join(parts)


def rental_price_breakdown(daily_price: object, days: object, discount_amount: object = 0) -> dict[str, object]:
    rental_days = max(1, min(int(float(days or 1)), 366))
    daily = round(float(daily_price or 0), 2)
    standard_base = round(daily * rental_days, 2)
    duration_tier = duration_discount_for_days(rental_days)
    duration_discount_rate = float(duration_tier["rate"] or 0)
    duration_discount_amount = round(standard_base * duration_discount_rate, 2)
    base = round(max(0.0, standard_base - duration_discount_amount), 2)
    effective_daily = round(base / rental_days, 2) if rental_days else daily
    tax_fee_lines = []
    for rule in get_active_tax_fee_rules():
        label = str(tax_fee_rule_value(rule, "label", "Tax or fee")).strip() or "Tax or fee"
        rule_type = str(tax_fee_rule_value(rule, "rule_type", "DAILY")).strip().upper()
        value = max(0.0, float(tax_fee_rule_value(rule, "value", 0) or 0))
        if rule_type == "PERCENT":
            amount = round(base * (value / 100), 2)
        elif rule_type == "FLAT":
            amount = round(value, 2)
        else:
            amount = round(value * rental_days, 2)
        if amount > 0:
            tax_fee_lines.append((label, amount))
    tax_fee_amount = round(sum(amount for _, amount in tax_fee_lines), 2)
    discount = round(max(0.0, min(float(discount_amount or 0), base + tax_fee_amount)), 2)
    total = round(max(0.0, base + tax_fee_amount - discount), 2)
    booking_hold = round(total * BOOKING_HOLD_RATE, 2)
    due_at_pickup = round(max(0.0, total - booking_hold), 2)
    market_total = round(total * (1 + MARKET_COMPARISON_RATE), 2)
    savings = round(max(0.0, market_total - total + discount), 2)
    return {
        "daily": daily,
        "effective_daily": effective_daily,
        "days": rental_days,
        "weeks": rental_days // 7,
        "extra_days": rental_days % 7,
        "standard_base": standard_base,
        "base": base,
        "duration_discount_rate": duration_discount_rate,
        "duration_discount_label": duration_tier["label"],
        "duration_discount_amount": duration_discount_amount,
        "tax_fee_amount": tax_fee_amount,
        "tax_fee_lines": tax_fee_lines,
        "discount_amount": discount,
        "total": total,
        "booking_hold": booking_hold,
        "due_at_pickup": due_at_pickup,
        "market_total": market_total,
        "savings": savings,
    }


def tax_fee_breakdown_html(breakdown: dict[str, object], label: str = "Taxes & fees") -> str:
    lines = breakdown.get("tax_fee_lines") or []
    line_items = "".join(
        f"<li><span>{escape(str(name))}</span><b>{escape(format_money(amount))}</b></li>"
        for name, amount in lines  # type: ignore[assignment]
    )
    if not line_items:
        line_items = "<li><span>No tax or fee lines</span><b>$0.00</b></li>"
    total = escape(format_money(breakdown.get("tax_fee_amount") or 0))
    return f"""
        <span class="tax-fee-detail" tabindex="0" aria-label="{escape(label)} breakdown">
            <b>{total}</b><span class="tax-fee-label">{escape(label)}</span>
            <span class="tax-fee-tooltip" role="tooltip">
                <strong>Taxes & fees breakdown</strong>
                <ul>{line_items}</ul>
                <span class="tax-fee-total"><span>Total</span><b>{total}</b></span>
            </span>
        </span>
    """


def duration_discount_breakdown_html(breakdown: dict[str, object]) -> str:
    amount = float(breakdown.get("duration_discount_amount") or 0)
    if amount <= 0:
        return ""
    label = str(breakdown.get("duration_discount_label") or "Duration rate")
    rate = float(breakdown.get("duration_discount_rate") or 0)
    return (
        f'<span class="price-line is-discount duration-discount-row">'
        f'<span class="price-line-amount">-{escape(format_money(amount))}</span>'
        f'<span class="price-line-label">{escape(label)} savings'
        f'<small>{rate:.0%} lower effective daily rate</small></span></span>'
    )


def rental_subtotal_breakdown_html(breakdown: dict[str, object]) -> str:
    duration_line = duration_discount_breakdown_html(breakdown)
    if not duration_line:
        return f'<span><b>{escape(format_money(breakdown["base"]))}</b>Rental subtotal</span>'
    return (
        f'<span><b>{escape(format_money(breakdown["standard_base"]))}</b>Standard rental subtotal</span>'
        f'{duration_line}'
        f'<span class="price-line duration-subtotal-row">'
        f'<span class="price-line-amount">{escape(format_money(breakdown["base"]))}</span>'
        f'<span class="price-line-label">Discounted rental subtotal</span></span>'
    )


def expire_stale_booking_holds() -> None:
    with db() as con:
        expired_rows = con.execute(
            """
            SELECT id, car_id
            FROM bookings
            WHERE booking_status = 'PENDING_HOLD'
              AND payment_status = 'HOLD_PENDING'
              AND hold_expires_at IS NOT NULL
              AND datetime(hold_expires_at) <= datetime('now')
            """
        ).fetchall()
        if not expired_rows:
            return
        expired_ids = [row["id"] for row in expired_rows]
        expired_car_ids = {row["car_id"] for row in expired_rows}
        placeholders = ",".join("?" for _ in expired_ids)
        con.execute(
            f"""
            UPDATE bookings
            SET booking_status = 'EXPIRED_HOLD',
                status = 'EXPIRED_HOLD',
                payment_status = 'HOLD_EXPIRED'
            WHERE id IN ({placeholders})
            """,
            expired_ids,
        )
        for car_id in expired_car_ids:
            con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ? AND UPPER(TRIM(status)) = 'HOLD'", (car_id,))


def booking_price_breakdown(row: sqlite3.Row | dict[str, object] | None) -> dict[str, object]:
    if not row:
        return rental_price_breakdown(0, 1, 0)
    daily = row_value(row, "daily_price")
    if not daily:
        days = max(1, int(float(row_value(row, "days") or 1)))
        subtotal = float(row_value(row, "subtotal_price") or row_value(row, "total_price") or 0)
        daily = subtotal / days if days else subtotal
    discount = float(row_value(row, "discount_amount") or 0)
    breakdown = rental_price_breakdown(daily, row_value(row, "days") or 1, discount)
    stored_total = float(row_value(row, "total_price") or 0)
    has_stored_breakdown = any(
        float(row_value(row, key) or 0) > 0
        for key in ("tax_fee_amount", "booking_hold_amount", "due_at_pickup_amount", "estimated_market_total")
    )
    has_admin_total_adjustment = any(
        float(row_value(row, key) or 0) > 0
        for key in ("late_fee_amount", "price_match_amount", "price_match_discount_amount")
    )
    if has_stored_breakdown and has_admin_total_adjustment and stored_total and abs(stored_total - float(breakdown["total"])) > 0.01:
        hold = float(row_value(row, "booking_hold_amount") or round(stored_total * BOOKING_HOLD_RATE, 2))
        tax_fee = float(row_value(row, "tax_fee_amount") or max(0, stored_total - float(breakdown["base"]) + discount))
        breakdown.update(
            {
                "tax_fee_amount": round(tax_fee, 2),
                "total": round(stored_total, 2),
                "booking_hold": round(hold, 2),
                "due_at_pickup": round(max(0.0, stored_total - hold), 2),
                "market_total": round(float(row_value(row, "estimated_market_total") or stored_total * (1 + MARKET_COMPARISON_RATE)), 2),
                "savings": round(float(row_value(row, "fairfares_savings_amount") or max(0.0, stored_total * MARKET_COMPARISON_RATE + discount)), 2),
            }
        )
    if row_value(row, "payment_status") == "PAID":
        breakdown.update({"booking_hold": 0.0, "due_at_pickup": 0.0})
    return breakdown


def confirm_booking_hold_payment(
    booking_id: int,
    amount: float,
    payment_method: str = "Stripe Checkout",
    cardholder_name: str = "Stripe customer",
    invoice_number: str = "",
    origin: str = "",
    payment_option: str = "hold",
) -> tuple[bool, str]:
    invoice_number = invoice_number or f"HOLD-{secrets.randbelow(900000) + 100000}"
    payment_option = "full" if payment_option == "full" else "hold"
    with db() as con:
        booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        if not booking:
            return False, "Booking not found."
        current_payment_status = row_value(booking, "payment_status")
        if current_payment_status == "PAID" or (current_payment_status == "HOLD_PAID" and payment_option != "full"):
            return True, "Booking payment already recorded."
        breakdown = booking_price_breakdown(booking)
        paid_amount = round(float(amount or (full_payment_total(breakdown["total"]) if payment_option == "full" else breakdown["booking_hold"])), 2)
        next_payment_status = "PAID" if payment_option == "full" else "HOLD_PAID"
        next_transaction_status = "PAID" if payment_option == "full" else "HOLD_PAID"
        next_billing_note = "Payment confirmed by Stripe checkout."
        next_discount = float(row_value(booking, "discount_amount") or 0)
        next_total = float(row_value(booking, "total_price") or breakdown["total"] or 0)
        next_hold_amount = paid_amount
        next_due_at_pickup = float(breakdown["due_at_pickup"])
        if payment_option == "full":
            if current_payment_status != "HOLD_PAID":
                next_discount = round(next_discount + FULL_PAYMENT_DISCOUNT_AMOUNT, 2)
                next_total = full_payment_total(next_total)
            next_hold_amount = 0.0
            next_due_at_pickup = 0.0
            next_billing_note = (
                "Remaining pickup balance paid by Stripe checkout."
                if current_payment_status == "HOLD_PAID"
                else "Full payment confirmed by Stripe checkout with $10 pickup discount."
            )
        while con.execute("SELECT 1 FROM transactions WHERE invoice_number = ?", (invoice_number,)).fetchone():
            invoice_number = f"HOLD-{secrets.randbelow(900000) + 100000}"
        con.execute(
            """
            INSERT INTO transactions
            (booking_id, payment_method, cardholder_name, amount, transaction_status, billing_verification_status, billing_verification_notes, invoice_number)
            VALUES (?, ?, ?, ?, ?, 'MATCHED', ?, ?)
            """,
            (booking_id, payment_method, cardholder_name, paid_amount, next_transaction_status, next_billing_note, invoice_number),
        )
        con.execute(
            """
            UPDATE bookings
            SET payment_status = ?,
                booking_status = 'CONFIRMED',
                status = 'CONFIRMED',
                discount_amount = ?,
                total_price = ?,
                booking_hold_amount = ?,
                due_at_pickup_amount = ?,
                hold_expires_at = NULL
            WHERE id = ?
            """,
            (next_payment_status, next_discount, next_total, next_hold_amount, next_due_at_pickup, booking_id),
        )
        con.execute("UPDATE cars SET status = 'BOOKED' WHERE id = ?", (booking["car_id"],))
    notify_slack_payment(
        booking,
        f"{'Full payment' if payment_option == 'full' else '10% hold'} paid by Stripe: {format_money(paid_amount)}",
    )
    send_confirmed_booking_email_once(booking_id, origin)
    return True, invoice_number


def create_pickup_balance_payment_intent(booking: sqlite3.Row, admin: sqlite3.Row) -> tuple[dict[str, object], str]:
    if row_value(booking, "payment_status") != "HOLD_PAID":
        return {}, "Pickup balance can only be collected after the 10% hold is paid."
    if row_value(booking, "booking_status") in {"CANCELLED", "CANCELLATION_REQUESTED", "RETURNED"}:
        return {}, "This booking cannot accept pickup balance payment."
    breakdown = booking_price_breakdown(booking)
    pickup_balance = round(float(breakdown["due_at_pickup"] or 0), 2)
    if pickup_balance <= 0:
        return {}, "No pickup balance is due for this booking."
    amount_cents = int(round(pickup_balance * 100))
    public_booking_id = row_value(booking, "booking_id")
    params = {
        "amount": amount_cents,
        "currency": "usd",
        "payment_method_types[]": "card_present",
        "capture_method": "automatic",
        "description": f"FairFares pickup balance - {public_booking_id}",
        "metadata[payment_option]": "pickup_balance",
        "metadata[booking_id]": row_value(booking, "id"),
        "metadata[public_booking_id]": public_booking_id,
        "metadata[user_id]": row_value(booking, "user_id"),
        "metadata[created_by_admin_id]": row_value(admin, "id"),
        "metadata[created_by_admin_email]": row_value(admin, "email"),
        "receipt_email": row_value(booking, "contact_email"),
    }
    payment_intent, status = stripe_api_request(
        "payment_intents",
        params,
        idempotency_key=f"pickup-balance-{row_value(booking, 'id')}-{amount_cents}",
    )
    if status != "ok":
        return {}, status
    return payment_intent, "ok"


def create_security_deposit_payment_intent(booking: sqlite3.Row, admin: sqlite3.Row) -> tuple[dict[str, object], str]:
    if row_value(booking, "payment_status") not in {"HOLD_PAID", "PAID"}:
        return {}, "Security deposit can be authorized after the 10% hold or full payment is recorded."
    if row_value(booking, "booking_status") in {"CANCELLED", "CANCELLATION_REQUESTED", "RETURNED"}:
        return {}, "This booking cannot accept a security deposit authorization."
    amount_cents = int(round(SECURITY_DEPOSIT_AMOUNT * 100))
    public_booking_id = row_value(booking, "booking_id")
    params = {
        "amount": amount_cents,
        "currency": "usd",
        "payment_method_types[]": "card_present",
        "capture_method": "manual",
        "description": f"FairFares refundable security deposit - {public_booking_id}",
        "metadata[payment_option]": "security_deposit",
        "metadata[booking_id]": row_value(booking, "id"),
        "metadata[public_booking_id]": public_booking_id,
        "metadata[user_id]": row_value(booking, "user_id"),
        "metadata[created_by_admin_id]": row_value(admin, "id"),
        "metadata[created_by_admin_email]": row_value(admin, "email"),
        "metadata[deposit_release_policy]": "release_after_return_review",
        "receipt_email": row_value(booking, "contact_email"),
    }
    payment_intent, status = stripe_api_request(
        "payment_intents",
        params,
        idempotency_key=f"security-deposit-{row_value(booking, 'id')}-{amount_cents}",
    )
    if status != "ok":
        return {}, status
    return payment_intent, "ok"


def record_security_deposit_authorization(data_object: dict[str, object]) -> tuple[bool, str]:
    metadata = data_object.get("metadata") if isinstance(data_object.get("metadata"), dict) else {}
    if metadata.get("payment_option") != "security_deposit":
        return False, "Not a FairFares security deposit authorization."
    try:
        booking_id = int(metadata.get("booking_id") or "0")
    except (TypeError, ValueError):
        booking_id = 0
    if not booking_id:
        return False, "Missing booking metadata."
    payment_reference = str(data_object.get("id") or "")
    if not payment_reference:
        return False, "Missing Stripe payment reference."
    amount = float(data_object.get("amount_capturable") or data_object.get("amount") or 0) / 100
    if amount <= 0:
        amount = SECURITY_DEPOSIT_AMOUNT
    with db() as con:
        if con.execute("SELECT 1 FROM transactions WHERE invoice_number = ?", (payment_reference,)).fetchone():
            return True, "Security deposit authorization already recorded."
        con.execute(
            """
            INSERT INTO transactions
            (booking_id, payment_method, cardholder_name, amount, transaction_status, billing_verification_status, billing_verification_notes, invoice_number)
            VALUES (?, 'Stripe Terminal / Tap to Pay deposit', 'Stripe in-person customer', ?, 'SECURITY_DEPOSIT_AUTHORIZED', 'MATCHED', ?, ?)
            """,
            (booking_id, round(amount, 2), SECURITY_DEPOSIT_RELEASE_COPY, payment_reference),
        )
        con.execute(
            """
            UPDATE bookings
            SET security_deposit_status = 'AUTHORIZED',
                security_deposit_amount = ?,
                security_deposit_payment_intent_id = ?,
                return_review_status = CASE
                    WHEN return_review_status = '' OR return_review_status = 'PENDING' THEN 'PENDING'
                    ELSE return_review_status
                END
            WHERE id = ?
            """,
            (round(amount, 2), payment_reference, booking_id),
        )
    return True, payment_reference


def confirm_pickup_balance_payment_intent(data_object: dict[str, object], origin: str = "") -> tuple[bool, str]:
    metadata = data_object.get("metadata") if isinstance(data_object.get("metadata"), dict) else {}
    if metadata.get("payment_option") not in {"pickup_balance", "terminal_pickup_balance"}:
        return False, "Not a FairFares pickup balance payment."
    try:
        booking_id = int(metadata.get("booking_id") or "0")
    except (TypeError, ValueError):
        booking_id = 0
    if not booking_id:
        return False, "Missing booking metadata."
    paid_amount = float(data_object.get("amount_received") or data_object.get("amount") or 0) / 100
    payment_reference = str(data_object.get("id") or "")
    return confirm_booking_hold_payment(
        booking_id,
        paid_amount,
        "Stripe Terminal / Tap to Pay",
        "Stripe in-person customer",
        payment_reference,
        origin,
        "full",
    )


def stripe_refund_payment_reference(
    payment_reference: str,
    booking_id: int,
    amount: object,
    idempotency_key: str,
) -> tuple[bool, str, str]:
    payment_reference = (payment_reference or "").strip()
    if not payment_reference:
        return False, "No Stripe payment reference saved.", ""
    amount_cents = int(round(max(0.0, float(amount or 0)) * 100))
    if amount_cents <= 0:
        return False, "Stored Stripe transaction amount is not refundable.", ""
    refund_params: dict[str, object] = {
        "amount": amount_cents,
        "metadata[booking_id]": booking_id,
        "metadata[source]": "fairfares_auto_cancellation",
    }
    if payment_reference.startswith("pi_"):
        refund_params["payment_intent"] = payment_reference
    elif payment_reference.startswith("ch_"):
        refund_params["charge"] = payment_reference
    elif payment_reference.startswith("cs_"):
        session, status = stripe_api_get(f"checkout/sessions/{urllib.parse.quote(payment_reference)}")
        if not session:
            return False, status, ""
        payment_intent = str(session.get("payment_intent") or "")
        if not payment_intent:
            return False, "Stripe checkout session has no payment intent.", ""
        refund_params["payment_intent"] = payment_intent
    else:
        return False, "Payment was not created by Stripe Checkout.", ""
    refund, status = stripe_api_request("refunds", refund_params, idempotency_key=idempotency_key)
    refund_id = str(refund.get("id") or "")
    refund_status = str(refund.get("status") or "")
    if refund_id:
        return True, f"Stripe refund {refund_id} created{(' (' + refund_status + ')') if refund_status else ''}.", refund_id
    return False, status, ""


def auto_refund_booking_payments(booking_id: int) -> tuple[str, str]:
    with db() as con:
        transactions = con.execute(
            """
            SELECT *
            FROM transactions
            WHERE booking_id = ?
              AND transaction_status IN ('PAID', 'HOLD_PAID')
              AND invoice_number != ''
              AND payment_method = 'Stripe Checkout'
              AND amount > 0
              AND substr(invoice_number, 1, 3) IN ('pi_', 'ch_', 'cs_')
            ORDER BY id ASC
            """,
            (booking_id,),
        ).fetchall()
    if not transactions:
        return "REFUND_REVIEW", "No paid Stripe transaction was found for automatic refund."

    refunded_count = 0
    details: list[str] = []
    for transaction in transactions:
        idempotency_key = f"fairfares-refund-booking-{booking_id}-txn-{row_value(transaction, 'id')}"
        ok, message, refund_id = stripe_refund_payment_reference(
            row_value(transaction, "invoice_number"),
            booking_id,
            row_value(transaction, "amount"),
            idempotency_key,
        )
        details.append(message)
        with db() as con:
            con.execute(
                """
                UPDATE transactions
                SET transaction_status = ?,
                    billing_verification_status = ?,
                    billing_verification_notes = ?
                WHERE id = ?
                """,
                (
                    "REFUNDED" if ok else "REFUND_REVIEW",
                    "REFUNDED" if ok else "REVIEW_REQUIRED",
                    f"{message}{(' Original payment: ' + row_value(transaction, 'invoice_number')) if ok else ''}",
                    row_value(transaction, "id"),
                ),
            )
        if ok:
            refunded_count += 1

    if refunded_count == len(transactions):
        return "REFUNDED", f"Refunded {refunded_count} Stripe payment{'s' if refunded_count != 1 else ''} automatically."
    if refunded_count:
        return "REFUND_REVIEW", f"Refunded {refunded_count} of {len(transactions)} Stripe payments. Admin review needed: {' '.join(details)}"
    return "REFUND_REVIEW", f"Automatic refund could not be completed. Admin review needed: {' '.join(details)}"


def refund_passcode_configured() -> bool:
    return bool(os.environ.get("FAIRFARES_REFUND_PASSCODE", "").strip())


def verify_refund_passcode(value: str) -> bool:
    expected = os.environ.get("FAIRFARES_REFUND_PASSCODE", "").strip()
    provided = (value or "").strip()
    return bool(expected and provided and hmac.compare_digest(provided, expected))


def booking_refund_allowed(booking: sqlite3.Row | dict[str, object] | None) -> tuple[bool, str]:
    if not booking:
        return False, "Booking not found."
    if row_value(booking, "payment_status") == "REFUNDED":
        return False, "This booking is already refunded."
    if row_value(booking, "booking_status") not in {"CANCELLED", "CANCELLATION_REQUESTED", "EXPIRED_HOLD"}:
        return False, "Refunds are limited to cancelled, expired, or cancellation-review bookings."
    if row_value(booking, "payment_status") not in {"PAID", "HOLD_PAID", "REFUND_REVIEW"}:
        return False, "This booking has no refundable online payment status."
    return True, ""


def create_manual_refund_task(
    con: sqlite3.Connection,
    booking: sqlite3.Row,
    requester: sqlite3.Row,
    reason: str,
) -> str:
    ticket_id = make_ticket_id()
    while con.execute("SELECT 1 FROM support_tickets WHERE ticket_id = ?", (ticket_id,)).fetchone():
        ticket_id = make_ticket_id()
    message = (
        "P0 manual refund review requested\n"
        f"Booking: {row_value(booking, 'booking_id')}\n"
        f"Customer: {row_value(booking, 'user_name')} - {row_value(booking, 'user_email')}\n"
        f"Payment status: {row_value(booking, 'payment_status')}\n"
        f"Booking status: {row_value(booking, 'booking_status')}\n"
        f"Requested by: {row_value(requester, 'name')} - {row_value(requester, 'email')}\n"
        f"Reason: {reason or 'Manual refund requested by staff.'}"
    )
    con.execute(
        """
        INSERT INTO support_tickets
        (ticket_id, booking_id, user_id, topic, preferred_contact, message, urgent, priority,
         escalated_to_oncall, escalated_by, escalation_reason, escalated_at)
        VALUES (?, ?, ?, 'Manual refund review', 'Admin dashboard', ?, 1, 'P0', 1, ?, 'Staff requested manual refund approval.', CURRENT_TIMESTAMP)
        """,
        (ticket_id, row_value(booking, "id"), row_value(booking, "user_id"), message, row_value(requester, "id")),
    )
    ticket_pk = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
    ticket = con.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_pk,)).fetchone()
    if ticket:
        queue_oncall_escalation_alert(con, ticket, requester, "Staff requested manual refund approval.")
    else:
        queue_support_alerts(con, ticket_pk, ticket_id, "P0", f"P0 FairFares manual refund task {ticket_id}", message)
    return ticket_id


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


def select_options(values: list[str], selected: str = "") -> str:
    normalized_values = []
    for value in [selected, *values]:
        clean = (value or "").strip()
        if clean and clean not in normalized_values:
            normalized_values.append(clean)
    return "".join(
        f'<option value="{escape(value)}" {"selected" if value == selected else ""}>{escape(value)}</option>'
        for value in normalized_values
    )


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


PICKUP_PREFILL_FIELDS = {
    "customer_name": "customer full name",
    "address": "address",
    "date_of_birth": "date of birth",
    "license_number": "driver license number",
    "license_state": "driver license state",
    "license_expiry": "driver license expiration",
    "insurance_provider": "insurance provider",
    "insurance_type": "insurance coverage/type",
    "coverage_amount": "insurance coverage amount",
}


def clean_pickup_prefill_value(field: str, value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        return ""
    if field in {"date_of_birth", "license_expiry"}:
        match = re.search(r"\d{4}-\d{2}-\d{2}", text)
        return match.group(0) if match else ""
    if field == "license_state":
        match = re.search(r"\b[A-Za-z]{2}\b", text)
        return match.group(0).upper() if match else ""
    if field == "coverage_amount":
        match = re.search(r"\d+(?:,\d{3})*(?:\.\d{1,2})?", text)
        return match.group(0).replace(",", "") if match else ""
    return text[:240]


def parse_json_object(text: str) -> dict[str, object]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    parsed = json.loads(cleaned)
    return parsed if isinstance(parsed, dict) else {}


def extract_pickup_prefill_from_images(form: dict[str, str]) -> tuple[dict[str, str], list[str], str]:
    images = []
    for field, label in (
        ("front_image_url", "driver license front"),
        ("back_image_url", "driver license back"),
        ("insurance_document_url", "insurance document"),
    ):
        image = (form.get(field) or "").strip()
        if image.startswith("data:image/") and ";base64," in image and len(image) <= MAX_PROFILE_PHOTO_DATA_URL_LENGTH:
            images.append((label, image))
    if not images:
        return {}, list(PICKUP_PREFILL_FIELDS.values()), "Take or upload DL/insurance photos first."
    if not os.environ.get("OPENAI_API_KEY"):
        return {}, list(PICKUP_PREFILL_FIELDS.values()), "Photo prefill needs OPENAI_API_KEY configured. Enter missing fields manually for now."
    try:
        from openai import OpenAI

        content: list[dict[str, object]] = [
            {
                "type": "text",
                "text": (
                    "Extract pickup form fields from these rental pickup images. "
                    "Return only JSON with keys: fields, missing_fields, notes. "
                    "fields may include customer_name, address, date_of_birth, license_number, "
                    "license_state, license_expiry, insurance_provider, insurance_type, coverage_amount. "
                    "Use YYYY-MM-DD for dates, two-letter US state for license_state, numeric coverage_amount only. "
                    "If a value is unclear, omit it and put the human label in missing_fields. "
                    "Do not guess. This is OCR/prefill only, not authenticity verification."
                ),
            }
        ]
        for label, image in images:
            content.append({"type": "text", "text": f"Image: {label}"})
            content.append({"type": "image_url", "image_url": {"url": image}})
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        response = client.chat.completions.create(
            model=OPENAI_VISION_MODEL,
            messages=[
                {"role": "system", "content": "You extract text from driver license and insurance images for form prefill. Return strict JSON only."},
                {"role": "user", "content": content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        payload = parse_json_object(response.choices[0].message.content or "{}")
        raw_fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
        fields = {
            key: clean_pickup_prefill_value(key, raw_fields.get(key))
            for key in PICKUP_PREFILL_FIELDS
            if clean_pickup_prefill_value(key, raw_fields.get(key))
        }
        missing = payload.get("missing_fields") if isinstance(payload.get("missing_fields"), list) else []
        missing_labels = [str(item).strip() for item in missing if str(item).strip()]
        if not missing_labels:
            missing_labels = [label for key, label in PICKUP_PREFILL_FIELDS.items() if not fields.get(key)]
        notes = str(payload.get("notes") or "").strip()
        return fields, missing_labels, notes or "Review extracted values before saving pickup."
    except Exception as exc:
        return {}, list(PICKUP_PREFILL_FIELDS.values()), f"Could not prefill from photos. Enter missing fields manually. ({exc.__class__.__name__})"


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
    clean_email = normalize_email(email)
    code = referral_signup_discount_code(name, clean_email)
    holder = name.strip() or clean_email or f"User {user_id}"
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
    base = normalize_email(email).split("@")[0] or name or "student"
    cleaned = "".join(char if char.isalnum() else "_" for char in base.upper())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return f"STUDENT_{(cleaned or 'VERIFIED')[:30]}_15"


def student_email_matches_profile_name(profile_name: str, student_email: str) -> bool:
    local_part = normalize_email(student_email).split("@", 1)[0]
    compact_local = re.sub(r"[^a-z0-9]", "", local_part)
    name_tokens = [
        token
        for token in re.findall(r"[a-z0-9]+", (profile_name or "").lower())
        if len(token) >= 2
    ]
    if not compact_local or not name_tokens:
        return False
    meaningful_tokens = [token for token in name_tokens if len(token) >= 3]
    if any(token in compact_local for token in meaningful_tokens):
        return True
    first = name_tokens[0]
    last = name_tokens[-1]
    patterns = {
        f"{first[:1]}{last}",
        f"{first}{last[:1]}",
    }
    return any(pattern and pattern in compact_local for pattern in patterns)


def student_verification_delivery_message(delivery_status: str) -> str:
    if delivery_status.startswith("sent"):
        return "Verification email sent to your .edu inbox. Click the link there to activate the student discount."
    if delivery_status == "not configured":
        return "Student verification email is not configured on the server. Add RESEND_API_KEY and RESEND_FROM, then try again."
    safe_status = re.sub(r"(re_[A-Za-z0-9_-]{12,}|sk_[A-Za-z0-9_-]+)", "[redacted]", delivery_status)
    return f"Student verification email was not delivered. Email provider status: {safe_status[:240]}"


def create_student_discount(user_id: int, name: str, student_email: str) -> str:
    clean_email = normalize_email(student_email)
    code = student_discount_code(name, clean_email)
    holder = name.strip() or clean_email or f"User {user_id}"
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
    clean_email = normalize_email(email)
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
    clean_email = normalize_email(email)
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
    clean_email = normalize_email(referred_email)
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
      <img class="guest-offer-logo" src="/static/img/fairfares-glow-logo.png" alt="FairFares logo">
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


EXPLORER_PLACE_QUERIES = {
    "Food": ["best student friendly food near {city}", "popular restaurants near {city}"],
    "Adventure": ["outdoor adventure near {city}", "unique activities near {city}"],
    "Nature": ["parks and nature near {city}", "scenic nature spots near {city}"],
    "Photography": ["best photo spots near {city}", "instagrammable places near {city}"],
    "Date Night": ["evening date night spots near {city}", "romantic dinner and views near {city}"],
    "Coffee": ["best coffee shops near {city}", "student coffee near {city}"],
    "Scenic Drive": ["scenic overlook near {city}", "scenic drive stops near {city}"],
    "Sunset": ["best evening sunset viewpoint near {city}", "sunset overlook near {city}"],
    "Hidden Gems": ["hidden gems near {city}", "unique local places near {city}"],
    "Music": ["live music near {city}", "music venues near {city}"],
    "Shopping": ["shopping district near {city}", "local shops near {city}"],
    "Surprise Me": ["top things to do near {city}", "best attractions near {city}"],
}


MOOD_TIME_RULES = {
    "Food": ("Any time", "Works for lunch, dinner, or a snack stop."),
    "Coffee": ("Morning to afternoon", "Best before 4 PM for study, work, or a quick reset."),
    "Adventure": ("Morning to early afternoon", "Daylight gives you safer trails, parking, and photos."),
    "Nature": ("Morning or golden hour", "Cooler light and calmer crowds make this easier to enjoy."),
    "Photography": ("Golden hour", "Soft light is usually strongest shortly after sunrise or before sunset."),
    "Date Night": ("Evening", "Built for dinner, lights, music, and relaxed night plans."),
    "Scenic Drive": ("Daylight or sunset", "Go while roads and overlooks are easy to see."),
    "Sunset": ("Sunset window", "Arrive 30-45 minutes before sunset and stay for blue hour."),
    "Hidden Gems": ("Late morning to evening", "Flexible, but verify hours for smaller local spots."),
    "Music": ("Evening", "Most venues and performances are strongest at night."),
    "Shopping": ("Late morning to afternoon", "Best while shops are fully open."),
    "Surprise Me": ("Flexible", "Explorer will adapt the timing to the stop type."),
}

OUTDOOR_MOODS = {"Adventure", "Nature", "Photography", "Scenic Drive", "Sunset"}
INDOOR_FRIENDLY_MOODS = {"Food", "Coffee", "Music", "Shopping", "Date Night"}


def explorer_weather_forecast(city: str, target_date: date | None = None) -> dict[str, object]:
    """Lightweight seasonal forecast until a live weather provider is connected."""
    target_date = target_date or date.today()
    month = target_date.month
    city_name = city.split(",", 1)[0].strip().lower()
    mountain_city = any(name in city_name for name in ["denver", "boulder", "colorado", "salt lake", "reno"])
    desert_city = any(name in city_name for name in ["las vegas", "phoenix", "palm springs"])
    coastal_city = any(name in city_name for name in ["los angeles", "san diego", "san francisco", "seattle"])

    if month in {12, 1, 2}:
        high = 42 if mountain_city else 58 if coastal_city else 50
        low = 22 if mountain_city else 45 if coastal_city else 33
        condition = "Cold"
        rain_chance = 25
    elif month in {3, 4, 5}:
        high = 68 if not desert_city else 82
        low = 42 if mountain_city else 55
        condition = "Mild"
        rain_chance = 30
    elif month in {6, 7, 8}:
        high = 88 if not desert_city else 105
        low = 61 if mountain_city else 76 if desert_city else 65
        condition = "Sunny"
        rain_chance = 18 if not coastal_city else 12
    else:
        high = 66 if mountain_city else 78 if desert_city else 70
        low = 40 if mountain_city else 58
        condition = "Cool"
        rain_chance = 22

    if rain_chance >= 35:
        condition = "Chance of rain"
    if high >= 95:
        condition = "Very hot"
    return {
        "condition": condition,
        "high_f": high,
        "low_f": low,
        "rain_chance": rain_chance,
        "summary": f"{condition}, about {high}°F high / {low}°F low, {rain_chance}% rain chance.",
    }


def explorer_stop_advice(mood: str, city: str, weather: dict[str, object]) -> dict[str, str]:
    time_window, time_reason = MOOD_TIME_RULES.get(mood, MOOD_TIME_RULES["Surprise Me"])
    condition = str(weather.get("condition") or "Mild")
    high = int(weather.get("high_f") or 70)
    rain = int(weather.get("rain_chance") or 0)
    outdoor = mood in OUTDOOR_MOODS
    if outdoor and (rain >= 40 or condition == "Very hot" or high >= 95):
        verdict = "Wait or swap"
        weather_note = "Outdoor stop is less comfortable in heat or rain. Pick an indoor alternative if conditions look rough."
    elif outdoor and (condition in {"Cold", "Cool"} or rain >= 25):
        verdict = "Go prepared"
        weather_note = "Still worth it, but bring layers and check the sky before you drive."
    elif mood in INDOOR_FRIENDLY_MOODS:
        verdict = "Good pick"
        weather_note = "Weather should not block this stop. It is a strong backup if outdoor plans shift."
    else:
        verdict = "Good pick"
        weather_note = "Conditions look reasonable for this plan."
    return {
        "best_time": time_window,
        "time_reason": time_reason,
        "weather_verdict": verdict,
        "weather_note": weather_note,
    }


def google_api_get(url: str, timeout: int = 8) -> dict[str, object]:
    request = urllib.request.Request(url, headers={"User-Agent": "FairFares Explorer/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def explorer_photo_url(photo_reference: str) -> str:
    if not photo_reference:
        return ""
    return f"/api/explorer/place-photo?ref={urllib.parse.quote(photo_reference)}"


def normalize_google_review(review: dict[str, object]) -> dict[str, str | int]:
    text = str(review.get("text") or "").strip()
    if len(text) > 220:
        text = f"{text[:217].rstrip()}..."
    return {
        "author": str(review.get("author_name") or "Google reviewer"),
        "rating": int(review.get("rating") or 0),
        "text": text,
    }


def google_place_details(place_id: str, api_key: str) -> dict[str, object]:
    fields = ",".join(
        [
            "place_id",
            "name",
            "formatted_address",
            "geometry",
            "rating",
            "user_ratings_total",
            "photos",
            "reviews",
            "types",
            "url",
            "website",
            "opening_hours",
        ]
    )
    query = urllib.parse.urlencode({"place_id": place_id, "fields": fields, "key": api_key})
    details = google_api_get(f"https://maps.googleapis.com/maps/api/place/details/json?{query}")
    if details.get("status") not in {"OK", "ZERO_RESULTS"}:
        raise RuntimeError(str(details.get("error_message") or details.get("status") or "Google Places details failed"))
    return dict(details.get("result") or {})


def explorer_mission_pack(name: str, mood: str, order: int, secret: bool) -> dict[str, object]:
    xp_bonus = 35 if secret else 25
    title = "Explorer Field Mission"
    challenge = f"Visit {name}, check in, capture one photo, and leave a quick Explorer rating."
    prompt = "What made this stop worth the drive?"
    checklist = ["Check in at the stop", "Capture a photo", "Rate the experience 1-5"]
    if mood in {"Food", "Coffee"}:
        title = "Food Hunter"
        challenge = f"Order a signature item at {name}, take a food photo, and rate the taste."
        prompt = "What should the next FairFares traveler order here?"
        checklist = ["Order the house favorite", "Upload a food photo", "Rate taste 1-5"]
    elif mood in {"Sunset", "Photography", "Scenic Drive"}:
        title = "Scenic Shot Challenge"
        challenge = f"Find the best angle at {name}, take a photo, and mark the view quality."
        prompt = "Where is the best angle or safest pull-off?"
        checklist = ["Find the viewpoint", "Upload your best shot", "Rate the view 1-5"]
    elif mood in {"Adventure", "Nature"}:
        title = "Trail & Vista Scout"
        challenge = f"Complete a short walk or viewpoint check at {name}, then log a safety tip."
        prompt = "What should someone know before they go?"
        checklist = ["Check in safely", "Capture the route or view", "Leave one travel tip"]
    elif mood in {"Music", "Shopping"}:
        title = "Local Gem Scout"
        challenge = f"Explore {name}, find one standout detail, and share whether it is worth a stop."
        prompt = "What was the best find?"
        checklist = ["Explore the location", "Capture one detail", "Share a quick recommendation"]
    if secret:
        title = "Mystery Stop Unlock"
        challenge = f"Reveal {name}, complete the hidden challenge, and earn the final bonus."
        prompt = "Was the mystery stop worth the reveal?"
        checklist = ["Unlock the stop", "Complete the hidden challenge", "Upload proof of adventure"]
    return {
        "mission_title": title,
        "challenge": challenge,
        "story_prompt": prompt,
        "checklist": checklist,
        "photo_bonus_xp": xp_bonus,
        "completion_label": f"Stop {order} reward",
    }


def google_place_to_stop(place: dict[str, object], api_key: str, order: int, mood: str, secret: bool, city_label: str = "", weather: dict[str, object] | None = None, include_details: bool = True) -> dict[str, object] | None:
    place_id = str(place.get("place_id") or "")
    if not place_id:
        return None
    if include_details:
        try:
            detail = google_place_details(place_id, api_key)
        except Exception:
            detail = place
    else:
        detail = place
    geometry = dict(detail.get("geometry") or place.get("geometry") or {})
    location = dict(geometry.get("location") or {})
    lat = float(location.get("lat") or 0)
    lng = float(location.get("lng") or 0)
    if not lat or not lng:
        return None
    name = str(detail.get("name") or place.get("name") or "Explorer Stop")
    rating = float(detail.get("rating") or place.get("rating") or 0)
    review_count = int(detail.get("user_ratings_total") or place.get("user_ratings_total") or 0)
    photos = detail.get("photos") if isinstance(detail.get("photos"), list) else []
    photo_urls = []
    for photo in photos[:5]:
        photo_reference = str(dict(photo).get("photo_reference") or "")
        if photo_reference:
            photo_urls.append(explorer_photo_url(photo_reference))
    photo_reference_url = photo_urls[0] if photo_urls else ""
    reviews = []
    for review in detail.get("reviews") or []:
        if isinstance(review, dict):
            normalized = normalize_google_review(review)
            if normalized["text"]:
                reviews.append(normalized)
        if len(reviews) >= 2:
            break
    mission_pack = explorer_mission_pack(name, mood, order, secret)
    if not secret and city_label:
        mission_pack["mission_title"] = f"{city_label} {mission_pack['mission_title']}"
    weather = weather or explorer_weather_forecast(city_label or "")
    advice = explorer_stop_advice(mood, city_label, weather)
    return {
        "order": order,
        "name": name,
        "lat": lat,
        "lng": lng,
        "xp_reward": 90 if secret else 55 + (order * 10),
        "mission": mission_pack["challenge"],
        "challenge": mission_pack["challenge"],
        "mission_title": mission_pack["mission_title"],
        "story_prompt": mission_pack["story_prompt"],
        "checklist": mission_pack["checklist"],
        "photo_bonus_xp": mission_pack["photo_bonus_xp"],
        "tips": "Live Google Places result. Check current hours, parking, and safety before you go.",
        "reference_photo_url": photo_reference_url,
        "reference_media_urls": photo_urls,
        "is_secret": 1 if secret else 0,
        "locked": 1 if secret else 0,
        "place_id": str(detail.get("place_id") or place_id),
        "address": str(detail.get("formatted_address") or place.get("formatted_address") or ""),
        "rating": rating,
        "review_count": review_count,
        "reviews": reviews,
        "google_url": str(detail.get("url") or ""),
        "source": "GOOGLE_PLACES",
        "mood": mood,
        "tags": [mood],
        "best_time": advice["best_time"],
        "time_reason": advice["time_reason"],
        "weather_verdict": advice["weather_verdict"],
        "weather_note": advice["weather_note"],
    }


def explorer_preference_terms(duration: str, budget: str, travel_with: str) -> list[str]:
    terms: list[str] = []
    if duration in {"2 Hours", "3 Hours"}:
        terms.extend(["nearby", "quick stop"])
    elif duration in {"Weekend", "Week"}:
        terms.extend(["best rated", "day trip"])
    if budget == "$":
        terms.extend(["affordable", "budget friendly"])
    elif budget == "$$$":
        terms.extend(["premium", "highly rated"])
    if travel_with == "Family":
        terms.extend(["family friendly"])
    elif travel_with == "Couple":
        terms.extend(["romantic"])
    elif travel_with == "Solo":
        terms.extend(["safe solo"])
    return terms[:4]


def explorer_duration_profile(duration: str) -> tuple[int, int, int]:
    profiles = {
        "2 Hours": (2, 3, 12),
        "3 Hours": (3, 3, 16),
        "4 Hours": (4, 4, 22),
        "5 Hours": (5, 4, 28),
        "6 Hours": (6, 5, 34),
        "Half Day": (4, 4, 26),
        "Full Day": (8, 5, 54),
        "Weekend": (18, 5, 120),
        "Week": (40, 5, 220),
    }
    return profiles.get(duration, profiles["Half Day"])


def fetch_google_explorer_stops(city: str, moods: list[str], city_lat: float, city_lng: float, duration: str = "", budget: str = "", travel_with: str = "") -> list[dict[str, object]]:
    api_key = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
    if not api_key:
        return []
    title_city = city.split(",", 1)[0].strip() or "Denver"
    query_moods = moods[:5] or ["Scenic Drive", "Hidden Gems", "Food"]
    preference_terms = explorer_preference_terms(duration, budget, travel_with)
    preference_suffix = " ".join(preference_terms)
    weather = explorer_weather_forecast(city)
    seen_place_ids: set[str] = set()
    mood_buckets: dict[str, list[dict[str, object]]] = {}
    for mood in query_moods + ["Hidden Gems", "Surprise Me"]:
        if mood in mood_buckets:
            continue
        mood_buckets[mood] = []
        for template in EXPLORER_PLACE_QUERIES.get(mood, EXPLORER_PLACE_QUERIES["Surprise Me"]):
            params = {
                "query": f"{template.format(city=title_city)} {preference_suffix}".strip(),
                "key": api_key,
            }
            if city_lat and city_lng:
                params["location"] = f"{city_lat},{city_lng}"
                params["radius"] = "35000"
            url = f"https://maps.googleapis.com/maps/api/place/textsearch/json?{urllib.parse.urlencode(params)}"
            try:
                payload = google_api_get(url)
            except Exception:
                continue
            if payload.get("status") not in {"OK", "ZERO_RESULTS"}:
                continue
            for place in payload.get("results") or []:
                if not isinstance(place, dict):
                    continue
                place_id = str(place.get("place_id") or "")
                if not place_id or place_id in seen_place_ids:
                    continue
                seen_place_ids.add(place_id)
                stop = google_place_to_stop(place, api_key, len(mood_buckets[mood]) + 1, mood, False, title_city, weather, include_details=False)
                if stop:
                    mood_buckets[mood].append(stop)
                if len(mood_buckets[mood]) >= 4:
                    break
            if len(mood_buckets[mood]) >= 4:
                break
    stops: list[dict[str, object]] = []
    for round_index in range(4):
        for mood in query_moods + ["Hidden Gems", "Surprise Me"]:
            bucket = mood_buckets.get(mood) or []
            if len(bucket) > round_index:
                stop = bucket[round_index]
                stop["order"] = len(stops) + 1
                stops.append(stop)
            if len(stops) >= 12:
                return stops
    return stops


def explorer_maps_loader() -> str:
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        return '<script>window.FAIRFARES_EXPLORER_MAPS_ENABLED=false;</script>'
    escaped_key = html.escape(urllib.parse.quote(api_key, safe=""), quote=True)
    return (
        '<script>window.FAIRFARES_EXPLORER_MAPS_ENABLED=true;</script>'
        f'<script async defer src="https://maps.googleapis.com/maps/api/js?key={escaped_key}"></script>'
    )


def explorer_config_status() -> dict[str, bool]:
    return {
        "mapsKeyPresent": bool(os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()),
        "placesKeyPresent": bool(os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()),
        "openAiKeyPresent": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
    }


def log_explorer_config_status() -> None:
    status = explorer_config_status()
    print(
        "Explorer config: "
        f"maps={'present' if status['mapsKeyPresent'] else 'missing'}, "
        f"places={'present' if status['placesKeyPresent'] else 'missing'}, "
        f"openai={'present' if status['openAiKeyPresent'] else 'missing'}"
    )


def generate_explorer_quest(city: str, moods: list[str], duration: str, budget: str, travel_with: str, fairfares_booked: bool, city_lat: float = 0, city_lng: float = 0) -> dict[str, object]:
    mood_order = moods[:5] or ["Scenic Drive"]
    selected_moods = set(mood_order)
    duration_hours, target_stop_count, total_miles = explorer_duration_profile(duration)
    weather = explorer_weather_forecast(city)
    google_stops = fetch_google_explorer_stops(city, mood_order, city_lat, city_lng, duration, budget, travel_with)
    scored_by_mood: dict[str, list[dict[str, object]]] = {}
    for mood in mood_order:
        scored = []
        for stop in EXPLORER_DENVER_STOPS:
            score = (2 if mood in stop["tags"] else 0) + len(selected_moods & stop["tags"])
            scored.append((score, stop["name"], stop))
        scored.sort(key=lambda item: (-item[0], item[1]))
        scored_by_mood[mood] = [item[2] for item in scored]
    visible_stops = []
    used_local_names: set[str] = set()
    while len(visible_stops) < max(1, target_stop_count - 1):
        added = False
        for mood in mood_order:
            for stop in scored_by_mood.get(mood, []):
                if stop["name"] not in used_local_names:
                    visible_stop = dict(stop)
                    visible_stop["_primary_mood"] = mood
                    visible_stops.append(visible_stop)
                    used_local_names.add(str(stop["name"]))
                    added = True
                    break
            if len(visible_stops) >= max(1, target_stop_count - 1):
                break
        if not added:
            break
    remaining_stops = [stop for stop in EXPLORER_DENVER_STOPS if str(stop["name"]) not in used_local_names]
    secret_stop = next((stop for stop in remaining_stops if "Hidden Gems" in stop["tags"]), remaining_stops[0] if remaining_stops else EXPLORER_DENVER_STOPS[-1])
    stops = visible_stops + [secret_stop]
    quest_type = " + ".join(mood_order[:2])
    total_xp = sum(int(stop["xp"]) for stop in stops) + (100 if fairfares_booked else 0)
    title_mood = "Sunset" if "Sunset" in selected_moods else "Hidden Gem" if "Hidden Gems" in selected_moods else next(iter(selected_moods))
    title_city = city.split(",", 1)[0].strip() or "Denver"
    difficulty = 1 if duration in {"2 Hours", "3 Hours"} else 2 if duration in {"4 Hours", "5 Hours", "6 Hours", "Half Day"} else 3
    def local_payload_stop(stop: dict[str, object], index: int, tip: str, source: str, secret: bool = False) -> dict[str, object]:
        primary_mood = stop.get("_primary_mood") or ("Hidden Gems" if secret and "Hidden Gems" in stop["tags"] else next((mood for mood in mood_order if mood in stop["tags"]), next(iter(stop["tags"]), "Surprise Me")))
        advice = explorer_stop_advice(str(primary_mood), city, weather)
        return {
            "order": index + 1,
            "name": stop["name"],
            "lat": stop["lat"],
            "lng": stop["lng"],
            "xp_reward": stop["xp"],
            "mission": stop["challenge"],
            "challenge": stop["challenge"],
            "mission_title": "Mystery Stop Unlock" if secret else "Local Explorer Mission",
            "story_prompt": "What should another FairFares traveler know?",
            "checklist": ["Check in at the stop", "Capture a photo", "Share one local tip"],
            "photo_bonus_xp": 35 if secret else 25,
            "tips": tip,
            "reference_photo_url": "",
            "reference_media_urls": [],
            "is_secret": 1 if secret else 0,
            "locked": 1 if secret else 0,
            "place_id": "",
            "address": "",
            "rating": 0,
            "review_count": 0,
            "reviews": [],
            "google_url": "",
            "source": source,
            "mood": primary_mood,
            "tags": sorted(stop["tags"]),
            "best_time": advice["best_time"],
            "time_reason": advice["time_reason"],
            "weather_verdict": advice["weather_verdict"],
            "weather_note": advice["weather_note"],
        }
    if len(google_stops) >= 3:
        while len(google_stops) < target_stop_count:
            fallback = EXPLORER_DENVER_STOPS[len(google_stops) % len(EXPLORER_DENVER_STOPS)]
            google_stops.append(local_payload_stop(fallback, len(google_stops), "Local fallback stop added because Google Places returned fewer route options.", "LOCAL_FALLBACK", len(google_stops) == target_stop_count - 1))
        payload_stops = google_stops[:target_stop_count]
        alternate_stops = google_stops[target_stop_count:target_stop_count + 6]
        for index, stop in enumerate(payload_stops):
            stop["order"] = index + 1
            stop["is_secret"] = 1 if index == len(payload_stops) - 1 else 0
            stop["locked"] = 1 if index == len(payload_stops) - 1 else 0
            if stop["is_secret"]:
                stop["mission_title"] = "Mystery Stop Unlock"
        for index, stop in enumerate(alternate_stops):
            stop["order"] = target_stop_count + index + 1
            stop["is_secret"] = 0
            stop["locked"] = 0
    else:
        local_stops = stops[:target_stop_count - 1] + [secret_stop]
        payload_stops = [
            local_payload_stop(stop, index, "Local Explorer preview. Render will use Google Places when GOOGLE_PLACES_API_KEY is available.", "LOCAL", index == len(local_stops) - 1)
            for index, stop in enumerate(local_stops)
        ]
        alternate_stops = [
            local_payload_stop(stop, index, "Local alternate stop. Render will use Google Places when GOOGLE_PLACES_API_KEY is available.", "LOCAL", False)
            for index, stop in enumerate(EXPLORER_DENVER_STOPS[target_stop_count:target_stop_count + 6])
        ]
    total_xp = sum(int(stop["xp_reward"]) for stop in payload_stops) + (100 if fairfares_booked else 0)
    return {
        "title": f"{title_city} {title_mood} Explorer Quest",
        "description": f"A {duration.lower()} {quest_type.lower()} route for {travel_with.lower()} travelers in {title_city}. Explorer balances your selected moods, suggests the best time to go, and checks weather fit before each stop.",
        "city": city,
        "city_lat": city_lat,
        "city_lng": city_lng,
        "start_lat": city_lat,
        "start_lng": city_lng,
        "start_label": title_city,
        "quest_type": quest_type,
        "difficulty": difficulty,
        "duration": duration,
        "budget": budget,
        "travel_with": travel_with,
        "fairfares_booked": fairfares_booked,
        "total_hours": duration_hours,
        "total_miles": total_miles,
        "total_xp": total_xp,
        "stop_count": len(payload_stops),
        "fairfares_bonus": 100 if fairfares_booked else 0,
        "source": "GOOGLE_PLACES" if len(google_stops) >= 3 else "LOCAL",
        "weather": weather,
        "stops": payload_stops,
        "alternatives": alternate_stops,
    }


def row_to_explorer_quest(quest: sqlite3.Row, stops: list[sqlite3.Row]) -> dict[str, object]:
    city = quest["city"]
    weather = explorer_weather_forecast(city)
    quest_moods = [item.strip() for item in str(quest["quest_type"] or "").split("+") if item.strip()]
    return {
        "quest_id": quest["id"],
        "title": quest["title"],
        "description": row_value(quest, "description"),
        "city": city,
        "city_lat": row_value(quest, "city_lat", 0),
        "city_lng": row_value(quest, "city_lng", 0),
        "start_lat": row_value(quest, "city_lat", 0),
        "start_lng": row_value(quest, "city_lng", 0),
        "start_label": quest["city"].split(",", 1)[0].strip() or quest["city"],
        "quest_type": quest["quest_type"],
        "difficulty": int(row_value(quest, "difficulty", 2) or 2),
        "duration": quest["duration"],
        "budget": quest["budget"],
        "travel_with": quest["travel_with"],
        "fairfares_booked": bool(row_value(quest, "fairfares_booked")),
        "total_hours": quest["total_hours"],
        "total_miles": quest["total_miles"],
        "total_xp": quest["total_xp"],
        "stop_count": int(row_value(quest, "stop_count", len(stops)) or len(stops)),
        "weather": weather,
        "stops": [
            dict(
                {
                "stop_id": stop["id"],
                "order": stop["stop_order"],
                "name": stop["name"],
                "lat": stop["lat"],
                "lng": stop["lng"],
                "xp_reward": stop["xp_reward"],
                "mission": row_value(stop, "challenge"),
                "challenge": row_value(stop, "challenge"),
                "mission_title": "Explorer Field Mission" if not row_value(stop, "is_secret", 0) else "Mystery Stop Unlock",
                "story_prompt": "What made this stop worth the drive?",
                "checklist": ["Check in at the stop", "Capture a photo", "Rate the experience 1-5"],
                "photo_bonus_xp": 25,
                "tips": row_value(stop, "tips"),
                "reference_photo_url": row_value(stop, "reference_photo_url"),
                "reference_media_urls": [row_value(stop, "reference_photo_url")] if row_value(stop, "reference_photo_url") else [],
                "is_secret": int(row_value(stop, "is_secret", 0) or 0),
                "locked": int(row_value(stop, "locked", 0) or 0),
                "completed": int(row_value(stop, "completed", 0) or 0),
                "place_id": row_value(stop, "place_id"),
                "address": row_value(stop, "address"),
                "rating": float(row_value(stop, "rating", 0) or 0),
                "review_count": int(row_value(stop, "review_count", 0) or 0),
                "reviews": json.loads(row_value(stop, "reviews_json", "[]") or "[]"),
                "google_url": row_value(stop, "google_url"),
                "source": row_value(stop, "source", "LOCAL"),
                "mood": quest_moods[(int(row_value(stop, "stop_order", 1) or 1) - 1) % len(quest_moods)] if quest_moods else "Explorer",
                },
                **explorer_stop_advice(quest_moods[(int(row_value(stop, "stop_order", 1) or 1) - 1) % len(quest_moods)] if quest_moods else "Surprise Me", city, weather),
            )
            for stop in stops
        ],
    }


def persist_explorer_quest(user_id: int | None, quest: dict[str, object]) -> int:
    with db() as con:
        con.execute(
            """
            INSERT INTO explorer_quests
            (user_id, city, city_lat, city_lng, title, description, quest_type, difficulty, duration, budget, travel_with, fairfares_booked, total_hours, total_miles, total_xp, stop_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                quest["city"],
                quest.get("city_lat", 0),
                quest.get("city_lng", 0),
                quest["title"],
                quest.get("description", ""),
                quest["quest_type"],
                quest.get("difficulty", 2),
                quest["duration"],
                quest["budget"],
                quest["travel_with"],
                1 if quest.get("fairfares_booked") else 0,
                quest["total_hours"],
                quest["total_miles"],
                quest["total_xp"],
                quest.get("stop_count", len(quest.get("stops", []))),
            ),
        )
        quest_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        for stop in quest["stops"]:
            con.execute(
                """
                INSERT INTO explorer_stops
                (quest_id, stop_order, name, lat, lng, xp_reward, challenge, tips, reference_photo_url, is_secret, locked, place_id, address, rating, review_count, reviews_json, google_url, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    quest_id,
                    stop["order"],
                    stop["name"],
                    stop["lat"],
                    stop["lng"],
                    stop["xp_reward"],
                    stop.get("mission") or stop.get("challenge", ""),
                    stop.get("tips", ""),
                    stop.get("reference_photo_url", ""),
                    stop.get("is_secret", 0),
                    stop.get("locked", stop.get("is_secret", 0)),
                    stop.get("place_id", ""),
                    stop.get("address", ""),
                    stop.get("rating", 0),
                    stop.get("review_count", 0),
                    json.dumps(stop.get("reviews", [])),
                    stop.get("google_url", ""),
                    stop.get("source", "LOCAL"),
                ),
            )
            stop["stop_id"] = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
        if user_id and quest.get("fairfares_bonus"):
            bonus = int(quest["fairfares_bonus"])
            con.execute(
                """
                INSERT INTO explorer_profiles (user_id, xp, level, trips, badges)
                VALUES (?, ?, 1, 0, 1)
                ON CONFLICT(user_id) DO UPDATE SET
                    xp = xp + ?,
                    level = MAX(1, ((xp + ?) / 250) + 1),
                    badges = MAX(badges, 1),
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, bonus, bonus, bonus),
            )
            con.execute(
                """
                INSERT INTO explorer_xp_events (user_id, quest_id, event_type, xp_amount, note)
                VALUES (?, ?, 'FAIRFARES_BOOKING_BONUS', ?, 'Explorer Bonus Active')
                """,
                (user_id, quest_id, bonus),
            )
            badge = con.execute("SELECT id FROM explorer_badges WHERE name = 'First Explorer'").fetchone()
            if badge:
                con.execute("INSERT OR IGNORE INTO explorer_user_badges (user_id, badge_id) VALUES (?, ?)", (user_id, badge["id"]))
    return quest_id


def get_admin_cars() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute("SELECT * FROM cars WHERE UPPER(TRIM(status)) != 'DELETED' ORDER BY sort_order, daily_price, id").fetchall()


def get_admin_car_detail(car_id: int) -> dict[str, object] | None:
    with db() as con:
        car = con.execute("SELECT * FROM cars WHERE id = ? AND UPPER(TRIM(status)) != 'DELETED'", (car_id,)).fetchone()
        if not car:
            return None
        revenue = con.execute(
            """
            SELECT COUNT(*) AS booking_count,
                   COALESCE(SUM(total_price), 0) AS total_revenue
            FROM bookings
            WHERE car_id = ?
              AND booking_status NOT IN ('CANCELLED', 'EXPIRED_HOLD')
            """,
            (car_id,),
        ).fetchone()
        service_totals = con.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN cost_type = 'REPAIR' THEN amount ELSE 0 END), 0) AS repair_total,
                COALESCE(SUM(CASE WHEN cost_type = 'MAINTENANCE' THEN amount ELSE 0 END), 0) AS maintenance_total
            FROM car_service_costs
            WHERE car_id = ?
            """,
            (car_id,),
        ).fetchone()
        service_rows = con.execute(
            """
            SELECT *
            FROM car_service_costs
            WHERE car_id = ?
            ORDER BY service_date DESC, id DESC
            """,
            (car_id,),
        ).fetchall()
        bookings = con.execute(
            """
            SELECT bookings.*, users.name AS user_name, users.email AS user_email
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            WHERE bookings.car_id = ?
            ORDER BY bookings.id DESC
            LIMIT 25
            """,
            (car_id,),
        ).fetchall()
    purchase_cost = float(row_value(car, "purchase_cost") or 0)
    repair_total = float(row_value(service_totals, "repair_total") or 0)
    maintenance_total = float(row_value(service_totals, "maintenance_total") or 0)
    total_revenue = float(row_value(revenue, "total_revenue") or 0)
    return {
        "car": car,
        "booking_count": int(row_value(revenue, "booking_count") or 0),
        "total_revenue": total_revenue,
        "repair_total": repair_total,
        "maintenance_total": maintenance_total,
        "total_cost": purchase_cost + repair_total + maintenance_total,
        "roi": total_revenue - (purchase_cost + repair_total + maintenance_total),
        "service_rows": service_rows,
        "bookings": bookings,
    }


def get_admin_fleet_roi() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT cars.*,
                   COUNT(bookings.id) AS booking_count,
                   COALESCE(SUM(bookings.total_price), 0) AS total_revenue,
                   COALESCE(service.repair_total, 0) AS repair_total,
                   COALESCE(service.maintenance_total, 0) AS maintenance_total,
                   (
                       COALESCE(cars.purchase_cost, 0) +
                       COALESCE(service.repair_total, 0) +
                       COALESCE(service.maintenance_total, 0)
                   ) AS total_cost,
                   (
                       COALESCE(SUM(bookings.total_price), 0) -
                       (
                           COALESCE(cars.purchase_cost, 0) +
                           COALESCE(service.repair_total, 0) +
                           COALESCE(service.maintenance_total, 0)
                       )
                   ) AS roi
            FROM cars
            LEFT JOIN bookings
              ON bookings.car_id = cars.id
             AND bookings.booking_status NOT IN ('CANCELLED', 'EXPIRED_HOLD')
            LEFT JOIN (
                SELECT car_id,
                       SUM(CASE WHEN cost_type = 'REPAIR' THEN amount ELSE 0 END) AS repair_total,
                       SUM(CASE WHEN cost_type = 'MAINTENANCE' THEN amount ELSE 0 END) AS maintenance_total
                FROM car_service_costs
                GROUP BY car_id
            ) service ON service.car_id = cars.id
            WHERE UPPER(TRIM(cars.status)) != 'DELETED'
            GROUP BY cars.id
            ORDER BY roi ASC, cars.sort_order, cars.name
            """
        ).fetchall()


def get_business_expenses() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM business_expenses
            ORDER BY expense_date DESC, id DESC
            LIMIT 100
            """
        ).fetchall()


def get_car(car_id: int) -> sqlite3.Row | None:
    expire_stale_booking_holds()
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
                   cars.color AS car_color, cars.image_url AS car_image_url,
                   cars.daily_price, cars.license_plate, cars.vin_number, cars.status AS car_status
            FROM bookings
            JOIN users ON users.id = bookings.user_id
            JOIN cars ON cars.id = bookings.car_id
            ORDER BY bookings.id DESC
            LIMIT 50
            """
        ).fetchall()


def employee_operations_metrics() -> dict[str, object]:
    bookings = get_admin_bookings()
    today = datetime.now().date()
    tomorrow = today + timedelta(days=1)
    today_pickups = [
        row for row in bookings
        if row_value(row, "booking_status") not in {"CANCELLED", "EXPIRED_HOLD"}
        and (booking_datetime_from_row(row, "pickup_date", "pickup_time") or datetime.min).date() == today
    ]
    tomorrow_pickups = [
        row for row in bookings
        if row_value(row, "booking_status") not in {"CANCELLED", "EXPIRED_HOLD"}
        and (booking_datetime_from_row(row, "pickup_date", "pickup_time") or datetime.min).date() == tomorrow
    ]
    active_bookings = [
        row for row in bookings
        if row_value(row, "booking_status") in {"PENDING_HOLD", "CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "PICKED_UP"}
    ]
    open_tickets = [row for row in get_admin_tickets() if row_value(row, "status") != "CLOSED"]
    urgent_tickets = [
        row for row in open_tickets
        if row_value(row, "urgent") or normalize_support_priority(row_value(row, "priority")) in {"P0", "P1"}
    ]
    return {
        "today_pickups": today_pickups,
        "tomorrow_pickups": tomorrow_pickups,
        "active_bookings": active_bookings,
        "open_tickets": open_tickets,
        "urgent_tickets": urgent_tickets,
    }


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
            WHERE users.role = 'CUSTOMER'
              AND users.is_admin = 0
            GROUP BY users.id
            ORDER BY users.name COLLATE NOCASE
            LIMIT 100
            """
        ).fetchall()


def get_staff_accounts() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT id, name, email, phone, role, is_admin, is_verified, created_at
            FROM users
            WHERE is_admin = 1 OR role IN ('ADMIN', 'EMPLOYEE')
            ORDER BY
                CASE WHEN role = 'ADMIN' OR is_admin = 1 THEN 0 ELSE 1 END,
                name COLLATE NOCASE
            """
        ).fetchall()


def get_active_admin_accounts() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT id, name, email, phone, role, is_admin, is_verified
            FROM users
            WHERE is_verified = 1
              AND (is_admin = 1 OR role = 'ADMIN')
            ORDER BY name COLLATE NOCASE, id
            """
        ).fetchall()


def month_start_from_query(value: str = "") -> date:
    if value:
        try:
            parsed = datetime.strptime(value[:7], "%Y-%m").date()
            return parsed.replace(day=1)
        except ValueError:
            pass
    today = datetime.now().date()
    return today.replace(day=1)


def next_month_start(month_start: date) -> date:
    return date(month_start.year + (1 if month_start.month == 12 else 0), 1 if month_start.month == 12 else month_start.month + 1, 1)


def previous_month_start(month_start: date) -> date:
    return date(month_start.year - (1 if month_start.month == 1 else 0), 12 if month_start.month == 1 else month_start.month - 1, 1)


def ensure_oncall_schedule_for_month(month_start: date, assigned_by: int | None = None) -> None:
    admins = get_active_admin_accounts()
    if not admins:
        return
    next_month = next_month_start(month_start)
    with db() as con:
        existing = {
            row["shift_date"]
            for row in con.execute(
                "SELECT shift_date FROM oncall_shifts WHERE shift_date >= ? AND shift_date < ?",
                (month_start.isoformat(), next_month.isoformat()),
            ).fetchall()
        }
        days = (next_month - month_start).days
        for offset in range(days):
            day = month_start + timedelta(days=offset)
            if day.isoformat() in existing:
                continue
            admin = admins[offset % len(admins)]
            con.execute(
                """
                INSERT INTO oncall_shifts (shift_date, admin_user_id, assigned_by, note)
                VALUES (?, ?, ?, ?)
                """,
                (day.isoformat(), admin["id"], assigned_by, "Auto-rotated monthly schedule"),
            )


def get_oncall_shifts_for_month(month_start: date) -> list[sqlite3.Row]:
    ensure_oncall_schedule_for_month(month_start)
    next_month = next_month_start(month_start)
    with db() as con:
        return con.execute(
            """
            SELECT oncall_shifts.*,
                   admin.name AS admin_name,
                   admin.email AS admin_email,
                   assigner.name AS assigned_by_name
            FROM oncall_shifts
            JOIN users admin ON admin.id = oncall_shifts.admin_user_id
            LEFT JOIN users assigner ON assigner.id = oncall_shifts.assigned_by
            WHERE shift_date >= ? AND shift_date < ?
            ORDER BY shift_date ASC
            """,
            (month_start.isoformat(), next_month.isoformat()),
        ).fetchall()


def next_oncall_shift_for_user(user_id: int) -> sqlite3.Row | None:
    today = datetime.now().date()
    ensure_oncall_schedule_for_month(today.replace(day=1))
    ensure_oncall_schedule_for_month(next_month_start(today.replace(day=1)))
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM oncall_shifts
            WHERE admin_user_id = ?
              AND shift_date >= ?
            ORDER BY shift_date ASC
            LIMIT 1
            """,
            (user_id, today.isoformat()),
        ).fetchone()


def upcoming_oncall_shifts(limit: int = 7) -> list[sqlite3.Row]:
    today = datetime.now().date()
    ensure_oncall_schedule_for_month(today.replace(day=1))
    ensure_oncall_schedule_for_month(next_month_start(today.replace(day=1)))
    with db() as con:
        return con.execute(
            """
            SELECT oncall_shifts.*,
                   admin.name AS admin_name,
                   admin.email AS admin_email
            FROM oncall_shifts
            JOIN users admin ON admin.id = oncall_shifts.admin_user_id
            WHERE shift_date >= ?
            ORDER BY shift_date ASC
            LIMIT ?
            """,
            (today.isoformat(), limit),
        ).fetchall()


def get_oncall_shift_for_day(day: date | None = None) -> sqlite3.Row | None:
    selected_day = day or datetime.now().date()
    ensure_oncall_schedule_for_month(selected_day.replace(day=1))
    with db() as con:
        return con.execute(
            """
            SELECT oncall_shifts.*,
                   admin.name AS admin_name,
                   admin.email AS admin_email,
                   admin.phone AS admin_phone
            FROM oncall_shifts
            JOIN users admin ON admin.id = oncall_shifts.admin_user_id
            WHERE oncall_shifts.shift_date = ?
            LIMIT 1
            """,
            (selected_day.isoformat(),),
        ).fetchone()


def render_oncall_mini_calendar(month_start: date | None = None) -> str:
    selected_month = month_start or datetime.now().date().replace(day=1)
    shifts = get_oncall_shifts_for_month(selected_month)
    shift_rows = {row_value(row, "shift_date"): row for row in shifts}
    next_month = next_month_start(selected_month)
    today = datetime.now().date()
    color_pool = ["#16a34a", "#2563eb", "#0891b2", "#7c3aed", "#dc2626", "#0f766e", "#ca8a04"]
    cells = ['<span class="admin-oncall-mini-empty" aria-hidden="true"></span>' for _ in range(selected_month.weekday())]
    for offset in range((next_month - selected_month).days):
        day = selected_month + timedelta(days=offset)
        shift = shift_rows.get(day.isoformat())
        assigned_id = str(row_value(shift, "admin_user_id") or "")
        color_index = (int(assigned_id) if assigned_id.isdigit() else day.day) % len(color_pool)
        admin_name = row_value(shift, "admin_name") or "Unassigned"
        classes = "admin-oncall-mini-day"
        if day == today:
            classes += " is-today"
        cells.append(
            f"""
            <a class="{classes}" href="/admin/oncall?month={escape(selected_month.strftime("%Y-%m"))}" style="--oncall-color: {color_pool[color_index]}">
              <span>{escape(str(day.day))}</span>
              <b>{escape(admin_name.split()[0] if admin_name else "Open")}</b>
            </a>
            """
        )
    return f"""
    <div class="admin-oncall-mini-board">
      <div class="admin-oncall-mini-title">
        <span>Monthly on-call board</span>
        <b>{escape(selected_month.strftime("%B"))}</b>
      </div>
      <div class="admin-oncall-mini-weekdays" aria-hidden="true">
        <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
      </div>
      <div class="admin-oncall-mini-grid">{"".join(cells)}</div>
    </div>
    """


def get_staff_account_requests() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT staff_account_requests.*,
                   requester.name AS requester_name,
                   requester.email AS requester_email,
                   approver.name AS approver_name,
                   created_user.email AS created_user_email
            FROM staff_account_requests
            JOIN users AS requester ON requester.id = staff_account_requests.requested_by
            LEFT JOIN users AS approver ON approver.id = staff_account_requests.approved_by
            LEFT JOIN users AS created_user ON created_user.id = staff_account_requests.created_user_id
            ORDER BY
                CASE staff_account_requests.status
                    WHEN 'PENDING' THEN 0
                    WHEN 'APPROVED' THEN 1
                    ELSE 2
                END,
                staff_account_requests.created_at DESC
            """
        ).fetchall()


def normalized_staff_role(value: str) -> str:
    role = (value or "").strip().upper()
    return role if role in {ROLE_ADMIN, ROLE_EMPLOYEE} else ROLE_EMPLOYEE


def staff_role_label(row: sqlite3.Row) -> str:
    role = normalized_user_role(row_value(row, "role"))
    if role == ROLE_ADMIN or int(row_value(row, "is_admin") or 0) == 1:
        return "Admin"
    if role == ROLE_EMPLOYEE:
        return "Employee"
    return "Customer"


def is_admin_user(user: sqlite3.Row | None) -> bool:
    return bool(user and (normalized_user_role(row_value(user, "role")) == ROLE_ADMIN or int(row_value(user, "is_admin") or 0) == 1))


def is_staff_user(user: sqlite3.Row | None) -> bool:
    return bool(user and (is_admin_user(user) or normalized_user_role(row_value(user, "role")) == ROLE_EMPLOYEE))


def get_admin_nav_badge_counts(user: sqlite3.Row | None) -> dict[str, int]:
    if not is_staff_user(user):
        return {}
    today = datetime.now().date().isoformat()
    with db() as con:
        counts = {
            "portal": con.execute(
                "SELECT COUNT(*) AS total FROM cars WHERE UPPER(TRIM(status)) != 'AVAILABLE'"
            ).fetchone()["total"],
            "bookings": con.execute(
                """
                SELECT COUNT(*) AS total
                FROM bookings
                WHERE booking_status IN ('PENDING_HOLD', 'CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
                """
            ).fetchone()["total"],
            "tickets": con.execute(
                "SELECT COUNT(*) AS total FROM support_tickets WHERE status != 'CLOSED'"
            ).fetchone()["total"],
            "pickup": con.execute(
                """
                SELECT COUNT(*) AS total
                FROM bookings
                WHERE pickup_date = ?
                  AND booking_status NOT IN ('CANCELLED', 'EXPIRED_HOLD')
                """,
                (today,),
            ).fetchone()["total"],
        }
        if is_admin_user(user):
            counts.update(
                {
                    "requests": con.execute(
                        "SELECT COUNT(*) AS total FROM staff_account_requests WHERE status = 'PENDING'"
                    ).fetchone()["total"],
                    "system": con.execute(
                        "SELECT COUNT(*) AS total FROM app_feedback WHERE created_at >= datetime('now', '-7 days')"
                    ).fetchone()["total"],
                }
            )
    return {key: int(value or 0) for key, value in counts.items()}


ADMIN_NAV_ICONS = {
    "AI Agent": "&#129302;",
    "Bookings": "&#128663;",
    "Booked Cars": "&#128663;",
    "Commercials": "&#127916;",
    "Customers": "&#128100;",
    "Dashboard": "&#127968;",
    "Discounts": "&#127991;",
    "Documents": "&#128196;",
    "Email Marketing": "&#9993;",
    "Employees": "&#128101;",
    "Explorer": "&#129517;",
    "Fleet": "&#128664;",
    "Inventory": "&#128664;",
    "Knowledge": "&#129302;",
    "Log out": "&#8617;",
    "Marketing": "&#128227;",
    "On-call": "&#128222;",
    "Operations": "&#128736;",
    "Payments": "&#128179;",
    "People": "&#128101;",
    "Reports": "&#128200;",
    "ROI": "&#128200;",
    "Settings": "&#9881;",
    "Staff Requests": "&#128101;",
    "System": "&#9881;",
    "Tickets": "&#127903;",
    "Users": "&#128100;",
    "User Pickup": "&#129706;",
    "User Portal": "&#127760;",
    "Vehicles": "&#128664;",
    "Verification": "&#129706;",
    "Wiki": "&#129302;",
    "Workspace": "&#127968;",
}


def render_admin_nav_label(label: str, count: int = 0) -> str:
    icon = ADMIN_NAV_ICONS.get(label, "&bull;")
    badge = ""
    if count > 0:
        badge_text = "99+" if count > 99 else str(count)
        badge = f'<span class="admin-nav-badge" aria-label="{escape(str(count))} new items">{escape(badge_text)}</span>'
    return f'<span class="admin-nav-label"><span class="admin-nav-icon" aria-hidden="true">{icon}</span><span class="admin-nav-text">{escape(label)}</span>{badge}</span>'


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
            "tickets": con.execute("SELECT COUNT(*) AS total FROM support_tickets WHERE status != 'CLOSED'").fetchone()["total"],
            "escalations": con.execute(
                """
                SELECT COUNT(*) AS total
                FROM support_tickets
                WHERE status != 'CLOSED'
                  AND (escalated_to_oncall = 1 OR priority = 'P0')
                """
            ).fetchone()["total"],
            "users": con.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'CUSTOMER' AND is_admin = 0").fetchone()["total"],
        }


def get_workspace_posts(
    user: sqlite3.Row | None = None,
    limit: int = 20,
    group_id: int | None = None,
    author_id: int | None = None,
) -> list[sqlite3.Row]:
    filters = []
    params: list[object] = []
    current_user_id = int(row_value(user, "id") or 0) if user else 0
    if user and not is_admin_user(user):
        filters.append("UPPER(TRIM(workspace_posts.visibility)) IN ('STAFF', 'COMPANY')")
    if group_id:
        filters.append("workspace_posts.group_id = ?")
        params.append(group_id)
    if author_id:
        filters.append("workspace_posts.author_id = ?")
        params.append(author_id)
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    query_params: list[object] = [current_user_id, *params, limit]
    with db() as con:
        return con.execute(
            f"""
            SELECT workspace_posts.*,
                   users.name AS author_name,
                   users.email AS author_email,
                   users.role AS author_role,
                   users.is_admin AS author_is_admin,
                   users.profile_photo_url AS author_photo,
                   workspace_groups.name AS group_name,
                   (
                     SELECT COUNT(*)
                     FROM workspace_post_comments
                     WHERE workspace_post_comments.post_id = workspace_posts.id
                   ) AS comment_count,
                   (
                     SELECT COUNT(*)
                     FROM workspace_post_reactions
                     WHERE workspace_post_reactions.post_id = workspace_posts.id
                   ) AS reaction_count
                   , (
                     SELECT reaction
                     FROM workspace_post_reactions
                     WHERE workspace_post_reactions.post_id = workspace_posts.id
                       AND workspace_post_reactions.user_id = ?
                     ORDER BY workspace_post_reactions.id DESC
                     LIMIT 1
                   ) AS viewer_reaction
            FROM workspace_posts
            JOIN users ON users.id = workspace_posts.author_id
            LEFT JOIN workspace_groups ON workspace_groups.id = workspace_posts.group_id
            {where_clause}
            ORDER BY workspace_posts.id DESC
            LIMIT ?
            """,
            query_params,
        ).fetchall()


def get_workspace_post_comments(post_id: int, limit: int = 3) -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT workspace_post_comments.*,
                   users.name AS author_name,
                   users.profile_photo_url AS author_photo
            FROM workspace_post_comments
            JOIN users ON users.id = workspace_post_comments.author_id
            WHERE workspace_post_comments.post_id = ?
            ORDER BY workspace_post_comments.id DESC
            LIMIT ?
            """,
            (post_id, limit),
        ).fetchall()


def get_workspace_post_stats(post_id: int) -> dict[str, int]:
    with db() as con:
        row = con.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM workspace_post_reactions WHERE post_id = ?) AS reaction_count,
              (SELECT COUNT(*) FROM workspace_post_comments WHERE post_id = ?) AS comment_count
            """,
            (post_id, post_id),
        ).fetchone()
    return {
        "reaction_count": int(row_value(row, "reaction_count") or 0),
        "comment_count": int(row_value(row, "comment_count") or 0),
    }


def get_workspace_reaction_counts(post_id: int) -> dict[str, int]:
    allowed_reactions = {key for key, _emoji, _label in WORKSPACE_REACTIONS}
    with db() as con:
        rows = con.execute(
            """
            SELECT reaction, COUNT(*) AS total
            FROM workspace_post_reactions
            WHERE post_id = ?
            GROUP BY reaction
            """,
            (post_id,),
        ).fetchall()
    counts: dict[str, int] = {}
    for row in rows:
        reaction = str(row_value(row, "reaction") or "").upper().strip()
        if reaction in allowed_reactions:
            counts[reaction] = int(row_value(row, "total") or 0)
    return counts


def workspace_reaction_summary(post_id: int) -> str:
    counts = get_workspace_reaction_counts(post_id)
    parts = [
        f"{counts[key]} {emoji} {label}"
        for key, emoji, label in WORKSPACE_REACTIONS
        if counts.get(key)
    ]
    return " · ".join(parts) if parts else "0 reactions"


def workspace_reaction_button_label(reaction: str | None) -> tuple[str, str]:
    normalized = (reaction or "").upper().strip()
    for key, emoji, label in WORKSPACE_REACTIONS:
        if key == normalized:
            return emoji, label
    return "👍", "Like"


def apply_workspace_reaction(post_id: int, user_id: int, reaction: str) -> dict[str, object]:
    normalized = (reaction or "LIKE").upper().strip()
    allowed_reactions = {key for key, _emoji, _label in WORKSPACE_REACTIONS}
    if normalized not in allowed_reactions:
        normalized = "LIKE"
    active_reaction = ""
    with db() as con:
        post = con.execute("SELECT id FROM workspace_posts WHERE id = ?", (post_id,)).fetchone()
        if post:
            existing = con.execute(
                """
                SELECT reaction
                FROM workspace_post_reactions
                WHERE post_id = ? AND user_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (post_id, user_id),
            ).fetchone()
            existing_reaction = str(row_value(existing, "reaction") or "").upper().strip() if existing else ""
            con.execute(
                "DELETE FROM workspace_post_reactions WHERE post_id = ? AND user_id = ?",
                (post_id, user_id),
            )
            if existing_reaction != normalized:
                con.execute(
                    """
                    INSERT INTO workspace_post_reactions (post_id, user_id, reaction)
                    VALUES (?, ?, ?)
                    """,
                    (post_id, user_id, normalized),
                )
                active_reaction = normalized
    stats = get_workspace_post_stats(post_id)
    emoji, label = workspace_reaction_button_label(active_reaction)
    return {
        "ok": True,
        "reaction_count": stats["reaction_count"],
        "reaction_summary": workspace_reaction_summary(post_id),
        "reaction": active_reaction,
        "emoji": emoji,
        "label": label,
    }


def workspace_post_redirect(post_id: int) -> str:
    with db() as con:
        row = con.execute("SELECT group_id FROM workspace_posts WHERE id = ?", (post_id,)).fetchone()
    group_id = row_value(row, "group_id")
    return f"/admin/workspace?group={int(group_id)}" if group_id else "/admin/workspace"


def get_workspace_group(group_id: int | None) -> sqlite3.Row | None:
    if not group_id:
        return None
    with db() as con:
        return con.execute("SELECT * FROM workspace_groups WHERE id = ?", (group_id,)).fetchone()


def get_workspace_groups(user: sqlite3.Row | None = None, limit: int = 30) -> list[sqlite3.Row]:
    current_user_id = int(row_value(user, "id") or 0) if user else 0
    with db() as con:
        return con.execute(
            """
            SELECT workspace_groups.*,
                   users.name AS creator_name,
                   COUNT(workspace_group_members.id) AS member_count,
                   MAX(CASE WHEN workspace_group_members.user_id = ? THEN 1 ELSE 0 END) AS joined
            FROM workspace_groups
            LEFT JOIN users ON users.id = workspace_groups.created_by
            LEFT JOIN workspace_group_members ON workspace_group_members.group_id = workspace_groups.id
            GROUP BY workspace_groups.id
            ORDER BY workspace_groups.name COLLATE NOCASE
            LIMIT ?
            """,
            (current_user_id, limit),
        ).fetchall()


def render_workspace_groups(groups: list[sqlite3.Row], selected_group_id: int | None = None) -> str:
    if not groups:
        return '<p class="workspace-group-empty">No groups yet.</p>'
    rows = []
    for group in groups:
        name = row_value(group, "name")
        group_id = int(row_value(group, "id") or 0)
        active = " active" if selected_group_id == group_id else ""
        joined = bool(int(row_value(group, "joined") or 0))
        slack_url = row_value(group, "slack_url") or ""
        slack_channel_name = row_value(group, "slack_channel_name") or "Slack"
        join_action = (
            '<span class="workspace-group-joined">Joined</span>'
            if joined
            else f'<form method="post" action="/admin/workspace/group/join"><input type="hidden" name="group_id" value="{group_id}"><button type="submit">Join</button></form>'
        )
        slack_action = (
            f'<a class="workspace-group-slack" href="{escape(slack_url)}" target="_blank" rel="noopener">Open #{escape(slack_channel_name)}</a>'
            if slack_url
            else (
                f'<form method="post" action="/admin/workspace/group/slack" class="workspace-group-slack-form">'
                f'<input type="hidden" name="group_id" value="{group_id}">'
                f'<input name="slack_url" maxlength="600" placeholder="Fallback Slack link">'
                f'<button type="submit">Save</button></form>'
            )
        )
        rows.append(
            f"""
            <article class="workspace-group-chip{active}" data-workspace-group-item data-group-name="{escape(name).lower()}">
              <div class="workspace-group-row">
                <a class="workspace-group-main" href="/admin/workspace?group={group_id}"><b>{escape(name)}</b><span>{escape(str(row_value(group, "member_count") or 0))} members</span></a>
                {join_action}
              </div>
              <div class="workspace-group-actions">
                {slack_action}
              </div>
            </article>
            """
        )
    return "\n".join(rows)


def render_workspace_group_options(groups: list[sqlite3.Row], selected_group_id: int | None = None) -> str:
    options = ['<option value="">Company feed</option>']
    for group in groups:
        group_id = int(row_value(group, "id") or 0)
        selected = " selected" if selected_group_id == group_id else ""
        options.append(f'<option value="{group_id}"{selected}>{escape(row_value(group, "name"))}</option>')
    return "".join(options)


def normalize_slack_url(value: str) -> str:
    url = (value or "").strip()
    if not url:
        return ""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme in {"http", "https"} and "slack.com" in parsed.netloc.lower():
        return url[:600]
    return ""


def normalize_workspace_visibility(value: str, user: sqlite3.Row) -> str:
    visibility = (value or "COMPANY").upper().strip()
    if visibility == "ADMIN" and is_admin_user(user):
        return "ADMIN"
    return "COMPANY"


def workspace_visibility_label(row: sqlite3.Row | dict[str, object] | None) -> str:
    visibility = str(row_value(row, "visibility") or "COMPANY").upper().strip()
    if visibility == "ADMIN":
        return "Admin only"
    return "Company"


def workspace_role_label(row: sqlite3.Row | dict[str, object] | None) -> str:
    if row_value(row, "author_is_admin") in {1, "1", True} or row_value(row, "author_role") == ROLE_ADMIN:
        return "Admin"
    if row_value(row, "author_role") == ROLE_EMPLOYEE:
        return "Employee"
    return "Staff"


def safe_workspace_link(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme.lower() in {"http", "https", "mailto", "tel"}:
        return escape(url.strip())
    return "#"


def render_workspace_inline_markup(text: str) -> str:
    rendered = escape(text)

    def link_replacer(match: re.Match[str]) -> str:
        label = match.group(1).strip()
        url = html.unescape(match.group(2).strip())
        if not label or not url:
            return match.group(0)
        return f'<a href="{safe_workspace_link(url)}" target="_blank" rel="noopener">{label}</a>'

    rendered = re.sub(r"\[([^\]\n]{1,100})\]\(([^)\s]{1,400})\)", link_replacer, rendered)
    rendered = re.sub(r"\*\*([^*\n][^*\n]*?)\*\*", r"<strong>\1</strong>", rendered)
    rendered = re.sub(r"__([^_\n][^_\n]*?)__", r"<u>\1</u>", rendered)
    rendered = re.sub(r"(?<!\*)\*([^*\n][^*\n]*?)\*(?!\*)", r"<em>\1</em>", rendered)
    return rendered


def render_workspace_post_body(body: str) -> str:
    lines = body.splitlines()
    blocks: list[str] = []
    list_items: list[str] = []
    ordered_items: list[str] = []

    def flush_lists() -> None:
        nonlocal list_items, ordered_items
        if list_items:
            blocks.append("<ul>" + "".join(list_items) + "</ul>")
            list_items = []
        if ordered_items:
            blocks.append("<ol>" + "".join(ordered_items) + "</ol>")
            ordered_items = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            flush_lists()
            continue
        if stripped.startswith("- "):
            if ordered_items:
                flush_lists()
            list_items.append(f"<li>{render_workspace_inline_markup(stripped[2:].strip())}</li>")
            continue
        ordered_match = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if ordered_match:
            if list_items:
                flush_lists()
            ordered_items.append(f"<li>{render_workspace_inline_markup(ordered_match.group(1).strip())}</li>")
            continue
        flush_lists()
        if stripped.startswith("> "):
            blocks.append(f"<blockquote>{render_workspace_inline_markup(stripped[2:].strip())}</blockquote>")
        else:
            blocks.append(f"<p>{render_workspace_inline_markup(stripped)}</p>")
    flush_lists()
    return "".join(blocks) or "<p></p>"


def render_workspace_comments(post_id: int) -> str:
    comments = get_workspace_post_comments(post_id)
    if not comments:
        return ""
    comment_items = []
    for comment in comments:
        comment_author = row_value(comment, "author_name") or "FairFares Staff"
        comment_items.append(
            f"""
            <article>
              <b>{escape(comment_author)}</b>
              <span>{escape(row_value(comment, "body"))}</span>
            </article>
            """
        )
    return f'<div class="workspace-comments">{"".join(comment_items)}</div>'


def render_workspace_posts(posts: list[sqlite3.Row]) -> str:
    if not posts:
        return """
        <article class="admin-feed-card workspace-empty-feed">
          <div class="admin-feed-head">
            <span class="admin-feed-avatar">FF</span>
            <div><b>No profile posts yet</b><span>Workspace feed</span></div>
          </div>
          <h2>Share the first team update</h2>
          <p>Posts created here are saved under your staff profile and visible in the workspace feed.</p>
        </article>
        """
    cards = []
    for post in posts:
        post_id = int(row_value(post, "id") or 0)
        author_name = row_value(post, "author_name") or "FairFares Staff"
        author_initials = "".join(part[:1] for part in author_name.split()[:2]).upper() or "FF"
        photo = row_value(post, "author_photo")
        avatar_style = (
            f' style="background-image:url(&quot;{escape(photo)}&quot;);background-size:cover;background-position:center;"'
            if photo
            else ""
        )
        image = row_value(post, "image_data") or row_value(post, "media_url")
        image_html = ""
        if image:
            image_html = f'<img class="workspace-post-image" src="{escape(image)}" alt="Workspace post image">'
        comments_html = render_workspace_comments(post_id)
        viewer_reaction = row_value(post, "viewer_reaction")
        reaction_emoji, reaction_label = workspace_reaction_button_label(viewer_reaction)
        reaction_options = "".join(
            f"""
            <button type="submit" name="reaction" value="{escape(key)}" title="{escape(label)}" aria-label="{escape(label)}">
              <span>{escape(emoji)}</span>
            </button>
            """
            for key, emoji, label in WORKSPACE_REACTIONS
        )
        cards.append(
            f"""
            <article class="admin-feed-card workspace-post-card" data-workspace-post-id="{post_id}">
              <div class="admin-feed-head">
                <span class="admin-feed-avatar"{avatar_style}>{"" if photo else escape(author_initials)}</span>
                <div>
                  <b>{escape(author_name)}</b>
                  <span>{escape(workspace_role_label(post))} - {escape(workspace_visibility_label(post))} - {escape(row_value(post, "post_type").title())} - {escape(row_value(post, "created_at"))}</span>
                </div>
                <button type="button" data-workspace-post-menu aria-expanded="false" aria-label="Open post menu">...</button>
                <div class="workspace-post-menu" hidden>
                  <button type="button" data-workspace-post-edit>Edit post</button>
                </div>
              </div>
              <div class="workspace-post-body">{render_workspace_post_body(row_value(post, "body"))}</div>
              <form method="post" action="/admin/workspace/post/update" class="workspace-post-edit-form workspace-post-form" hidden>
                <input type="hidden" name="post_id" value="{escape(row_value(post, "id"))}">
                <label><span>Edit post</span><textarea name="body" rows="5" maxlength="1200">{escape(row_value(post, "body"))}</textarea></label>
                <div class="workspace-editor-toolbar" aria-label="Editing tools">
                  <button type="button" data-editor-command="bold"><b>B</b></button>
                  <button type="button" data-editor-command="italic"><i>I</i></button>
                  <button type="button" data-editor-command="underline"><u>U</u></button>
                  <button type="button" data-editor-command="bullet">List</button>
                  <button type="button" data-editor-command="number">1.</button>
                  <button type="button" data-editor-command="quote">Quote</button>
                  <button type="button" data-editor-command="link">Link</button>
                  <button type="button" data-editor-command="clear">Clear</button>
                </div>
                <div class="workspace-edit-actions">
                  <button type="submit">Save changes</button>
                  <button type="button" data-workspace-post-cancel>Edit later</button>
                </div>
              </form>
              {image_html}
              <div class="workspace-post-stats">
                <span data-workspace-reaction-count>{escape(workspace_reaction_summary(post_id))}</span>
                <span data-workspace-comment-count>{escape(str(row_value(post, "comment_count") or 0))} comments</span>
              </div>
              <div class="admin-feed-social-row" aria-label="Feed actions">
                <form method="post" action="/admin/workspace/post/react" class="workspace-reaction-form" data-workspace-reaction-form>
                  <input type="hidden" name="post_id" value="{escape(row_value(post, "id"))}">
                  <input type="hidden" name="reaction" value="{escape(viewer_reaction or "LIKE")}" data-workspace-reaction-value>
                  <button type="submit" class="workspace-reaction-main" data-workspace-reaction-main>
                    <span data-workspace-reaction-emoji>{escape(reaction_emoji)}</span>
                    <b data-workspace-reaction-label>{escape(reaction_label)}</b>
                  </button>
                  <div class="workspace-reaction-tray" role="menu" aria-label="Choose reaction">
                    {reaction_options}
                  </div>
                </form>
                <button type="button" data-workspace-comment-toggle><i class="workspace-button-icon" aria-hidden="true">&#9998;</i>Comment</button>
                <form method="post" action="/admin/workspace/post/share-slack" data-workspace-share-form>
                  <input type="hidden" name="post_id" value="{escape(row_value(post, "id"))}">
                  <button type="submit"><i class="workspace-button-icon" aria-hidden="true">&#10148;</i>Share to Slack</button>
                </form>
              </div>
              <div data-workspace-comments>{comments_html}</div>
              <form method="post" action="/admin/workspace/post/comment" class="workspace-comment-form" hidden>
                <input type="hidden" name="post_id" value="{escape(row_value(post, "id"))}">
                <input name="body" maxlength="360" placeholder="Write a comment">
                <button type="submit">Post</button>
              </form>
            </article>
            """
        )
    return "\n".join(cards)


def get_website_feedback(limit: int = 25) -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT app_feedback.*, users.name AS user_name, users.email AS user_email
            FROM app_feedback
            LEFT JOIN users ON users.id = app_feedback.user_id
            ORDER BY app_feedback.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()


def assistant_user_role(user: sqlite3.Row | None) -> str:
    if not user:
        return "guest"
    if is_staff_user(user):
        return "admin"
    return "user"


def assistant_car_context(limit: int = 5) -> list[dict[str, object]]:
    cars = [
        car for car in get_cars()
        if str(row_value(car, "status") or "").upper().strip() == "AVAILABLE"
    ]
    cars.sort(key=lambda car: float(row_value(car, "daily_price") or 0))
    return [
        {
            "id": row_value(car, "id"),
            "name": row_value(car, "name"),
            "category": row_value(car, "category"),
            "fuel": row_value(car, "fuel_type"),
            "daily_price": float(row_value(car, "daily_price") or 0),
            "seats": row_value(car, "seats"),
            "bags": row_value(car, "bags"),
            "status": row_value(car, "status"),
            "select_url": f"/manage-booking?car_id={row_value(car, 'id')}",
        }
        for car in cars[:limit]
    ]


def assistant_booking_context(user: sqlite3.Row | None) -> dict[str, object] | None:
    if not user:
        return None
    booking = get_booking_for_user(int(user["id"]))
    if not booking:
        return None
    breakdown = booking_price_breakdown(booking)
    return {
        "booking_id": row_value(booking, "booking_id"),
        "car": row_value(booking, "car_name"),
        "status": booking_status_label(row_value(booking, "booking_status"), row_value(booking, "payment_status")),
        "raw_status": row_value(booking, "booking_status"),
        "pickup": f"{row_value(booking, 'pickup_location')} · {row_value(booking, 'pickup_date')} {row_value(booking, 'pickup_time')}",
        "dropoff": f"{row_value(booking, 'dropoff_location')} · {row_value(booking, 'dropoff_date')} {row_value(booking, 'dropoff_time')}",
        "total": format_money(breakdown["total"]),
        "due_now": format_money(breakdown["booking_hold"]),
        "due_at_pickup": format_money(breakdown["due_at_pickup"]),
        "manage_url": "/manage-booking",
        "cancel_url": "/manage-booking?agent=cancel#cancel",
        "documents_url": "/manage-booking?agent=documents#documents",
    }


def assistant_database_context(question: str, user: sqlite3.Row | None, include_internal: bool) -> dict[str, object]:
    articles = search_wiki_articles(question, include_internal=include_internal)
    context: dict[str, object] = {
        "role": assistant_user_role(user),
        "cars": assistant_car_context(),
        "booking": assistant_booking_context(user),
        "wiki": [
            {
                "title": row_value(article, "title"),
                "body": row_value(article, "body"),
                "visibility": row_value(article, "visibility"),
            }
            for article in articles[:4]
        ],
    }
    if include_internal:
        context["fleet"] = get_fleet_summary()
        context["admin_metrics"] = get_admin_metrics()
    return context


def assistant_actions(question: str, context: dict[str, object]) -> list[dict[str, str]]:
    lower = question.lower()
    cars = context.get("cars") if isinstance(context.get("cars"), list) else []
    booking = context.get("booking") if isinstance(context.get("booking"), dict) else None
    actions: list[dict[str, str]] = []
    if any(word in lower for word in ("book", "cheapest", "car", "suv", "sedan", "select")):
        cheapest = cars[0] if cars else None
        if isinstance(cheapest, dict):
            actions.append({"label": f"Book {cheapest['name']}", "href": str(cheapest["select_url"]), "kind": "book"})
        actions.append({"label": "Browse all cars", "href": "/#results", "kind": "browse"})
    if any(word in lower for word in ("cancel", "refund")):
        actions.append({"label": "Review cancellation", "href": "/manage-booking?agent=cancel#cancel", "kind": "cancel"})
    if any(word in lower for word in ("booking", "pickup", "drop", "receipt", "invoice", "document", "agreement")) and booking:
        actions.append({"label": "Open my booking", "href": "/manage-booking", "kind": "booking"})
        actions.append({"label": "Download documents", "href": "/manage-booking?agent=documents#documents", "kind": "documents"})
    if any(word in lower for word in ("support", "help", "issue", "problem")):
        actions.append({"label": "Open support", "href": "/manage-booking?agent=support#support", "kind": "support"})
    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for action in actions:
        key = action["href"] + action["label"]
        if key not in seen:
            deduped.append(action)
            seen.add(key)
    return deduped[:4]


def local_assistant_answer(question: str, context: dict[str, object]) -> str:
    lower = question.lower()
    cars = context.get("cars") if isinstance(context.get("cars"), list) else []
    booking = context.get("booking") if isinstance(context.get("booking"), dict) else None
    wiki = context.get("wiki") if isinstance(context.get("wiki"), list) else []
    if any(word in lower for word in ("cheapest", "cheap", "lowest", "price", "car", "suv", "sedan", "book")) and cars:
        cheapest = cars[0]
        return (
            f"The lowest available option I see is {cheapest['name']} at "
            f"{format_money(float(cheapest['daily_price']))}/day. I can take you to checkout or show all cars."
        )
    if booking and any(word in lower for word in ("my booking", "pickup", "drop", "status", "receipt", "invoice", "document")):
        return (
            f"Your booking {booking['booking_id']} is {booking['status']} for {booking['car']}. "
            f"Pickup: {booking['pickup']}. Total estimate: {booking['total']}; due now: {booking['due_now']}; "
            f"due at pickup: {booking['due_at_pickup']}."
        )
    if any(word in lower for word in ("cancel", "refund")):
        policy = wiki[0] if wiki else None
        policy_text = f" {policy['title']}: {policy['body']}" if isinstance(policy, dict) else ""
        return (
            "Cancellation and refund review depends on timing, booking status, payment record, and provider terms."
            f"{policy_text} I can open your cancellation screen so you can confirm the request."
        )
    if any(word in lower for word in ("admin", "database", "fleet", "users")) and context.get("role") == "admin":
        metrics = context.get("admin_metrics") or {}
        return (
            "Admin database snapshot: "
            f"{row_value(metrics, 'available') if isinstance(metrics, dict) else ''} available cars, "
            f"{row_value(metrics, 'booked') if isinstance(metrics, dict) else ''} bookings, "
            f"{row_value(metrics, 'users') if isinstance(metrics, dict) else ''} student users."
        )
    if wiki:
        primary = wiki[0]
        return f"{primary['title']}: {primary['body']}"
    return (
        "I can help with cars, booking status, cancellation, refunds, receipts, Explorer trips, discounts, and support. "
        "Ask for the cheapest car, your pickup time, refund policy, or help booking."
    )


def truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def slugify_mcp_label(value: object, fallback: str) -> str:
    label = re.sub(r"[^A-Za-z0-9_-]+", "_", str(value or "").strip()).strip("_")
    return (label or fallback)[:64]


def parse_openai_agent_mcp_servers() -> list[dict[str, object]]:
    raw = os.environ.get(OPENAI_AGENT_MCP_SERVERS_ENV, "").strip()
    if not raw:
        return []
    servers: list[object]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        servers = [item.strip() for item in raw.split(",") if item.strip()]
    else:
        if isinstance(parsed, dict):
            servers = parsed.get("servers", []) if isinstance(parsed.get("servers"), list) else [parsed]
        elif isinstance(parsed, list):
            servers = parsed
        else:
            servers = []

    allow_unrestricted = truthy_env(os.environ.get(OPENAI_AGENT_MCP_ALLOW_UNRESTRICTED_ENV))
    tools: list[dict[str, object]] = []
    for index, server in enumerate(servers, start=1):
        config: dict[str, object]
        if isinstance(server, str):
            config = {"server_url": server}
        elif isinstance(server, dict):
            config = dict(server)
        else:
            continue

        server_url = str(config.get("server_url") or config.get("url") or "").strip()
        if not server_url.startswith(("https://", "http://")):
            continue

        normalized_server_url = server_url.rstrip("/")
        known_readonly_mcp = normalized_server_url in OPENAI_READONLY_MCP_SERVER_URLS
        allowed_tools = config.get("allowed_tools")
        if isinstance(allowed_tools, str):
            allowed_tools = [item.strip() for item in allowed_tools.split(",") if item.strip()]
        if allowed_tools is not None and not isinstance(allowed_tools, list):
            allowed_tools = None
        if known_readonly_mcp and not truthy_env(str(config.get("force_allowed_tools") or "")):
            allowed_tools = None
        if not allowed_tools and not allow_unrestricted and not known_readonly_mcp:
            continue

        tool: dict[str, object] = {
            "type": "mcp",
            "server_label": slugify_mcp_label(
                config.get("server_label") or config.get("label") or config.get("name"),
                f"mcp_{index}",
            ),
            "server_url": server_url,
            "require_approval": str(config.get("require_approval") or "never"),
        }
        if allowed_tools:
            tool["allowed_tools"] = [str(item) for item in allowed_tools if str(item).strip()]

        authorization = str(config.get("authorization") or "").strip()
        authorization_env = str(config.get("authorization_env") or "").strip()
        bearer_env = str(config.get("bearer_token_env") or "").strip()
        if authorization_env:
            authorization = os.environ.get(authorization_env, "").strip()
        bearer_token = os.environ.get(bearer_env, "").strip() if bearer_env else ""
        if bearer_token:
            authorization = f"Bearer {bearer_token}"
        if authorization:
            tool["authorization"] = authorization
        tools.append(tool)
    return tools[:5]


def build_openai_assistant_payload(question: str, context: dict[str, object]) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": os.environ.get("OPENAI_AGENT_MODEL", "gpt-4o-mini"),
        "input": [
            {
                "role": "system",
                "content": (
                    "You are FairFares Assistant. Answer using only the provided FairFares context and configured MCP tools. "
                    "Respect role permissions. Use MCP tools only for relevant read-only lookups. "
                    "Do not claim you completed booking, cancellation, refund, payment, profile, or admin changes; "
                    "tell the user which action button to use for those steps. Keep answers concise."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({"question": question, "context": context}, default=str),
            },
        ],
        "max_output_tokens": 360,
    }
    mcp_tools = parse_openai_agent_mcp_servers()
    if mcp_tools:
        payload["tools"] = mcp_tools
    return payload


def openai_assistant_answer(question: str, context: dict[str, object]) -> str | None:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return None
    payload = build_openai_assistant_payload(question, context)
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            error_body = exc.read().decode("utf-8", errors="replace")[:1000]
        except Exception:
            error_body = ""
        print(f"FairFares assistant OpenAI error {exc.code}: {error_body}", flush=True)
        return None
    except Exception:
        print("FairFares assistant OpenAI request failed.", flush=True)
        return None
    output_text = data.get("output_text")
    if output_text:
        return str(output_text).strip()
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return " ".join(chunks).strip() or None


def search_wiki_articles(query: str = "", include_internal: bool = False) -> list[sqlite3.Row]:
    clean_query = " ".join((query or "").split())[:120]
    clauses = ["status = 'PUBLISHED'"]
    params: list[object] = []
    if not include_internal:
        clauses.append("visibility = 'PUBLIC'")
    if clean_query:
        like = f"%{clean_query.lower()}%"
        clauses.append(
            "(LOWER(title) LIKE ? OR LOWER(subtitle) LIKE ? OR LOWER(body) LIKE ? OR LOWER(tags) LIKE ?)"
        )
        params.extend([like, like, like, like])
    where = " AND ".join(clauses)
    with db() as con:
        return con.execute(
            f"""
            SELECT wiki_articles.*, users.name AS author_name
            FROM wiki_articles
            LEFT JOIN users ON users.id = wiki_articles.created_by
            WHERE {where}
            ORDER BY
              CASE visibility WHEN 'PUBLIC' THEN 0 ELSE 1 END,
              updated_at DESC,
              id DESC
            """,
            params,
        ).fetchall()


def get_wiki_article(article_id: int, include_internal: bool = False) -> sqlite3.Row | None:
    clauses = ["id = ?", "status = 'PUBLISHED'"]
    params: list[object] = [article_id]
    if not include_internal:
        clauses.append("visibility = 'PUBLIC'")
    with db() as con:
        return con.execute(
            f"SELECT * FROM wiki_articles WHERE {' AND '.join(clauses)}",
            params,
        ).fetchone()


def get_booking_for_user(user_id: int) -> sqlite3.Row | None:
    expire_stale_booking_holds()
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.seats, cars.bags,
                   cars.doors, cars.transmission, cars.color, cars.image_url, cars.daily_price
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
    expire_stale_booking_holds()
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*, cars.name AS car_name, cars.category, cars.color, cars.image_url, cars.daily_price
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
        trip_type = "past" if status in {"CANCELLED", "RETURNED", "EXPIRED_HOLD"} else "upcoming"
        if row_value(booking, "saved_by_user"):
            trip_type = f"{trip_type} favorites"
        status_text = booking_status_label(status, row_value(booking, "payment_status"))
        breakdown = booking_price_breakdown(booking)
        paid_amount = booking_paid_amount(booking)
        details = {
            "bookingId": public_booking_id_label(booking),
            "car": booking["car_name"],
            "status": status,
            "statusText": status_text,
            "payment": payment_status_label(row_value(booking, "payment_status")),
            "paid": format_money(paid_amount),
            "pickupBalance": format_money(breakdown["due_at_pickup"]),
            "pickup": f"{booking['pickup_location']} | {booking['pickup_date']} {booking['pickup_time']}",
            "dropoff": f"{booking['dropoff_location']} | {booking['dropoff_date']} {booking['dropoff_time']}",
            "provider": booking["provider"],
            "reason": row_value(booking, "cancellation_reason") or "No request notes saved.",
            "image": row_value(booking, "image_url") or "",
            "price": f"{format_money(breakdown['total'])} total",
        }
        details_json = escape(json.dumps(details))
        image_alt = vehicle_image_alt(
            {
                "car_name": booking["car_name"],
                "category": row_value(booking, "category"),
                "pickup_location": booking["pickup_location"],
            }
        )
        rows.append(
            f"""
            <button class="mini-trip" type="button" data-trip-type="{escape(trip_type)}" data-trip-details="{details_json}">
              {'<img src="' + escape(details["image"]) + '" alt="' + escape(image_alt) + '">' if details["image"] else '<div class="mini-car"></div>'}
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
        image_alt = vehicle_image_alt(
            {
                "car_name": saved["car_name"],
                "category": row_value(saved, "category"),
                "location": saved["pickup_location"] or saved["location"],
            }
        )
        rows.append(
            f"""
            <div class="mini-trip saved-mini-trip" role="button" tabindex="0" data-trip-type="favorites" data-trip-details="{details_json}">
              {'<img src="' + escape(details["image"]) + '" alt="' + escape(image_alt) + '">' if details["image"] else '<div class="mini-car"></div>'}
              <span>{escape(saved["car_name"])}<br><small>{escape(details["pickup"])} · Saved car</small></span>
              <button class="light-button mini-trip-remove" type="button" data-unsave-car-id="{saved["car_id"]}">Remove saved</button>
            </div>
            """
        )
    return "\n".join(rows)


def booking_status_label(status: str, payment_status: str = "") -> str:
    if status == "PENDING_HOLD":
        return "Payment window"
    if status == "EXPIRED_HOLD":
        return "Expired"
    if status == "CONFIRMED":
        if payment_status == "PAID":
            return "Confirmed / Paid in full"
        return "Confirmed" if payment_status == "HOLD_PAID" else "Confirmed / Pay at pickup"
    labels = {
        "CANCELLATION_REQUESTED": "Request sent to admin",
        "CANCELLED": "Cancelled",
        "MODIFIED": "Modification sent to admin",
        "PICKED_UP": "Picked up",
        "RETURNED": "Returned",
    }
    return labels.get(status, status.replace("_", " ").title())


def booking_status_class(status: str) -> str:
    if status in {"CANCELLATION_REQUESTED", "MODIFIED", "PENDING_HOLD"}:
        return "status-pending"
    if status in {"CANCELLED", "RETURNED", "EXPIRED_HOLD"}:
        return "status-muted"
    return "status-confirmed"


def payment_status_label(status: str) -> str:
    labels = {
        "PAY_AT_PICKUP": "Pay at pickup",
        "HOLD_PENDING": "Payment pending",
        "HOLD_EXPIRED": "Expired",
        "HOLD_DUE": "10% due now",
        "HOLD_PAID": "10% paid",
        "PAID": "Paid in full",
        "PENDING": "Payment pending",
        "REFUND_REVIEW": "Refund review",
        "REFUNDED": "Refunded",
        "FAILED": "Payment failed",
    }
    return labels.get(status, status.replace("_", " ").title())


def admin_payment_summary(row: sqlite3.Row | dict[str, object]) -> tuple[str, str]:
    payment_status = row_value(row, "payment_status")
    breakdown = booking_price_breakdown(row)
    if payment_status == "PAID":
        return "Paid in full", "Pickup balance $0.00"
    if payment_status == "HOLD_PAID":
        return "10% hold paid", f"Pickup balance due {format_money(breakdown['due_at_pickup'])}"
    if payment_status == "HOLD_PENDING":
        return "Hold payment pending", f"10% due now {format_money(breakdown['booking_hold'])}"
    if payment_status == "HOLD_EXPIRED":
        return "Payment window expired", "Restart checkout before pickup"
    if payment_status == "REFUNDED":
        return "Refunded", "Pickup balance $0.00"
    if payment_status == "REFUND_REVIEW":
        return "Refund review", "Admin follow-up needed"
    return payment_status_label(payment_status), f"Pickup balance {format_money(breakdown['due_at_pickup'])}"


def booking_payment_records(booking_id: int | None) -> list[sqlite3.Row]:
    if not booking_id:
        return []
    with db() as con:
        return con.execute(
            """
            SELECT *
            FROM transactions
            WHERE booking_id = ?
            ORDER BY id ASC
            """,
            (booking_id,),
        ).fetchall()


def booking_paid_amount(row: sqlite3.Row | dict[str, object] | None) -> float:
    if not row:
        return 0.0
    transactions = booking_payment_records(int(row_value(row, "id") or 0))
    paid_total = round(
        sum(
            float(row_value(transaction, "amount") or 0)
            for transaction in transactions
            if row_value(transaction, "transaction_status") in {"PAID", "HOLD_PAID"}
        ),
        2,
    )
    if paid_total > 0:
        return paid_total
    breakdown = booking_price_breakdown(row)
    payment_status = row_value(row, "payment_status")
    if payment_status == "PAID":
        return round(float(row_value(row, "total_price") or breakdown["total"] or 0), 2)
    if payment_status == "HOLD_PAID":
        return round(float(row_value(row, "booking_hold_amount") or breakdown["booking_hold"] or 0), 2)
    return 0.0


def booking_refund_estimate(row: sqlite3.Row | dict[str, object] | None) -> tuple[float, str]:
    if not row:
        return 0.0, "No booking selected."
    if row_value(row, "payment_status") == "REFUNDED":
        return 0.0, "This booking has already been refunded."
    paid_amount = booking_paid_amount(row)
    payment_status = row_value(row, "payment_status")
    if payment_status in {"PAID", "HOLD_PAID", "REFUND_REVIEW"} and paid_amount > 0:
        return paid_amount, f"Based on {payment_status_label(payment_status).lower()} currently recorded."
    return 0.0, "No online payment has been recorded for this booking yet."


def cancellation_requires_admin_review(
    booking: sqlite3.Row | dict[str, object] | None,
    now: datetime | None = None,
) -> bool:
    if not booking:
        return True
    if row_value(booking, "payment_status") == "PAID":
        return True
    pickup_at = booking_datetime_from_row(booking, "pickup_date", "pickup_time")
    if not pickup_at:
        return True
    return pickup_at - (now or datetime.now()) < timedelta(hours=24)


def booking_payment_record_summary(row: sqlite3.Row | dict[str, object]) -> dict[str, object]:
    transactions = booking_payment_records(int(row_value(row, "id") or 0))
    paid_transactions = [
        transaction for transaction in transactions
        if row_value(transaction, "transaction_status") in {"PAID", "HOLD_PAID"}
    ]
    refunded_transactions = [
        transaction for transaction in transactions
        if row_value(transaction, "transaction_status") == "REFUNDED"
    ]
    paid_amount = round(sum(float(row_value(transaction, "amount") or 0) for transaction in paid_transactions), 2)
    refunded_amount = round(sum(float(row_value(transaction, "amount") or 0) for transaction in refunded_transactions), 2)
    references = [
        row_value(transaction, "invoice_number")
        for transaction in transactions
        if row_value(transaction, "invoice_number")
    ]
    methods = [
        row_value(transaction, "payment_method")
        for transaction in transactions
        if row_value(transaction, "payment_method")
    ]
    return {
        "paid_amount": paid_amount or booking_paid_amount(row),
        "refunded_amount": refunded_amount,
        "references": references,
        "methods": methods,
        "count": len(transactions),
    }


def public_booking_id_label(row: sqlite3.Row | dict[str, object] | None) -> str:
    if not row:
        return "No booking yet"
    if row_value(row, "payment_status") in {"HOLD_PAID", "PAID"}:
        return row_value(row, "booking_id") or "Confirmed booking"
    return "Pending confirmation"


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


def queue_oncall_escalation_alert(con: sqlite3.Connection, ticket: sqlite3.Row, escalator: sqlite3.Row | None, reason: str) -> None:
    escalator_label = f"{row_value(escalator, 'name')} ({row_value(escalator, 'email')})" if escalator else "System auto-escalation"
    oncall = get_oncall_shift_for_day()
    oncall_label = (
        f"{row_value(oncall, 'admin_name')} ({row_value(oncall, 'admin_email')})"
        if oncall
        else "No on-call admin assigned today"
    )
    body = (
        "On-call admin escalation\n"
        f"Ticket: {row_value(ticket, 'ticket_id')}\n"
        f"Assigned on-call admin: {oncall_label}\n"
        f"Original priority: {normalize_support_priority(row_value(ticket, 'priority'))}\n"
        f"Escalated by: {escalator_label}\n"
        f"Reason: {reason}\n"
        f"Topic: {row_value(ticket, 'topic')}\n"
        f"Message: {row_value(ticket, 'message') or '-'}"
    )
    queue_support_alerts(
        con,
        int(row_value(ticket, "id") or 0),
        row_value(ticket, "ticket_id"),
        "P0",
        f"On-call escalation: FairFares ticket {row_value(ticket, 'ticket_id')}",
        body,
    )


def get_admin_tickets() -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT support_tickets.*, users.name AS user_name, users.email AS user_email,
                   bookings.booking_id,
                   escalator.name AS escalated_by_name,
                   escalator.email AS escalated_by_email,
                   (
                       SELECT GROUP_CONCAT(channel || ': ' || delivery_status, ' | ')
                       FROM support_alerts
                       WHERE support_alerts.ticket_id = support_tickets.id
                   ) AS alert_summary
            FROM support_tickets
            JOIN users ON users.id = support_tickets.user_id
            LEFT JOIN users escalator ON escalator.id = support_tickets.escalated_by
            LEFT JOIN bookings ON bookings.id = support_tickets.booking_id
            ORDER BY CASE support_tickets.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'FOLLOWUP' THEN 2 ELSE 3 END,
                     CASE support_tickets.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                     support_tickets.urgent DESC,
                     support_tickets.id DESC
            LIMIT 100
            """
        ).fetchall()


def sort_tickets_for_admin(rows: list[sqlite3.Row], user: sqlite3.Row, today_oncall: sqlite3.Row | None) -> list[sqlite3.Row]:
    viewer_id = int(row_value(user, "id") or 0)
    oncall_id = int(row_value(today_oncall, "admin_user_id") or 0)
    viewer_is_oncall = bool(viewer_id and viewer_id == oncall_id)
    status_rank = {"OPEN": 0, "IN_PROGRESS": 1, "FOLLOWUP": 2, "CLOSED": 3}
    priority_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}

    def key(row: sqlite3.Row) -> tuple[int, int, int, int, int]:
        status = row_value(row, "status")
        priority = normalize_support_priority(row_value(row, "priority"))
        escalated = bool(int(row_value(row, "escalated_to_oncall") or 0))
        urgent = bool(int(row_value(row, "urgent") or 0)) or priority in {"P0", "P1"}
        open_ticket = status != "CLOSED"
        mine_oncall_urgent = viewer_is_oncall and open_ticket and (escalated or priority == "P0")
        any_escalated_urgent = open_ticket and (escalated or urgent)
        return (
            0 if mine_oncall_urgent else 1,
            0 if any_escalated_urgent else 1,
            status_rank.get(status, 4),
            priority_rank.get(priority, 4),
            -int(row_value(row, "id") or 0),
        )

    return sorted(rows, key=key)


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


def get_support_tickets_for_user(user_id: int) -> list[sqlite3.Row]:
    with db() as con:
        return con.execute(
            """
            SELECT support_tickets.*, bookings.booking_id AS public_booking_id,
                   cars.name AS booked_car_name
            FROM support_tickets
            LEFT JOIN bookings ON bookings.id = support_tickets.booking_id
            LEFT JOIN cars ON cars.id = bookings.car_id
            WHERE support_tickets.user_id = ?
            ORDER BY support_tickets.id DESC
            LIMIT 12
            """,
            (user_id,),
        ).fetchall()


def render_support_history(tickets: list[sqlite3.Row], current_booking_id: int | None) -> tuple[str, str]:
    current_ticket = ""
    old_rows = []
    for ticket in tickets:
        ticket_booking_id = int(row_value(ticket, "booking_id") or 0)
        ticket_booking_label = row_value(ticket, "public_booking_id") or "No booking"
        status = row_value(ticket, "status").replace("_", " ").title()
        topic = row_value(ticket, "topic") or "Support"
        if current_booking_id and ticket_booking_id == current_booking_id and not current_ticket:
            owner = row_value(ticket, "claimed_by") or "FairFares support"
            comment = row_value(ticket, "admin_comment")
            current_ticket = (
                f"<div class=\"support-summary support-ticket-state\"><b>{escape(owner)} is working on ticket {escape(row_value(ticket, 'ticket_id'))}</b>"
                f"<span>Booking {escape(ticket_booking_label)} · {escape(status)} · {escape(topic)}{(' · ' + escape(comment)) if comment else ''}</span></div>"
            )
            continue
        old_rows.append(
            f"""
            <li>
              <span><b>{escape(row_value(ticket, "ticket_id"))}</b> Booking {escape(ticket_booking_label)} · {escape(status)} · {escape(topic)}</span>
              <button type="button" class="light-button" data-support-continue
                data-ticket-id="{escape(row_value(ticket, "ticket_id"))}"
                data-booking-id="{escape(ticket_booking_label)}"
                data-topic="{escape(topic)}">Continue</button>
            </li>
            """
        )
    if not old_rows:
        return current_ticket, ""
    history = f"""
        <details class="support-history">
          <summary>See old conversations ({len(old_rows)})</summary>
          <ul>{"".join(old_rows)}</ul>
        </details>
    """
    return current_ticket, history


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
    expire_stale_booking_holds()
    with db() as con:
        return con.execute(
            """
            SELECT bookings.*
            FROM bookings
            JOIN cars ON cars.id = bookings.car_id
            WHERE bookings.car_id = ?
              AND UPPER(TRIM(cars.status)) IN ('BOOKED', 'HOLD')
              AND (
                bookings.booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
                OR (
                    bookings.booking_status = 'PENDING_HOLD'
                    AND bookings.payment_status = 'HOLD_PENDING'
                    AND bookings.hold_expires_at IS NOT NULL
                    AND datetime(bookings.hold_expires_at) > datetime('now')
                )
              )
            ORDER BY bookings.id DESC
            LIMIT 1
            """,
            (car_id,),
        ).fetchone()


def active_booking_conflict_for_car(
    car_id: int,
    requested_start: datetime | None,
    requested_end: datetime | None,
    exclude_booking_id: int = 0,
) -> sqlite3.Row | None:
    if not requested_start or not requested_end:
        return active_booking_for_car(car_id)
    expire_stale_booking_holds()
    with db() as con:
        rows = con.execute(
            """
            SELECT bookings.*
            FROM bookings
            WHERE bookings.car_id = ?
              AND bookings.id != ?
              AND (
                bookings.booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
                OR (
                    bookings.booking_status = 'PENDING_HOLD'
                    AND bookings.payment_status = 'HOLD_PENDING'
                    AND bookings.hold_expires_at IS NOT NULL
                    AND datetime(bookings.hold_expires_at) > datetime('now')
                )
              )
            ORDER BY bookings.pickup_date, bookings.pickup_time
            """,
            (car_id, exclude_booking_id or 0),
        ).fetchall()
    for row in rows:
        active_start = parse_booking_datetime(row_value(row, "pickup_date"), row_value(row, "pickup_time"))
        active_end = parse_booking_datetime(row_value(row, "dropoff_date"), row_value(row, "dropoff_time"))
        if not active_start or not active_end:
            continue
        if requested_start < active_end and requested_end > active_start:
            return row
    return None


def booking_datetime_from_row(row: sqlite3.Row, date_key: str, time_key: str) -> datetime | None:
    return parse_booking_datetime(row_value(row, date_key), row_value(row, time_key))


def parse_sqlite_datetime(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text.split(".")[0], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def booking_hold_remaining_seconds(booking: sqlite3.Row | dict[str, object] | None) -> int:
    if not booking or row_value(booking, "booking_status") != "PENDING_HOLD":
        return 0
    expires_at = parse_sqlite_datetime(row_value(booking, "hold_expires_at"))
    if not expires_at:
        return BOOKING_HOLD_MINUTES * 60
    return max(0, int((expires_at - datetime.now()).total_seconds()))


def booking_hold_remaining_label(booking: sqlite3.Row | dict[str, object] | None) -> str:
    seconds = booking_hold_remaining_seconds(booking)
    if seconds <= 0:
        return "Expired"
    minutes = seconds // 60
    remainder = seconds % 60
    return f"{minutes}:{remainder:02d}"


def cancellation_policy_timeline(booking: sqlite3.Row | dict[str, object] | None) -> dict[str, object]:
    pickup_at = booking_datetime_from_row(booking, "pickup_date", "pickup_time") if booking else None
    now = datetime.now()
    hours_until_pickup = max(0.0, (pickup_at - now).total_seconds() / 3600) if pickup_at else 0.0
    days_until_pickup = math.ceil(hours_until_pickup / 24) if hours_until_pickup > 0 else 0
    if days_until_pickup <= 1:
        day_ticks: list[str] = []
    elif days_until_pickup <= 8:
        day_ticks = [f"{day}d" for day in range(1, days_until_pickup)]
    else:
        step = max(1, math.ceil((days_until_pickup - 1) / 7))
        day_ticks = [f"{day}d" for day in range(step, days_until_pickup, step)]
    if not pickup_at:
        day_label = "Pickup date pending"
        cutoff_copy = "The 24-hour cutoff is calculated after pickup is scheduled."
    elif hours_until_pickup >= 24:
        day_label = f"{days_until_pickup} day{'s' if days_until_pickup != 1 else ''} until pickup"
        cutoff_copy = "Cancel before the 24-hour cutoff for automatic review. Hold payments are not accepted after the cutoff."
    else:
        day_label = "Inside 24-hour cutoff"
        cutoff_copy = "Inside 24 hours, cancellations and refunds require admin review. No hold-payment cancellation is automatically accepted."
    return {
        "day_label": day_label,
        "cutoff_copy": cutoff_copy,
        "day_ticks": day_ticks,
    }


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
    pickup_date, return_date, pickup_time, return_time, rental_days, requested_start, requested_end = normalize_booking_window(
        days,
        pickup_date,
        return_date,
        pickup_time,
        return_time,
        strict=True,
    )
    expire_stale_booking_holds()
    candidates = [requested_car] if requested_car else get_cars()
    car = None
    for candidate in candidates:
        if not candidate:
            continue
        if candidate["status"].strip().upper() == "MAINTENANCE":
            continue
        active_booking = active_booking_conflict_for_car(candidate["id"], requested_start, requested_end)
        active_return = parse_booking_datetime(
            active_booking["dropoff_date"],
            active_booking["dropoff_time"],
        ) if active_booking else None
        if requested_start and active_return and requested_start < active_return:
            if requested_car and candidate["id"] == requested_car["id"] and requested_start.date() == active_return.date():
                pickup_date = active_return.strftime("%Y-%m-%d")
                pickup_time = active_return.strftime("%I:%M %p").lstrip("0")
                requested_start = parse_booking_datetime(pickup_date, pickup_time) or requested_start
                rental_days = rental_day_count(requested_start, requested_end, rental_days)
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
        discount_amount = calculate_booking_discount_amount(car["daily_price"], rental_days, discount)
        price_breakdown = rental_price_breakdown(car["daily_price"], rental_days, discount_amount)
        subtotal = float(price_breakdown["base"])
        final_total = float(price_breakdown["total"])
        applied_code = discount["code"] if discount else ""
        default_location = primary_inventory_location(car["location"])
        selected_pickup_location = pickup_location or default_location
        selected_return_location = return_location or selected_pickup_location
        con.execute(
            """
            INSERT INTO bookings
            (booking_id, user_id, car_id, provider, pickup_location, pickup_date, pickup_time,
             dropoff_location, dropoff_date, dropoff_time, days, subtotal_price, discount_code, discount_amount,
             tax_fee_amount, booking_hold_amount, due_at_pickup_amount, estimated_market_total, fairfares_savings_amount,
             total_price, status, booking_status, payment_status, hold_started_at, hold_expires_at, contact_name, contact_email, contact_phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_HOLD', 'HOLD_PENDING', CURRENT_TIMESTAMP, datetime('now', '+10 minutes'), ?, ?, ?)
            """,
            (
                booking_id,
                user_id,
                car["id"],
                "AVIS",
                selected_pickup_location,
                format_booking_date(pickup_date, format_booking_date(default_pickup, "Upcoming pickup")),
                pickup_time or "10:00 AM",
                selected_return_location,
                format_booking_date(return_date, format_booking_date(default_return, "Upcoming return")),
                return_time or "10:00 AM",
                rental_days,
                subtotal,
                applied_code,
                discount_amount,
                price_breakdown["tax_fee_amount"],
                price_breakdown["booking_hold"],
                price_breakdown["due_at_pickup"],
                price_breakdown["market_total"],
                price_breakdown["savings"],
                final_total,
                "PENDING_HOLD",
                (user["name"] or "") if user else "",
                (user["email"] or "") if user else "",
                (user["phone"] or "") if user else "",
            ),
        )
        if applied_code:
            con.execute("UPDATE discounts SET used_count = used_count + 1 WHERE code = ?", (applied_code,))
        con.execute("UPDATE cars SET status = 'HOLD' WHERE id = ?", (car["id"],))
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
    pickup_date, return_date, pickup_time, return_time, rental_days, _requested_start, _requested_end = normalize_booking_window(
        days,
        pickup_date,
        return_date,
        pickup_time,
        return_time,
        strict=False,
    )
    subtotal = round(float(car["daily_price"]) * rental_days, 2)
    discount = get_valid_discount(discount_code)
    discount_amount = calculate_booking_discount_amount(car["daily_price"], rental_days, discount)
    price_breakdown = rental_price_breakdown(car["daily_price"], rental_days, discount_amount)
    default_location = primary_inventory_location(car["location"])
    selected_pickup_location = pickup_location or default_location
    selected_return_location = return_location or selected_pickup_location
    return {
        "id": None,
        "booking_id": "Pending details",
        "car_id": car["id"],
        "provider": "AVIS",
        "pickup_location": selected_pickup_location,
        "pickup_date": format_booking_date(pickup_date, "Upcoming pickup"),
        "pickup_time": pickup_time or "10:00 AM",
        "dropoff_location": selected_return_location,
        "dropoff_date": format_booking_date(return_date, "Upcoming return"),
        "dropoff_time": return_time or "10:00 AM",
        "days": rental_days,
        "subtotal_price": subtotal,
        "discount_code": discount["code"] if discount else "",
        "discount_amount": discount_amount,
        "tax_fee_amount": price_breakdown["tax_fee_amount"],
        "booking_hold_amount": price_breakdown["booking_hold"],
        "due_at_pickup_amount": price_breakdown["due_at_pickup"],
        "estimated_market_total": price_breakdown["market_total"],
        "fairfares_savings_amount": price_breakdown["savings"],
        "total_price": price_breakdown["total"],
        "status": "PENDING_HOLD",
        "booking_status": "PENDING_HOLD",
        "payment_status": "HOLD_PENDING",
        "hold_started_at": "",
        "hold_expires_at": "",
        "car_name": car["name"],
        "category": car["category"],
        "seats": car["seats"],
        "bags": car["bags"],
        "doors": car["doors"],
        "transmission": car["transmission"],
        "color": car["color"],
        "image_url": car["image_url"],
        "daily_price": car["daily_price"],
    }


def find_or_create_guest_user(full_name: str, email: str, phone: str) -> int:
    clean_email = normalize_email(email)
    clean_phone = phone.strip()
    with db() as con:
        existing = find_user_by_email(con, clean_email)
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
        if existing and row_value(existing, "booking_status") in {"PENDING_HOLD", "EXPIRED_HOLD"} and row_value(existing, "payment_status") in {"HOLD_PENDING", "HOLD_EXPIRED"}:
            with db() as con:
                con.execute(
                    """
                    UPDATE bookings
                    SET booking_status = 'EXPIRED_HOLD',
                        payment_status = 'HOLD_EXPIRED',
                        status = 'EXPIRED_HOLD',
                        hold_expires_at = datetime('now', '-1 minute')
                    WHERE id = ?
                    """,
                    (row_value(existing, "id"),),
                )
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'AVAILABLE'
                    WHERE id = ?
                      AND UPPER(TRIM(status)) = 'HOLD'
                    """,
                    (row_value(existing, "car_id"),),
                )
            existing = None
        if (
            existing
            and int(row_value(existing, "car_id") or 0) == car_id
            and row_value(existing, "booking_status") in {"PENDING_HOLD", "CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "PICKED_UP"}
        ):
            return existing
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
        "body": "Thanks for choosing FairFares. Your trip is confirmed for {pickup_date}. Your FairFares savings are carried into your booking, receipt, agreement, and confirmation email. If you bring a lower comparable quote before pickup, we will review it, match the eligible price, and add another 10% off after review.",
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


def default_email_campaign_plans(today: date | None = None) -> list[dict[str, str]]:
    today = today or date.today()
    year = today.year
    next_year = year + 1
    plans = [
        {
            "campaign_date": today.isoformat(),
            "campaign_type": draft["type"],
            "audience": draft["audience"],
            "trigger_rule": draft["timing"],
            "subject_line": draft["subject"],
            "headline": draft["headline"],
            "message_body": draft["body"],
            "cta_label": draft["cta"],
            "status": "DRAFT",
            "notes": "Lifecycle calendar draft. Send a test before sending to subscribers.",
        }
        for draft in EMAIL_MARKETING_DRAFTS
    ]
    plans.extend(
        [
            {
                "campaign_date": (today + timedelta(days=60)).isoformat(),
                "campaign_type": "Re-engagement",
                "audience": "Inactive users",
                "trigger_rule": "60 days inactive",
                "subject_line": "A FairFares offer is waiting for your next ride",
                "headline": "Come back with a cleaner deal.",
                "message_body": "Your next FairFares booking can show savings, documents, and trip details clearly before pickup.",
                "cta_label": "Search Cars",
                "status": "DRAFT",
                "notes": "Calendar item: exclusive offer for 60-day inactive users.",
            },
            {
                "campaign_date": (today + timedelta(days=90)).isoformat(),
                "campaign_type": "Re-engagement",
                "audience": "Inactive users",
                "trigger_rule": "90 days inactive",
                "subject_line": "Ready for another fair ride?",
                "headline": "Come back and save.",
                "message_body": "FairFares keeps pricing transparent, documents easy to find, and Explorer memories ready when you travel again.",
                "cta_label": "Book Again",
                "status": "DRAFT",
                "notes": "Calendar item: comeback offer for 90-day inactive users.",
            },
        ]
    )
    month_dates = {
        "January": date(next_year if today.month > 1 else year, 1, 1),
        "March": date(next_year if today.month > 3 else year, 3, 1),
        "May": date(next_year if today.month > 5 else year, 5, 1),
        "July": date(next_year if today.month > 7 else year, 6, 15),
        "August": date(next_year if today.month > 8 else year, 8, 1),
        "September": date(next_year if today.month > 9 else year, 8, 15),
        "October": date(next_year if today.month > 10 else year, 10, 1),
        "November": date(next_year if today.month > 11 else year, 11, 1),
        "December": date(next_year if today.month > 12 else year, 12, 1),
    }
    for month, title, window in EMAIL_SEASONAL_PLAN:
        plans.append(
            {
                "campaign_date": month_dates[month].isoformat(),
                "campaign_type": "Seasonal",
                "audience": "Subscribed users",
                "trigger_rule": window,
                "subject_line": title,
                "headline": title,
                "message_body": f"Plan the {title.lower()} campaign with one clear offer, one short message, and one FairFares booking action.",
                "cta_label": "Search Cars",
                "status": "DRAFT",
                "notes": f"Seasonal calendar item for {month}. Add offer, artwork, segment, and test send.",
            }
        )
    plans.extend(
        [
            {
                "campaign_date": today.isoformat(),
                "campaign_type": "Behavioral",
                "audience": "Customers with birthdays this month",
                "trigger_rule": "Birthday",
                "subject_line": "A birthday ride from FairFares",
                "headline": "Celebrate with a fairer trip.",
                "message_body": "Add a birthday discount code and keep the message short, warm, and easy to redeem.",
                "cta_label": "Claim Birthday Offer",
                "status": "DRAFT",
                "notes": "Behavioral calendar item: birthday discount.",
            },
            {
                "campaign_date": today.isoformat(),
                "campaign_type": "Behavioral",
                "audience": "Users watching a saved route or car",
                "trigger_rule": "Price drop detected",
                "subject_line": "A lower FairFares price is available",
                "headline": "Your watched trip just got easier.",
                "message_body": "Send only when the new daily price or total estimate is lower than the previous saved view.",
                "cta_label": "View Lower Price",
                "status": "DRAFT",
                "notes": "Behavioral calendar item: price drop detected.",
            },
            {
                "campaign_date": today.isoformat(),
                "campaign_type": "Behavioral",
                "audience": "Users who started but did not finish booking",
                "trigger_rule": "Abandoned booking",
                "subject_line": "Finish your FairFares booking",
                "headline": "Your car search is still saved.",
                "message_body": "Remind the user what they searched for and bring them back to the booking flow.",
                "cta_label": "Complete Booking",
                "status": "DRAFT",
                "notes": "Behavioral calendar item: abandoned booking.",
            },
            {
                "campaign_date": today.isoformat(),
                "campaign_type": "Behavioral",
                "audience": "Returning customers",
                "trigger_rule": "Repeat customer",
                "subject_line": "Welcome back to FairFares",
                "headline": "Your next ride should feel simple too.",
                "message_body": "Thank repeat customers and point them to saved profile, documents, and Explorer memories.",
                "cta_label": "Book Again",
                "status": "DRAFT",
                "notes": "Behavioral calendar item: welcome-back offer.",
            },
            {
                "campaign_date": today.isoformat(),
                "campaign_type": "Behavioral",
                "audience": "Users near active FairFares cities",
                "trigger_rule": "Location-based offers",
                "subject_line": "Popular FairFares routes near you",
                "headline": "Find a nearby ride and a memory worth keeping.",
                "message_body": "Feature monthly popular destinations and Explorer ideas by city.",
                "cta_label": "Explore Nearby",
                "status": "DRAFT",
                "notes": "Behavioral calendar item: monthly popular destinations.",
            },
        ]
    )
    return plans


def ensure_email_marketing_calendar_plans() -> None:
    with db() as con:
        existing = con.execute("SELECT COUNT(*) AS total FROM email_campaigns").fetchone()["total"]
        if existing:
            return
        con.executemany(
            """
            INSERT INTO email_campaigns
            (campaign_date, campaign_type, audience, trigger_rule, subject_line, headline, message_body, cta_label, status, notes)
            VALUES (:campaign_date, :campaign_type, :audience, :trigger_rule, :subject_line, :headline, :message_body, :cta_label, :status, :notes)
            """,
            default_email_campaign_plans(),
        )


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
            WHERE role = 'CUSTOMER'
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


def row_value(row: sqlite3.Row | dict[str, object] | None, key: str, default: str = "") -> str:
    if row is None:
        return str(default)
    if isinstance(row, dict):
        value = row.get(key, default)
        return str(value if value is not None else default)
    if not hasattr(row, "keys"):
        return str(default)
    return str(row[key] if key in row.keys() and row[key] is not None else default)


def profile_photo_url(user: sqlite3.Row | dict[str, object] | None) -> str:
    if not user:
        return ""
    return row_value(user, "profile_photo_url")


def user_avatar_span(user: sqlite3.Row | dict[str, object] | None) -> str:
    photo = profile_photo_url(user)
    style = ""
    if photo:
        style = (
            f' style="background-image:url(&quot;{escape(photo)}&quot;) !important;'
            'background-size:cover !important;background-position:center !important;"'
        )
    return f"<span{style}></span>"


PRICE_MATCH_PROMISE = (
    "Bring a lower comparable quote before pickup. FairFares will review it, match the eligible price, "
    "and add another 10% off so your savings stay clear on your documents."
)


def booking_savings_note(row: sqlite3.Row | dict[str, object], include_terms: bool = False) -> str:
    breakdown = booking_price_breakdown(row)
    discount_amount = float(row_value(row, "discount_amount") or 0)
    if discount_amount > 0:
        code = row_value(row, "discount_code")
        subtotal = float(row_value(row, "subtotal_price") or row_value(row, "total_price") or 0)
        total = float(row_value(row, "total_price") or 0)
        code_part = f" with {code}" if code else ""
        return (
            f"You saved {format_money(discount_amount)}{code_part}. "
            f"Original total {format_money(subtotal)}; final total {format_money(total)}."
        )
    terms = " Terms and conditions apply." if include_terms else ""
    return (
        f"Estimated market total {format_money(breakdown['market_total'])}; FairFares total "
        f"{format_money(breakdown['total'])}. A 10% hold of {format_money(breakdown['booking_hold'])} "
        f"is deducted from your pickup balance.{terms}"
    )


def booking_savings_label(row: sqlite3.Row | dict[str, object] | None) -> str:
    if not row:
        return ""
    breakdown = booking_price_breakdown(row)
    discount_amount = float(row_value(row, "discount_amount") or 0)
    if discount_amount > 0:
        code = row_value(row, "discount_code")
        return f"FairFares saved you {format_money(discount_amount)}{f' with {code}' if code else ''}."
    duration_discount = float(breakdown.get("duration_discount_amount") or 0)
    if duration_discount > 0:
        return f"{breakdown['duration_discount_label']} saved you {format_money(duration_discount)} vs standard daily pricing."
    savings = float(breakdown["savings"] or 0)
    return f"Estimated FairFares savings: {format_money(savings)} (typically 10-25% vs major rental totals)."


def booking_savings_explainer(row: sqlite3.Row | dict[str, object] | None, include_terms: bool = False) -> str:
    if not row:
        return ""
    breakdown = booking_price_breakdown(row)
    discount_amount = float(row_value(row, "discount_amount") or 0)
    subtotal = float(row_value(row, "subtotal_price") or row_value(row, "total_price") or 0)
    total = float(row_value(row, "total_price") or 0)
    if discount_amount > 0:
        code = row_value(row, "discount_code")
        code_part = f" using {code}" if code else ""
        return (
            f"We lowered your rental from {format_money(subtotal)} to {format_money(total)}{code_part}. "
            f"Taxes and fees are itemized, and a 10% hold of {format_money(breakdown['booking_hold'])} "
            f"is deducted from your pickup balance."
        )
    terms = " Terms and conditions apply." if include_terms else ""
    return (
        f"FairFares estimates {format_money(breakdown['savings'])} in savings, typically 10-25% against comparable major-rental totals. "
        f"Your 10% hold is {format_money(breakdown['booking_hold'])}; the remaining "
        f"{format_money(breakdown['due_at_pickup'])} is due at pickup after review.{terms}"
    )


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
        "lessor_phone": "+1 9372518688",
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
    breakdown = booking_price_breakdown(row)
    paid_amount = booking_paid_amount(row)
    pickup_due = float(breakdown.get("due_at_pickup", 0) or 0)
    payment_status = row_value(row, "payment_status")
    pickup_location = row_value(row, "pickup_location")
    return_location = row_value(row, "return_location") or pickup_location
    pickup_datetime = f"{row_value(row, 'pickup_date')} {row_value(row, 'pickup_time')}".strip()
    return_datetime = f"{row_value(row, 'dropoff_date')} {row_value(row, 'dropoff_time')}".strip()
    actual_pickup = f"{row_value(row, 'actual_pickup_date') or row_value(row, 'pickup_date')} {row_value(row, 'actual_pickup_time') or row_value(row, 'pickup_time')}".strip()
    actual_return = f"{row_value(row, 'actual_return_date') or row_value(row, 'dropoff_date')} {row_value(row, 'actual_return_time') or row_value(row, 'dropoff_time')}".strip()
    vehicle_identity = (
        f"{row_value(row, 'car_year')} {vehicle_make(row)} {vehicle_model(row)} "
        f"({row_value(row, 'car_color')} {row_value(row, 'car_type') or row_value(row, 'car_category')})"
    ).strip()
    price_match_agency = row_value(row, "price_match_agency")
    price_match_amount = float(row_value(row, "price_match_amount") or 0)
    price_match_discount = float(row_value(row, "price_match_discount_amount") or 0)
    price_match_original = float(row_value(row, "price_match_original_total") or row_value(row, "subtotal_price") or row_value(row, "total_price") or 0)
    late_fee = float(row_value(row, "late_fee_amount") or 0)
    pickup_odometer = row_value(row, "pickup_odometer") or values.get("vehicle_mileage", "")
    return_odometer = row_value(row, "return_odometer")
    pickup_fuel = row_value(row, "pickup_fuel_level") or "Staff to record at pickup."
    return_fuel = row_value(row, "return_fuel_level") or "Staff to record at return."
    pickup_condition = row_value(row, "pickup_condition_status") or "Staff and Lessee must review pickup photos and visible condition before release."
    return_condition = row_value(row, "return_condition_status") or "Pending return review."
    new_damage = row_value(row, "new_damage_found") or "Pending return review."
    deposit_status = row_value(row, "security_deposit_status") or "NOT_AUTHORIZED"
    saved_deposit_amount = float(row_value(row, "security_deposit_amount") or 0)
    deposit_amount = saved_deposit_amount if saved_deposit_amount > 0 else SECURITY_DEPOSIT_AMOUNT
    return_review_status = row_value(row, "return_review_status") or "PENDING"
    post_return_charge_amount = float(row_value(row, "post_return_charge_amount") or 0)
    post_return_charge_notes = row_value(row, "post_return_charge_notes")
    post_return_fee_line = post_return_fee_rule_summary() or "Configured FairFares post-return fee rules apply."
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
    savings_or_price_promise = booking_savings_explainer(row)
    return f"""FAIRFARES VEHICLE RENTAL AGREEMENT
Version 1.0
Booking ID: {row_value(row, 'booking_id')}
Agreement Date: {values.get('agreement_date', '')}

IMPORTANT LEGAL NOTICE: This generated agreement is intended to document the rental terms accepted at pickup. Staff must verify all blank or incomplete fields before releasing the vehicle. FairFares should have this master form reviewed by Colorado counsel before live use.

1. DEFINITIONS.
"Agreement" means this FairFares Vehicle Rental Agreement and all attached pickup/return records, photos, receipts, invoices, and signed documents. "FairFares" or "Lessor" means {values.get('lessor_name', 'FairFares')}. "Customer," "Renter," or "Lessee" means the person signing below. "Vehicle" means the vehicle identified in this Agreement. "Rental Period" means the period from pickup until the vehicle is returned, inspected, and accepted by FairFares.

2. RENTAL AGREEMENT.
FairFares agrees to rent the Vehicle to Lessee only under the terms of this Agreement. This is a rental only; Lessee receives no ownership interest, title, lien, or transfer right in the Vehicle.

3. PARTIES AND CONTACT INFORMATION.
Lessor: {values.get('lessor_name', '')}
Lessor Address: {values.get('lessor_address', '')}
Lessor Email: {values.get('lessor_email', '')}
Lessor Phone: {values.get('lessor_phone', '')}
Lessee Legal Name: {values.get('lessee_name', '')}
Lessee Address: {values.get('lessee_address', '')}
Lessee Email: {row_value(row, 'user_email')}
Lessee Phone: {row_value(row, 'phone')}

4. ELIGIBILITY REQUIREMENTS.
Lessee must be legally eligible to rent and operate the Vehicle, must provide accurate identity and contact information, must satisfy payment and insurance requirements, and must not be disqualified by FairFares or provider risk review. Drivers under 25, temporary licenses, international licenses, debit/prepaid payment methods, or unusual booking facts may require additional review.

5. DRIVER LICENSE VERIFICATION.
License State: {values.get('license_state', '')}
License Number: {values.get('license_number', '')}
License Expiration: {values.get('license_expiry', '')}
Lessee authorizes FairFares to inspect, photograph, scan, or otherwise record driver license information for booking, pickup, identity, fraud prevention, insurance, legal, and vehicle-release purposes. Failure to provide a valid, unexpired license may block vehicle release.

6. INSURANCE REQUIREMENTS.
Lessee must provide proof of a valid auto insurance policy that extends coverage to rental vehicles. Recommended coverage includes collision, comprehensive, liability, rental vehicle coverage if required by the insurer, and roadside assistance. FairFares may verify coverage before releasing the Vehicle. If Lessee's current policy does not adequately cover rental vehicles, Lessee must contact the insurer before pickup or obtain provider-approved coverage where offered.

7. INSURANCE DECLARATION.
Insurance Company: {values.get('insurance_company', '')}
Policy Number: {values.get('insurance_policy', '')}
Lessee declares that the insurance information provided is true, current, and sufficient for this rental. Lessee remains responsible for deductibles, exclusions, denied claims, coverage gaps, uninsured loss, and any damage or liability not paid by insurance.

8. PAYMENT AUTHORIZATION.
Payment Status: {payment_status}
Rental Subtotal: {format_money(row_value(row, 'subtotal_price') or row_value(row, 'total_price'))}
Discount Applied: {row_value(row, 'discount_code') or 'None'} - {format_money(row_value(row, 'discount_amount'))}
Amount Paid/Authorized: {format_money(paid_amount)}
Balance Due at Pickup: {format_money(pickup_due)}
Final Total: {format_money(row_value(row, 'total_price'))}
{price_match_line}
{late_fee_line}
How FairFares saved you money: {savings_or_price_promise}
Lessee authorizes FairFares and its payment processors, including Stripe where applicable, to charge amounts due under this Agreement, including rental charges, balances, deposits, late fees, damage, tolls, tickets, cleaning, fuel, keys, towing, roadside charges, and other post-return charges permitted by this Agreement.

9. SECURITY DEPOSIT AUTHORIZATION.
Security Deposit/Authorization: {format_money(deposit_amount)}
Deposit Status: {deposit_status}
Return Review Status: {return_review_status}
Post-return Charge Review: {format_money(post_return_charge_amount)}{f" - {post_return_charge_notes}" if post_return_charge_notes else ""}
FairFares may authorize a refundable security deposit at pickup. The deposit is not rental revenue. FairFares may release the authorization after the Vehicle is returned and reviewed for tickets, tolls, damage, cleaning, fuel, keys, misuse, late return charges, and other post-return charges. FairFares may capture or apply all or part of the deposit only for amounts permitted by this Agreement, payment processor rules, and applicable law. Deposit release does not waive later claims discovered after return.

10. VEHICLE DESCRIPTION.
Vehicle: {vehicle_identity}
VIN: {row_value(row, 'vin_number')}
License Plate: {row_value(row, 'license_plate')}
Starting Mileage: {pickup_odometer}
Return Mileage: {return_odometer or 'Pending return record.'}
Fuel Level Out: {pickup_fuel}
Fuel Level In: {return_fuel}
Vehicle Condition Out: {pickup_condition}
Vehicle Condition In: {return_condition}
New Damage Found at Return: {new_damage}

11. RENTAL PERIOD AND LOCATIONS.
Scheduled Pickup: {pickup_datetime}
Scheduled Return: {return_datetime}
Actual Pickup: {actual_pickup}
Actual Return: {actual_return}
Pickup Location: {pickup_location}
Return Location: {return_location}

12. VEHICLE PICKUP PROCEDURE.
Before release, FairFares may require payment confirmation, Stripe Identity or other identity review, valid driver license, insurance proof, agreement signature, pickup condition photos, fuel/mileage record, and staff approval. Lessee must inspect the Vehicle before leaving and immediately report visible damage, cleanliness issues, warning lights, missing accessories, or other concerns.

13. VEHICLE RETURN PROCEDURE.
Lessee must return the Vehicle at the agreed return location, date, and time unless FairFares approves a modification. Vehicle must be returned with the same fuel level, in substantially similar condition except ordinary wear, clean, with keys/accessories, and ready for inspection. Late, dirty, damaged, incomplete, or unauthorized returns may create additional charges.

14. VEHICLE CONDITION REPORT.
Pickup and return photos, uploaded damage photos, inspection forms, odometer readings, fuel readings, staff notes, customer notes, and signatures are part of this Agreement. Minimum inspection photos should include front, rear, driver side, passenger side, dashboard/odometer, fuel gauge, front seats, rear seats/cargo, and any damage closeups. Lessee accepts responsibility for damage, loss, missing items, or abnormal wear occurring during the Rental Period, subject to insurance and applicable law.

15. MILEAGE POLICY.
Mileage Allowance: {values.get('mileage_allowed', '')} miles per month or as otherwise stated in booking terms.
Extra Mile Rate: ${values.get('extra_mile_rate', '')} per mile.
Mileage may be reviewed from odometer records, photos, GPS/telematics where disclosed, or provider records.

16. FUEL POLICY.
Lessee must return the Vehicle with the same fuel or charge level recorded at pickup unless written terms state otherwise. Refueling, recharging, service, towing, or downtime caused by low fuel/charge may be charged to Lessee.

17. PERMITTED USES.
The Vehicle may be used only for lawful personal transportation by approved drivers listed in this Agreement or booking record. Lessee must follow traffic laws, parking rules, toll rules, manufacturer requirements, and FairFares instructions.

18. PROHIBITED USES.
Prohibited uses include rideshare, delivery, commercial use, racing, towing, off-road use, subleasing, car sharing, illegal activity, reckless driving, intoxicated/impaired driving, driving without required license or insurance, unauthorized drivers, leaving the United States without approval, smoking, tampering with tracking/safety equipment, disabling warning systems, or modifying the Vehicle.

19. ADDITIONAL DRIVERS.
Additional Driver: {row_value(row, 'additional_driver_name') or 'None'} {f"({row_value(row, 'additional_driver_age')})" if row_value(row, 'additional_driver_age') else ""}
No additional driver may operate the Vehicle unless approved by FairFares and documented in the booking or agreement. Lessee remains responsible for approved and unauthorized drivers.

20. ACCIDENT PROCEDURES.
In any accident or damage event, Lessee must first ensure safety, call emergency services when needed, contact police when required, notify FairFares/support promptly, collect other party and witness information, take photos, preserve evidence, and cooperate with insurance, police, and FairFares investigation. Lessee must not admit fault, abandon the Vehicle, or authorize repairs without FairFares approval unless necessary for emergency safety.

21. MECHANICAL BREAKDOWN.
If the Vehicle breaks down or shows warning lights, Lessee must stop safely, contact FairFares/support, and follow instructions. Lessee may not continue driving when doing so may worsen damage. Unauthorized repairs, towing, diagnostics, or parts may not be reimbursed.

22. VEHICLE DAMAGE.
Lessee is responsible for damage, loss, theft, diminished value, downtime, towing, storage, administrative costs, and claim-related charges arising during the Rental Period, except to the extent prohibited by law or paid by insurance/provider coverage. Damage includes tire, glass, key, wheel, undercarriage, interior, smoke, pet, water, hail, collision, theft, vandalism, and misuse damage.

23. CUSTOMER RESPONSIBILITIES.
Lessee must safeguard keys, lock the Vehicle, use proper fuel/charging, obey laws, keep the Vehicle reasonably clean, avoid prohibited uses, maintain insurance, respond to FairFares communications, disclose damage or incidents, pay charges due, and return the Vehicle as agreed.

24. FEES AND CHARGES.
Possible charges include rental balance, late return, extra mileage, fuel/recharge, cleaning, smoking, pet cleaning, tolls, tickets, impound, towing, storage, key replacement, damage, loss, deductible, unauthorized driver/use, chargeback, payment failure, administrative processing, and provider-imposed charges.
Current post-return fee defaults: {post_return_fee_line}. Staff must document evidence and notes before applying any deposit capture or post-return charge.

25. TOLLS AND TICKETS.
Lessee is responsible for tolls, parking tickets, traffic citations, camera violations, impound charges, and related administrative fees during the Rental Period, even if FairFares receives notice after return.

26. ROADSIDE ASSISTANCE.
Roadside assistance may be available depending on provider, insurance, location, and event. Lessee may be responsible for roadside costs caused by negligence, misuse, lockout, lost keys, dead battery caused by customer conduct, empty fuel/charge, tire damage, or unauthorized travel.

27. THEFT OF VEHICLE.
Lessee must immediately report theft, attempted theft, lost keys, or unauthorized taking to police and FairFares. Lessee must cooperate with insurance and investigation and may be responsible for loss not paid by insurance.

28. LOSS OF KEYS.
Lost, stolen, damaged, or unreturned keys/fobs/accessories may result in replacement, towing, reprogramming, downtime, delivery, and administrative charges.

29. PRIVACY POLICY.
FairFares may collect, store, and use booking, payment, identity, license, insurance, vehicle, photo, location, support, and agreement data for rental operations, fraud prevention, safety, legal compliance, customer support, and recordkeeping. FairFares handles data according to its posted privacy practices and applicable law.

30. GPS / VEHICLE TRACKING DISCLOSURE.
The Vehicle may include GPS, telematics, manufacturer connected services, or provider tracking for safety, recovery, theft prevention, maintenance, mileage, location, operational, and legal purposes. Lessee must not disable, tamper with, remove, or obstruct tracking or safety equipment.

31. AI AND IDENTITY VERIFICATION.
FairFares may use Stripe Identity, staff review, OCR/photo prefill, AI-assisted extraction, or approved provider checks to assist with identity, driver license, insurance, pickup, support, and record workflows. AI/OCR suggestions are not DMV verification and must be reviewed by staff. Lessee consents to the use of necessary document images and data for these purposes.

32. STRIPE PAYMENT AUTHORIZATION.
Lessee authorizes Stripe or other processors to process payment, identity, receipt, refund, and charge records related to this booking. Payment confirmation does not waive FairFares' right to collect later charges under this Agreement.

33. DRIVER INSURANCE VERIFICATION.
FairFares may request updated insurance proof, contact insurer/provider where permitted, review insurance documents, and refuse release or continued rental if coverage appears missing, expired, insufficient, unverifiable, or inconsistent with rental use.

34. CUSTOMER DECLARATIONS.
Lessee declares that all information provided is true and complete; the driver license is valid and unexpired; insurance coverage is active and applicable to rental vehicles; Lessee is not impaired or prohibited from driving; payment authorization is valid; and Lessee has read and agrees to this Agreement.

35. INDEMNIFICATION.
To the maximum extent permitted by law, Lessee agrees to indemnify, defend, and hold FairFares, its owners, employees, agents, providers, and partners harmless from claims, losses, damages, penalties, fees, costs, and expenses arising from Lessee's use, possession, operation, breach, negligence, misconduct, unauthorized use, or violation of law.

36. LIMITATION OF LIABILITY.
To the maximum extent permitted by law, FairFares is not liable for indirect, incidental, special, consequential, punitive, lost-profit, trip-interruption, or personal property losses, except where prohibited by law. Nothing in this Agreement limits liability that cannot legally be limited.

37. GOVERNING LAW (COLORADO).
This Agreement is governed by the laws of the State of Colorado, without regard to conflict-of-law rules. Venue and dispute procedures are subject to applicable Colorado law and any mandatory consumer protection requirements.

38. ELECTRONIC SIGNATURE.
Lessee agrees that electronic records, typed signatures, checkbox consent, uploaded documents, Stripe records, payment records, and saved agreement text may be used as enforceable records and signatures to the extent allowed by law.

39. PICKUP CHECKLIST.
Staff/Lessee must confirm before release: identity verification, valid license, insurance proof, rental payment, refundable security deposit authorization where required, pickup photos, odometer/fuel, visible condition, keys/accessories, customer/staff signatures, emergency/support contacts, and any special restrictions.

40. RETURN CHECKLIST.
Staff/Lessee should confirm at return: return time/location, odometer/fuel, cleanliness, keys/accessories, new damage, return photos, damage closeups, toll/ticket notes, late fees, remaining balance, support issues, deposit release/capture decision, and final closeout status.

41. EMERGENCY CONTACTS.
Emergency services: 911 when urgent.
FairFares Support: use Manage Booking support or contact FairFares staff.
Lessor Phone: {values.get('lessor_phone', '')}
Lessor Email: {values.get('lessor_email', '')}

42. SIGNATURE PAGE.
LESSEE:
By: {values.get('customer_signature', '') or '_________________'}
Printed Name: {values.get('lessee_name', '')}
Date: {values.get('agreement_date', '')}

LESSOR / FAIRFARES REPRESENTATIVE:
By: {values.get('issuer_signature', '') or '_________________'}
Printed Name: {values.get('issuer_name', '')}
Date: {values.get('agreement_date', '')}

43. APPENDIX.
The appendix includes damage photos, pickup inspection forms, return inspection forms, insurance documents, driver license records, receipts, invoices, payment records, Stripe records, support tickets, and booking modifications saved in FairFares systems.
"""


def default_agreement_text(row: sqlite3.Row) -> str:
    return build_rental_agreement_text(row, agreement_default_values(row))


def render_agreement_fields(values: dict[str, str]) -> str:
    return render_agreement_fields_for_role(values)


def render_agreement_fields_for_role(values: dict[str, str], role_filter: str = "") -> str:
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
        if role_filter and role != role_filter:
            continue
        field_html = []
        for key, label in fields:
            step = ' step="0.01"' if input_types.get(key) == "number" else ""
            field_html.append(
                f'<label class="agreement-field agreement-{role}"><span>{escape(label)} <b>{escape(title)}</b></span>'
                f'<input name="agreement_{key}" type="{input_types.get(key, "text")}"{step} value="{escape(values.get(key, ""))}"></label>'
            )
        groups.append(f'<div class="agreement-group agreement-group-{role}"><h3>{escape(title)} fields</h3>{"".join(field_html)}</div>')
    return "".join(groups)


def get_admin_agreement_context(booking_id: int) -> tuple[sqlite3.Row | None, sqlite3.Row | None, sqlite3.Row | None, sqlite3.Row | None]:
    with db() as con:
        booking = con.execute(
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
        if not booking:
            return None, None, None, None
        license_row = con.execute(
            "SELECT * FROM driver_licenses WHERE user_id = ? ORDER BY id DESC LIMIT 1",
            (booking["user_id"],),
        ).fetchone()
        insurance = con.execute(
            "SELECT * FROM insurances WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
            (booking_id,),
        ).fetchone()
        agreement = con.execute(
            "SELECT * FROM rental_agreements WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
            (booking_id,),
        ).fetchone()
    return booking, license_row, insurance, agreement


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

    payment_summary = booking_payment_record_summary(booking)
    invoice_number = (
        ", ".join(str(reference) for reference in payment_summary["references"])
        if payment_summary["references"]
        else f"INV-{booking['booking_id']}"
    )
    payment_method = (
        ", ".join(dict.fromkeys(str(method) for method in payment_summary["methods"]))
        if payment_summary["methods"]
        else payment_status_label(booking["payment_status"])
    )
    transaction_status = payment_status_label(booking["payment_status"])
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
    breakdown = booking_price_breakdown(booking)
    status_line = f"Trip status: {booking_status_label(booking['booking_status'], booking['payment_status'])}"
    savings_line = booking_savings_explainer(booking)
    tax_fee_lines = "\n".join(
        f"{label}: {format_money(amount)}"
        for label, amount in breakdown["tax_fee_lines"]  # type: ignore[index]
    )

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
                f"Amount paid: {format_money(payment_summary['paid_amount'])}\n"
                f"Amount refunded: {format_money(payment_summary['refunded_amount'])}\n"
                f"Rental subtotal: {format_money(breakdown['base'])}\n"
                f"Discount: {booking['discount_code'] or 'None'} · -{format_money(booking['discount_amount'])}\n"
                f"Taxes and fees: {format_money(breakdown['tax_fee_amount'])}\n"
                f"10% booking hold: {format_money(breakdown['booking_hold'])}\n"
                f"Due at pickup after hold: {format_money(breakdown['due_at_pickup'])}\n"
                f"FairFares savings: {savings_line}\n"
                f"Estimated total: {format_money(breakdown['total'])}"
            ),
            "status": f"Generated from booking {booking['booking_id']} and admin payment records.",
        },
        "Rental Agreement": {
            "title": "Rental Agreement",
            "content": (
                f"{status_line}\n\n"
                f"{agreement_text}\n\n"
                f"Estimated total: {format_money(breakdown['total'])}\n"
                f"10% booking hold: {format_money(breakdown['booking_hold'])}. This hold is deducted from the pickup balance. Holds become non-refundable inside 24 hours before pickup unless FairFares approves an exception.\n"
                f"Amount paid: {format_money(payment_summary['paid_amount'])}\n"
                f"Due at pickup after hold: {format_money(breakdown['due_at_pickup'])}\n"
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
                f"Rental days: {breakdown['weeks']} week(s), {breakdown['extra_days']} day(s)\n"
                f"Daily rate: {format_money(breakdown['daily'])}\n"
                f"Rental subtotal: {format_money(breakdown['base'])}\n"
                f"Discount: {booking['discount_code'] or 'None'} · -{format_money(booking['discount_amount'])}\n"
                f"{tax_fee_lines}\n"
                f"FairFares savings: {savings_line}\n"
                f"10% booking hold: {format_money(breakdown['booking_hold'])}\n"
                f"Amount paid: {format_money(payment_summary['paid_amount'])}\n"
                f"Due at pickup: {format_money(breakdown['due_at_pickup'])}\n"
                f"Insurance: {insurance_line}\n"
                f"Final total: {format_money(breakdown['total'])}"
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
                "bookingId": public_booking_id_label(booking),
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
    template = Template((TEMPLATE_DIR / template_name).read_text(encoding="utf-8"))
    favicon_links = "\n".join(
        (
            f'  <link rel="icon" type="image/png" sizes="32x32" href="/static/img/favicon-32.png?v={ASSET_VERSION}">',
            f'  <link rel="icon" type="image/png" sizes="512x512" href="/static/img/favicon-512.png?v={ASSET_VERSION}">',
            f'  <link rel="apple-touch-icon" sizes="180x180" href="/static/img/apple-touch-icon.png?v={ASSET_VERSION}">',
        )
    )
    stylesheet_urls = [*BASE_STYLESHEETS, *PAGE_STYLESHEETS.get(template_name, []), *SHARED_STYLESHEETS]
    stylesheet_links = "\n".join(
        f'  <link rel="stylesheet" href="{escape(url)}">' for url in stylesheet_urls
    )
    safe_context = {
        "stylesheet_links": stylesheet_links,
        "asset_version": ASSET_VERSION,
        "internal_links": render_internal_links(),
        **context,
    }
    html_text = template.safe_substitute(safe_context)
    html_text = html_text.replace("$favicon_links", favicon_links)
    if favicon_links not in html_text:
        html_text = re.sub(r"(<head\b[^>]*>)", r"\1\n" + favicon_links, html_text, count=1)
    html_text = html_text.replace("/static/js/app.js?v=54", f"/static/js/app.js?v={ASSET_VERSION}")
    html_text = html_text.replace("/static/js/app.js?v=explorer-26", f"/static/js/app.js?v=explorer-{ASSET_VERSION}")
    html_text = inject_structured_data(html_text, template_name)
    if should_track_google_analytics(template_name):
        html_text = inject_google_tag(html_text)
    html_text = re.sub(r"(<body\b[^>]*>)", r"\1\n" + render_site_loader(), html_text, count=1)
    return html_text.encode("utf-8")


def render_internal_links() -> str:
    city_links = (
        ("Denver, CO car rentals", "/car-rental-denver"),
        ("Downtown Denver rentals", "/cheap-car-rental-downtown-denver"),
        ("Colorado Springs rentals", "/cheap-car-rental-colorado"),
        ("Student car rental Colorado", "/student-car-rental-colorado"),
        ("SUV rental Denver", "/affordable-suv-rental-denver"),
        ("Weekend car rental Colorado", "/weekend-car-rental-colorado"),
        ("Colorado road trip rentals", "/colorado-road-trip-rental"),
        ("Monthly car rental Colorado", "/monthly-car-rental"),
    )
    airport_links = (
        ("Denver Airport car rental", "/denver-airport-car-rental"),
        ("Cheap rentals near Denver Airport", "/cheap-car-rental-near-denver-airport"),
        ("Airport pickup rental", "/denver-airport-car-rental"),
        ("Rental cars Denver", "/car-rental-denver"),
        ("Affordable car rental Colorado", "/cheap-car-rental-colorado"),
        ("Explorer trip planner", "/explorer"),
        ("Deals and price match", "/deals"),
        ("Rental guides", "/blog"),
    )
    city_html = "\n".join(
        f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
        for label, url in city_links
    )
    airport_html = "\n".join(
        f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
        for label, url in airport_links
    )
    return f"""
    <section class="internal-link-network" aria-label="Explore FairFares">
      <div class="internal-link-main">
        <div class="internal-link-heading">
          <span>Explore FairFares</span>
          <h2>Popular car rental locations</h2>
        </div>
        <div class="internal-link-directory">
          <div class="internal-link-tabs" aria-label="Popular rental categories">
            <span>Cities</span>
            <span>Airports</span>
          </div>
          <div class="internal-link-columns">
            <nav aria-label="Popular city rental links">{city_html}</nav>
            <nav aria-label="Popular airport and travel rental links">{airport_html}</nav>
          </div>
        </div>
      </div>
      <div class="internal-link-utility">
        <strong>© FairFares LLC. All Rights Reserved.</strong>
        <span>Price Match Guarantee + 10% off eligible lower quotes.</span>
      </div>
    </section>
    """.strip()


VALUE_STRIP_ICONS = {
    "pin": '<svg viewBox="0 0 24 24" role="img"><path d="M12 21s7-6.1 7-12A7 7 0 0 0 5 9c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    "calendar": '<svg viewBox="0 0 24 24" role="img"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2"/></svg>',
    "thumb": '<svg viewBox="0 0 24 24" role="img"><path d="M7 21H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11ZM7 11l4.5-7.5A2 2 0 0 1 15.2 5v4h3.7a2 2 0 0 1 2 2.4l-1.4 7A3 3 0 0 1 16.6 21H7V11Z"/></svg>',
    "car": '<svg viewBox="0 0 24 24" role="img"><path d="M5 16h14l-1.6-5.2A3 3 0 0 0 14.5 9h-5a3 3 0 0 0-2.9 1.8L5 16Z"/><path d="M4 16v3M20 16v3M7 19h.01M17 19h.01M7 13h10"/></svg>',
    "route": '<svg viewBox="0 0 24 24" role="img"><path d="M5 19c3-7 11-7 14-14"/><path d="M6 5h.01M18 19h.01"/><path d="M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/></svg>',
    "student": '<svg viewBox="0 0 24 24" role="img"><path d="M3 8 12 4l9 4-9 4-9-4Z"/><path d="M7 10v5c2.7 2 7.3 2 10 0v-5M21 8v6"/></svg>',
    "shield": '<svg viewBox="0 0 24 24" role="img"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/></svg>',
    "document": '<svg viewBox="0 0 24 24" role="img"><path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>',
}


def value_strip_icon_key(title: str) -> str:
    label = title.lower()
    if any(word in label for word in ("airport", "pickup", "denver", "local", "coverage")):
        return "pin"
    if any(word in label for word in ("timing", "window", "reserve", "longer", "monthly", "weekend")):
        return "calendar"
    if any(word in label for word in ("price", "match", "discount", "saving", "rate", "clear", "transparent")):
        return "thumb"
    if any(word in label for word in ("student", "school", ".edu")):
        return "student"
    if any(word in label for word in ("document", "checkout", "secure", "hold")):
        return "document"
    if any(word in label for word in ("road", "trip", "route", "explorer", "colorado")):
        return "route"
    if any(word in label for word in ("support", "review", "guarantee")):
        return "shield"
    return "car"


def render_value_strip_icon(title: str) -> str:
    icon = VALUE_STRIP_ICONS.get(value_strip_icon_key(title), VALUE_STRIP_ICONS["car"])
    return f'<span class="value-strip-icon" aria-hidden="true">{icon}</span>'


GOOGLE_TAG_ID = "G-T1Z9NDENEQ"
GOOGLE_TAG_HTML = f"""
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id={GOOGLE_TAG_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){{dataLayer.push(arguments);}}
    gtag('js', new Date());

    gtag('config', '{GOOGLE_TAG_ID}');
  </script>
""".rstrip()


def inject_google_tag(html_text: str) -> str:
    if GOOGLE_TAG_ID in html_text or "googletagmanager.com/gtag/js" in html_text:
        return html_text
    return re.sub(r"(<head\b[^>]*>)", r"\1\n" + GOOGLE_TAG_HTML, html_text, count=1)


def should_track_google_analytics(template_name: str) -> bool:
    return not template_name.startswith("admin")


PUBLIC_SCHEMA_TEMPLATES = {
    "index.html",
    "seo_landing.html",
    "blog_index.html",
    "blog_post.html",
    "deals.html",
    "buy_cars.html",
    "explorer.html",
    "wiki.html",
}


def should_include_structured_data(template_name: str) -> bool:
    return template_name in PUBLIC_SCHEMA_TEMPLATES


def schema_origin() -> str:
    return os.environ.get("PUBLIC_BASE_URL", "https://www.fairfare.space").rstrip("/")


def html_meta_content(html_text: str, name: str, default: str = "") -> str:
    pattern = rf'<meta\s+name="{re.escape(name)}"\s+content="([^"]*)"'
    match = re.search(pattern, html_text, flags=re.IGNORECASE)
    return html.unescape(match.group(1)).strip() if match else default


def html_title(html_text: str, default: str = "FairFares") -> str:
    match = re.search(r"<title>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    return html.unescape(re.sub(r"\s+", " ", match.group(1)).strip()) if match else default


def canonical_url_from_html(html_text: str) -> str:
    match = re.search(r'<link\s+rel="canonical"\s+href="([^"]+)"', html_text, flags=re.IGNORECASE)
    if match:
        return html.unescape(match.group(1)).strip()
    return f"{schema_origin()}/"


def schema_page_name(title: str) -> str:
    return title.split("|", 1)[0].strip() or "FairFares"


def schema_breadcrumb_items(canonical_url: str, title: str) -> list[dict[str, object]]:
    origin = schema_origin()
    parsed = urllib.parse.urlparse(canonical_url)
    path = parsed.path.strip("/")
    items: list[dict[str, object]] = [
        {
            "@type": "ListItem",
            "position": 1,
            "name": "FairFares",
            "item": f"{origin}/",
        }
    ]
    if path:
        items.append(
            {
                "@type": "ListItem",
                "position": 2,
                "name": schema_page_name(title),
                "item": canonical_url,
            }
        )
    return items


def schema_feedback_summary() -> dict[str, object]:
    try:
        with get_db() as con:
            summary = con.execute(
                """
                SELECT COUNT(*) AS review_count, AVG(rating) AS rating_value
                FROM app_feedback
                WHERE rating BETWEEN 1 AND 5
                """
            ).fetchone()
            latest = con.execute(
                """
                SELECT rating, message, created_at
                FROM app_feedback
                WHERE rating BETWEEN 1 AND 5 AND TRIM(message) != ''
                ORDER BY datetime(created_at) DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
    except Exception:
        return {}
    count = int(row_value(summary, "review_count", 0) or 0)
    rating_raw = row_lookup(summary, "rating_value", None)
    if count <= 0 or rating_raw is None:
        return {}
    data: dict[str, object] = {
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": round(float(rating_raw), 1),
            "reviewCount": count,
            "bestRating": 5,
            "worstRating": 1,
        }
    }
    message = row_value(latest, "message")
    if latest is not None and message:
        data["review"] = {
            "@type": "Review",
            "reviewRating": {
                "@type": "Rating",
                "ratingValue": int(row_value(latest, "rating", 5) or 5),
                "bestRating": 5,
                "worstRating": 1,
            },
            "author": {
                "@type": "Person",
                "name": "FairFares customer",
            },
            "datePublished": row_value(latest, "created_at"),
            "reviewBody": message[:500],
        }
    return data


def render_structured_data(template_name: str, html_text: str) -> str:
    if not should_include_structured_data(template_name):
        return ""
    origin = schema_origin()
    canonical = canonical_url_from_html(html_text)
    title = html_title(html_text)
    description = html_meta_content(
        html_text,
        "description",
        "Affordable car rentals in Denver and Colorado with airport pickup, student savings, and price match review.",
    )
    logo_url = f"{origin}/static/img/fairfares-glow-logo.png"
    business_id = f"{origin}/#fairfares"
    review_data = schema_feedback_summary()
    business: dict[str, object] = {
        "@type": ["LocalBusiness", "AutoRental"],
        "@id": business_id,
        "name": "FairFares",
        "url": origin,
        "image": logo_url,
        "logo": logo_url,
        "description": description,
        "areaServed": [
            {"@type": "State", "name": "Colorado"},
            {"@type": "City", "name": "Denver"},
            {"@type": "Airport", "name": "Denver International Airport"},
        ],
        "address": {
            "@type": "PostalAddress",
            "addressLocality": "Denver",
            "addressRegion": "CO",
            "addressCountry": "US",
        },
        "priceRange": "$$",
        "sameAs": [
            origin,
        ],
    }
    business.update(review_data)
    graph: list[dict[str, object]] = [
        business,
        {
            "@type": "WebSite",
            "@id": f"{origin}/#website",
            "name": "FairFares",
            "url": origin,
            "publisher": {"@id": business_id},
            "potentialAction": {
                "@type": "SearchAction",
                "target": f"{origin}/?q={{search_term_string}}",
                "query-input": "required name=search_term_string",
            },
        },
        {
            "@type": "WebPage",
            "@id": canonical,
            "name": schema_page_name(title),
            "url": canonical,
            "description": description,
            "isPartOf": {"@id": f"{origin}/#website"},
            "about": {"@id": business_id},
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": schema_breadcrumb_items(canonical, title),
        },
    ]
    if template_name == "index.html" and "FAQPage" not in html_text:
        graph.append(
            {
                "@type": "FAQPage",
                "mainEntity": [
                    {
                        "@type": "Question",
                        "name": "Do you offer airport pickup?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Yes, FairFares offers convenient airport pickup for eligible rentals.",
                        },
                    },
                    {
                        "@type": "Question",
                        "name": "Do you match competitor prices?",
                        "acceptedAnswer": {
                            "@type": "Answer",
                            "text": "Yes. If you find a qualifying lower publicly available price from a major rental company, FairFares will match it and provide an additional 10% discount according to our terms.",
                        },
                    },
                ],
            }
        )
    schema = {"@context": "https://schema.org", "@graph": graph}
    return f'  <script type="application/ld+json">{json.dumps(schema, ensure_ascii=False, separators=(",", ":"))}</script>'


def inject_structured_data(html_text: str, template_name: str) -> str:
    if "fairfares-schema-graph" in html_text:
        return html_text
    schema_script = render_structured_data(template_name, html_text)
    if not schema_script:
        return html_text
    schema_script = schema_script.replace("<script ", '<script id="fairfares-schema-graph" ', 1)
    return re.sub(r"(</head>)", schema_script + "\n\\1", html_text, count=1, flags=re.IGNORECASE)


def render_site_loader() -> str:
    return """
  <div class="site-loader" id="siteLoader" aria-hidden="true">
    <div class="site-loader-mark">
      <img src="/static/img/fairfares-glow-logo.png" alt="FairFares" width="653" height="193" decoding="async">
      <span></span>
    </div>
  </div>
    """.rstrip()


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def row_lookup(row: sqlite3.Row | dict[str, object] | None, key: str, default: object = "") -> object:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        value = row[key]
        return default if value is None else value
    if isinstance(row, dict):
        value = row.get(key, default)
        return default if value is None else value
    return default


def vehicle_image_alt(row: sqlite3.Row | dict[str, object] | None) -> str:
    name = str(row_lookup(row, "name") or row_lookup(row, "car_name") or "FairFares rental car").strip()
    category = str(row_lookup(row, "category") or row_lookup(row, "type") or "").strip()
    location = str(row_lookup(row, "location") or row_lookup(row, "pickup_location") or "").strip()
    location_lower = location.lower()
    if "denver" in location_lower or "(den)" in location_lower:
        market = "Denver, Colorado"
    elif "colorado" in location_lower:
        market = location
    else:
        market = "Colorado"
    descriptor = f"{name} rental"
    if category and category.lower() not in name.lower():
        descriptor = f"{name} {category.lower()} rental"
    return f"{descriptor} available in {market}"


def guest_offer_modal() -> str:
    return """
  <section class="guest-offer-backdrop" id="guestOfferModal" hidden>
    <div class="guest-offer-modal" role="dialog" aria-modal="true" aria-labelledby="guestOfferTitle">
      <button class="guest-offer-close" type="button" data-offer-close aria-label="Close offer">x</button>
      <img class="guest-offer-logo" src="/static/img/fairfares-glow-logo.png" alt="FairFares logo">
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
        if parsed.path == "/api/explorer/place-photo":
            self.api_explorer_place_photo(parsed)
            return
        if parsed.path == "/api/explorer/config-status":
            self.api_explorer_config_status()
            return
        if parsed.path.startswith("/api/explorer/quests/"):
            self.api_get_explorer_quest(parsed.path.rsplit("/", 1)[-1])
            return
        if parsed.path.startswith("/blog/"):
            self.blog_post_page(parsed.path.rsplit("/", 1)[-1])
            return
        if parsed.path in SEO_LANDING_PAGES:
            self.seo_landing_page()
            return
        routes = {
            "/": self.home,
            "/blog": self.blog_index_page,
            "/about": self.about_page,
            "/contact": self.contact_page,
            "/robots.txt": self.robots_txt,
            "/sitemap.xml": self.sitemap_xml,
            "/buy-cars": self.buy_cars_page,
            "/deals": self.deals_page,
            "/wiki": self.wiki_page,
            "/explorer": self.explorer_page,
            "/activate": self.activate_account,
            "/student-verify": self.verify_student_email,
            "/unsubscribe": self.unsubscribe_marketing,
            "/healthz": self.healthz,
            "/login": self.login_page,
            "/signup": self.signup_page,
            "/forgot-password": self.forgot_password_page,
            "/reset-password": self.reset_password_page,
            "/manage-booking": self.manage_booking,
            "/payment/success": self.payment_success_page,
            "/payment/cancel": self.payment_cancel_page,
            "/dashboard": self.dashboard,
            "/admin": self.admin_workspace_page,
            "/admin/inventory": self.admin_portal,
            "/admin/workspace": self.admin_workspace_page,
            "/admin/roi": self.admin_roi_page,
            "/admin/cars/detail": self.admin_car_detail_page,
            "/admin/bookings": self.admin_bookings_page,
            "/admin/users": self.admin_users_page,
            "/admin/requests": self.admin_requests_page,
            "/admin/tickets": self.admin_tickets_page,
            "/admin/oncall": self.admin_oncall_page,
            "/admin/discounts": self.admin_discounts_page,
            "/admin/wiki": self.admin_wiki_page,
            "/admin/commercials": self.admin_commercials_page,
            "/admin/email-marketing": self.admin_email_marketing_page,
            "/admin/email-automation/run": self.run_email_automation_endpoint,
            "/admin/pickup": self.admin_pickup_page,
            "/admin/agreement/customer": self.admin_customer_agreement_page,
            "/admin/system": self.admin_system_page,
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
            "/forgot-password": self.forgot_password,
            "/reset-password": self.reset_password,
            "/bookings/modify": self.update_user_booking,
            "/bookings/cancel": self.cancel_user_booking,
            "/bookings/request-cancel": self.cancel_booking_request,
            "/bookings/save": self.save_current_booking,
            "/payment/stripe-session": self.create_stripe_checkout_session,
            "/stripe/webhook": self.stripe_webhook,
            "/identity/stripe-session": self.create_stripe_identity_session,
            "/admin/identity/stripe-session": self.create_admin_stripe_identity_session,
            "/payment/hold": self.pay_booking_hold,
            "/booking/hold/continue": self.continue_booking_hold,
            "/booking/hold/remove": self.remove_booking_hold,
            "/saved-cars": self.save_search_car,
            "/documents/email": self.email_booking_documents,
            "/guest-booking": self.create_guest_booking,
            "/explorer/quest": self.create_explorer_quest,
            "/explorer/checkin": self.checkin_explorer_stop,
            "/api/explorer/quests": self.api_create_explorer_quest,
            "/api/explorer/checkins": self.api_explorer_checkin,
            "/api/explorer/xp": self.api_explorer_xp,
            "/profile/update": self.update_user_profile,
            "/profile/photo": self.update_profile_photo,
            "/support/tickets": self.create_support_ticket,
            "/feedback": self.submit_app_feedback,
            "/wiki/ask": self.ask_wiki_agent,
            "/student-verification": self.update_student_verification,
            "/referrals/generate": self.generate_referral_code,
            "/referrals/claim": self.claim_referral_bonus,
            "/admin/content": self.update_content,
            "/admin/cars": self.create_admin_car,
            "/admin/cars/status": self.update_admin_car_status,
            "/admin/cars/service-cost": self.create_admin_car_service_cost,
            "/admin/cars/delete": self.delete_admin_car,
            "/admin/business-expenses": self.create_admin_business_expense,
            "/admin/business-expenses/delete": self.delete_admin_business_expense,
            "/admin/workspace/group": self.create_workspace_group,
            "/admin/workspace/group/join": self.join_workspace_group,
            "/admin/workspace/group/slack": self.update_workspace_group_slack,
            "/admin/workspace/post": self.create_workspace_post,
            "/admin/workspace/post/update": self.update_workspace_post,
            "/admin/workspace/post/react": self.react_workspace_post,
            "/admin/workspace/post/comment": self.comment_workspace_post,
            "/admin/workspace/post/share-slack": self.share_workspace_post_to_slack,
            "/admin/bookings/status": self.update_admin_booking_status,
            "/admin/bookings/refund": self.refund_admin_booking_payment,
            "/admin/oncall/assign": self.assign_oncall_shift,
            "/admin/discounts": self.create_admin_discount,
            "/admin/discounts/delete": self.delete_admin_discount,
            "/admin/tax-fees": self.create_admin_tax_fee_rule,
            "/admin/tax-fees/delete": self.delete_admin_tax_fee_rule,
            "/admin/post-return-fees": self.create_admin_post_return_fee_rule,
            "/admin/post-return-fees/delete": self.delete_admin_post_return_fee_rule,
            "/admin/staff/request": self.create_staff_account_request,
            "/admin/staff/review": self.review_staff_account_request,
            "/admin/staff/password": self.reset_staff_account_password,
            "/admin/wiki": self.create_admin_wiki_article,
            "/admin/wiki/delete": self.delete_admin_wiki_article,
            "/admin/commercials": self.create_admin_commercial,
            "/admin/commercials/status": self.update_admin_commercial_status,
            "/admin/commercials/delete": self.delete_admin_commercial,
            "/admin/email-marketing": self.create_email_campaign,
            "/admin/email-marketing/delete": self.delete_email_campaign,
            "/admin/email-marketing/send": self.send_email_campaign_now,
            "/admin/email-marketing/test": self.send_email_campaign_test,
            "/admin/pickup-documents": self.save_pickup_documents,
            "/admin/payment/pickup-balance": self.create_admin_pickup_balance_payment,
            "/admin/payment/security-deposit": self.create_admin_security_deposit_payment,
            "/admin/agreement/customer": self.save_customer_agreement,
            "/admin/pickup/prefill": self.prefill_pickup_documents,
            "/admin/identity/idscan": self.run_admin_idscan_check,
            "/admin/tickets/update": self.update_admin_ticket,
            "/admin/tickets/escalate": self.escalate_admin_ticket,
            "/admin/backups/create": self.create_admin_backup,
            "/admin/drive/migrate": self.migrate_admin_drive_uploads,
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
        if path in {"/login", "/signup", "/forgot-password", "/reset-password"}:
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

    def read_form_with_files(self) -> tuple[dict[str, str], dict[str, dict[str, object]]]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self.read_form(), {}
        form: dict[str, str] = {}
        files: dict[str, dict[str, object]] = {}
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        message = BytesParser(policy=EMAIL_POLICY).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
        )
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            key = part.get_param("name", header="content-disposition")
            if not key:
                continue
            filename = part.get_filename() or ""
            if filename:
                payload = part.get_payload(decode=True) or b""
                if len(payload) <= MAX_DRIVE_UPLOAD_BYTES:
                    files[key] = {
                        "filename": Path(filename).name,
                        "mime_type": part.get_content_type() or mimetypes.guess_type(filename)[0] or "application/octet-stream",
                        "payload": payload,
                    }
                continue
            payload_text = part.get_content()
            form[key] = str(payload_text).strip()
        return form, files

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

    def wants_json(self) -> bool:
        accept = self.headers.get("Accept", "")
        requested_with = self.headers.get("X-Requested-With", "")
        return "application/json" in accept.lower() or requested_with == "fetch"

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

    def send_text(self, body_text: str, content_type: str = "text/plain; charset=utf-8", status: int = 200) -> None:
        body = body_text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def robots_txt(self) -> None:
        self.send_text(
            "\n".join(
                (
                    "User-agent: *",
                    "Allow: /",
                    "Disallow: /admin",
                    "Disallow: /api/",
                    "Disallow: /payment/",
                    "Disallow: /stripe/",
                    "Sitemap: https://www.fairfare.space/sitemap.xml",
                    "",
                )
            )
        )

    def sitemap_xml(self) -> None:
        static_urls = [
            "/",
            "/blog",
            "/about",
            "/contact",
            "/deals",
            "/explorer",
        ]
        urls = [*static_urls, *SEO_LANDING_PAGES.keys(), *(f"/blog/{post['slug']}" for post in BLOG_POSTS)]
        today = date.today().isoformat()
        entries = "\n".join(
            f"""  <url>
    <loc>https://www.fairfare.space{escape(path)}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>{"weekly" if path.startswith("/blog") else "daily"}</changefreq>
    <priority>{"1.0" if path == "/" else "0.8"}</priority>
  </url>"""
            for path in urls
        )
        self.send_text(
            f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{entries}
</urlset>
""",
            "application/xml; charset=utf-8",
        )

    def set_session(self, user_id: int) -> None:
        token = secrets.token_urlsafe(32)
        with db() as con:
            con.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
            user = con.execute("SELECT is_admin, role FROM users WHERE id = ?", (user_id,)).fetchone()
        self.send_response(303)
        self.send_header("Location", "/admin" if is_staff_user(user) else "/dashboard")
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

    def reset_password_url(self, token: str) -> str:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
        if public_base_url:
            return f"{public_base_url}/reset-password?token={urllib.parse.quote(token)}"
        host = self.headers.get("Host") or "127.0.0.1:8000"
        scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
        return f"{scheme}://{host}/reset-password?token={urllib.parse.quote(token)}"

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
        service_copy = {
            "Hybrid": ("Hybrid cars", "Sedans & SUVs"),
            "Fuel-Efficient": ("Fuel-efficient", "Lower-cost rentals"),
            "Electric": ("Electric", "Vehicle options"),
        }
        services = "\n".join(
            f"""
            <div class="benefit-pill">
                <span class="circle-icon">{escape(row["icon"])}</span>
                <strong>{escape(service_copy.get(row["title"], (row["title"], row["body"]))[0])}</strong>
                <span>{escape(service_copy.get(row["title"], (row["title"], row["body"]))[1])}</span>
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

    def seo_landing_page(self) -> None:
        landing = SEO_LANDING_PAGES.get(urllib.parse.urlparse(self.path).path)
        if not landing:
            self.not_found()
            return
        user = self.current_user()
        feature_cards = "\n".join(
            f"""
            <article>
              {render_value_strip_icon(title)}
              <h2>{escape(title)}</h2>
              <p>{escape(copy)}</p>
            </article>
            """
            for title, copy in landing["features"]
        )
        action_links = "\n".join(
            f'<a class="{escape("select-button" if index == 0 else "light-button")}" href="{escape(url)}">{escape(label)}</a>'
            for index, (label, url) in enumerate(landing["links"])
        )
        related_links = "\n".join(
            f'<a href="{escape(path)}">{escape(data["h1"])}</a>'
            for path, data in SEO_LANDING_PAGES.items()
            if data is not landing
        )
        body = render_template(
            "seo_landing.html",
            title=escape(landing["title"]),
            description=escape(landing["description"]),
            canonical_url=escape(f"https://www.fairfare.space{urllib.parse.urlparse(self.path).path}"),
            kicker=escape(landing["kicker"]),
            heading=escape(landing["h1"]),
            intro=escape(landing["intro"]),
            body_copy=escape(landing["body"]),
            feature_cards=feature_cards,
            action_links=action_links,
            related_links=related_links,
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def about_page(self) -> None:
        user = self.current_user()
        body = render_template(
            "about.html",
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def contact_page(self) -> None:
        user = self.current_user()
        body = render_template(
            "contact.html",
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def blog_index_page(self) -> None:
        user = self.current_user()
        post_cards = "\n".join(
            f"""
            <article class="blog-card">
              <span>{escape(post["category"])} · {escape(post["date"])}</span>
              <h2><a href="/blog/{escape(post["slug"])}">{escape(post["title"])}</a></h2>
              <p>{escape(post["description"])}</p>
              <a class="light-button" href="/blog/{escape(post["slug"])}">Read guide</a>
            </article>
            """
            for post in BLOG_POSTS
        )
        body = render_template(
            "blog_index.html",
            post_cards=post_cards,
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def blog_post_page(self, slug: str) -> None:
        post = BLOG_POST_BY_SLUG.get(slug)
        if not post:
            self.not_found()
            return
        user = self.current_user()
        sections = "\n".join(
            f"""
            <section>
              <h2>{escape(title)}</h2>
              <p>{escape(copy)}</p>
            </section>
            """
            for title, copy in post["sections"]
        )
        related_posts = "\n".join(
            f'<a href="/blog/{escape(other["slug"])}">{escape(other["title"])}</a>'
            for other in BLOG_POSTS
            if other["slug"] != slug
        )
        gallery_items = "\n".join(
            f"""
            <figure>
              <img src="{escape(src)}?v={ASSET_VERSION}" alt="{escape(alt)}" loading="lazy" decoding="async">
              <figcaption>{escape(alt)}</figcaption>
            </figure>
            """
            for src, alt in post.get("gallery", [])
        )
        commercial = get_active_commercial()
        video_embed_url = row_value(commercial, "embed_url") or "https://www.youtube.com/embed/vMG_P78gAOE?rel=0&modestbranding=1"
        cta_label, cta_url = post["cta"]
        body = render_template(
            "blog_post.html",
            title=escape(post["title"]),
            description=escape(post["description"]),
            canonical_url=escape(f"https://www.fairfare.space/blog/{slug}"),
            category=escape(post["category"]),
            date=escape(post["date"]),
            hero=escape(post["hero"]),
            hero_image=escape(post.get("image") or "/static/img/hero-road.png"),
            intro=escape(post["intro"]),
            sections=sections,
            video_title=escape(post.get("video_title") or "Related FairFares video"),
            video_summary=escape(post.get("video_summary") or "Watch the FairFares booking flow and rental savings story."),
            video_embed_url=escape(video_embed_url),
            gallery_items=gallery_items,
            cta_label=escape(cta_label),
            cta_url=escape(cta_url),
            related_posts=related_posts,
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def explorer_page(self) -> None:
        user = self.current_user()
        profile = get_explorer_profile(user["id"] if user else None)
        photo = profile_photo_url(user)
        body = render_template(
            "explorer.html",
            auth_link='<span class="explorer-nav-tag">Explorer by FairFares</span>' if user else '<a href="/login">Sign in / Join</a>',
            profile_photo_url=escape(photo),
            explorer_photo_class="has-photo" if photo else "has-empty-photo",
            explorer_photo_src=escape(photo),
            explorer_photo_hidden="" if photo else "hidden",
            explorer_photo_label="Change photo" if photo else "Upload your photo",
            level=escape(str(profile["level"])),
            xp=escape(str(profile["xp"])),
            trips=escape(str(profile["trips"])),
            badges=escape(str(profile["badges"])),
            booked_checked="",
            exploring_checked="",
            maps_loader=explorer_maps_loader(),
        )
        self.send_html(body)

    def api_explorer_place_photo(self, parsed: urllib.parse.ParseResult) -> None:
        api_key = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
        ref = (urllib.parse.parse_qs(parsed.query).get("ref") or [""])[0].strip()
        if not api_key or not ref:
            self.send_json({"ok": False, "message": "Place photo is not available."}, 404)
            return
        query = urllib.parse.urlencode({"maxwidth": "900", "photo_reference": ref, "key": api_key})
        url = f"https://maps.googleapis.com/maps/api/place/photo?{query}"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "FairFares Explorer/1.0"})
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type") or "image/jpeg"
        except Exception:
            self.send_json({"ok": False, "message": "Unable to load place photo."}, 502)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def api_explorer_config_status(self) -> None:
        self.send_json({"ok": True, "explorer": explorer_config_status()})

    def create_explorer_quest(self) -> None:
        user = self.current_user()
        form = self.read_form()
        moods = [item.strip() for item in form.get("moods", "").split(",") if item.strip()]
        city = form.get("city", "Denver, Colorado") or "Denver, Colorado"
        try:
            city_lat = float(form.get("city_lat", "0") or 0)
            city_lng = float(form.get("city_lng", "0") or 0)
        except ValueError:
            city_lat = 0
            city_lng = 0
        fairfares_booked = form.get("fairfares_booked") == "yes"
        quest = generate_explorer_quest(
            city,
            moods,
            form.get("duration", "Half Day"),
            form.get("budget", "$$"),
            form.get("travel_with", "Friends"),
            fairfares_booked,
            city_lat,
            city_lng,
        )
        quest_id = persist_explorer_quest(user["id"] if user else None, quest)
        quest["quest_id"] = quest_id
        self.send_json({"ok": True, "quest": quest})

    def api_create_explorer_quest(self) -> None:
        self.create_explorer_quest()

    def api_get_explorer_quest(self, raw_id: str) -> None:
        try:
            quest_id = int(raw_id)
        except ValueError:
            self.send_json({"ok": False, "message": "Explorer quest id is invalid."}, 400)
            return
        with db() as con:
            quest = con.execute("SELECT * FROM explorer_quests WHERE id = ?", (quest_id,)).fetchone()
            if not quest:
                self.send_json({"ok": False, "message": "Explorer quest not found."}, 404)
                return
            stops = con.execute("SELECT * FROM explorer_stops WHERE quest_id = ? ORDER BY stop_order", (quest_id,)).fetchall()
        self.send_json({"ok": True, "quest": row_to_explorer_quest(quest, stops)})

    def api_explorer_checkin(self) -> None:
        self.checkin_explorer_stop()

    def api_explorer_xp(self) -> None:
        user = self.current_user()
        form = self.read_form()
        try:
            xp_amount = int(form.get("xp_amount", "0") or 0)
            quest_id = int(form.get("quest_id", "0") or 0) or None
            stop_id = int(form.get("stop_id", "0") or 0) or None
        except ValueError:
            self.send_json({"ok": False, "message": "XP payload is invalid."}, 400)
            return
        if xp_amount <= 0:
            self.send_json({"ok": False, "message": "XP amount must be positive."}, 400)
            return
        if not user:
            self.send_json({"ok": True, "message": "Guest XP preview only. Sign in to save Explorer XP.", "xp": xp_amount})
            return
        with db() as con:
            con.execute(
                """
                INSERT INTO explorer_profiles (user_id, xp, level, trips, badges)
                VALUES (?, ?, 1, 0, 0)
                ON CONFLICT(user_id) DO UPDATE SET
                    xp = xp + ?,
                    level = MAX(1, ((xp + ?) / 250) + 1),
                    updated_at = CURRENT_TIMESTAMP
                """,
                (user["id"], xp_amount, xp_amount, xp_amount),
            )
            con.execute(
                """
                INSERT INTO explorer_xp_events (user_id, quest_id, stop_id, event_type, xp_amount, note)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    quest_id,
                    stop_id,
                    form.get("event_type", "MANUAL_XP"),
                    xp_amount,
                    form.get("note", "Sprint 1 XP hook"),
                ),
            )
            profile = con.execute("SELECT * FROM explorer_profiles WHERE user_id = ?", (user["id"],)).fetchone()
        self.send_json({"ok": True, "xp": int(profile["xp"] or 0), "level": int(profile["level"] or 1)})

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
                "UPDATE explorer_stops SET locked = 0 WHERE quest_id = ? AND stop_order = ?",
                (stop["quest_id"], int(stop["stop_order"] or 0) + 1),
            )
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
            con.execute(
                """
                INSERT INTO explorer_xp_events (user_id, quest_id, stop_id, event_type, xp_amount, note)
                VALUES (?, ?, ?, 'STOP_CHECKIN', ?, ?)
                """,
                (user["id"], stop["quest_id"], stop_id, earned, f"Checked in at {stop['name']}"),
            )
            open_stops = con.execute(
                "SELECT COUNT(*) AS total FROM explorer_stops WHERE quest_id = ? AND completed = 0",
                (stop["quest_id"],),
            ).fetchone()["total"]
            if int(open_stops or 0) == 0:
                con.execute("UPDATE explorer_quests SET status = 'COMPLETED' WHERE id = ?", (stop["quest_id"],))
                con.execute(
                    "UPDATE explorer_profiles SET trips = trips + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
                    (user["id"],),
                )
                badge = con.execute("SELECT id FROM explorer_badges WHERE name = 'Hidden Gem Hunter'").fetchone()
                if badge:
                    con.execute("INSERT OR IGNORE INTO explorer_user_badges (user_id, badge_id) VALUES (?, ?)", (user["id"], badge["id"]))
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

    def wiki_page(self) -> None:
        user = self.current_user()
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
        articles = search_wiki_articles(query, include_internal=False)
        article_cards = "\n".join(self.render_wiki_article_card(row, admin=False) for row in articles)
        body = render_template(
            "wiki.html",
            query=escape(query),
            result_count=escape(len(articles)),
            wiki_results=article_cards or self.render_wiki_empty_state(query, admin=False),
            auth_link='<a class="nav-button" href="/dashboard">Dashboard</a>' if user else '<a href="/login">Sign in / Join</a>',
        )
        self.send_html(body)

    def render_wiki_article_card(self, row: sqlite3.Row, admin: bool = False) -> str:
        visibility = row_value(row, "visibility") or "PUBLIC"
        visibility_badge = (
            f'<span class="wiki-visibility wiki-visibility-{escape(visibility.lower())}">{escape(visibility.title())}</span>'
            if admin
            else ""
        )
        tags = [
            tag.strip()
            for tag in (row_value(row, "tags") or "").split(",")
            if tag.strip()
        ]
        tag_html = "".join(f"<span>{escape(tag)}</span>" for tag in tags[:8])
        body_text = row_value(row, "body")
        return f"""
        <article class="wiki-result-card">
          <div class="wiki-result-head">
            <div>
              <h2>{escape(row_value(row, "title"))}</h2>
              <p>{escape(row_value(row, "subtitle"))}</p>
            </div>
            {visibility_badge}
          </div>
          <div class="wiki-body">{escape(body_text)}</div>
          <div class="wiki-tags">{tag_html}</div>
          <small>Updated {escape(row_value(row, "updated_at"))}{(' · ' + escape(row_value(row, 'author_name'))) if row_value(row, 'author_name') else ''}</small>
        </article>
        """

    def render_wiki_empty_state(self, query: str, admin: bool = False) -> str:
        if query:
            return f"""
            <article class="wiki-empty">
              <b>No Wiki result found for "{escape(query)}".</b>
              <span>{'Create an article below or adjust your search.' if admin else 'Try a simpler search like savings, Explorer, pickup, receipt, or cancellation.'}</span>
            </article>
            """
        return """
        <article class="wiki-empty">
          <b>No Wiki articles yet.</b>
          <span>Admin can create title, subtitle, body, tags, and visibility rules.</span>
        </article>
        """

    def render_car_card(self, row: sqlite3.Row, saved_car_ids: set[int] | None = None) -> str:
        features = "".join(f"<li>{escape(feature)}</li>" for feature in row["features"].split("|"))
        image_alt = vehicle_image_alt(row)
        car_visual = (
            f'<img class="car-card-image" src="{escape(row["image_url"])}" alt="{escape(image_alt)}" width="520" height="320" loading="lazy" decoding="async">'
            if row["image_url"]
            else '<div class="car-shape"></div>'
        )
        booked_until_date = row_value(row, "booked_until_date")
        booked_until_time = row_value(row, "booked_until_time")
        daily_low, daily_high = daily_price_range(row["daily_price"])
        location_list = "|".join(split_inventory_locations(row["location"]))
        is_saved = bool(saved_car_ids and row["id"] in saved_car_ids)
        save_label = "Unsave" if is_saved else "Save Trip"
        return f"""
        <article class="car-card" data-category="{escape(row["category"])}" data-fuel="{escape(row["fuel_type"])}" data-location="{escape(row["location"])}" data-locations="{escape(location_list)}" data-price="{row["daily_price"]}" data-price-low="{daily_low}" data-price-high="{daily_high}" data-booked-until-date="{escape(booked_until_date)}" data-booked-until-time="{escape(booked_until_time)}">
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
                <span class="price-range" data-price-range>${daily_low}-{daily_high}</span><span>/day</span>
                <small class="duration-rate-note" data-duration-savings-note></small>
                <small class="availability-note" data-availability-note></small>
                <div class="card-actions-row">
                    <button class="light-button save-search-trip" type="button" data-car-id="{row["id"]}" data-save-car="{escape(row["name"])}" data-saved="{str(is_saved).lower()}">{save_label}</button>
                    <a class="select-button" href="/manage-booking?car_id={row["id"]}" rel="nofollow"><span>Select</span><span class="visually-hidden"> {escape(row["name"])}</span></a>
                </div>
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
        email = normalize_email(form.get("email", ""))
        with db() as con:
            user = find_user_by_email(con, email)
        if not user:
            log_login_failure(email, "user_not_found")
            self.login_page("That email and password did not match.")
            return
        if not verify_password(form.get("password", ""), user["password_hash"]):
            log_login_failure(email, "password_mismatch")
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
        email = normalize_email(form.get("email", ""))
        phone = form.get("phone", "").strip()
        referral_code = form.get("referral_code", "").strip()
        password = form.get("password", "")
        if "@" not in email or len(password) < 8:
            self.signup_page("Use a valid email and a password with at least 8 characters.")
            return
        try:
            with db() as con:
                existing_email_user = find_user_by_email(con, email)
                if existing_email_user and not int(existing_email_user["guest_account"] or 0):
                    raise sqlite3.IntegrityError
                guest = existing_email_user if existing_email_user else None
                if not guest and phone:
                    guest = con.execute(
                        "SELECT * FROM users WHERE phone = ? AND guest_account = 1 ORDER BY id DESC LIMIT 1",
                        (phone,),
                    ).fetchone()
                if guest:
                    email_owner = find_user_by_email(con, email)
                    if email_owner and email_owner["id"] == guest["id"]:
                        email_owner = None
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

    def forgot_password_page(self) -> None:
        self.send_html(
            render_template(
                "forgot_password.html",
                error="",
            )
        )

    def forgot_password(self) -> None:
        form = self.read_form()
        email = normalize_email(form.get("email", ""))

        if not email or "@" not in email:
            self.send_html(
                render_template(
                    "forgot_password.html",
                    error="Please enter a valid email address.",
                )
            )
            return

        with db() as con:
            user = find_user_by_email(con, email)

        token = create_verification(user["id"] if user else 1, email, purpose="PASSWORD_RESET")

        if user:
            link = self.reset_password_url(token)
            outbox_file, delivery_status = send_password_reset_email(email, user["name"], link)

        self.send_html(
            render_template(
                "forgot_password_sent.html",
                email=escape(email),
            )
        )

    def reset_password_page(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        token = query.get("token", [""])[0]

        if not token:
            self.activation_message_page("Reset link missing", "Please use the password reset link from your FairFares email.")
            return

        with db() as con:
            verification = con.execute(
                """
                SELECT email_verifications.*, users.email
                FROM email_verifications
                JOIN users ON users.id = email_verifications.user_id
                WHERE token = ? AND purpose = 'PASSWORD_RESET' AND used_at IS NULL
                """,
                (token,),
            ).fetchone()

        if not verification:
            self.activation_message_page("Reset link invalid", "That password reset link is not valid or has expired.")
            return

        created_time = datetime.fromisoformat(verification["created_at"])
        expires_at = created_time + timedelta(minutes=30)
        if datetime.now(UTC).replace(tzinfo=None) > expires_at:
            self.activation_message_page("Reset link expired", "Your password reset link has expired. Please request a new one.")
            return

        self.send_html(
            render_template(
                "reset_password.html",
                token=escape(token),
                error="",
            )
        )

    def reset_password(self) -> None:
        form = self.read_form()
        token = form.get("token", "").strip()
        new_password = form.get("password", "")

        if not token or len(new_password) < 8:
            self.send_html(
                render_template(
                    "reset_password.html",
                    token=escape(token),
                    error="Password must be at least 8 characters.",
                )
            )
            return

        with db() as con:
            verification = con.execute(
                """
                SELECT email_verifications.*, users.id
                FROM email_verifications
                JOIN users ON users.id = email_verifications.user_id
                WHERE token = ? AND purpose = 'PASSWORD_RESET' AND used_at IS NULL
                """,
                (token,),
            ).fetchone()

        if not verification:
            self.activation_message_page("Reset link invalid", "That password reset link is not valid or has expired.")
            return

        created_time = datetime.fromisoformat(verification["created_at"])
        expires_at = created_time + timedelta(minutes=30)
        if datetime.now(UTC).replace(tzinfo=None) > expires_at:
            self.activation_message_page("Reset link expired", "Your password reset link has expired. Please request a new one.")
            return

        with db() as con:
            con.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (hash_password(new_password), verification["user_id"]),
            )
            con.execute("UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE token = ?", (token,))
            con.execute("DELETE FROM sessions WHERE user_id = ?", (verification["user_id"],))

        self.activation_message_page(
            "Password reset successful",
            "Your password has been reset. You can now sign in with your new password.",
            "Go to Login",
            "/login"
        )

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
            active_booking = active_booking_conflict_for_car(
                requested_car["id"],
                requested_start,
                requested_end,
                exclude_booking_id=booking["id"],
            )
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
        next_days = rental_day_count(requested_start, requested_end, booking["days"])
        next_daily_price = float(row_value(requested_car, "daily_price") if requested_car else row_value(booking, "daily_price") or 0)
        discount_amount = calculate_booking_discount_amount(next_daily_price, next_days, get_valid_discount(booking["discount_code"]))
        next_breakdown = rental_price_breakdown(next_daily_price, next_days, discount_amount)
        subtotal = float(next_breakdown["base"])
        total_price = float(next_breakdown["total"])
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
                    days = ?,
                    subtotal_price = ?,
                    discount_amount = ?,
                    total_price = ?,
                    tax_fee_amount = ?,
                    booking_hold_amount = ?,
                    due_at_pickup_amount = ?,
                    estimated_market_total = ?,
                    fairfares_savings_amount = ?,
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
                    next_days,
                    subtotal,
                    discount_amount,
                    total_price,
                    next_breakdown["tax_fee_amount"],
                    next_breakdown["booking_hold"],
                    next_breakdown["due_at_pickup"],
                    next_breakdown["market_total"],
                    next_breakdown["savings"],
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
        if booking["booking_status"] == "CANCELLED":
            self.send_json({"ok": False, "message": "This booking is already cancelled."}, 409)
            return
        if booking["payment_status"] == "REFUNDED":
            self.send_json({"ok": False, "message": "This booking has already been refunded."}, 409)
            return
        reason = form.get("reason") or "Customer cancellation"
        note = form.get("note", "")
        if note:
            reason = f"{reason}: {note}"
        auto_cancel = not cancellation_requires_admin_review(booking)
        next_status = "CANCELLED" if auto_cancel else "CANCELLATION_REQUESTED"
        refund_message = ""
        if auto_cancel and booking["payment_status"] == "HOLD_PAID":
            next_payment_status, refund_message = auto_refund_booking_payments(int(booking["id"]))
        elif booking["payment_status"] in {"PAID", "HOLD_PAID"}:
            next_payment_status = "REFUND_REVIEW"
        else:
            next_payment_status = booking["payment_status"]
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
                f"Booking cancelled automatically. {refund_message or 'No online payment refund was needed.'} Task {ticket_id} was created for admin recordkeeping."
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

    def pay_booking_hold(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to pay and confirm this car."}, 401)
            return
        expire_stale_booking_holds()
        form = self.read_form()
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.send_json({"ok": False, "message": "Choose a car before paying."}, 404)
            return
        if booking["booking_status"] == "EXPIRED_HOLD":
            self.send_json({"ok": False, "message": "Payment window closed. Restart checkout or remove this vehicle."}, 409)
            return
        if booking["booking_status"] in {"CANCELLED", "RETURNED"}:
            self.send_json({"ok": False, "message": "This booking cannot accept payment right now."}, 400)
            return
        breakdown = booking_price_breakdown(booking)
        hold_amount = float(breakdown["booking_hold"])
        cardholder = form.get("cardholder_name", "").strip()
        raw_card = re.sub(r"\D+", "", form.get("card_last4", ""))
        payment_method = form.get("payment_method", "Card").strip() or "Card"
        if not cardholder or len(raw_card) < 4:
            self.send_json({"ok": False, "message": "Enter the cardholder name and last 4 card digits."}, 400)
            return
        card_last4 = raw_card[-4:]
        billing_status, billing_notes = evaluate_billing_name(
            payment_method,
            cardholder,
            booking["contact_name"] or user["name"],
            "",
        )
        if billing_status == "REVIEW_REQUIRED":
            billing_status = "MATCHED"
            billing_notes = "Billing name captured for 10% payment."
        invoice_number = f"HOLD-{secrets.randbelow(900000) + 100000}"
        with db() as con:
            while con.execute("SELECT 1 FROM transactions WHERE invoice_number = ?", (invoice_number,)).fetchone():
                invoice_number = f"HOLD-{secrets.randbelow(900000) + 100000}"
            con.execute(
                """
                INSERT INTO transactions
                (booking_id, payment_method, cardholder_name, amount, transaction_status, billing_verification_status, billing_verification_notes, invoice_number)
                VALUES (?, ?, ?, ?, 'HOLD_PAID', ?, ?, ?)
                """,
                (
                    booking["id"],
                    f"{payment_method} ending {card_last4}",
                    cardholder,
                    hold_amount,
                    billing_status,
                    billing_notes,
                    invoice_number,
                ),
            )
            con.execute(
                """
                UPDATE bookings
                SET payment_status = 'HOLD_PAID',
                    booking_status = 'CONFIRMED',
                    status = 'CONFIRMED',
                    booking_hold_amount = ?,
                    due_at_pickup_amount = ?,
                    hold_expires_at = NULL
                WHERE id = ? AND user_id = ?
                """,
                (hold_amount, breakdown["due_at_pickup"], booking["id"], user["id"]),
            )
            con.execute("UPDATE cars SET status = 'BOOKED' WHERE id = ?", (booking["car_id"],))
        notify_slack_payment(booking, f"10% hold paid: {format_money(hold_amount)}", self.public_origin())
        send_confirmed_booking_email_once(booking["id"], self.public_origin())
        self.send_json(
            {
                "ok": True,
                "message": f"Payment recorded: {format_money(hold_amount)}. It will be deducted from pickup balance.",
                "payment_status": "HOLD_PAID",
                "payment_label": payment_status_label("HOLD_PAID"),
                "status_label": booking_status_label("CONFIRMED", "HOLD_PAID"),
                "hold_amount": format_money(hold_amount),
                "due_at_pickup": format_money(breakdown["due_at_pickup"]),
                "invoice_number": invoice_number,
            }
        )

    def create_stripe_checkout_session(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to pay and confirm this car."}, 401)
            return
        expire_stale_booking_holds()
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.send_json({"ok": False, "message": "Choose a car before paying."}, 404)
            return
        if booking["booking_status"] == "EXPIRED_HOLD":
            self.send_json({"ok": False, "message": "Payment window closed. Restart checkout or remove this vehicle."}, 409)
            return
        if booking["booking_status"] not in {"PENDING_HOLD", "CONFIRMED"} or booking["payment_status"] == "PAID":
            self.send_json({"ok": False, "message": "This booking does not need a payment right now."}, 400)
            return
        form = self.read_form()
        payment_option = "full" if form.get("payment_option") == "full" else "hold"
        if booking["payment_status"] == "HOLD_PAID" and payment_option != "full":
            self.send_json({"ok": False, "message": "The 10% hold is already paid. Pay the remaining balance for hassle-free pickup."}, 400)
            return
        breakdown = booking_price_breakdown(booking)
        checkout_amount = (
            round(float(breakdown["due_at_pickup"]), 2)
            if payment_option == "full" and booking["payment_status"] == "HOLD_PAID"
            else full_payment_total(breakdown["total"])
            if payment_option == "full"
            else round(float(breakdown["booking_hold"]), 2)
        )
        amount_cents = max(50, int(round(checkout_amount * 100)))
        origin = self.public_origin().rstrip("/")
        product_name = (
            "FairFares remaining pickup balance"
            if payment_option == "full" and booking["payment_status"] == "HOLD_PAID"
            else "FairFares full booking payment"
            if payment_option == "full"
            else "FairFares 10% booking hold"
        )
        product_description = (
            f"{row_value(booking, 'car_name')} - {row_value(booking, 'booking_id')} - remaining balance for hassle-free pickup"
            if payment_option == "full" and booking["payment_status"] == "HOLD_PAID"
            else
            f"{row_value(booking, 'car_name')} - {row_value(booking, 'booking_id')} - full payment includes $10 pickup discount"
            if payment_option == "full"
            else f"{row_value(booking, 'car_name')} - {row_value(booking, 'booking_id')}"
        )
        params = {
            "mode": "payment",
            "success_url": f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{origin}/payment/cancel",
            "customer_email": row_value(booking, "contact_email") or row_value(user, "email"),
            "client_reference_id": row_value(booking, "booking_id"),
            "line_items[0][quantity]": 1,
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": amount_cents,
            "line_items[0][price_data][product_data][name]": product_name,
            "line_items[0][price_data][product_data][description]": product_description,
            "metadata[payment_option]": payment_option,
            "metadata[booking_id]": row_value(booking, "id"),
            "metadata[public_booking_id]": row_value(booking, "booking_id"),
            "metadata[user_id]": row_value(user, "id"),
            "payment_intent_data[metadata][payment_option]": payment_option,
            "payment_intent_data[metadata][booking_id]": row_value(booking, "id"),
            "payment_intent_data[metadata][public_booking_id]": row_value(booking, "booking_id"),
            "payment_intent_data[metadata][user_id]": row_value(user, "id"),
        }
        session, status = stripe_api_request("checkout/sessions", params)
        url = str(session.get("url") or "")
        if not url:
            self.send_json({"ok": False, "message": status}, 502)
            return
        self.send_json({"ok": True, "url": url})

    def create_stripe_identity_session(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to verify your identity."}, 401)
            return
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.send_json({"ok": False, "message": "Book a vehicle before starting identity verification."}, 404)
            return
        if not stripe_identity_enabled():
            self.send_json({"ok": False, "message": "Stripe Identity is not configured on this server."}, 503)
            return
        existing = latest_identity_verification(int(user["id"]), int(booking["id"]))
        if existing and row_value(existing, "status") == "VERIFIED":
            self.send_json({"ok": True, "verified": True, "message": "Identity is already verified."})
            return
        origin = self.public_origin().rstrip("/")
        session, status = create_stripe_identity_session_for(user, booking, f"{origin}/manage-booking?identity=return")
        url = str(session.get("url") or "")
        if not url:
            self.send_json({"ok": False, "message": status}, 502)
            return
        save_identity_verification_from_session(session, int(user["id"]), int(booking["id"]))
        self.send_json({"ok": True, "url": url, "message": "Opening Stripe Identity."})

    def create_admin_stripe_identity_session(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id", "0") or 0)
        except ValueError:
            booking_id = 0
        if not booking_id:
            self.send_json({"ok": False, "message": "Booking is required for Stripe Identity."}, 400)
            return
        with db() as con:
            booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
            if not booking:
                self.send_json({"ok": False, "message": "Booking not found."}, 404)
                return
            customer = con.execute("SELECT * FROM users WHERE id = ?", (booking["user_id"],)).fetchone()
            if not customer:
                self.send_json({"ok": False, "message": "Customer not found."}, 404)
                return
        existing = latest_identity_verification(int(customer["id"]), int(booking["id"]))
        if existing and row_value(existing, "status") == "VERIFIED":
            self.send_json({"ok": True, "verified": True, "message": "Identity is already verified."})
            return
        origin = self.public_origin().rstrip("/")
        session, status = create_stripe_identity_session_for(customer, booking, f"{origin}/admin/pickup?identity=return")
        url = str(session.get("url") or "")
        if not url:
            self.send_json({"ok": False, "message": status}, 502)
            return
        save_identity_verification_from_session(session, int(customer["id"]), int(booking["id"]))
        self.send_json({"ok": True, "url": url, "message": "Opening Stripe Identity for pickup verification."})

    def create_admin_pickup_balance_payment(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id", "0") or 0)
        except ValueError:
            booking_id = 0
        if not booking_id:
            self.send_json({"ok": False, "message": "Missing booking."}, 400)
            return
        with db() as con:
            booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        if not booking:
            self.send_json({"ok": False, "message": "Booking not found."}, 404)
            return
        payment_intent, status = create_pickup_balance_payment_intent(booking, admin)
        if status != "ok":
            self.send_json({"ok": False, "message": status}, 400)
            return
        payment_intent_id = str(payment_intent.get("id") or "")
        client_secret = str(payment_intent.get("client_secret") or "")
        amount = float(payment_intent.get("amount") or 0) / 100
        self.send_json(
            {
                "ok": True,
                "message": (
                    "In-person pickup balance payment created. Collect it with Stripe Terminal/Tap to Pay; "
                    "FairFares updates this booking after Stripe confirms payment."
                ),
                "payment_intent_id": payment_intent_id,
                "client_secret": client_secret,
                "amount": format_money(amount),
                "dashboard_url": stripe_dashboard_payment_url(payment_intent_id),
            }
        )

    def create_admin_security_deposit_payment(self) -> None:
        admin = self.require_admin()
        if not admin:
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id", "0") or 0)
        except ValueError:
            booking_id = 0
        if not booking_id:
            self.send_json({"ok": False, "message": "Missing booking."}, 400)
            return
        with db() as con:
            booking = con.execute("SELECT * FROM bookings WHERE id = ?", (booking_id,)).fetchone()
        if not booking:
            self.send_json({"ok": False, "message": "Booking not found."}, 404)
            return
        payment_intent, status = create_security_deposit_payment_intent(booking, admin)
        if status != "ok":
            self.send_json({"ok": False, "message": status}, 400)
            return
        payment_intent_id = str(payment_intent.get("id") or "")
        client_secret = str(payment_intent.get("client_secret") or "")
        amount = float(payment_intent.get("amount") or 0) / 100
        self.send_json(
            {
                "ok": True,
                "message": (
                    "Refundable security deposit authorization created. Collect it with Stripe Terminal/Tap to Pay; "
                    "release it after return review if there are no tickets, damage, tolls, cleaning, fuel, or other charges."
                ),
                "payment_intent_id": payment_intent_id,
                "client_secret": client_secret,
                "amount": format_money(amount),
                "dashboard_url": stripe_dashboard_payment_url(payment_intent_id),
            }
        )

    def payment_success_page(self) -> None:
        user = self.current_user()
        if not user:
            self.redirect("/login")
            return
        parsed = urllib.parse.urlparse(self.path)
        session_id = urllib.parse.parse_qs(parsed.query).get("session_id", [""])[0]
        success_title = "Payment received"
        success_message = "Your 10% booking hold is being confirmed. Your pickup balance is updated on Manage Booking."
        if session_id:
            session, _status = stripe_api_get(f"checkout/sessions/{urllib.parse.quote(session_id)}")
            metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
            try:
                booking_id = int(metadata.get("booking_id") or "0")
            except (TypeError, ValueError):
                booking_id = 0
            try:
                session_user_id = int(metadata.get("user_id") or "0")
            except (TypeError, ValueError):
                session_user_id = 0
            if session_user_id and session_user_id != int(user["id"]) and not is_staff_user(user):
                self.activation_message_page(
                    "Payment received",
                    "Stripe confirmed the payment, but this checkout belongs to a different FairFares account.",
                    "Open Manage Booking",
                    "/manage-booking",
                )
                return
            if session.get("payment_status") == "paid" and booking_id:
                amount_total = float(session.get("amount_total") or 0) / 100
                payment_option = "full" if metadata.get("payment_option") == "full" else "hold"
                if payment_option == "full":
                    success_title = "Full payment received"
                    success_message = "Your booking is paid in full. Your pickup balance is $0.00."
                confirm_booking_hold_payment(
                    booking_id,
                    amount_total,
                    "Stripe Checkout",
                    str(session.get("customer_email") or row_value(user, "email") or "Stripe customer"),
                    str(session.get("payment_intent") or session.get("id") or ""),
                    self.public_origin(),
                    payment_option,
                )
        self.activation_message_page(
            success_title,
            success_message,
            "Open Manage Booking",
            "/manage-booking",
        )

    def payment_cancel_page(self) -> None:
        self.activation_message_page(
            "Payment not completed",
            "Stripe checkout was cancelled. Your payment window remains active until the timer expires.",
            "Return to Checkout",
            "/manage-booking",
        )

    def stripe_webhook(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length)
        if stripe_webhook_secret() and not verify_stripe_signature(payload, self.headers.get("Stripe-Signature", "")):
            self.send_json({"ok": False, "message": "Invalid Stripe signature."}, 400)
            return
        try:
            event = json.loads(payload.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"ok": False, "message": "Invalid webhook payload."}, 400)
            return
        event_type = str(event.get("type") or "")
        data_object = ((event.get("data") or {}).get("object") or {}) if isinstance(event.get("data"), dict) else {}
        if event_type == "checkout.session.completed" and data_object.get("payment_status") == "paid":
            metadata = data_object.get("metadata") if isinstance(data_object.get("metadata"), dict) else {}
            try:
                booking_id = int(metadata.get("booking_id") or "0")
            except (TypeError, ValueError):
                booking_id = 0
            if booking_id:
                amount_total = float(data_object.get("amount_total") or 0) / 100
                payment_option = "full" if metadata.get("payment_option") == "full" else "hold"
                confirm_booking_hold_payment(
                    booking_id,
                    amount_total,
                    "Stripe Checkout",
                    str(data_object.get("customer_email") or "Stripe customer"),
                    str(data_object.get("payment_intent") or data_object.get("id") or ""),
                    self.public_origin(),
                    payment_option,
                )
        if event_type == "payment_intent.succeeded":
            confirm_pickup_balance_payment_intent(data_object, self.public_origin())
            record_security_deposit_authorization(data_object)
        if event_type == "payment_intent.amount_capturable_updated":
            record_security_deposit_authorization(data_object)
        if event_type.startswith("identity.verification_session."):
            save_identity_verification_from_session(data_object)
        self.send_json({"received": True})

    def continue_booking_hold(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to continue checkout."}, 401)
            return
        expire_stale_booking_holds()
        booking = get_booking_for_user(user["id"])
        if not booking:
            self.send_json({"ok": False, "message": "No checkout window found."}, 404)
            return
        if booking["booking_status"] not in {"PENDING_HOLD", "EXPIRED_HOLD"}:
            self.send_json({"ok": False, "message": "This booking does not need a new payment window."}, 400)
            return
        active = active_booking_for_car(booking["car_id"])
        if active and int(active["id"]) != int(booking["id"]):
            self.send_json({"ok": False, "message": "That car is no longer available. Please choose another vehicle."}, 409)
            return
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'PENDING_HOLD',
                    status = 'PENDING_HOLD',
                    payment_status = 'HOLD_PENDING',
                    hold_started_at = CURRENT_TIMESTAMP,
                    hold_expires_at = datetime('now', '+10 minutes')
                WHERE id = ? AND user_id = ?
                """,
                (booking["id"], user["id"]),
            )
            con.execute("UPDATE cars SET status = 'HOLD' WHERE id = ?", (booking["car_id"],))
        self.send_json(
            {
                "ok": True,
                "message": "Checkout restarted for 10 minutes. Pay 10% to confirm this car.",
                "status_label": booking_status_label("PENDING_HOLD", "HOLD_PENDING"),
                "status_class": booking_status_class("PENDING_HOLD"),
                "remaining": f"{BOOKING_HOLD_MINUTES}:00",
            }
        )

    def remove_booking_hold(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to remove this car."}, 401)
            return
        booking = get_booking_for_user(user["id"])
        if not booking or booking["booking_status"] not in {"PENDING_HOLD", "EXPIRED_HOLD"}:
            self.send_json({"ok": False, "message": "No removable checkout item found."}, 404)
            return
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET booking_status = 'CANCELLED',
                    status = 'CANCELLED',
                    payment_status = 'HOLD_EXPIRED',
                    cancellation_reason = 'Customer removed unpaid checkout item.'
                WHERE id = ? AND user_id = ?
                """,
                (booking["id"], user["id"]),
            )
            active = con.execute(
                """
                SELECT 1
                FROM bookings
                WHERE car_id = ?
                  AND id != ?
                  AND booking_status IN ('CONFIRMED', 'MODIFIED', 'CANCELLATION_REQUESTED', 'PICKED_UP')
                LIMIT 1
                """,
                (booking["car_id"], booking["id"]),
            ).fetchone()
            if not active:
                con.execute("UPDATE cars SET status = 'AVAILABLE' WHERE id = ?", (booking["car_id"],))
        self.send_json({"ok": True, "message": "Removed. The car is available again.", "redirect": "/#results"})

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
        email = normalize_email(form.get("email") or user["email"] or "")
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

    def update_profile_photo(self) -> None:
        user = self.current_user()
        if not user:
            self.send_json({"ok": False, "login_required": True, "message": "Sign in to save your profile photo."}, 401)
            return
        form = self.read_form()
        photo = (form.get("photo") or "").strip()
        if photo.startswith("data:image/svg xml"):
            photo = photo.replace("data:image/svg xml", "data:image/svg+xml", 1)
        if not photo.startswith("data:image/"):
            self.send_json({"ok": False, "message": "Upload a valid image."}, 400)
            return
        if ";base64," not in photo or len(photo) > MAX_PROFILE_PHOTO_DATA_URL_LENGTH:
            self.send_json({"ok": False, "message": "Use a smaller JPG, PNG, or WebP profile image."}, 400)
            return
        with db() as con:
            con.execute("UPDATE users SET profile_photo_url = ? WHERE id = ?", (photo, user["id"]))
        self.send_json({"ok": True, "photo": photo, "message": "Profile photo saved."})

    def create_workspace_group(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        name = re.sub(r"\s+", " ", (form.get("name") or "").strip())
        description = (form.get("description") or "").strip()
        slack_url = normalize_slack_url(form.get("slack_url") or "")
        if len(name) > 60:
            name = name[:60].strip()
        if len(description) > 240:
            description = description[:240].strip()
        if not name:
            self.redirect("/admin/workspace")
            return
        with db() as con:
            existing_group = con.execute("SELECT id FROM workspace_groups WHERE name = ?", (name,)).fetchone()
            slack_channel_id = ""
            slack_channel_name = ""
            if not existing_group and not slack_url:
                slack_channel_id, slack_channel_name, slack_url, _slack_status = create_slack_channel_for_workspace_group(name)
            con.execute(
                """
                INSERT OR IGNORE INTO workspace_groups (
                    name, description, slack_url, slack_channel_id, slack_channel_name, created_by
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, description, slack_url, slack_channel_id, slack_channel_name, row_value(user, "id")),
            )
            group = con.execute("SELECT id FROM workspace_groups WHERE name = ?", (name,)).fetchone()
            if group:
                if slack_url:
                    con.execute(
                        """
                        UPDATE workspace_groups
                        SET slack_url = ?,
                            slack_channel_id = COALESCE(NULLIF(?, ''), slack_channel_id),
                            slack_channel_name = COALESCE(NULLIF(?, ''), slack_channel_name)
                        WHERE id = ?
                        """,
                        (slack_url, slack_channel_id, slack_channel_name, row_value(group, "id")),
                    )
                con.execute(
                    """
                    INSERT OR IGNORE INTO workspace_group_members (group_id, user_id)
                    VALUES (?, ?)
                    """,
                    (row_value(group, "id"), row_value(user, "id")),
                )
        self.redirect("/admin/workspace")

    def update_workspace_group_slack(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            group_id = int(form.get("group_id") or "0")
        except ValueError:
            group_id = 0
        slack_url = normalize_slack_url(form.get("slack_url") or "")
        with db() as con:
            group = con.execute("SELECT id FROM workspace_groups WHERE id = ?", (group_id,)).fetchone()
            if group:
                con.execute(
                    """
                    UPDATE workspace_groups
                    SET slack_url = ?,
                        slack_channel_id = '',
                        slack_channel_name = ''
                    WHERE id = ?
                    """,
                    (slack_url, group_id),
                )
        self.redirect(f"/admin/workspace?group={group_id}" if group_id else "/admin/workspace")

    def join_workspace_group(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            group_id = int(form.get("group_id") or "0")
        except ValueError:
            group_id = 0
        with db() as con:
            group = con.execute("SELECT id FROM workspace_groups WHERE id = ?", (group_id,)).fetchone()
            if group:
                con.execute(
                    """
                    INSERT OR IGNORE INTO workspace_group_members (group_id, user_id)
                    VALUES (?, ?)
                    """,
                    (group_id, row_value(user, "id")),
                )
        self.redirect(f"/admin/workspace?group={group_id}" if group_id else "/admin/workspace")

    def create_workspace_post(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        body = (form.get("body") or "").strip()
        post_type = (form.get("post_type") or "UPDATE").upper().strip()
        visibility = normalize_workspace_visibility(form.get("visibility") or "COMPANY", user)
        try:
            group_id = int(form.get("group_id") or "0") or None
        except ValueError:
            group_id = None
        media_url = (form.get("media_url") or "").strip()
        image_data = (form.get("image_data") or "").strip()
        if group_id and not get_workspace_group(group_id):
            group_id = None
        if post_type not in {"UPDATE", "HANDOFF", "ALERT", "PROFILE"}:
            post_type = "UPDATE"
        if len(body) > 1200:
            body = body[:1200].strip()
        if len(media_url) > 1200:
            media_url = media_url[:1200].strip()
        if image_data:
            if image_data.startswith("data:image/svg xml"):
                image_data = image_data.replace("data:image/svg xml", "data:image/svg+xml", 1)
            if not image_data.startswith("data:image/") or ";base64," not in image_data or len(image_data) > MAX_PROFILE_PHOTO_DATA_URL_LENGTH:
                image_data = ""
        if not body and not image_data and not media_url:
            self.redirect("/admin/workspace")
            return
        with db() as con:
            con.execute(
                """
                INSERT INTO workspace_posts (author_id, post_type, body, media_url, image_data, visibility, group_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (row_value(user, "id"), post_type, body or "Shared a workspace update.", media_url, image_data, visibility, group_id),
            )
        self.redirect(f"/admin/workspace?group={group_id}" if group_id else "/admin/workspace")

    def update_workspace_post(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            post_id = int(form.get("post_id") or "0")
        except ValueError:
            self.redirect("/admin/workspace")
            return
        body = (form.get("body") or "").strip()
        if len(body) > 1200:
            body = body[:1200].strip()
        if not body:
            self.redirect("/admin/workspace")
            return
        with db() as con:
            post = con.execute("SELECT author_id FROM workspace_posts WHERE id = ?", (post_id,)).fetchone()
            if not post:
                self.redirect("/admin/workspace")
                return
            if row_value(post, "author_id") != row_value(user, "id") and not is_admin_user(user):
                self.redirect("/admin/workspace")
                return
            con.execute(
                """
                UPDATE workspace_posts
                SET body = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (body, post_id),
            )
        self.redirect("/admin/workspace")

    def react_workspace_post(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            post_id = int(form.get("post_id") or "0")
        except ValueError:
            post_id = 0
        if not post_id:
            if self.wants_json():
                self.send_json({"ok": False, "error": "Missing post."}, 400)
                return
            self.redirect("/admin/workspace")
            return
        payload = apply_workspace_reaction(post_id, int(row_value(user, "id") or 0), form.get("reaction") or "LIKE")
        if self.wants_json():
            self.send_json(payload)
            return
        self.redirect(workspace_post_redirect(post_id))

    def comment_workspace_post(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            post_id = int(form.get("post_id") or "0")
        except ValueError:
            post_id = 0
        body = re.sub(r"\s+", " ", (form.get("body") or "").strip())
        if len(body) > 360:
            body = body[:360].strip()
        if not post_id or not body:
            if self.wants_json():
                self.send_json({"ok": False, "error": "Comment is required."}, 400)
                return
            self.redirect(workspace_post_redirect(post_id) if post_id else "/admin/workspace")
            return
        with db() as con:
            post = con.execute("SELECT id FROM workspace_posts WHERE id = ?", (post_id,)).fetchone()
            if post:
                con.execute(
                    """
                    INSERT INTO workspace_post_comments (post_id, author_id, body)
                    VALUES (?, ?, ?)
                    """,
                    (post_id, row_value(user, "id"), body),
                )
        if self.wants_json():
            stats = get_workspace_post_stats(post_id)
            self.send_json({"ok": True, "comment_count": stats["comment_count"], "comments_html": render_workspace_comments(post_id)})
            return
        self.redirect(workspace_post_redirect(post_id))

    def share_workspace_post_to_slack(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            post_id = int(form.get("post_id") or "0")
        except ValueError:
            post_id = 0
        if not post_id:
            if self.wants_json():
                self.send_json({"ok": False, "error": "Missing post."}, 400)
                return
            self.redirect("/admin/workspace")
            return
        status = "Post not found."
        with db() as con:
            post = con.execute(
                """
                SELECT workspace_posts.*, users.name AS author_name, workspace_groups.name AS group_name
                FROM workspace_posts
                JOIN users ON users.id = workspace_posts.author_id
                LEFT JOIN workspace_groups ON workspace_groups.id = workspace_posts.group_id
                WHERE workspace_posts.id = ?
                """,
                (post_id,),
            ).fetchone()
        if post:
            group_name = row_value(post, "group_name") or "Company feed"
            text = (
                f"Workspace post shared by {row_value(user, 'name')}\n"
                f"Author: {row_value(post, 'author_name')}\n"
                f"Feed: {group_name}\n"
                f"{row_value(post, 'body')}"
            )
            status = send_slack_notification("general", text[:3000])
        if self.wants_json():
            self.send_json({"ok": bool(post), "message": status if post else "Post not found."}, 200 if post else 404)
            return
        self.redirect(workspace_post_redirect(post_id))

    def create_guest_booking(self) -> None:
        form = self.read_form()
        first_name = form.get("first_name", "").strip()
        last_name = form.get("last_name", "").strip()
        full_name = " ".join(part for part in (first_name, last_name) if part).strip()
        email = normalize_email(form.get("email", ""))
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
            "booking_id": public_booking_id_label(booking),
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
                (ticket_id, booking_id, user_id, topic, preferred_contact, message, urgent, priority,
                 escalated_to_oncall, escalation_reason, escalated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
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
                    1 if priority == "P0" else 0,
                    "Auto-escalated because the customer ticket was classified P0." if priority == "P0" else "",
                    1 if priority == "P0" else 0,
                ),
            )
            ticket_pk = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            ticket_row = con.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_pk,)).fetchone()
            alert_body = (
                f"{priority} support ticket created\n"
                f"SLA: {support_sla_text(priority)}\n"
                f"Ticket: {ticket_id}\n"
                f"Customer: {user['name']} · {user['email']} · {user['phone'] or 'No phone'}\n"
                f"Topic: {topic}\n"
                f"Preferred contact: {form.get('preferred_contact') or 'Chat in browser'}\n"
                f"Message: {message or '-'}"
            )
            if priority == "P0" and ticket_row:
                queue_oncall_escalation_alert(con, ticket_row, None, "Auto-escalated because the customer ticket was classified P0.")
            else:
                queue_support_alerts(con, ticket_pk, ticket_id, priority, f"{priority} FairFares support ticket {ticket_id}", alert_body)
        notify_slack_support_ticket(ticket_id, priority, topic, user, self.public_origin(), escalated=priority == "P0")
        self.send_json({
            "ok": True,
            "ticket_id": ticket_id,
            "priority": priority,
            "sla": support_sla_text(priority),
            "message": f"Ticket {ticket_id} created as {priority}. SLA: {support_sla_text(priority)}. Target response by {due_at}.",
        })

    def submit_app_feedback(self) -> None:
        user = self.current_user()
        form = self.read_form()
        try:
            rating = int(form.get("rating", "0") or 0)
        except ValueError:
            rating = 0
        if rating < 1 or rating > 5:
            self.send_json({"ok": False, "message": "Please choose a rating from 1 to 5."}, 400)
            return
        message = (form.get("message") or "").strip()[:1200]
        page = (form.get("page") or "").strip()[:300]
        user_agent = (self.headers.get("User-Agent") or "").strip()[:300]
        with db() as con:
            con.execute(
                """
                INSERT INTO app_feedback (user_id, rating, message, page, user_agent)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user["id"] if user else None, rating, message, page, user_agent),
            )
        self.send_json({"ok": True, "message": "Thank you. Your valuable website feedback was submitted."})

    def ask_wiki_agent(self) -> None:
        user = self.current_user()
        include_internal = assistant_user_role(user) == "admin"
        form = self.read_form()
        question = " ".join((form.get("question") or "").split())[:180]
        if not question:
            self.send_json({"ok": False, "message": "Ask about cars, booking, cancellation, refunds, Explorer, or support."}, 400)
            return
        context = assistant_database_context(question, user, include_internal)
        answer = openai_assistant_answer(question, context) or local_assistant_answer(question, context)
        wiki_sources = context.get("wiki") if isinstance(context.get("wiki"), list) else []
        sources = [
            {
                "title": str(row.get("title", "")),
                "visibility": str(row.get("visibility", "")),
            }
            for row in wiki_sources[:3]
            if isinstance(row, dict)
        ]
        self.send_json(
            {
                "ok": True,
                "answer": answer,
                "sources": sources,
                "actions": assistant_actions(question, context),
                "scope": "Admin database + Wiki" if include_internal else ("Your FairFares data + public Wiki" if user else "Public FairFares data"),
                "agent": "FairFares Assistant",
            }
        )

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
        student_email = normalize_email(form.get("student_email", ""))
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
        if not student_email_matches_profile_name(row_value(user, "name"), student_email):
            self.send_json({
                "ok": False,
                "message": "Your profile name must match your school email. Update your FairFares profile name or use the .edu email issued to you.",
                "verified": False,
                "verified_label": "Student Verification Pending",
                "discount_label": "Profile name must match school email",
                "checks_html": "<li>Student ID saved</li><li>Profile name and school email must match</li><li>Discount pending <b>0% OFF</b></li>",
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
        message = student_verification_delivery_message(delivery_status)
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
            if not student_email_matches_profile_name(verification["name"], verification["email"]):
                self.activation_message_page(
                    "Profile name must match school email",
                    "Update your FairFares profile name or request verification again with the .edu email issued to you.",
                    "Open Dashboard",
                    "/dashboard",
                )
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
        send_student_verified_email(verification["email"], verification["name"], code, self.public_origin())
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
        if is_staff_user(user):
            self.redirect("/admin")
            return
        self.render_manage_booking(user)

    def require_admin(self) -> sqlite3.Row | None:
        user = self.current_user()
        if not user:
            self.redirect("/login")
            return None
        if not is_staff_user(user):
            self.redirect("/dashboard")
            return None
        return user

    def require_owner_admin(self, fallback: str = "/admin/bookings") -> sqlite3.Row | None:
        user = self.require_admin()
        if not user:
            return None
        if not is_admin_user(user):
            self.redirect(fallback)
            return None
        return user

    def render_admin_nav(self, user: sqlite3.Row, active: str) -> str:
        admin_groups = [
            ("workspace", "Workspace", "/admin", [("workspace", "/admin", "Workspace")]),
            ("fleet", "Fleet", "/admin/inventory", [("portal", "/admin/inventory", "Inventory"), ("roi", "/admin/roi", "ROI")]),
            ("operations", "Operations", "/admin/bookings", [("bookings", "/admin/bookings", "Booked Cars"), ("tickets", "/admin/tickets", "Tickets"), ("oncall", "/admin/oncall", "On-call"), ("pickup", "/admin/pickup", "User Pickup")]),
            ("people", "People", "/admin/users", [("users", "/admin/users", "Users"), ("requests", "/admin/requests", "Staff Requests")]),
            ("marketing", "Marketing", "/admin/discounts", [("discounts", "/admin/discounts", "Discounts"), ("commercials", "/admin/commercials", "Commercials"), ("email", "/admin/email-marketing", "Email Marketing")]),
            ("knowledge", "Knowledge", "/admin/wiki", [("wiki", "/admin/wiki", "Wiki")]),
            ("system", "System", "/admin/system", [("system", "/admin/system", "System")]),
        ]
        employee_groups = [
            ("workspace", "Workspace", "/admin", [("workspace", "/admin", "Workspace")]),
            ("operations", "Operations", "/admin/bookings", [("bookings", "/admin/bookings", "Booked Cars"), ("tickets", "/admin/tickets", "Tickets"), ("pickup", "/admin/pickup", "User Pickup")]),
            ("portal", "User Portal", "/", [("portal", "/", "User Portal")]),
        ]
        groups = admin_groups if is_admin_user(user) else employee_groups
        badge_counts = get_admin_nav_badge_counts(user)
        active_group = next((group for group in groups if any(item[0] == active for item in group[3])), groups[0])
        primary_links = []
        for key, label, href, _items in groups:
            active_class = ' class="active"' if key == active_group[0] else ""
            group_count = sum(badge_counts.get(item_key, 0) for item_key, _href, _label in _items)
            primary_links.append(f'<a{active_class} href="{href}" title="{escape(label)}" aria-label="{escape(label)}">{render_admin_nav_label(label, group_count)}</a>')
        primary_links.append(f'<a href="/logout" title="Log out" aria-label="Log out">{render_admin_nav_label("Log out")}</a>')
        sub_links = []
        if active_group[0] != "workspace":
            for key, href, label in active_group[3]:
                active_class = ' class="active"' if key == active else ""
                sub_links.append(f'<a{active_class} href="{href}" title="{escape(label)}" aria-label="{escape(label)}">{render_admin_nav_label(label, badge_counts.get(key, 0))}</a>')
        subnav_html = f'<nav class="admin-subnav" aria-label="Admin filters">{"".join(sub_links)}</nav>' if sub_links else ""
        oncall_drawer = ""
        if is_admin_user(user) and active != "workspace":
            next_shift = next_oncall_shift_for_user(int(row_value(user, "id") or 0))
            next_label = row_value(next_shift, "shift_date") or "Set schedule"
            today_oncall = get_oncall_shift_for_day()
            today_label = (
                f"{row_value(today_oncall, 'admin_name')} - {row_value(today_oncall, 'shift_date')}"
                if today_oncall
                else "No admin assigned today"
            )
            mini_calendar = render_oncall_mini_calendar()
            oncall_drawer = f"""
            <aside class="admin-oncall-dock" data-oncall-dock>
              <button class="admin-oncall-tab" type="button" data-oncall-toggle aria-expanded="false">
                <span>On-call</span><b>{escape(next_label)}</b>
              </button>
              <section class="admin-oncall-drawer" aria-label="On-call dashboard">
                <div class="admin-oncall-drawer-head">
                  <p class="eyebrow">On-call dashboard</p>
                  <h2>Admin coverage</h2>
                  <button type="button" data-oncall-close aria-label="Close on-call dashboard">x</button>
                </div>
                <div class="admin-oncall-next">
                  <span>Today&apos;s on-call</span>
                  <b>{escape(today_label)}</b>
                  <small>Your next shift: {escape(next_label)}</small>
                </div>
                {mini_calendar}
                <div class="admin-oncall-next admin-oncall-next-soft">
                  <span>Ticket routing</span>
                  <b>P0 and escalated tickets route to today&apos;s on-call admin.</b>
                </div>
                <a class="admin-oncall-full-link" href="/admin/oncall">Open monthly schedule</a>
              </section>
            </aside>
            """
        return f"""
        <div class="admin-nav-stack">
          <nav class="admin-nav admin-primary-nav" aria-label="Admin sections">{"".join(primary_links)}</nav>
          {subnav_html}
        </div>
        {oncall_drawer}
        """

    def render_booking_status_filter_options(self, selected: str) -> str:
        options = [
            ("ALL", "All bookings"),
            ("PENDING_HOLD", "Pending payment"),
            ("EXPIRED_HOLD", "Expired payment"),
            ("CONFIRMED", "Confirmed"),
            ("MODIFIED", "Modification requests"),
            ("CANCELLATION_REQUESTED", "Cancellation requests"),
            ("CANCELLED", "Cancelled"),
            ("PICKED_UP", "Picked up"),
            ("RETURNED", "Returned"),
        ]
        return "".join(
            f'<option value="{value}" {"selected" if selected == value else ""}>{escape(label)}</option>'
            for value, label in options
        )

    def admin_portal(self) -> None:
        user = self.require_admin()
        if not user:
            return
        if not is_admin_user(user):
            self.employee_portal(user)
            return
        metrics = get_admin_metrics()
        cars = "\n".join(self.render_admin_car_row(row) for row in get_admin_cars())
        fleet_summary = "\n".join(self.render_fleet_summary_row(row) for row in get_fleet_summary())
        body = render_template(
            "admin.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "portal"),
            total_cars=metrics["cars"],
            available_cars=metrics["available"],
            booked_count=metrics["booked"],
            user_count=metrics["users"],
            cars=cars or '<tr><td colspan="10">No inventory yet.</td></tr>',
            fleet_summary=fleet_summary or '<tr><td colspan="7">No fleet data yet.</td></tr>',
        )
        self.send_html(body)

    def admin_workspace_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        metrics = get_admin_metrics()
        parsed = urllib.parse.urlparse(self.path)
        try:
            selected_group_id = int(urllib.parse.parse_qs(parsed.query).get("group", ["0"])[0]) or None
        except ValueError:
            selected_group_id = None
        try:
            selected_author_id = int(urllib.parse.parse_qs(parsed.query).get("author", ["0"])[0]) or None
        except ValueError:
            selected_author_id = None
        selected_group = get_workspace_group(selected_group_id)
        if selected_group_id and not selected_group:
            selected_group_id = None
        name_parts = row_value(user, "name").split()
        initials = "".join(part[:1] for part in name_parts[:2]).upper() or "FF"
        first_name = name_parts[0] if name_parts else "FairFares"
        profile_photo = profile_photo_url(user)
        avatar_style = (
            f' style="background-image:url(&quot;{escape(profile_photo)}&quot;);background-size:cover;background-position:center;"'
            if profile_photo
            else ""
        )
        role_label = "Admin" if is_admin_user(user) else "Employee"
        current_user_id = int(row_value(user, "id") or 0)
        if selected_author_id and selected_author_id != current_user_id and not is_admin_user(user):
            selected_author_id = None
        posts = get_workspace_posts(user, group_id=selected_group_id, author_id=selected_author_id)
        own_post_count = len(get_workspace_posts(user, limit=200, author_id=current_user_id))
        groups = get_workspace_groups(user)
        if selected_author_id == current_user_id:
            feed_scope = "My posts"
        elif selected_author_id:
            with db() as con:
                author_row = con.execute("SELECT name FROM users WHERE id = ?", (selected_author_id,)).fetchone()
            feed_scope = f"{row_value(author_row, 'name') or 'Staff'} posts"
        else:
            feed_scope = row_value(selected_group, "name") if selected_group else "Company feed"
        workspace_slack_url = row_value(selected_group, "slack_url") if selected_group else ""
        if not workspace_slack_url:
            workspace_slack_url = "https://app.slack.com/client"
        visibility_controls = (
            """
            <label class="workspace-visibility-select">
              <span>Post audience</span>
              <select name="visibility">
                <option value="COMPANY">Company</option>
                <option value="ADMIN">Admin only</option>
              </select>
            </label>
            """
            if is_admin_user(user)
            else '<input type="hidden" name="visibility" value="COMPANY">'
        )
        group_target_controls = f"""
            <label class="workspace-visibility-select">
              <span>Post location</span>
              <select name="group_id">
                {render_workspace_group_options(groups, selected_group_id)}
              </select>
            </label>
        """
        body = render_template(
            "admin_workspace.html",
            admin_name=escape(row_value(user, "name")),
            admin_user_id=escape(str(current_user_id)),
            admin_first_name=escape(first_name),
            admin_email=escape(row_value(user, "email")),
            admin_phone=escape(row_value(user, "phone") or "No phone saved"),
            staff_role=escape(role_label),
            admin_initials=escape(initials),
            admin_avatar_text="" if profile_photo else escape(initials),
            admin_avatar_style=avatar_style,
            admin_nav=self.render_admin_nav(user, "workspace"),
            available_cars=metrics["available"],
            booked_count=metrics["booked"],
            open_ticket_count=metrics["tickets"],
            escalation_count=metrics["escalations"],
            ticket_badge_class="has-count" if metrics["tickets"] else "",
            escalation_badge_class="has-count" if metrics["escalations"] else "",
            user_count=metrics["users"],
            workspace_post_count=escape(str(own_post_count)),
            workspace_groups=render_workspace_groups(groups, selected_group_id),
            workspace_group_count=escape(str(len(groups))),
            workspace_feed_scope=escape(feed_scope),
            workspace_slack_url=escape(workspace_slack_url),
            workspace_visibility_controls=visibility_controls,
            workspace_group_target_controls=group_target_controls,
            workspace_posts=render_workspace_posts(posts),
        )
        self.send_html(body)

    def employee_portal(self, user: sqlite3.Row) -> None:
        metrics = employee_operations_metrics()
        today_rows = "\n".join(self.render_employee_pickup_row(row) for row in metrics["today_pickups"][:8])
        tomorrow_rows = "\n".join(self.render_employee_pickup_row(row) for row in metrics["tomorrow_pickups"][:8])
        urgent_rows = "\n".join(self.render_employee_ticket_row(row) for row in metrics["urgent_tickets"][:6])
        body = render_template(
            "admin_employee.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "bookings"),
            today_count=escape(str(len(metrics["today_pickups"]))),
            tomorrow_count=escape(str(len(metrics["tomorrow_pickups"]))),
            active_count=escape(str(len(metrics["active_bookings"]))),
            open_ticket_count=escape(str(len(metrics["open_tickets"]))),
            today_pickups=today_rows or '<tr><td colspan="4">No pickups scheduled for today.</td></tr>',
            tomorrow_pickups=tomorrow_rows or '<tr><td colspan="4">No pickups scheduled for tomorrow.</td></tr>',
            urgent_tickets=urgent_rows or '<tr><td colspan="4">No urgent open tickets.</td></tr>',
        )
        self.send_html(body)

    def render_employee_pickup_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "pickup_time") or "-")}</b><span>{escape(row_value(row, "booking_id"))}</span></td>
          <td>{escape(row_value(row, "user_name"))}<span>{escape(row_value(row, "user_email"))}</span></td>
          <td>{escape(row_value(row, "car_name"))}<span>{escape(row_value(row, "car_category") or row_value(row, "car_type"))}</span></td>
          <td>{escape(booking_status_label(row_value(row, "booking_status"), row_value(row, "payment_status")))}</td>
        </tr>
        """

    def render_employee_ticket_row(self, row: sqlite3.Row) -> str:
        priority = normalize_support_priority(row_value(row, "priority"))
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "ticket_id"))}</b><span>{escape(priority)}</span></td>
          <td>{escape(row_value(row, "user_name"))}<span>{escape(row_value(row, "user_email"))}</span></td>
          <td>{escape(row_value(row, "topic"))}</td>
          <td>{escape(row_value(row, "status"))}</td>
        </tr>
        """

    def admin_roi_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        rows = get_admin_fleet_roi()
        business_expenses = get_business_expenses()
        total_revenue = sum(float(row_value(row, "total_revenue") or 0) for row in rows)
        vehicle_cost = sum(float(row_value(row, "total_cost") or 0) for row in rows)
        miscellaneous_total = sum(float(row_value(row, "amount") or 0) for row in business_expenses)
        total_cost = vehicle_cost + miscellaneous_total
        ready_count = sum(1 for row in rows if float(row_value(row, "purchase_cost") or 0) > 0)
        roi_rows = "\n".join(self.render_fleet_roi_row(row) for row in rows)
        business_expense_rows = "\n".join(self.render_business_expense_row(row) for row in business_expenses)
        body = render_template(
            "admin_roi.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "roi"),
            vehicle_count=escape(str(len(rows))),
            ready_count=escape(str(ready_count)),
            total_revenue=format_money(total_revenue),
            vehicle_cost=format_money(vehicle_cost),
            miscellaneous_total=format_money(miscellaneous_total),
            total_cost=format_money(total_cost),
            fleet_roi=format_money(total_revenue - total_cost),
            roi_rows=roi_rows or '<tr><td colspan="9">No vehicles available for ROI reporting.</td></tr>',
            today=escape(date.today().isoformat()),
            business_expense_rows=business_expense_rows or '<tr><td colspan="4">No miscellaneous business expenses added yet.</td></tr>',
        )
        self.send_html(body)

    def render_fleet_roi_row(self, row: sqlite3.Row) -> str:
        purchase_cost = float(row_value(row, "purchase_cost") or 0)
        roi_ready = purchase_cost > 0
        roi_value = float(row_value(row, "roi") or 0)
        roi_label = format_money(roi_value) if roi_ready else "Pending"
        roi_class = "positive" if roi_value >= 0 else "negative"
        if not roi_ready:
            roi_class = "pending"
        return f"""
        <tr>
          <td><a class="admin-car-name" href="/admin/cars/detail?id={escape(row_value(row, "id"))}"><b>{escape(row_value(row, "name"))}</b><span>{escape(row_value(row, "year") or "-")} {escape(row_value(row, "category") or row_value(row, "type"))}</span></a></td>
          <td>{escape(row_value(row, "status"))}</td>
          <td>{escape(row_value(row, "booking_count") or "0")}</td>
          <td>{format_money(row_value(row, "total_revenue") or 0)}</td>
          <td>{format_money(purchase_cost)}</td>
          <td>{format_money(row_value(row, "repair_total") or 0)}</td>
          <td>{format_money(row_value(row, "maintenance_total") or 0)}</td>
          <td>{format_money(row_value(row, "total_cost") or 0)}</td>
          <td><b class="roi-value {roi_class}">{escape(roi_label)}</b></td>
        </tr>
        """

    def render_business_expense_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "expense_date"))}</b><span>Business expense</span></td>
          <td>{format_money(row_value(row, "amount") or 0)}</td>
          <td>{escape(row_value(row, "description") or "-")}</td>
          <td>
            <form method="post" action="/admin/business-expenses/delete" class="inline-form">
              <input type="hidden" name="expense_id" value="{escape(row_value(row, "id"))}">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>
        """

    def admin_car_detail_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        try:
            car_id = int(urllib.parse.parse_qs(parsed.query).get("id", ["0"])[0])
        except ValueError:
            car_id = 0
        detail = get_admin_car_detail(car_id)
        if not detail:
            self.redirect("/admin/inventory")
            return
        car = detail["car"]
        purchase_cost_amount = float(row_value(car, "purchase_cost") or 0)
        roi_ready = purchase_cost_amount > 0
        service_rows = "\n".join(self.render_car_service_cost_row(row) for row in detail["service_rows"])
        receipt_rows = "\n".join(self.render_car_receipt_row(row) for row in detail["service_rows"] if row_value(row, "receipt_url"))
        booking_rows = "\n".join(self.render_car_detail_booking_row(row) for row in detail["bookings"])
        body = render_template(
            "admin_car_detail.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "portal"),
            car_id=escape(row_value(car, "id")),
            car_name=escape(row_value(car, "name")),
            car_meta=escape(f"{row_value(car, 'year') or '-'} {row_value(car, 'category') or row_value(car, 'type') or 'Vehicle'} | {row_value(car, 'fuel_type') or 'Fuel'}"),
            car_image=escape(row_value(car, "image_url") or "/static/img/booking-confirmation-promise.png"),
            car_image_alt=escape(vehicle_image_alt(car)),
            purchase_cost=format_money(row_value(car, "purchase_cost") or 0),
            purchase_receipt=self.render_receipt_link(car),
            booking_count=escape(str(detail["booking_count"])),
            total_revenue=format_money(detail["total_revenue"]),
            repair_total=format_money(detail["repair_total"]),
            maintenance_total=format_money(detail["maintenance_total"]),
            total_cost=format_money(detail["total_cost"]),
            roi=format_money(detail["roi"]) if roi_ready else "Pending",
            roi_label="ROI" if roi_ready else "ROI pending",
            roi_class=("positive" if float(detail["roi"]) >= 0 else "negative") if roi_ready else "pending",
            service_rows=service_rows or '<tr><td colspan="6">No maintenance or repair costs added yet.</td></tr>',
            receipt_rows=receipt_rows or '<tr><td colspan="4">No receipts added yet.</td></tr>',
            booking_rows=booking_rows or '<tr><td colspan="5">No bookings for this vehicle yet.</td></tr>',
        )
        self.send_html(body)

    def render_car_service_cost_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "cost_type").title())}</b><span>{escape(row_value(row, "service_date"))}</span></td>
          <td>{format_money(row_value(row, "amount") or 0)}</td>
          <td>{escape(row_value(row, "vendor") or "-")}</td>
          <td>{escape(row_value(row, "notes") or "-")}</td>
          <td>{self.render_receipt_link(row)}</td>
          <td>{escape(row_value(row, "created_at"))}</td>
        </tr>
        """

    def render_receipt_link(self, row: sqlite3.Row) -> str:
        receipt_url = row_value(row, "receipt_url") or row_value(row, "purchase_receipt_url")
        if not receipt_url:
            return '<span>No receipt</span>'
        if receipt_url.startswith("drive://"):
            return '<span>Stored in private Drive</span>'
        if receipt_url.startswith("local://"):
            return '<span>Stored in FairFares storage</span>'
        return f'<a class="admin-text-link" href="{escape(receipt_url)}" target="_blank" rel="noopener">Open receipt</a>'

    def render_car_receipt_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "cost_type").title())}</b><span>{escape(row_value(row, "service_date"))}</span></td>
          <td>{format_money(row_value(row, "amount") or 0)}</td>
          <td>{escape(row_value(row, "vendor") or "-")}</td>
          <td>{self.render_receipt_link(row)}</td>
        </tr>
        """

    def render_car_detail_booking_row(self, row: sqlite3.Row) -> str:
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "booking_id"))}</b><span>{escape(booking_status_label(row_value(row, "booking_status"), row_value(row, "payment_status")))}</span></td>
          <td>{escape(row_value(row, "user_name"))}<span>{escape(row_value(row, "user_email"))}</span></td>
          <td>{escape(row_value(row, "pickup_date"))}<span>{escape(row_value(row, "dropoff_date"))}</span></td>
          <td>{escape(str(row_value(row, "days") or 0))} days</td>
          <td>{format_money(row_value(row, "total_price") or 0)}</td>
        </tr>
        """

    def render_website_feedback_row(self, row: sqlite3.Row) -> str:
        user_label = row_value(row, "user_name") or "Guest"
        user_email = row_value(row, "user_email")
        if user_email:
            user_label = f"{user_label}<br><span>{escape(user_email)}</span>"
        stars = "★" * int(row_value(row, "rating", 0) or 0)
        return f"""
        <tr>
            <td><b>{escape(stars)}</b><br><span>{escape(row_value(row, "created_at"))}</span></td>
            <td>{user_label}</td>
            <td>{escape(row_value(row, "page") or "/")}</td>
            <td>{escape(row_value(row, "message") or "No message")}</td>
            <td><span>{escape(row_value(row, "user_agent"))}</span></td>
        </tr>
        """

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
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        selected_status = query.get("status", ["ALL"])[0].upper()
        selected_calendar = query.get("calendar", ["today"])[0].lower()
        allowed_statuses = {"ALL", "PENDING_HOLD", "EXPIRED_HOLD", "CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "CANCELLED", "PICKED_UP", "RETURNED"}
        if selected_status not in allowed_statuses:
            selected_status = "ALL"
        if selected_calendar not in {"today", "tomorrow", "weekly", "monthly"}:
            selected_calendar = "today"
        booking_rows = get_admin_bookings()
        if selected_status != "ALL":
            booking_rows = [row for row in booking_rows if row["booking_status"] == selected_status]
        bookings = "\n".join(self.render_admin_booking_row(row, user) for row in booking_rows)
        calendar_html = self.render_admin_booking_calendar(booking_rows, selected_calendar, selected_status)
        body = render_template(
            "admin_bookings.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "bookings"),
            booking_calendar=calendar_html,
            booking_status_options=self.render_booking_status_filter_options(selected_status),
            bookings=bookings or '<tr><td colspan="7">No bookings match this filter.</td></tr>',
        )
        self.send_html(body)

    def render_admin_booking_calendar(self, rows: list[sqlite3.Row], selected_calendar: str, selected_status: str) -> str:
        today = datetime.now().date()
        if selected_calendar == "tomorrow":
            start = today + timedelta(days=1)
            days = [start]
            title = "Tomorrow's bookings"
        elif selected_calendar == "weekly":
            start = today
            days = [start + timedelta(days=offset) for offset in range(7)]
            title = "7-day booking calendar"
        elif selected_calendar == "monthly":
            start = today.replace(day=1)
            next_month = date(start.year + (1 if start.month == 12 else 0), 1 if start.month == 12 else start.month + 1, 1)
            month_days = (next_month - start).days
            days = [start + timedelta(days=offset) for offset in range(month_days)]
            title = start.strftime("%B booking calendar")
        else:
            start = today
            days = [start]
            title = "Today's bookings"

        calendar_links = []
        for view, label in (("today", "Today"), ("tomorrow", "Tomorrow"), ("weekly", "Weekly"), ("monthly", "Monthly")):
            href = f"/admin/bookings?calendar={view}&status={urllib.parse.quote(selected_status)}"
            active = " active" if selected_calendar == view else ""
            calendar_links.append(f'<a class="{active.strip()}" href="{href}">{escape(label)}</a>')

        visible_rows = [
            row
            for row in rows
            if row_value(row, "booking_status") != "CANCELLED" and self.booking_overlaps_calendar_days(row, days)
        ]
        booking_count = len(visible_rows)
        day_cards = []
        if selected_calendar == "monthly":
            for _ in range(days[0].weekday()):
                day_cards.append('<article class="booking-calendar-day is-empty" aria-hidden="true"></article>')
        for day in days:
            day_rows = [row for row in visible_rows if self.booking_touches_day(row, day)]
            day_cards.append(self.render_booking_calendar_day(day, day_rows, selected_calendar))

        empty_state = "" if booking_count else '<p class="booking-calendar-empty">No bookings in this calendar window.</p>'
        return f"""
        <section class="admin-card booking-calendar-card">
          <div class="admin-card-head booking-calendar-head">
            <div>
              <p class="eyebrow">Schedule</p>
              <h2>{escape(title)}</h2>
              <p>{booking_count} pickup{'s' if booking_count != 1 else ''} shown. Click a booking block for customer, car, and trip details.</p>
            </div>
            <nav class="booking-calendar-tabs" aria-label="Booking calendar range">
              {''.join(calendar_links)}
            </nav>
          </div>
          <div class="booking-calendar-grid booking-calendar-{escape(selected_calendar)}">
            {''.join(day_cards)}
          </div>
          {empty_state}
        </section>
        <div class="booking-calendar-modal" id="bookingCalendarModal" hidden>
          <div class="booking-calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="bookingCalendarModalTitle">
            <button class="booking-calendar-close" type="button" data-booking-calendar-close aria-label="Close booking details">x</button>
            <div class="booking-calendar-dialog-head">
              <img data-booking-modal-image alt="" hidden>
              <div>
                <p class="eyebrow" data-booking-modal-field="status"></p>
                <h2 id="bookingCalendarModalTitle" data-booking-modal-field="booking"></h2>
                <span data-booking-modal-field="vehicle"></span>
              </div>
            </div>
            <dl class="booking-calendar-details">
              <div><dt>Customer</dt><dd data-booking-modal-field="customer"></dd></div>
              <div><dt>Email</dt><dd data-booking-modal-field="email"></dd></div>
              <div><dt>Phone</dt><dd data-booking-modal-field="phone"></dd></div>
              <div><dt>Pickup</dt><dd data-booking-modal-field="pickup"></dd></div>
              <div><dt>Return</dt><dd data-booking-modal-field="return"></dd></div>
              <div><dt>Total</dt><dd data-booking-modal-field="total"></dd></div>
              <div><dt>Location</dt><dd data-booking-modal-field="location"></dd></div>
            </dl>
            <a class="admin-text-link" href="/admin/pickup">Open pickup workflow</a>
          </div>
        </div>
        """

    def booking_overlaps_calendar_days(self, row: sqlite3.Row, days: list[date]) -> bool:
        return any(self.booking_touches_day(row, day) for day in days)

    def booking_touches_day(self, row: sqlite3.Row, day: date) -> bool:
        pickup = booking_datetime_from_row(row, "pickup_date", "pickup_time")
        return bool(pickup and pickup.date() == day)

    def render_booking_calendar_day(self, day: date, rows: list[sqlite3.Row], selected_calendar: str) -> str:
        sorted_rows = sorted(rows, key=lambda row: booking_datetime_from_row(row, "pickup_date", "pickup_time") or datetime.max)
        blocks = "".join(self.render_booking_calendar_block(row, day) for row in sorted_rows)
        day_label = day.strftime("%a")
        date_label = day.strftime("%b %d")
        density_class = " is-dense" if selected_calendar == "monthly" else ""
        return f"""
        <article class="booking-calendar-day{density_class}">
          <header><span>{escape(day_label)}</span><b>{escape(date_label)}</b></header>
          <div class="booking-calendar-blocks">
            {blocks or '<span class="booking-calendar-free">Available</span>'}
          </div>
        </article>
        """

    def render_booking_calendar_block(self, row: sqlite3.Row, day: date) -> str:
        time_label = f"Pickup {row_value(row, 'pickup_time')} - Return {row_value(row, 'dropoff_time')}"
        status = booking_status_label(row["booking_status"], row["payment_status"])
        payment_label, pickup_balance_label = admin_payment_summary(row)
        vehicle = f"{row_value(row, 'car_year')} {row_value(row, 'car_name')}".strip()
        detail_attrs = {
            "booking": row_value(row, "booking_id"),
            "status": status,
            "vehicle": vehicle,
            "customer": row_value(row, "user_name"),
            "email": row_value(row, "user_email"),
            "phone": row_value(row, "phone") or "No phone",
            "pickup": f"{row_value(row, 'pickup_date')} at {row_value(row, 'pickup_time')}",
            "return": f"{row_value(row, 'dropoff_date')} at {row_value(row, 'dropoff_time')}",
            "total": f"{format_money(row_value(row, 'total_price'))} - {payment_label} - {pickup_balance_label}",
            "location": row_value(row, "pickup_location") or row_value(row, "return_location") or "No location saved",
            "image": row_value(row, "car_image_url") or "",
        }
        attrs = " ".join(
            f'data-{escape(key)}="{escape(value)}"' for key, value in detail_attrs.items()
        )
        return f"""
        <button type="button" class="booking-calendar-event" data-booking-calendar-open {attrs}>
          <span>{escape(time_label)}</span>
          <b>{escape(row_value(row, "car_name"))}</b>
          <small>{escape(row_value(row, "user_name"))}</small>
        </button>
        """

    def admin_users_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        users = "\n".join(self.render_admin_user_card(row) for row in get_admin_users())
        body = render_template(
            "admin_users.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "users"),
            users=users or '<p class="admin-empty">No users yet.</p>',
        )
        self.send_html(body)

    def admin_requests_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        notice_key = query.get("staff_status", [""])[0]
        notice_messages = {
            "created": "Staff request created. A different admin must approve it before the user can log in.",
            "approved": "Staff account approved and activated. They can log in with the temporary password.",
            "password_reset": "Temporary password updated. The staff member can log in with the new password.",
            "rejected": "Staff request rejected.",
            "missing_password": "Staff requests need a temporary password with at least 8 characters.",
            "short_password": "Temporary password must be at least 8 characters.",
            "auth_required": "Enter your admin password to change a staff password.",
            "auth_failed": "Admin password confirmation failed. Staff password was not changed.",
            "pending": "That email already has a pending staff request. A different admin must approve it.",
            "active": "That email already belongs to an active staff account.",
            "invalid": "Enter a valid name, email, and role.",
            "self_review": "Admins cannot approve their own staff request. Ask another admin to approve it.",
            "not_found": "Staff request was not found or is no longer pending.",
        }
        staff_notice = (
            f'<p class="admin-status-notice">{escape(notice_messages[notice_key])}</p>'
            if notice_key in notice_messages
            else ""
        )
        staff_rows = "\n".join(self.render_staff_account_row(row) for row in get_staff_accounts())
        request_rows = "\n".join(self.render_staff_request_row(row, user) for row in get_staff_account_requests())
        body = render_template(
            "admin_requests.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "requests"),
            staff_notice=staff_notice,
            staff_create_card=self.render_staff_create_card(),
            staff_rows=staff_rows or '<tr><td colspan="5">No staff accounts yet.</td></tr>',
            staff_request_rows=request_rows or '<tr><td colspan="6">No pending staff requests.</td></tr>',
        )
        self.send_html(body)

    def admin_system_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        drive_migration_notice = ""
        if query.get("drive_migration"):
            drive_migration_notice = (
                '<div class="green-note"><b>Drive migration finished</b><br>'
                f"Processed {escape(query.get('processed', ['0'])[0])}; "
                f"uploaded {escape(query.get('uploaded', ['0'])[0])}; "
                f"failed {escape(query.get('failed', ['0'])[0])}; "
                f"unsupported {escape(query.get('unsupported', ['0'])[0])}; "
                f"skipped {escape(query.get('skipped', ['0'])[0])}."
                "</div>"
            )
        backup_rows = "\n".join(self.render_backup_row(path) for path in list_db_backups()[:5])
        feedback_rows = "\n".join(self.render_website_feedback_row(row) for row in get_website_feedback())
        drive_status = google_drive_config_status()
        drive_folder_rows = "\n".join(
            f"""
            <tr>
              <td>{escape(folder['env'])}</td>
              <td>{escape(key)}</td>
              <td>{'Configured' if folder['configured'] else 'Using root fallback'}</td>
              <td>{escape(masked_identifier(str(folder['folder_id'] or '')))}</td>
            </tr>
            """
            for key, folder in drive_status["folders"].items()
        )
        with db() as con:
            recent_drive_records = con.execute(
                """
                SELECT *
                FROM drive_files
                ORDER BY id DESC
                LIMIT 12
                """
            ).fetchall()
        drive_record_rows = "\n".join(
            f"""
            <tr>
              <td>{escape(row_value(row, "created_at"))}</td>
              <td>{escape(row_value(row, "folder_key"))}<span>{escape(row_value(row, "file_scope"))}</span></td>
              <td>{escape("Failed" if row_value(row, "drive_file_id") == "UPLOAD_FAILED" else "Uploaded")}</td>
              <td>{escape(row_value(row, "drive_web_view_link") or row_value(row, "drive_file_id"))}</td>
            </tr>
            """
            for row in recent_drive_records
        )
        body = render_template(
            "admin_system.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "system"),
            db_path=escape(DB_PATH),
            backup_dir=escape(BACKUP_DIR),
            drive_service_account_status="Configured" if drive_status["service_account"] else "Missing",
            drive_root_status="Configured" if drive_status["root_folder"] else "Missing",
            drive_root_folder_id=escape(masked_identifier(str(drive_status["root_folder_id"] or ""))),
            drive_migration_notice=drive_migration_notice,
            drive_folder_rows=drive_folder_rows or '<tr><td colspan="4">No Drive folder env values configured.</td></tr>',
            drive_record_rows=drive_record_rows or '<tr><td colspan="4">No Drive upload attempts recorded yet.</td></tr>',
            backup_rows=backup_rows or '<tr><td colspan="4">No backups yet.</td></tr>',
            feedback_rows=feedback_rows or '<tr><td colspan="5">No website feedback yet.</td></tr>',
        )
        self.send_html(body)

    def render_staff_create_card(self) -> str:
        return """
        <form method="post" action="/admin/staff/request" class="staff-request-form">
          <label><span>Full name</span><input name="name" required></label>
          <label><span>Email</span><input name="email" type="email" required></label>
          <label><span>Phone</span><input name="phone" autocomplete="tel"></label>
          <label><span>Role</span><select name="role"><option value="EMPLOYEE">Employee</option><option value="ADMIN">Admin</option></select></label>
          <label><span>Temporary password</span><input name="password" type="password" minlength="8" placeholder="Required" required></label>
          <button type="submit">Request Staff Account</button>
          <small>A different admin must approve this request. The temporary password is applied only after approval.</small>
        </form>
        """

    def render_staff_account_row(self, row: sqlite3.Row) -> str:
        role = staff_role_label(row)
        status = "Active" if row_value(row, "is_verified") else "Not verified"
        reset_form = f"""
          <form method="post" action="/admin/staff/password" class="inline-form staff-password-reset-form">
            <input type="hidden" name="user_id" value="{escape(row_value(row, "id"))}">
            <input name="admin_password" type="password" autocomplete="current-password" placeholder="Your admin password" required>
            <input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="New temp password" required>
            <button type="submit">Set</button>
          </form>
        """
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "name"))}</b><span>#{escape(row_value(row, "id"))}</span></td>
          <td>{escape(row_value(row, "email"))}<span>{escape(row_value(row, "phone") or "No phone")}</span></td>
          <td>{escape(role)}</td>
          <td>{escape(status)}</td>
          <td>{escape(row_value(row, "created_at"))}</td>
          <td>{reset_form}</td>
        </tr>
        """

    def render_staff_request_row(self, row: sqlite3.Row, current_admin: sqlite3.Row) -> str:
        status = row_value(row, "status")
        role = "Admin" if normalized_staff_role(row_value(row, "role")) == ROLE_ADMIN else "Employee"
        requester = f"{row_value(row, 'requester_name')} ({row_value(row, 'requester_email')})"
        reviewer = row_value(row, "approver_name") or "Pending"
        can_review = status == "PENDING" and is_admin_user(current_admin) and int(row_value(row, "requested_by") or 0) != int(row_value(current_admin, "id") or 0)
        action = (
            f"""
            <form method="post" action="/admin/staff/review" class="inline-form staff-review-actions">
              <input type="hidden" name="request_id" value="{escape(row_value(row, "id"))}">
              <input name="admin_note" placeholder="Optional note">
              <button type="submit" name="decision" value="APPROVE">Approve</button>
              <button class="danger-button" type="submit" name="decision" value="REJECT">Reject</button>
            </form>
            """
            if can_review
            else ("Waiting for another admin" if status == "PENDING" else escape(reviewer))
        )
        created = row_value(row, "created_user_email")
        return f"""
        <tr>
          <td><b>{escape(row_value(row, "name"))}</b><span>{escape(row_value(row, "email"))}</span></td>
          <td>{escape(role)}</td>
          <td>{escape(status.title())}<span>{escape(row_value(row, "admin_note") or "")}</span></td>
          <td>{escape(requester)}</td>
          <td>{escape(created or reviewer)}</td>
          <td>{action}</td>
        </tr>
        """

    def create_staff_account_request(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        if not is_admin_user(user):
            self.redirect("/admin/requests")
            return
        form = self.read_form()
        name = (form.get("name") or "").strip()
        email = normalize_email(form.get("email"))
        phone = (form.get("phone") or "").strip()
        role = normalized_staff_role(form.get("role", "EMPLOYEE"))
        password = form.get("password", "")
        if not name or "@" not in email:
            self.redirect("/admin/requests?staff_status=invalid")
            return
        if len(password) < 8:
            self.redirect("/admin/requests?staff_status=missing_password")
            return
        password_hash = hash_password(password)
        with db() as con:
            existing_user = find_user_by_email(con, email)
            existing_request = con.execute(
                f"SELECT id FROM staff_account_requests WHERE {normalized_email_sql('email')} = ? AND status = 'PENDING'",
                (email,),
            ).fetchone()
            if existing_user and not existing_request:
                if is_staff_user(existing_user):
                    self.redirect("/admin/requests?staff_status=active")
                    return
                con.execute(
                    """
                    INSERT INTO staff_account_requests
                    (name, email, phone, role, password_hash, requested_by, target_user_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        name or row_value(existing_user, "name"),
                        email,
                        phone or row_value(existing_user, "phone") or "",
                        role,
                        password_hash,
                        user["id"],
                        existing_user["id"],
                    ),
                )
                self.redirect("/admin/requests?staff_status=created")
                return
            elif not existing_user and not existing_request:
                con.execute(
                    """
                    INSERT INTO staff_account_requests
                    (name, email, phone, role, password_hash, requested_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (name, email, phone, role, password_hash, user["id"]),
                )
                self.redirect("/admin/requests?staff_status=created")
                return
            elif existing_request:
                self.redirect("/admin/requests?staff_status=pending")
                return
        self.redirect("/admin/requests?staff_status=missing_password")

    def review_staff_account_request(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        if not is_admin_user(user):
            self.redirect("/admin/requests")
            return
        form = self.read_form()
        request_id = int(form.get("request_id") or 0)
        decision = (form.get("decision") or "").upper()
        note = (form.get("admin_note") or "").strip()
        if decision not in {"APPROVE", "REJECT"}:
            self.redirect("/admin/requests?staff_status=invalid")
            return
        with db() as con:
            request = con.execute("SELECT * FROM staff_account_requests WHERE id = ?", (request_id,)).fetchone()
            if not request or request["status"] != "PENDING":
                self.redirect("/admin/requests?staff_status=not_found")
                return
            if int(request["requested_by"]) == int(user["id"]):
                self.redirect("/admin/requests?staff_status=self_review")
                return
            if decision == "REJECT":
                con.execute(
                    """
                    UPDATE staff_account_requests
                    SET status = 'REJECTED', approved_by = ?, admin_note = ?, reviewed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (user["id"], note, request_id),
                )
                self.redirect("/admin/requests?staff_status=rejected")
                return
            else:
                is_admin, role = user_role_flags(normalized_staff_role(request["role"]))
                target_user_id = row_value(request, "target_user_id")
                if target_user_id:
                    con.execute(
                        """
                        UPDATE users
                        SET name = COALESCE(NULLIF(?, ''), name),
                            phone = COALESCE(NULLIF(?, ''), phone),
                            password_hash = ?,
                            is_admin = ?,
                            role = ?,
                            is_verified = 1,
                            verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                            guest_account = 0
                        WHERE id = ?
                        """,
                        (request["name"], request["phone"], request["password_hash"], is_admin, role, target_user_id),
                    )
                    con.execute(
                        """
                        UPDATE staff_account_requests
                        SET status = 'APPROVED',
                            approved_by = ?,
                            created_user_id = ?,
                            admin_note = ?,
                            reviewed_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (user["id"], target_user_id, note, request_id),
                    )
                    self.redirect("/admin/requests?staff_status=approved")
                    return
                else:
                    try:
                        con.execute(
                            """
                            INSERT INTO users
                            (name, email, phone, password_hash, is_admin, role, is_verified, verified_at)
                            VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                            """,
                            (request["name"], request["email"], request["phone"], request["password_hash"], is_admin, role),
                        )
                        created_user_id = con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
                        con.execute(
                            """
                            UPDATE staff_account_requests
                            SET status = 'APPROVED',
                                approved_by = ?,
                                created_user_id = ?,
                                admin_note = ?,
                                reviewed_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                            """,
                            (user["id"], created_user_id, note, request_id),
                        )
                        self.redirect("/admin/requests?staff_status=approved")
                        return
                    except sqlite3.IntegrityError:
                        con.execute(
                            """
                            UPDATE staff_account_requests
                            SET status = 'REJECTED',
                                approved_by = ?,
                                admin_note = 'Email already exists.',
                                reviewed_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                            """,
                            (user["id"], request_id),
                        )
                        self.redirect("/admin/requests?staff_status=not_found")
                        return
        self.redirect("/admin/requests")

    def reset_staff_account_password(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        if not is_admin_user(user):
            self.redirect("/admin/requests")
            return
        form = self.read_form()
        try:
            target_user_id = int(form.get("user_id") or 0)
        except ValueError:
            target_user_id = 0
        admin_password = form.get("admin_password", "")
        password = form.get("password", "")
        if not admin_password:
            self.redirect("/admin/requests?staff_status=auth_required")
            return
        if not verify_password(admin_password, row_value(user, "password_hash")):
            print(f"Staff password reset blocked: admin confirmation failed for admin_id={row_value(user, 'id')}")
            self.redirect("/admin/requests?staff_status=auth_failed")
            return
        if len(password) < 8:
            self.redirect("/admin/requests?staff_status=short_password")
            return
        with db() as con:
            target = con.execute(
                """
                SELECT * FROM users
                WHERE id = ?
                  AND (is_admin = 1 OR role IN ('ADMIN', 'EMPLOYEE'))
                """,
                (target_user_id,),
            ).fetchone()
            if not target:
                self.redirect("/admin/requests?staff_status=not_found")
                return
            con.execute(
                """
                UPDATE users
                SET password_hash = ?,
                    is_verified = 1,
                    verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                    guest_account = 0
                WHERE id = ?
                """,
                (hash_password(password), target_user_id),
            )
        self.redirect("/admin/requests?staff_status=password_reset")

    def admin_tickets_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        today_oncall = get_oncall_shift_for_day()
        sorted_tickets = sort_tickets_for_admin(get_admin_tickets(), user, today_oncall)
        tickets = "\n".join(self.render_ticket_row(row, today_oncall, user) for row in sorted_tickets)
        oncall_owner = (
            f"{row_value(today_oncall, 'admin_name')} ({row_value(today_oncall, 'admin_email')})"
            if today_oncall
            else "No on-call admin assigned today"
        )
        body = render_template(
            "admin_tickets.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "tickets"),
            oncall_owner=escape(oncall_owner),
            tickets=tickets or '<tr><td colspan="8">No support tickets yet.</td></tr>',
        )
        self.send_html(body)

    def admin_oncall_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        selected_month = month_start_from_query(urllib.parse.parse_qs(parsed.query).get("month", [""])[0])
        ensure_oncall_schedule_for_month(selected_month, int(row_value(user, "id") or 0))
        shifts = get_oncall_shifts_for_month(selected_month)
        admins = get_active_admin_accounts()
        shift_rows = {row_value(row, "shift_date"): row for row in shifts}
        day_cards = []
        for _ in range(selected_month.weekday()):
            day_cards.append('<article class="oncall-day is-empty" aria-hidden="true"></article>')
        next_month = next_month_start(selected_month)
        for offset in range((next_month - selected_month).days):
            day = selected_month + timedelta(days=offset)
            day_cards.append(self.render_oncall_day(day, shift_rows.get(day.isoformat()), admins))
        next_shift = next_oncall_shift_for_user(int(row_value(user, "id") or 0))
        body = render_template(
            "admin_oncall.html",
            admin_name=escape(row_value(user, "name")),
            admin_nav=self.render_admin_nav(user, "oncall"),
            month_label=escape(selected_month.strftime("%B %Y")),
            month_value=escape(selected_month.strftime("%Y-%m")),
            previous_month=escape(previous_month_start(selected_month).strftime("%Y-%m")),
            next_month=escape(next_month.strftime("%Y-%m")),
            next_oncall=escape(row_value(next_shift, "shift_date") or "No upcoming shift"),
            active_admin_count=escape(str(len(admins))),
            oncall_days="".join(day_cards),
        )
        self.send_html(body)

    def render_oncall_day(self, day: date, shift: sqlite3.Row | None, admins: list[sqlite3.Row]) -> str:
        assigned_id = str(row_value(shift, "admin_user_id") or "")
        admin_options = "".join(
            f'<option value="{escape(row_value(admin, "id"))}" {"selected" if str(row_value(admin, "id")) == assigned_id else ""}>{escape(row_value(admin, "name"))}</option>'
            for admin in admins
        )
        admin_name = row_value(shift, "admin_name") or "Unassigned"
        note = row_value(shift, "note") or ""
        color_pool = ["#16a34a", "#2563eb", "#0891b2", "#7c3aed", "#dc2626", "#0f766e", "#ca8a04"]
        color_index = (int(assigned_id) if assigned_id.isdigit() else day.day) % len(color_pool)
        style = f' style="--oncall-color: {color_pool[color_index]}"'
        return f"""
        <article class="oncall-day"{style}>
          <button type="button" class="oncall-day-button" data-oncall-day-toggle aria-expanded="false">
            <header><span>{escape(day.strftime("%a"))}</span><b>{escape(str(day.day))}</b></header>
            <div class="oncall-assignee">
              <b>{escape(admin_name)}</b>
            </div>
            <span class="oncall-edit-hint">Assign admin</span>
          </button>
          <div class="oncall-day-editor" hidden>
            <form method="post" action="/admin/oncall/assign" class="oncall-assign-form">
              <input type="hidden" name="shift_date" value="{escape(day.isoformat())}">
              <select name="admin_user_id" aria-label="Assign admin for {escape(day.isoformat())}">{admin_options}</select>
              <input name="note" value="{escape(note)}" placeholder="Optional note">
              <button type="submit">Update on-call</button>
            </form>
          </div>
        </article>
        """

    def render_ticket_row(self, row: sqlite3.Row, today_oncall: sqlite3.Row | None = None, viewer: sqlite3.Row | None = None) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["status"] == status else ""}>{status.replace("_", " ").title()}</option>'
            for status in ("OPEN", "IN_PROGRESS", "FOLLOWUP", "CLOSED")
        )
        priority = normalize_support_priority(row["priority"] if "priority" in row.keys() else "")
        urgent = '<span class="ticket-urgent">URGENT</span>' if row["urgent"] or priority in {"P0", "P1"} else ""
        priority_badge = f'<span class="ticket-priority ticket-priority-{priority.lower()}">{escape(priority)}</span>'
        sla = support_sla_text(priority)
        escalated = bool(int(row_value(row, "escalated_to_oncall") or 0))
        viewer_id = int(row_value(viewer, "id") or 0)
        oncall_id = int(row_value(today_oncall, "admin_user_id") or 0)
        viewer_is_oncall = bool(viewer_id and viewer_id == oncall_id)
        viewer_is_employee = normalized_user_role(row_value(viewer, "role")) == ROLE_EMPLOYEE and not is_admin_user(viewer)
        auto_escalated = priority == "P0" and not escalated
        escalator = row_value(row, "escalated_by_name") or "System auto-escalation"
        oncall_owner = (
            f"{row_value(today_oncall, 'admin_name')} ({row_value(today_oncall, 'admin_email')})"
            if today_oncall
            else "No on-call admin assigned today"
        )
        escalation_note = (
            f"""
            <div class="ticket-escalation-note">
              <b>{'Auto escalated' if auto_escalated else 'Manually escalated'}</b>
              <span>Owner: {escape(oncall_owner)}</span>
              <span>{escape('System priority routing' if auto_escalated else escalator)}{f' · {escape(row_value(row, "escalated_at"))}' if row_value(row, "escalated_at") else ''}</span>
              <small>{escape(row_value(row, "escalation_reason") or ('P0 tickets route to on-call automatically.' if auto_escalated else 'No reason saved.'))}</small>
            </div>
            """
            if escalated or priority == "P0"
            else ""
        )
        escalation_action = ""
        if row_value(row, "status") != "CLOSED" and not escalated and priority != "P0" and viewer_is_employee and not viewer_is_oncall:
            escalation_action = f"""
                <form method="post" action="/admin/tickets/escalate" class="admin-stack-form ticket-escalation-form">
                    <input type="hidden" name="ticket_id" value="{row["id"]}">
                    <textarea name="reason" rows="2" required placeholder="Reason for on-call escalation"></textarea>
                    <button type="submit">Escalate to on-call</button>
                </form>
            """
        row_class = "ticket-open ticket-critical" if row["status"] != "CLOSED" and priority in {"P0", "P1"} else "ticket-open" if row["status"] != "CLOSED" else ""
        booking_label = row_value(row, "booking_id") or "No booking"
        claimed_label = row_value(row, "claimed_by") or "Unclaimed"
        return f"""
        <tr class="{row_class}">
            <td colspan="8">
                <article class="ticket-card">
                    <header class="ticket-card-head">
                        <div class="ticket-id-block">
                            <b>{escape(row_value(row, "ticket_id"))}</b>
                            <span>{escape(row_value(row, "created_at"))}</span>
                        </div>
                        <div class="ticket-priority-block">
                            {priority_badge}
                            {urgent}
                            <span>{escape(sla)}</span>
                        </div>
                        <div class="ticket-owner-block">
                            <b>{escape(claimed_label)}</b>
                            <span>{escape(row_value(row, "status").replace("_", " ").title())}</span>
                        </div>
                    </header>
                    <div class="ticket-card-grid">
                        <section class="ticket-customer-block">
                            <span>Customer</span>
                            <b>{escape(row_value(row, "user_name"))}</b>
                            <small>{escape(row_value(row, "user_email"))}</small>
                        </section>
                        <section class="ticket-meta-block">
                            <span>Booking</span>
                            <b>{escape(booking_label)}</b>
                            <small>{escape(row_value(row, "topic"))} · {escape(row_value(row, "preferred_contact"))}</small>
                        </section>
                        <section class="ticket-alert-block">
                            <span>Alert</span>
                            <b>{escape(row_value(row, "alert_summary") or "Dashboard alert queued")}</b>
                        </section>
                        <section class="ticket-message-block">
                            <span>Message</span>
                            <p>{escape(row_value(row, "message") or "-")}</p>
                        </section>
                        <section class="ticket-action-block">
                            <form method="post" action="/admin/tickets/update" class="admin-stack-form ticket-update-form">
                                <input type="hidden" name="ticket_id" value="{row["id"]}">
                                <input name="claimed_by" value="{escape(row_value(row, "claimed_by"))}" placeholder="Claimed by">
                                <select name="status">{status_options}</select>
                                <textarea name="admin_comment" rows="2" placeholder="Comment / follow-up">{escape(row_value(row, "admin_comment"))}</textarea>
                                <button type="submit">Update</button>
                            </form>
                            {escalation_action}
                        </section>
                    </div>
                    {escalation_note}
                </article>
            </td>
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
        user = self.require_owner_admin()
        if not user:
            return
        discounts = "\n".join(self.render_discount_row(row) for row in get_all_discounts())
        tax_fee_rules = "\n".join(self.render_tax_fee_rule_row(row) for row in get_all_tax_fee_rules())
        post_return_fee_rules = "\n".join(self.render_post_return_fee_rule_row(row) for row in get_all_post_return_fee_rules())
        body = render_template(
            "admin_discounts.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "discounts"),
            discounts=discounts or '<tr><td colspan="7">No discount codes yet.</td></tr>',
            tax_fee_rules=tax_fee_rules or '<tr><td colspan="6">No tax or fee rules yet.</td></tr>',
            post_return_fee_rules=post_return_fee_rules or '<tr><td colspan="6">No post-return fee rules yet.</td></tr>',
        )
        self.send_html(body)

    def admin_wiki_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
        articles = search_wiki_articles(query, include_internal=True)
        article_cards = "\n".join(self.render_admin_wiki_article(row) for row in articles)
        body = render_template(
            "admin_wiki.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "wiki"),
            query=escape(query),
            article_count=escape(len(articles)),
            wiki_articles=article_cards or self.render_wiki_empty_state(query, admin=True),
        )
        self.send_html(body)

    def render_admin_wiki_article(self, row: sqlite3.Row) -> str:
        card = self.render_wiki_article_card(row, admin=True)
        return f"""
        <div class="admin-wiki-item">
          {card}
          <form method="post" action="/admin/wiki/delete" class="inline-form">
            <input type="hidden" name="article_id" value="{row["id"]}">
            <button class="danger-button" type="submit">Delete</button>
          </form>
        </div>
        """

    def admin_commercials_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        commercials = "\n".join(self.render_commercial_row(row) for row in get_all_commercials())
        body = render_template(
            "admin_commercials.html",
            admin_name=escape(user["name"]),
            admin_nav=self.render_admin_nav(user, "commercials"),
            commercials=commercials or '<tr><td colspan="6">No commercials yet.</td></tr>',
        )
        self.send_html(body)

    def admin_email_marketing_page(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        notice = urllib.parse.parse_qs(parsed.query).get("notice", [""])[0].strip()
        notice_html = f'<div class="admin-alert">{escape(notice)}</div>' if notice else ""
        ensure_email_marketing_calendar_plans()
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
            admin_nav=self.render_admin_nav(user, "email"),
            draft_cards=draft_cards,
            seasonal_rows=seasonal_rows,
            campaign_rows=campaign_rows or '<tr><td colspan="7">No planned campaigns yet.</td></tr>',
            today=escape(today),
            subscriber_count=escape(str(get_marketing_subscriber_count())),
            notice=notice_html,
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
            admin_nav=self.render_admin_nav(user, "pickup"),
            records=records or '<p class="admin-empty">No pickup records yet.</p>',
        )
        self.send_html(body)

    def render_admin_car_row(self, row: sqlite3.Row) -> str:
        status_options = "".join(
            f'<option value="{status}" {"selected" if row["status"] == status else ""}>{status}</option>'
            for status in ("AVAILABLE", "BOOKED", "MAINTENANCE")
        )
        edit_fields = f"""
            <div class="admin-car-edit-grid">
                <label><span>Brand</span><input form="car-update-{row["id"]}" name="brand" value="{escape(row["brand"])}"></label>
                <label><span>Model</span><input form="car-update-{row["id"]}" name="model" value="{escape(row["model"])}"></label>
                <label><span>Year</span><input form="car-update-{row["id"]}" name="year" type="number" value="{escape(row["year"] or "")}"></label>
                <label><span>Category</span><input form="car-update-{row["id"]}" name="category" value="{escape(row["category"])}"></label>
                <label><span>Type</span><input form="car-update-{row["id"]}" name="type" value="{escape(row["type"])}"></label>
                <label><span>Fuel</span><input form="car-update-{row["id"]}" name="fuel_type" value="{escape(row["fuel_type"])}"></label>
                <label><span>Seats</span><input form="car-update-{row["id"]}" name="seats" type="number" value="{escape(row["seats"])}"></label>
                <label><span>Bags</span><input form="car-update-{row["id"]}" name="bags" type="number" value="{escape(row["bags"])}"></label>
                <label><span>Doors</span><input form="car-update-{row["id"]}" name="doors" type="number" value="{escape(row["doors"])}"></label>
                <label><span>Transmission</span><input form="car-update-{row["id"]}" name="transmission" value="{escape(row["transmission"])}"></label>
                <label><span>Badge</span><input form="car-update-{row["id"]}" name="badge" value="{escape(row["badge"])}"></label>
                <label><span>Color</span><input form="car-update-{row["id"]}" name="color" value="{escape(row["color"])}"></label>
                <label class="wide"><span>Image URL</span><input form="car-update-{row["id"]}" name="image_url" value="{escape(row["image_url"])}"></label>
                <label class="wide"><span>Features</span><input form="car-update-{row["id"]}" name="features" value="{escape(row["features"])}"></label>
                <label><span>License plate</span><input form="car-update-{row["id"]}" name="license_plate" value="{escape(row["license_plate"])}"></label>
                <label><span>VIN</span><input form="car-update-{row["id"]}" name="vin_number" value="{escape(row["vin_number"])}"></label>
                <label><span>Sort order</span><input form="car-update-{row["id"]}" name="sort_order" type="number" value="{escape(row["sort_order"])}"></label>
            </div>
        """
        return f"""
        <tr>
            <td><a class="admin-car-name" href="/admin/cars/detail?id={row["id"]}"><b>{escape(row["name"])}</b><span>{escape(row["brand"] or "-")} {escape(row["model"] or "")}</span></a></td>
            <td>{escape(row["year"] or "-")}</td>
            <td>{escape(row["type"] or row["category"])}</td>
            <td>{escape(row["fuel_type"])}</td>
            <td><input form="car-update-{row["id"]}" name="purchase_cost" type="number" min="0.01" step="0.01" value="{float(row_value(row, "purchase_cost") or 0):.2f}" aria-label="Purchase cost"></td>
            <td>{self.render_receipt_link(row)}</td>
            <td><textarea form="car-update-{row["id"]}" name="location" rows="2" aria-label="Vehicle locations" title="Use one location per line. Address commas are preserved.">{escape(row["location"])}</textarea></td>
            <td><input form="car-update-{row["id"]}" name="daily_price" type="number" step="0.01" value="{row["daily_price"]:.2f}" aria-label="Daily price"></td>
            <td>
                <form id="car-update-{row["id"]}" method="post" action="/admin/cars/status" class="inline-form">
                    <input type="hidden" name="car_id" value="{row["id"]}">
                    <select name="status">{status_options}</select>
                    <button type="submit">Update</button>
                </form>
            </td>
            <td>
                <details class="admin-car-edit">
                    <summary>Edit details</summary>
                    {edit_fields}
                    <button form="car-update-{row["id"]}" type="submit">Save full details</button>
                </details>
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

    def render_admin_booking_row(self, row: sqlite3.Row, user: sqlite3.Row) -> str:
        is_request = row["booking_status"] in {"MODIFIED", "CANCELLATION_REQUESTED"}
        payment_label, pickup_balance_label = admin_payment_summary(row)
        refund_allowed, refund_block_reason = booking_refund_allowed(row)
        refund_action = ""
        if refund_allowed and not refund_passcode_configured():
            refund_action = '<small class="approval-note"><b>Refund locked</b>Set FAIRFARES_REFUND_PASSCODE before manual refunds can be requested.</small>'
        elif refund_allowed:
            refund_button = "Refund Stripe payments" if is_admin_user(user) else "Request P0 refund review"
            refund_action = f"""
                <form method="post" action="/admin/bookings/refund" class="admin-stack-form">
                    <input type="hidden" name="booking_id" value="{row["id"]}">
                    <input name="reason" value="{escape(row["cancellation_reason"] or "")}" placeholder="Refund reason" required>
                    <input name="refund_passcode" type="password" placeholder="Refund passcode" autocomplete="off" required>
                    <small class="approval-note"><b>Strict refund control</b>{'Executes Stripe refund only for saved Stripe Checkout payments.' if is_admin_user(user) else 'Creates an urgent P0 task for admins to review and refund.'}</small>
                    <button type="submit">{escape(refund_button)}</button>
                </form>
            """
        elif row["payment_status"] in {"PAID", "HOLD_PAID", "REFUND_REVIEW"}:
            refund_action = f'<small class="approval-note"><b>Refund locked</b>{escape(refund_block_reason)}</small>'
        booking_status_options = (
            ("PENDING_HOLD", "Pending 10-min hold"),
            ("EXPIRED_HOLD", "Expired hold"),
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
        payment_status_options = (
            ("HOLD_PENDING", "Hold payment pending"),
            ("HOLD_EXPIRED", "Expired"),
            ("HOLD_PAID", "10% hold paid"),
            ("PAID", "Paid in full"),
            ("PAY_AT_PICKUP", "Pay at pickup"),
            ("REFUND_REVIEW", "Refund review"),
            ("REFUNDED", "Refunded"),
        )
        payment_options = "".join(
            f'<option value="{status}" {"selected" if row["payment_status"] == status else ""}>{escape(label)}</option>'
            for status, label in payment_status_options
        )
        request_note = ""
        if is_request:
            request_type = "Cancellation approval requested" if row["booking_status"] == "CANCELLATION_REQUESTED" else "Modification approval requested"
            action_copy = "Choose CANCELLED to approve cancellation, or CONFIRMED to keep booking." if row["booking_status"] == "CANCELLATION_REQUESTED" else "Review requested changes, then choose CONFIRMED to approve or keep MODIFIED while pending."
            request_note = f'<small class="approval-note"><b>{escape(request_type)}</b>{escape(action_copy)}</small>'
        return f"""
        <tr class="{'admin-request-row' if is_request else ''}">
            <td data-label="Booking"><b>{escape(row["booking_id"])}</b><span>{escape(booking_status_label(row["booking_status"], row["payment_status"]))}</span></td>
            <td data-label="User">{escape(row["user_name"])}<span>{escape(row["user_email"])}</span></td>
            <td data-label="Car">{escape(row["car_name"])}</td>
            <td data-label="Dates">
                <b>{escape(row["pickup_date"])} at {escape(row["pickup_time"])}</b>
                <span>{escape(row["dropoff_date"])} at {escape(row["dropoff_time"])}</span>
            </td>
            <td data-label="Total">
                <b>{escape(format_money(row["total_price"]))}</b>
                <span>{escape(payment_label)}</span>
                <span>{escape(pickup_balance_label)}</span>
            </td>
            <td data-label="Status">
                {f'<div class="admin-request-summary">{escape(row["cancellation_reason"] or "No request details saved.")}</div>' if is_request else ''}
                <form method="post" action="/admin/bookings/status" class="admin-stack-form">
                    <input type="hidden" name="booking_id" value="{row["id"]}">
                    <select name="booking_status">{status_options}</select>
                    <select name="payment_status">{payment_options}</select>
                    <input name="reason" value="{escape(row["cancellation_reason"])}" placeholder="Reason / notes">
                    {request_note}
                    <button type="submit">Save</button>
                </form>
                {refund_action}
            </td>
            <td data-label="Pickup"><a class="admin-text-link" href="/admin/pickup">Open Pickup</a></td>
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
        issuer_agreement_fields = render_agreement_fields_for_role(agreement_values, "issuer")
        customer_agreement_complete = bool(agreement_values.get("customer_signature"))
        customer_agreement_status = "Customer form saved" if customer_agreement_complete else "Customer form not completed"
        customer_agreement_url = f"/admin/agreement/customer?booking_id={row['id']}"
        front_scan = license_row["front_image_url"] if license_row else ""
        back_scan = license_row["back_image_url"] if license_row else ""
        insurance_scan = insurance["document_url"] if insurance else ""
        actual_pickup_date = row["actual_pickup_date"] or display_date_to_input(row["pickup_date"], "")
        actual_return_date = row["actual_return_date"] or display_date_to_input(row["dropoff_date"], "")
        actual_pickup_time = row["actual_pickup_time"] or row["pickup_time"]
        actual_return_time = row["actual_return_time"] or row["dropoff_time"]
        pickup_odometer = row_value(row, "pickup_odometer")
        return_odometer = row_value(row, "return_odometer")
        pickup_fuel_level = row_value(row, "pickup_fuel_level")
        return_fuel_level = row_value(row, "return_fuel_level")
        pickup_condition_status = row_value(row, "pickup_condition_status") or "ACCEPTABLE"
        return_condition_status = row_value(row, "return_condition_status") or "PENDING"
        new_damage_found = row_value(row, "new_damage_found") or "NO"
        return_review_status = row_value(row, "return_review_status") or "PENDING"
        security_deposit_status = row_value(row, "security_deposit_status") or "NOT_AUTHORIZED"
        security_deposit_amount = float(row_value(row, "security_deposit_amount") or 0)
        post_return_charge_amount = float(row_value(row, "post_return_charge_amount") or 0)
        fee_rule_copy = post_return_fee_rule_summary()
        fuel_options = ("Full", "3/4", "1/2", "1/4", "Empty", "Electric 100%", "Electric 75%", "Electric 50%", "Electric 25%")
        condition_options = ("ACCEPTABLE", "ISSUES_NOTED", "DAMAGE_NOTED", "PENDING")
        damage_options = ("NO", "YES", "PENDING")
        review_options = ("PENDING", "CLEAR_TO_RELEASE", "CHARGES_PENDING", "PARTIAL_CAPTURE_REVIEW", "CAPTURE_REVIEW", "RELEASED", "CLOSED")
        deposit_status_options = ("NOT_AUTHORIZED", "AUTHORIZED", "RELEASE_READY", "RELEASED", "PARTIALLY_CAPTURED", "CAPTURED", "EXPIRED", "FAILED")

        def compact_select_options(options: tuple[str, ...], selected: str) -> str:
            return "".join(
                f'<option value="{escape(option)}" {"selected" if option == selected else ""}>{escape(option.replace("_", " ").title())}</option>'
                for option in options
            )
        status_summary = booking_status_label(row["booking_status"], row["payment_status"])
        dl_status = license_row["verification_status"] if license_row else "Not captured"
        dl_note = (license_row["verification_notes"] if license_row and "verification_notes" in license_row.keys() else "") or ""
        identity_row = refresh_identity_verification_from_stripe(latest_identity_verification(int(row["user_id"]), int(row["id"])))
        identity_status = row_value(identity_row, "status") if identity_row else "PENDING"
        identity_verified = identity_status == "VERIFIED"
        identity_title, identity_body = identity_status_copy(identity_status)
        identity_detail = identity_status_detail(identity_row)
        external_identity_row = latest_external_identity_check(int(row["user_id"]), int(row["id"]))
        external_identity_title, external_identity_body = external_identity_status_copy(external_identity_row)
        billing_status = transaction["billing_verification_status"] if transaction and "billing_verification_status" in transaction.keys() else ""
        billing_note = transaction["billing_verification_notes"] if transaction and "billing_verification_notes" in transaction.keys() else ""
        payment_label, pickup_balance_label = admin_payment_summary(row)
        payment_breakdown = booking_price_breakdown(row)
        pickup_balance_due = round(float(payment_breakdown["due_at_pickup"] or 0), 2)
        payment_status = row_value(row, "payment_status")
        booking_status = row_value(row, "booking_status")
        can_collect_pickup_balance = row_value(row, "payment_status") == "HOLD_PAID" and pickup_balance_due > 0
        if payment_status == "PAID":
            pickup_balance_action_copy = "Full payment received. Pickup balance is $0.00."
        elif payment_status == "HOLD_PAID" and pickup_balance_due > 0:
            pickup_balance_action_copy = "Create a booking-linked in-person payment, then collect it on the staff reader or Tap to Pay device."
        elif payment_status == "HOLD_PAID":
            pickup_balance_action_copy = "10% hold is recorded and no pickup balance is currently due."
        elif booking_status in {"CANCELLED", "CANCELLATION_REQUESTED", "RETURNED"}:
            pickup_balance_action_copy = "This booking is not eligible for pickup balance collection."
        else:
            pickup_balance_action_copy = "Collect the 10% hold first; then this section can create the pickup balance payment."
        pickup_balance_button_attrs = "" if can_collect_pickup_balance else " disabled"
        pickup_balance_button_label = "Create in-person payment" if can_collect_pickup_balance else "Not eligible yet"
        can_authorize_deposit = payment_status in {"HOLD_PAID", "PAID"} and booking_status not in {"CANCELLED", "CANCELLATION_REQUESTED", "RETURNED"}
        deposit_button_attrs = "" if can_authorize_deposit else " disabled"
        deposit_button_label = "Create deposit authorization" if can_authorize_deposit else "Available after payment"
        deposit_action_copy = (
            f"Authorize {format_money(SECURITY_DEPOSIT_AMOUNT)} at pickup. Release it after return review if there are no tickets, damage, tolls, cleaning, fuel, key, or other charges."
            if can_authorize_deposit
            else f"{format_money(SECURITY_DEPOSIT_AMOUNT)} refundable security deposit becomes available after the 10% hold or full payment is recorded."
        )
        deposit_status_copy = (
            f"{security_deposit_status.replace('_', ' ').title()} · {format_money(security_deposit_amount or SECURITY_DEPOSIT_AMOUNT)}"
            if security_deposit_status != "NOT_AUTHORIZED"
            else "Not authorized"
        )
        pickup_balance_panel = f"""
            <section class="pickup-form-section wide-field">
                <div class="pickup-section-head">
                    <div><b>Payment, deposit, insurance, and price match</b><span>{escape(format_money(pickup_balance_due))} pickup balance plus {escape(format_money(SECURITY_DEPOSIT_AMOUNT))} refundable security deposit authorization.</span></div>
                </div>
                <div class="pickup-prefill-panel pickup-payment-panel" data-admin-pickup-payment>
                    <div>
                        <b>Rental pickup balance - {escape(payment_label)}</b>
                        <span>{escape(pickup_balance_action_copy)}</span>
                    </div>
                    <button type="button" data-admin-pickup-payment-button{pickup_balance_button_attrs}>{escape(pickup_balance_button_label)}</button>
                    <small data-admin-pickup-payment-status>{escape(pickup_balance_label)}. After Stripe confirms payment, FairFares marks this booking as full payment received.</small>
                </div>
                <div class="pickup-prefill-panel pickup-payment-panel pickup-deposit-panel" data-admin-security-deposit>
                    <div>
                        <b>Refundable security deposit - {escape(format_money(SECURITY_DEPOSIT_AMOUNT))}</b>
                        <span>{escape(deposit_action_copy)}</span>
                    </div>
                    <button type="button" data-admin-security-deposit-button{deposit_button_attrs}>{escape(deposit_button_label)}</button>
                    <small data-admin-security-deposit-status>{escape(SECURITY_DEPOSIT_RELEASE_COPY)}</small>
                </div>
                <div class="pickup-form-grid pickup-money-grid">
                    <label><span>Insurance Provider</span><input name="insurance_provider" value="{escape(insurance["insurance_provider"] if insurance else "")}"></label>
                    <label><span>Insurance Type</span><input name="insurance_type" value="{escape(insurance["insurance_type"] if insurance else "Rental coverage")}"></label>
                    <label><span>Coverage Amount</span><input name="coverage_amount" type="number" step="0.01" value="{escape(insurance["coverage_amount"] if insurance else "0")}"></label>
                    <label><span>Insurance Price</span><input name="insurance_price" type="number" step="0.01" value="{escape(insurance["price"] if insurance else "0")}"></label>
                    <label><span>Payment Method</span><input name="payment_method" value="{escape(transaction["payment_method"] if transaction else "")}" placeholder="Card / Cash / Online"></label>
                    <label><span>Cardholder Name</span><input name="cardholder_name" value="{escape(transaction["cardholder_name"] if transaction and "cardholder_name" in transaction.keys() else "")}" placeholder="Required for card payments"></label>
                    <label><span>Price Match Agency</span><input name="price_match_agency" value="{escape(row["price_match_agency"])}" placeholder="Avis, Enterprise, Hertz"></label>
                    <label><span>Matched Quote Total</span><input name="price_match_amount" type="number" step="0.01" value="{escape(row["price_match_amount"] or "")}" placeholder="Lower quote total"></label>
                </div>
            </section>
        """
        latest_transaction_label = transaction["transaction_status"] if transaction else ""
        billing_parts = []
        if latest_transaction_label:
            billing_parts.append(f"Latest transaction: {latest_transaction_label}")
        if billing_status:
            billing_parts.append(f"{billing_status}{(' - ' + billing_note) if billing_note else ''}")
        billing_summary = " · ".join(billing_parts)

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

        document_photo_fields = "".join(
            (
                capture_field("front_image_url", "DL Front", front_scan, "Front DL saved"),
                capture_field("back_image_url", "DL Back", back_scan, "Back DL saved"),
                capture_field("insurance_document_url", "Insurance", insurance_scan, "Insurance image saved"),
            )
        )
        vehicle_photo_fields = "".join(
            (
                capture_field("pickup_front_image", "Pickup Front", row_value(row, "pickup_front_image")),
                capture_field("pickup_back_image", "Pickup Rear", row_value(row, "pickup_back_image")),
                capture_field("pickup_left_image", "Pickup Driver Side", row_value(row, "pickup_left_image")),
                capture_field("pickup_right_image", "Pickup Passenger Side", row_value(row, "pickup_right_image")),
                capture_field("pickup_odometer_image", "Pickup Odometer", row_value(row, "pickup_odometer_image")),
                capture_field("pickup_fuel_image", "Pickup Fuel", row_value(row, "pickup_fuel_image")),
                capture_field("pickup_interior_front_image", "Pickup Front Seats", row_value(row, "pickup_interior_front_image")),
                capture_field("pickup_interior_rear_image", "Pickup Rear/Cargo", row_value(row, "pickup_interior_rear_image")),
                capture_field("return_front_image", "Return Front", row_value(row, "return_front_image")),
                capture_field("return_back_image", "Return Rear", row_value(row, "return_back_image")),
                capture_field("return_left_image", "Return Driver Side", row_value(row, "return_left_image")),
                capture_field("return_right_image", "Return Passenger Side", row_value(row, "return_right_image")),
                capture_field("return_odometer_image", "Return Odometer", row_value(row, "return_odometer_image")),
                capture_field("return_fuel_image", "Return Fuel", row_value(row, "return_fuel_image")),
                capture_field("return_interior_front_image", "Return Front Seats", row_value(row, "return_interior_front_image")),
                capture_field("return_interior_rear_image", "Return Rear/Cargo", row_value(row, "return_interior_rear_image")),
                capture_field("damage_photo_image", "Damage Closeup", row_value(row, "damage_photo_image")),
            )
        )
        return_review_copy = return_review_status.replace("_", " ").title()
        if post_return_charge_amount:
            return_review_copy = f"{return_review_copy} · {format_money(post_return_charge_amount)}"

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
                <span><b>Identity</b>{escape(identity_title)}<small>{escape(identity_body)}</small></span>
                <span><b>DMV/AAMVA</b>{escape(external_identity_title)}<small>{escape(external_identity_body)}</small></span>
                <span><b>Insurance</b>{escape(insurance["insurance_provider"] if insurance else "Not captured")}</span>
                <span><b>Payment</b>{escape(payment_label)}<small>{escape(pickup_balance_label)}</small>{f'<small>{escape(billing_summary)}</small>' if billing_summary else ''}</span>
                <span><b>Discount</b>{escape((row["discount_code"] or "None") + (" · -" + format_money(row["discount_amount"]) if row["discount_amount"] else ""))}</span>
                <span><b>Total</b>{escape(format_money(row["total_price"]))}</span>
                <span><b>Late fee</b>{escape(format_money(row["late_fee_amount"])) if row["late_fee_amount"] else "None"}</span>
                <span><b>Deposit</b>{escape(deposit_status_copy)}<small>{escape(SECURITY_DEPOSIT_RELEASE_COPY)}</small></span>
                <span><b>Return review</b>{escape(return_review_copy)}</span>
                <span><b>Agreement</b>{escape("Signed" if agreement and agreement["signature_text"] else "Pending")}</span>
            </div>
            <form method="post" action="/admin/pickup-documents" class="pickup-form">
                <input type="hidden" name="booking_id" value="{row["id"]}">
                <input type="hidden" name="user_id" value="{row["user_id"]}">
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>Stripe Identity at pickup</b><span>Start DL and selfie verification while the customer is present.</span></div>
                    </div>
                    <div class="pickup-prefill-panel pickup-stripe-identity-panel" data-admin-stripe-identity>
                        <div>
                            <b>{escape(identity_title)}</b>
                            <span>{escape(identity_body)}</span>
                        </div>
                        <button type="button" data-admin-stripe-identity-button {"disabled" if identity_verified else ""}>{"Verified" if identity_verified else "Start Stripe Identity"}</button>
                        <small data-admin-stripe-identity-status>{escape(identity_detail)}</small>
                    </div>
                </section>
                {pickup_balance_panel}
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>Customer and driver license</b><span>Capture required renter identity details at pickup.</span></div>
                    </div>
                    <div class="pickup-form-grid">
                        <label><span>Customer Full Name</span><input name="customer_name" value="{escape(row["user_name"])}"></label>
                        <label><span>Phone</span><input name="phone" value="{escape(row["phone"] or "")}" placeholder="Customer phone"></label>
                        <label><span>Address</span><input name="address" value="{escape(row["address"] or "")}" placeholder="Customer address"></label>
                        <label><span>Date of Birth</span><input name="date_of_birth" type="date" value="{escape(row["date_of_birth"] or "")}"></label>
                        <label><span>DL Number</span><input name="license_number" value="{escape(license_row["license_number"] if license_row else "")}" placeholder="Scan or enter DL"></label>
                        <label><span>DL State</span><input name="license_state" value="{escape(license_row["state"] if license_row else "CO")}"></label>
                        <label><span>DL Expiry</span><input name="license_expiry" type="date" value="{escape(license_row["expiry_date"] if license_row else "2028-12-31")}"></label>
                    </div>
                </section>
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>DL and insurance photos</b><span>Upload DL front/back and insurance proof, then prefill only blank fields.</span></div>
                    </div>
                    <div class="pickup-photo-row pickup-document-row">{document_photo_fields}</div>
                    <div class="pickup-prefill-panel" data-pickup-prefill>
                        <div>
                            <b>Prefill from captured documents</b>
                            <span>Uses OCR to suggest values only. Staff must review before saving.</span>
                        </div>
                        <button type="button" data-pickup-prefill-button>Prefill empty fields</button>
                        <small data-pickup-prefill-status>Confirm customer consent before sending document photos for OCR. This is not DMV verification.</small>
                    </div>
                </section>
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>Trip timing</b><span>Record actual pickup and return timing.</span></div>
                    </div>
                    <div class="pickup-form-grid">
                        <label><span>Actual Pickup Date</span><input name="actual_pickup_date" type="date" value="{escape(actual_pickup_date)}"></label>
                        <label><span>Actual Pickup Time</span><select name="actual_pickup_time">{time_select_options(actual_pickup_time)}</select></label>
                        <label><span>Actual Return Date</span><input name="actual_return_date" type="date" value="{escape(actual_return_date)}"></label>
                        <label><span>Actual Return Time</span><select name="actual_return_time">{time_select_options(actual_return_time)}</select></label>
                    </div>
                </section>
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>Inspection and return review</b><span>Record odometer, fuel, condition, signatures, and strict deposit release/capture status.</span></div>
                    </div>
                    <div class="pickup-form-grid">
                        <label><span>Pickup Odometer</span><input name="pickup_odometer" type="number" min="0" value="{escape(pickup_odometer)}"></label>
                        <label><span>Return Odometer</span><input name="return_odometer" type="number" min="0" value="{escape(return_odometer)}"></label>
                        <label><span>Pickup Fuel Level</span><select name="pickup_fuel_level"><option value="">Select fuel</option>{compact_select_options(fuel_options, pickup_fuel_level)}</select></label>
                        <label><span>Return Fuel Level</span><select name="return_fuel_level"><option value="">Select fuel</option>{compact_select_options(fuel_options, return_fuel_level)}</select></label>
                        <label><span>Pickup Condition</span><select name="pickup_condition_status">{compact_select_options(condition_options, pickup_condition_status)}</select></label>
                        <label><span>Return Condition</span><select name="return_condition_status">{compact_select_options(condition_options, return_condition_status)}</select></label>
                        <label><span>New Damage Found</span><select name="new_damage_found">{compact_select_options(damage_options, new_damage_found)}</select></label>
                        <label><span>Return Review Status</span><select name="return_review_status">{compact_select_options(review_options, return_review_status)}</select></label>
                        <label><span>Deposit Status</span><select name="security_deposit_status">{compact_select_options(deposit_status_options, security_deposit_status)}</select></label>
                        <label><span>Post-return Charges</span><input name="post_return_charge_amount" type="number" step="0.01" min="0" value="{escape(f'{post_return_charge_amount:.2f}' if post_return_charge_amount else '')}" placeholder="0.00"></label>
                        <label><span>Pickup Customer Signature</span><input name="pickup_customer_signature" value="{escape(row_value(row, "pickup_customer_signature"))}" placeholder="Typed at pickup"></label>
                        <label><span>Pickup Staff Signature</span><input name="pickup_staff_signature" value="{escape(row_value(row, "pickup_staff_signature"))}" placeholder="Staff initials/name"></label>
                        <label><span>Return Customer Signature</span><input name="return_customer_signature" value="{escape(row_value(row, "return_customer_signature"))}" placeholder="Typed at return"></label>
                        <label><span>Return Staff Signature</span><input name="return_staff_signature" value="{escape(row_value(row, "return_staff_signature"))}" placeholder="Staff initials/name"></label>
                        <label class="wide-field"><span>Charge / Release Notes</span><textarea name="post_return_charge_notes" rows="3" placeholder="Required before any deposit capture. Note tickets, tolls, damage, fuel, mileage, cleaning, keys, or release reason.">{escape(row_value(row, "post_return_charge_notes"))}</textarea></label>
                    </div>
                    <div class="pickup-prefill-panel pickup-return-review-panel">
                        <div>
                            <b>Strict deposit rule</b>
                            <span>Do not capture any deposit until return review has evidence and notes. Active fee defaults: {escape(fee_rule_copy)}</span>
                        </div>
                        <small>Release when review is clear; capture only documented tickets, tolls, damage, cleaning, fuel, keys, mileage, service, smoking, or allowed agreement charges.</small>
                    </div>
                </section>
                <section class="pickup-form-section wide-field">
                    <div class="pickup-section-head">
                        <div><b>Vehicle photos</b><span>Minimum inspection set: exterior, odometer, fuel, interior/cargo, and damage closeups when needed.</span></div>
                    </div>
                    <div class="pickup-photo-row pickup-vehicle-row">{vehicle_photo_fields}</div>
                </section>
                <div class="agreement-builder wide-field">
                    <div class="agreement-builder-head">
                        <div>
                            <b>Rental Agreement Builder</b>
                            <span>Customer fields are filled on a separate full-page form. Admin fields stay here.</span>
                        </div>
                        <a class="secondary-print-button" href="{escape(customer_agreement_url)}" target="_blank" rel="noopener">Open customer form</a>
                    </div>
                    <p class="agreement-flow-note">{escape(customer_agreement_status)}. Save admin pickup data after customer form completion to regenerate the final agreement with issuer fields.</p>
                    <div class="agreement-field-grid">{issuer_agreement_fields}</div>
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

    def render_tax_fee_rule_row(self, row: sqlite3.Row) -> str:
        rule_type = row["rule_type"]
        value = f'{float(row["value"]):.2f}%' if rule_type == "PERCENT" else format_money(row["value"])
        basis = {
            "DAILY": "Per rental day",
            "PERCENT": "Percent of rental subtotal",
            "FLAT": "Per booking",
        }.get(rule_type, "Per rental day")
        return f"""
        <tr>
            <td><b>{escape(row["label"])}</b><span>{escape(basis)}</span></td>
            <td>{escape(rule_type)}</td>
            <td>{escape(value)}</td>
            <td>{escape(str(row["sort_order"]))}</td>
            <td>{escape(row["status"])}</td>
            <td>
                <form method="post" action="/admin/tax-fees/delete" class="inline-form">
                    <input type="hidden" name="rule_id" value="{row["id"]}">
                    <button class="danger-button" type="submit">Delete</button>
                </form>
            </td>
        </tr>
        """

    def render_post_return_fee_rule_row(self, row: sqlite3.Row) -> str:
        rule_type = row["rule_type"]
        if rule_type == "PER_MILE":
            value = f'{format_money(row["value"])}/mile'
            basis = "Per extra mile"
        elif rule_type == "DAILY":
            value = f'{format_money(row["value"])}/day'
            basis = "Per day"
        else:
            value = format_money(row["value"])
            basis = "Per reviewed incident"
        return f"""
        <tr>
            <td><b>{escape(row["label"])}</b><span>{escape(row["description"] or basis)}</span></td>
            <td>{escape(rule_type)}</td>
            <td>{escape(value)}</td>
            <td>{escape(str(row["sort_order"]))}</td>
            <td>{escape(row["status"])}</td>
            <td>
                <form method="post" action="/admin/post-return-fees/delete" class="inline-form">
                    <input type="hidden" name="rule_id" value="{row["id"]}">
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

    def admin_customer_agreement_page(self) -> None:
        user = self.require_admin()
        if not user:
            return
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            booking_id = int(query.get("booking_id", ["0"])[0] or 0)
        except ValueError:
            booking_id = 0
        booking, license_row, insurance, agreement = get_admin_agreement_context(booking_id)
        if not booking:
            self.not_found()
            return
        values = agreement_default_values(booking, license_row, insurance, agreement)
        customer_fields = render_agreement_fields_for_role(values, "customer")
        agreement_text = build_rental_agreement_text(booking, values)
        saved_notice = (
            '<p class="agreement-customer-notice">Customer agreement fields saved. Admin can continue pickup.</p>'
            if query.get("saved", [""])[0]
            else ""
        )
        stylesheet_links = "\n".join(
            f'  <link rel="stylesheet" href="{escape(url)}">' for url in [*BASE_STYLESHEETS, *SHARED_STYLESHEETS]
        )
        body = f"""
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Customer Agreement | FairFares</title>
{stylesheet_links}
</head>
<body class="admin-screen agreement-customer-screen">
  <main class="agreement-customer-page">
    <section class="agreement-customer-panel">
      <div class="agreement-customer-head">
        <div>
          <p class="eyebrow">Rental Agreement</p>
          <h1>Customer form</h1>
          <span>{escape(row_value(booking, "booking_id"))} - {escape(row_value(booking, "user_name"))} - {escape(row_value(booking, "car_name"))}</span>
        </div>
        <a class="secondary-print-button" href="/admin/pickup">Back to pickup</a>
      </div>
      {saved_notice}
      <form method="post" action="/admin/agreement/customer" class="agreement-customer-form">
        <input type="hidden" name="booking_id" value="{escape(row_value(booking, "id"))}">
        <div class="agreement-field-grid">{customer_fields}</div>
        <label class="agreement-consent-field">
          <input type="checkbox" name="electronic_consent" value="1" required>
          <span>I agree to complete and sign this FairFares rental agreement electronically. I confirm the customer information is accurate and I can save or request a copy of this agreement.</span>
        </label>
        <button type="submit">Save customer agreement</button>
      </form>
    </section>
    <section class="agreement-customer-panel">
      <div class="agreement-customer-head">
        <div>
          <p class="eyebrow">Preview</p>
          <h2>Generated agreement</h2>
          <span>Review before saving. Admin fields can still be completed in pickup.</span>
        </div>
      </div>
      <textarea class="agreement-customer-preview" readonly rows="22">{escape(agreement_text)}</textarea>
    </section>
  </main>
</body>
</html>
        """.strip()
        self.send_html(body.encode("utf-8"))

    def save_customer_agreement(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id") or 0)
        except ValueError:
            booking_id = 0
        if form.get("electronic_consent") != "1":
            self.send_html(b"Electronic signature consent is required.", 400)
            return
        booking, license_row, insurance, agreement = get_admin_agreement_context(booking_id)
        if not booking:
            self.not_found()
            return
        values = agreement_default_values(booking, license_row, insurance, agreement)
        for _title, role, fields in AGREEMENT_FIELD_GROUPS:
            if role != "customer":
                continue
            for key, _label in fields:
                values[key] = form.get(f"agreement_{key}", "").strip()
        signature_text = values.get("customer_signature", "").strip()
        generated_agreement_text = build_rental_agreement_text(booking, values)
        with db() as con:
            con.execute(
                """
                INSERT INTO rental_agreements
                (booking_id, agreement_text, agreement_data, signer_name, signature_text, signed_at)
                VALUES (?, ?, ?, ?, ?, CASE WHEN ? != '' THEN CURRENT_TIMESTAMP ELSE NULL END)
                """,
                (
                    booking_id,
                    generated_agreement_text,
                    json.dumps(values),
                    values.get("lessee_name", row_value(booking, "user_name")),
                    signature_text,
                    signature_text,
                ),
            )
        self.redirect(f"/admin/agreement/customer?booking_id={booking_id}&saved=1")

    def create_admin_backup(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        create_db_backup("admin")
        self.redirect("/admin/system")

    def migrate_admin_drive_uploads(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        summary = migrate_existing_uploads_to_drive(row_value(user, "id"))
        message = (
            f"processed={summary.get('processed', 0)}"
            f"&uploaded={summary.get('uploaded', 0)}"
            f"&failed={summary.get('failed', 0)}"
            f"&unsupported={summary.get('unsupported', 0)}"
            f"&skipped={summary.get('skipped', 0)}"
        )
        self.redirect(f"/admin/system?drive_migration=1&{message}")

    def download_admin_backup(self) -> None:
        user = self.require_owner_admin()
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
        user = self.require_owner_admin()
        if not user:
            return
        form, files = self.read_form_with_files()
        brand = form.get("brand", "")
        model = form.get("model", "")
        name = f"{brand} {model}".strip() or form.get("name", "New Car")
        try:
            daily_price = max(0.0, float(form.get("daily_price") or 0))
        except ValueError:
            daily_price = 0.0
        try:
            purchase_cost = max(0.0, float(form.get("purchase_cost") or 0))
        except ValueError:
            purchase_cost = 0.0
        purchase_receipt_file = files.get("purchase_receipt_file")
        if purchase_cost <= 0 or not purchase_receipt_file:
            self.redirect("/admin/inventory?error=purchase_receipt_required")
            return
        try:
            days = int(form.get("days") or 7)
        except ValueError:
            days = 7
        with db() as con:
            cursor = con.execute(
                """
                INSERT INTO cars
                (name, brand, model, year, category, type, fuel_type, seats, bags, doors, transmission,
                 daily_price, total_price, badge, color, features, location, image_url, status,
                 license_plate, vin_number, purchase_cost, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    normalize_inventory_locations(form.get("location")),
                    form.get("image_url") or "",
                    form.get("status") or "AVAILABLE",
                    form.get("license_plate") or "",
                    form.get("vin_number") or "",
                    purchase_cost,
                    int(form.get("sort_order") or 99),
                ),
            )
            car_id = cursor.lastrowid
            receipt_ref = upload_file_payload_to_drive(
                con,
                folder_key="roi",
                file_scope="vehicle_purchase_receipt",
                file_data=purchase_receipt_file,
                uploaded_by=row_value(user, "id"),
                car_id=car_id,
            )
            if not receipt_ref:
                receipt_ref = save_file_payload_locally(
                    folder_name="vehicle-purchase-receipts",
                    file_data=purchase_receipt_file,
                    fallback_name=f"vehicle-{car_id}-purchase-receipt",
                )
            if not receipt_ref:
                con.execute("DELETE FROM cars WHERE id = ?", (car_id,))
                self.redirect("/admin/inventory?error=purchase_receipt_upload_failed")
                return
            con.execute("UPDATE cars SET purchase_receipt_url = ? WHERE id = ?", (receipt_ref, car_id))
        self.redirect("/admin/inventory")

    def update_admin_car_status(self) -> None:
        user = self.require_owner_admin()
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
        try:
            year = int(form.get("year") or 0)
        except ValueError:
            year = 0
        def int_field(name: str, fallback: int) -> int:
            try:
                return int(form.get(name) or fallback)
            except ValueError:
                return fallback
        location = normalize_inventory_locations(form.get("location", ""))
        with db() as con:
            current = con.execute("SELECT * FROM cars WHERE id = ?", (form.get("car_id"),)).fetchone()
            try:
                purchase_cost = max(0.0, float(form.get("purchase_cost") or row_value(current, "purchase_cost") or 0))
            except ValueError:
                purchase_cost = float(row_value(current, "purchase_cost") or 0)
            brand = form.get("brand", row_value(current, "brand")).strip()
            model = form.get("model", row_value(current, "model")).strip()
            name = f"{brand} {model}".strip() or row_value(current, "name") or "Vehicle"
            con.execute(
                """
                UPDATE cars
                SET name = ?,
                    brand = ?,
                    model = ?,
                    year = ?,
                    category = ?,
                    type = ?,
                    fuel_type = ?,
                    seats = ?,
                    bags = ?,
                    doors = ?,
                    transmission = ?,
                    daily_price = ?,
                    total_price = ?,
                    badge = ?,
                    color = ?,
                    features = ?,
                    location = ?,
                    image_url = ?,
                    status = ?,
                    license_plate = ?,
                    vin_number = ?,
                    purchase_cost = ?,
                    sort_order = ?
                WHERE id = ?
                """,
                (
                    name,
                    brand,
                    model,
                    year or int(row_value(current, "year") or 2026),
                    form.get("category", row_value(current, "category")) or "Economy",
                    form.get("type", row_value(current, "type")) or "Sedan",
                    form.get("fuel_type", row_value(current, "fuel_type")) or "Gasoline",
                    int_field("seats", int(row_value(current, "seats") or 5)),
                    int_field("bags", int(row_value(current, "bags") or 2)),
                    int_field("doors", int(row_value(current, "doors") or 4)),
                    form.get("transmission", row_value(current, "transmission")) or "Automatic",
                    daily_price or float(row_value(current, "daily_price") or 0),
                    (daily_price or float(row_value(current, "daily_price") or 0)) * 7,
                    form.get("badge", row_value(current, "badge")) or "Available",
                    form.get("color", row_value(current, "color")) or "white",
                    form.get("features", row_value(current, "features")) or "Free Cancellation|Unlimited Mileage|24/7 Support",
                    location or normalize_inventory_locations(row_value(current, "location")),
                    form.get("image_url", row_value(current, "image_url")),
                    status,
                    form.get("license_plate", row_value(current, "license_plate")),
                    form.get("vin_number", row_value(current, "vin_number")),
                    purchase_cost,
                    int_field("sort_order", int(row_value(current, "sort_order") or 99)),
                    form.get("car_id"),
                ),
            )
            if current and row_value(current, "status") != status:
                updated_car = con.execute("SELECT * FROM cars WHERE id = ?", (form.get("car_id"),)).fetchone()
                notify_slack_vehicle(updated_car, status, self.public_origin(), note=f"Changed by {row_value(user, 'name')}")
        redirect_to = form.get("redirect_to", "/admin/inventory")
        if not redirect_to.startswith("/admin"):
            redirect_to = "/admin/inventory"
        self.redirect(redirect_to)

    def create_admin_car_service_cost(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form, files = self.read_form_with_files()
        try:
            car_id = int(form.get("car_id") or 0)
        except ValueError:
            car_id = 0
        cost_type = (form.get("cost_type") or "MAINTENANCE").strip().upper()
        if cost_type not in {"MAINTENANCE", "REPAIR"}:
            cost_type = "MAINTENANCE"
        try:
            amount = max(0.0, float(form.get("amount") or 0))
        except ValueError:
            amount = 0.0
        service_date = (form.get("service_date") or "").strip() or datetime.now().strftime("%Y-%m-%d")
        with db() as con:
            car = con.execute("SELECT * FROM cars WHERE id = ? AND UPPER(TRIM(status)) != 'DELETED'", (car_id,)).fetchone()
            if car and amount > 0:
                receipt_ref = form.get("receipt_url", "").strip()
                cursor = con.execute(
                    """
                    INSERT INTO car_service_costs (car_id, cost_type, amount, service_date, vendor, receipt_url, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        car_id,
                        cost_type,
                        amount,
                        service_date,
                        form.get("vendor", "").strip(),
                        receipt_ref,
                        form.get("notes", "").strip(),
                    ),
                )
                service_cost_id = cursor.lastrowid
                drive_ref = upload_file_payload_to_drive(
                    con,
                    folder_key="roi",
                    file_scope="vehicle_service_receipt",
                    file_data=files.get("receipt_file"),
                    uploaded_by=row_value(user, "id"),
                    car_id=car_id,
                    expense_id=service_cost_id,
                )
                if drive_ref:
                    receipt_ref = drive_ref
                    con.execute("UPDATE car_service_costs SET receipt_url = ? WHERE id = ?", (receipt_ref, service_cost_id))
                elif files.get("receipt_file"):
                    receipt_ref = save_file_payload_locally(
                        folder_name="vehicle-service-receipts",
                        file_data=files.get("receipt_file"),
                        fallback_name=f"vehicle-{car_id}-{cost_type.lower()}-receipt",
                    )
                    if receipt_ref:
                        con.execute("UPDATE car_service_costs SET receipt_url = ? WHERE id = ?", (receipt_ref, service_cost_id))
                notify_slack_vehicle(
                    car,
                    cost_type,
                    self.public_origin(),
                    note=f"{format_money(amount)} on {service_date}: {form.get('notes', '').strip() or form.get('vendor', '').strip() or 'No note'}",
                )
        self.redirect(f"/admin/cars/detail?id={car_id}" if car_id else "/admin/inventory")

    def create_admin_business_expense(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form, files = self.read_form_with_files()
        try:
            amount = max(0.0, float(form.get("amount") or 0))
        except ValueError:
            amount = 0.0
        expense_date = (form.get("expense_date") or "").strip() or datetime.now().strftime("%Y-%m-%d")
        description = (form.get("description") or "").strip()
        if amount > 0 and description:
            with db() as con:
                cursor = con.execute(
                    """
                    INSERT INTO business_expenses (expense_date, amount, description)
                    VALUES (?, ?, ?)
                    """,
                    (expense_date, amount, description),
                )
                expense_id = cursor.lastrowid
                upload_file_payload_to_drive(
                    con,
                    folder_key="roi",
                    file_scope="business_expense_file",
                    file_data=files.get("expense_file"),
                    uploaded_by=row_value(user, "id"),
                    expense_id=expense_id,
                )
        self.redirect("/admin/roi")

    def delete_admin_business_expense(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM business_expenses WHERE id = ?", (form.get("expense_id"),))
        self.redirect("/admin/roi")

    def delete_admin_car(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            booked = con.execute("SELECT 1 FROM bookings WHERE car_id = ? LIMIT 1", (form.get("car_id"),)).fetchone()
            if booked:
                con.execute("UPDATE cars SET status = 'DELETED' WHERE id = ?", (form.get("car_id"),))
            else:
                con.execute("DELETE FROM cars WHERE id = ?", (form.get("car_id"),))
        self.redirect("/admin/inventory")

    def refund_admin_booking_payment(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        reason = (form.get("reason") or "").strip() or "Manual refund requested by staff."
        if not refund_passcode_configured() or not verify_refund_passcode(form.get("refund_passcode", "")):
            self.redirect("/admin/bookings")
            return
        with db() as con:
            booking = con.execute(
                """
                SELECT bookings.*, users.name AS user_name, users.email AS user_email,
                       cars.name AS car_name
                FROM bookings
                JOIN users ON users.id = bookings.user_id
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (form.get("booking_id"),),
            ).fetchone()
            allowed, _message = booking_refund_allowed(booking)
            if not allowed or not booking:
                self.redirect("/admin/bookings")
                return
            if not is_admin_user(user):
                create_manual_refund_task(con, booking, user, reason)
                self.redirect("/admin/bookings")
                return

        next_payment_status, refund_message = auto_refund_booking_payments(int(row_value(booking, "id")))
        with db() as con:
            con.execute(
                """
                UPDATE bookings
                SET payment_status = ?,
                    cancellation_reason = CASE
                        WHEN cancellation_reason = '' THEN ?
                        ELSE cancellation_reason || ' | ' || ?
                    END
                WHERE id = ?
                """,
                (
                    next_payment_status,
                    f"Manual refund: {refund_message}",
                    f"Manual refund: {refund_message}",
                    row_value(booking, "id"),
                ),
            )
            updated_booking = con.execute(
                """
                SELECT bookings.*, users.name AS user_name, users.email AS user_email,
                       cars.name AS car_name
                FROM bookings
                JOIN users ON users.id = bookings.user_id
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (row_value(booking, "id"),),
            ).fetchone()
            if next_payment_status != "REFUNDED" and updated_booking:
                create_manual_refund_task(con, updated_booking, user, f"{reason} | Automatic refund result: {refund_message}")
        notify_slack_payment(
            booking,
            f"Manual refund action by {row_value(user, 'name')}: {next_payment_status} - {refund_message}",
            self.public_origin(),
        )
        self.redirect("/admin/bookings")

    def update_admin_booking_status(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        booking_status = form.get("booking_status", "CONFIRMED")
        payment_status = form.get("payment_status", "PAY_AT_PICKUP")
        if booking_status not in {"PENDING_HOLD", "EXPIRED_HOLD", "CONFIRMED", "MODIFIED", "CANCELLATION_REQUESTED", "CANCELLED", "PICKED_UP", "RETURNED"}:
            booking_status = "CONFIRMED"
        if payment_status not in {"HOLD_PENDING", "HOLD_EXPIRED", "HOLD_PAID", "PAID", "PAY_AT_PICKUP", "REFUND_REVIEW", "REFUNDED"}:
            payment_status = "PAY_AT_PICKUP"
        reason = form.get("reason", "")
        if booking_status in {"CONFIRMED", "PICKED_UP", "RETURNED"}:
            reason = ""
        if booking_status == "CANCELLED" and not reason:
            reason = "Cancelled by admin approval."
        with db() as con:
            previous_booking = con.execute(
                """
                SELECT bookings.*, users.name AS user_name, cars.name AS car_name
                FROM bookings
                JOIN users ON users.id = bookings.user_id
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (form.get("booking_id"),),
            ).fetchone()
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
            if booking_status in {"CANCELLED", "EXPIRED_HOLD"}:
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'AVAILABLE'
                    WHERE id = (SELECT car_id FROM bookings WHERE id = ?)
                    """,
                    (form.get("booking_id"),),
                )
            elif booking_status == "PENDING_HOLD":
                con.execute(
                    """
                    UPDATE cars
                    SET status = 'HOLD'
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
            updated_booking = con.execute(
                """
                SELECT bookings.*, users.name AS user_name, cars.name AS car_name
                FROM bookings
                JOIN users ON users.id = bookings.user_id
                JOIN cars ON cars.id = bookings.car_id
                WHERE bookings.id = ?
                """,
                (form.get("booking_id"),),
            ).fetchone()
            notify_payment_statuses = {"HOLD_PAID", "PAID", "REFUND_REVIEW", "REFUNDED"}
            if updated_booking and (
                not previous_booking
                or row_value(previous_booking, "booking_status") != booking_status
                or row_value(previous_booking, "payment_status") != payment_status
            ) and (
                payment_status in notify_payment_statuses
                or row_value(previous_booking, "payment_status") in notify_payment_statuses
            ):
                notify_slack_payment(
                    updated_booking,
                    f"Admin set booking {booking_status} / payment {payment_status}",
                    self.public_origin(),
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

    def escalate_admin_ticket(self) -> None:
        user = self.require_admin()
        if not user:
            return
        if is_admin_user(user):
            self.redirect("/admin/tickets")
            return
        form = self.read_form()
        try:
            ticket_id = int(form.get("ticket_id") or 0)
        except ValueError:
            ticket_id = 0
        reason = (form.get("reason") or "").strip()
        if not reason:
            reason = "Employee requested on-call admin review."
        with db() as con:
            ticket = con.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_id,)).fetchone()
            if not ticket or row_value(ticket, "status") == "CLOSED":
                self.redirect("/admin/tickets")
                return
            if not int(row_value(ticket, "escalated_to_oncall") or 0):
                con.execute(
                    """
                    UPDATE support_tickets
                    SET escalated_to_oncall = 1,
                        escalated_by = ?,
                        escalation_reason = ?,
                        escalated_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (row_value(user, "id"), reason, ticket_id),
                )
                updated_ticket = con.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_id,)).fetchone()
                if updated_ticket:
                    queue_oncall_escalation_alert(con, updated_ticket, user, reason)
                    notify_slack_support_ticket(
                        row_value(updated_ticket, "ticket_id"),
                        row_value(updated_ticket, "priority"),
                        row_value(updated_ticket, "topic"),
                        user,
                        self.public_origin(),
                        escalated=True,
                    )
        self.redirect("/admin/tickets")

    def assign_oncall_shift(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        shift_date = (form.get("shift_date") or "").strip()
        try:
            parsed_day = datetime.strptime(shift_date, "%Y-%m-%d").date()
            admin_user_id = int(form.get("admin_user_id") or 0)
        except ValueError:
            self.redirect("/admin/oncall")
            return
        note = (form.get("note") or "").strip()
        with db() as con:
            admin = con.execute(
                "SELECT id FROM users WHERE id = ? AND is_verified = 1 AND (is_admin = 1 OR role = 'ADMIN')",
                (admin_user_id,),
            ).fetchone()
            if admin:
                con.execute(
                    """
                    INSERT INTO oncall_shifts (shift_date, admin_user_id, assigned_by, note)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(shift_date) DO UPDATE SET
                        admin_user_id = excluded.admin_user_id,
                        assigned_by = excluded.assigned_by,
                        note = excluded.note,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (parsed_day.isoformat(), admin_user_id, row_value(user, "id"), note),
                )
        self.redirect(f"/admin/oncall?month={parsed_day.strftime('%Y-%m')}")

    def create_admin_discount(self) -> None:
        user = self.require_owner_admin()
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
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM discounts WHERE id = ?", (form.get("discount_id"),))
        self.redirect("/admin/discounts")

    def create_admin_tax_fee_rule(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        label = (form.get("label") or "").strip()
        if not label:
            self.redirect("/admin/discounts")
            return
        rule_type = (form.get("rule_type") or "DAILY").strip().upper()
        if rule_type not in {"DAILY", "PERCENT", "FLAT"}:
            rule_type = "DAILY"
        value = max(0.0, float(form.get("value") or 0))
        status = (form.get("status") or "ACTIVE").strip().upper()
        if status not in {"ACTIVE", "INACTIVE"}:
            status = "ACTIVE"
        with db() as con:
            existing = con.execute(
                "SELECT id FROM tax_fee_rules WHERE LOWER(label) = LOWER(?) AND rule_type = ? ORDER BY id LIMIT 1",
                (label, rule_type),
            ).fetchone()
            if existing:
                con.execute(
                    """
                    UPDATE tax_fee_rules
                    SET label = ?, value = ?, status = ?, sort_order = ?
                    WHERE id = ?
                    """,
                    (label, value, status, int(form.get("sort_order") or 0), existing["id"]),
                )
            else:
                con.execute(
                    """
                    INSERT INTO tax_fee_rules
                    (label, rule_type, value, status, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (label, rule_type, value, status, int(form.get("sort_order") or 0)),
                )
        self.redirect("/admin/discounts")

    def delete_admin_tax_fee_rule(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM tax_fee_rules WHERE id = ?", (form.get("rule_id"),))
        self.redirect("/admin/discounts")

    def create_admin_post_return_fee_rule(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        label = (form.get("label") or "").strip()
        if not label:
            self.redirect("/admin/discounts")
            return
        rule_type = (form.get("rule_type") or "FLAT").strip().upper()
        if rule_type not in {"FLAT", "DAILY", "PER_MILE"}:
            rule_type = "FLAT"
        value = max(0.0, float(form.get("value") or 0))
        status = (form.get("status") or "ACTIVE").strip().upper()
        if status not in {"ACTIVE", "INACTIVE"}:
            status = "ACTIVE"
        with db() as con:
            existing = con.execute(
                "SELECT id FROM post_return_fee_rules WHERE LOWER(label) = LOWER(?) AND rule_type = ? ORDER BY id LIMIT 1",
                (label, rule_type),
            ).fetchone()
            if existing:
                con.execute(
                    """
                    UPDATE post_return_fee_rules
                    SET label = ?, value = ?, description = ?, status = ?, sort_order = ?
                    WHERE id = ?
                    """,
                    (label, value, form.get("description", ""), status, int(form.get("sort_order") or 0), existing["id"]),
                )
            else:
                con.execute(
                    """
                    INSERT INTO post_return_fee_rules
                    (label, rule_type, value, description, status, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (label, rule_type, value, form.get("description", ""), status, int(form.get("sort_order") or 0)),
                )
        self.redirect("/admin/discounts")

    def delete_admin_post_return_fee_rule(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM post_return_fee_rules WHERE id = ?", (form.get("rule_id"),))
        self.redirect("/admin/discounts")

    def create_admin_wiki_article(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        title = (form.get("title") or "").strip()[:180]
        subtitle = (form.get("subtitle") or "").strip()[:260]
        body = (form.get("body") or "").strip()[:10000]
        tags = (form.get("tags") or "").strip()[:400]
        visibility = (form.get("visibility") or "PUBLIC").upper()
        if visibility not in {"PUBLIC", "INTERNAL"}:
            visibility = "PUBLIC"
        if not title or not body:
            self.redirect("/admin/wiki")
            return
        with db() as con:
            con.execute(
                """
                INSERT INTO wiki_articles (title, subtitle, body, tags, visibility, status, created_by)
                VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?)
                """,
                (title, subtitle, body, tags, visibility, user["id"]),
            )
        self.redirect("/admin/wiki")

    def delete_admin_wiki_article(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute(
                "UPDATE wiki_articles SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (form.get("article_id"),),
            )
        self.redirect("/admin/wiki")

    def create_admin_commercial(self) -> None:
        user = self.require_owner_admin()
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
        user = self.require_owner_admin()
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
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM commercials WHERE id = ?", (form.get("commercial_id"),))
        self.redirect("/admin/commercials")

    def create_email_campaign(self) -> None:
        user = self.require_owner_admin()
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
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        with db() as con:
            con.execute("DELETE FROM email_campaigns WHERE id = ?", (form.get("campaign_id"),))
        self.redirect("/admin/email-marketing")

    def send_email_campaign_now(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        try:
            campaign_id = int(form.get("campaign_id", "0"))
        except ValueError:
            campaign_id = 0
        result = send_marketing_campaign(campaign_id, self.public_origin())
        notice = f"{result.get('message', 'Marketing send finished.')} Provider: {result.get('delivery_status', 'not attempted')}"
        self.redirect(f"/admin/email-marketing?notice={urllib.parse.quote(str(notice)[:420])}")

    def send_email_campaign_test(self) -> None:
        user = self.require_owner_admin()
        if not user:
            return
        form = self.read_form()
        try:
            campaign_id = int(form.get("campaign_id", "0"))
        except ValueError:
            campaign_id = 0
        result = send_marketing_campaign(campaign_id, self.public_origin(), form.get("test_email", ""))
        notice = f"{result.get('message', 'Marketing test finished.')} Provider: {result.get('delivery_status', 'not attempted')}"
        self.redirect(f"/admin/email-marketing?notice={urllib.parse.quote(str(notice)[:420])}")

    def run_email_automation_endpoint(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        configured_token = os.environ.get("EMAIL_AUTOMATION_TOKEN", "").strip() or os.environ.get("FAIRFARES_CRON_TOKEN", "").strip()
        supplied_token = query.get("token", [""])[0].strip()
        if configured_token:
            if not hmac.compare_digest(configured_token, supplied_token):
                self.send_json({"ok": False, "message": "Invalid automation token."}, 403)
                return
        else:
            user = self.require_owner_admin("/admin/email-marketing")
            if not user:
                return
        result = run_email_automations(self.public_origin())
        self.send_json(result)

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
        body = f"""
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
        self.send_html(inject_google_tag(body).encode("utf-8"))

    def save_pickup_documents(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        booking_id = form.get("booking_id")
        user_id = form.get("user_id")
        pricing_update_booking_id = 0
        def safe_int_field(name: str) -> int:
            try:
                return max(0, int(float(form.get(name, "") or 0)))
            except (TypeError, ValueError):
                return 0

        def safe_money_field(name: str) -> float:
            try:
                return max(0.0, round(float(form.get(name, "") or 0), 2))
            except (TypeError, ValueError):
                return 0.0

        with db() as con:
            booking_public_id = ""
            booking_for_drive = con.execute("SELECT booking_id FROM bookings WHERE id = ?", (booking_id,)).fetchone()
            if booking_for_drive:
                booking_public_id = row_value(booking_for_drive, "booking_id")
            drive_field_values = {
                "front_image_url": upload_data_url_to_drive(
                    con,
                    folder_key="driver_license",
                    file_scope="driver_license_front",
                    data_url=form.get("front_image_url", ""),
                    fallback_name=f"{booking_public_id or booking_id}-dl-front",
                    uploaded_by=row_value(user, "id"),
                    user_id=user_id,
                    booking_id=booking_id,
                ),
                "back_image_url": upload_data_url_to_drive(
                    con,
                    folder_key="driver_license",
                    file_scope="driver_license_back",
                    data_url=form.get("back_image_url", ""),
                    fallback_name=f"{booking_public_id or booking_id}-dl-back",
                    uploaded_by=row_value(user, "id"),
                    user_id=user_id,
                    booking_id=booking_id,
                ),
                "insurance_document_url": upload_data_url_to_drive(
                    con,
                    folder_key="insurance",
                    file_scope="insurance_document",
                    data_url=form.get("insurance_document_url", ""),
                    fallback_name=f"{booking_public_id or booking_id}-insurance",
                    uploaded_by=row_value(user, "id"),
                    user_id=user_id,
                    booking_id=booking_id,
                ),
            }
            for photo_field in (
                "pickup_front_image",
                "pickup_back_image",
                "pickup_left_image",
                "pickup_right_image",
                "return_front_image",
                "return_back_image",
                "return_left_image",
                "return_right_image",
                "pickup_odometer_image",
                "pickup_fuel_image",
                "pickup_interior_front_image",
                "pickup_interior_rear_image",
                "return_odometer_image",
                "return_fuel_image",
                "return_interior_front_image",
                "return_interior_rear_image",
                "damage_photo_image",
            ):
                drive_field_values[photo_field] = upload_data_url_to_drive(
                    con,
                    folder_key="pickup_return",
                    file_scope=photo_field,
                    data_url=form.get(photo_field, ""),
                    fallback_name=f"{booking_public_id or booking_id}-{photo_field}",
                    uploaded_by=row_value(user, "id"),
                    user_id=user_id,
                    booking_id=booking_id,
                )
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
                front_image_url = drive_field_values.get("front_image_url", form.get("front_image_url", ""))
                back_image_url = drive_field_values.get("back_image_url", form.get("back_image_url", ""))
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
                        drive_field_values.get("insurance_document_url", form.get("insurance_document_url", "")),
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
            previous_price_match_state = (
                row_value(booking_for_fees, "price_match_agency"),
                float(row_value(booking_for_fees, "price_match_amount") or 0),
                float(row_value(booking_for_fees, "price_match_discount_amount") or 0),
                float(row_value(booking_for_fees, "total_price") or 0),
            ) if booking_for_fees else ("", 0.0, 0.0, 0.0)
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
            next_price_match_state = (
                form.get("price_match_agency", ""),
                matched_total,
                price_match_discount,
                revised_total,
            )
            if matched_total and previous_price_match_state != next_price_match_state:
                try:
                    pricing_update_booking_id = int(booking_id or 0)
                except (TypeError, ValueError):
                    pricing_update_booking_id = 0
            allowed_return_reviews = {
                "PENDING",
                "CLEAR_TO_RELEASE",
                "CHARGES_PENDING",
                "PARTIAL_CAPTURE_REVIEW",
                "CAPTURE_REVIEW",
                "RELEASED",
                "CLOSED",
            }
            allowed_deposit_statuses = {
                "NOT_AUTHORIZED",
                "AUTHORIZED",
                "RELEASE_READY",
                "RELEASED",
                "PARTIALLY_CAPTURED",
                "CAPTURED",
                "EXPIRED",
                "FAILED",
            }
            return_review_status = (form.get("return_review_status") or "PENDING").strip().upper()
            if return_review_status not in allowed_return_reviews:
                return_review_status = "PENDING"
            security_deposit_status = (form.get("security_deposit_status") or "NOT_AUTHORIZED").strip().upper()
            if security_deposit_status not in allowed_deposit_statuses:
                security_deposit_status = "NOT_AUTHORIZED"
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
                    pickup_odometer = ?,
                    return_odometer = ?,
                    pickup_fuel_level = ?,
                    return_fuel_level = ?,
                    pickup_condition_status = ?,
                    return_condition_status = ?,
                    new_damage_found = ?,
                    pickup_customer_signature = ?,
                    pickup_staff_signature = ?,
                    return_customer_signature = ?,
                    return_staff_signature = ?,
                    return_review_status = ?,
                    security_deposit_status = ?,
                    post_return_charge_amount = ?,
                    post_return_charge_notes = ?,
                    pickup_front_image = ?,
                    pickup_back_image = ?,
                    pickup_left_image = ?,
                    pickup_right_image = ?,
                    pickup_odometer_image = ?,
                    pickup_fuel_image = ?,
                    pickup_interior_front_image = ?,
                    pickup_interior_rear_image = ?,
                    return_front_image = ?,
                    return_back_image = ?,
                    return_left_image = ?,
                    return_right_image = ?,
                    return_odometer_image = ?,
                    return_fuel_image = ?,
                    return_interior_front_image = ?,
                    return_interior_rear_image = ?,
                    damage_photo_image = ?
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
                    safe_int_field("pickup_odometer"),
                    safe_int_field("return_odometer"),
                    form.get("pickup_fuel_level", ""),
                    form.get("return_fuel_level", ""),
                    form.get("pickup_condition_status", "ACCEPTABLE"),
                    form.get("return_condition_status", "PENDING"),
                    form.get("new_damage_found", "NO"),
                    form.get("pickup_customer_signature", ""),
                    form.get("pickup_staff_signature", ""),
                    form.get("return_customer_signature", ""),
                    form.get("return_staff_signature", ""),
                    return_review_status,
                    security_deposit_status,
                    safe_money_field("post_return_charge_amount"),
                    form.get("post_return_charge_notes", ""),
                    drive_field_values.get("pickup_front_image", form.get("pickup_front_image", "")),
                    drive_field_values.get("pickup_back_image", form.get("pickup_back_image", "")),
                    drive_field_values.get("pickup_left_image", form.get("pickup_left_image", "")),
                    drive_field_values.get("pickup_right_image", form.get("pickup_right_image", "")),
                    drive_field_values.get("pickup_odometer_image", form.get("pickup_odometer_image", "")),
                    drive_field_values.get("pickup_fuel_image", form.get("pickup_fuel_image", "")),
                    drive_field_values.get("pickup_interior_front_image", form.get("pickup_interior_front_image", "")),
                    drive_field_values.get("pickup_interior_rear_image", form.get("pickup_interior_rear_image", "")),
                    drive_field_values.get("return_front_image", form.get("return_front_image", "")),
                    drive_field_values.get("return_back_image", form.get("return_back_image", "")),
                    drive_field_values.get("return_left_image", form.get("return_left_image", "")),
                    drive_field_values.get("return_right_image", form.get("return_right_image", "")),
                    drive_field_values.get("return_odometer_image", form.get("return_odometer_image", "")),
                    drive_field_values.get("return_fuel_image", form.get("return_fuel_image", "")),
                    drive_field_values.get("return_interior_front_image", form.get("return_interior_front_image", "")),
                    drive_field_values.get("return_interior_rear_image", form.get("return_interior_rear_image", "")),
                    drive_field_values.get("damage_photo_image", form.get("damage_photo_image", "")),
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
            latest_agreement = con.execute(
                "SELECT * FROM rental_agreements WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                (booking_id,),
            ).fetchone()
            agreement_data = saved_agreement_data(latest_agreement)
            for key in AGREEMENT_FIELD_KEYS:
                field_name = f"agreement_{key}"
                if field_name in form:
                    agreement_data[key] = form.get(field_name, "").strip()
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
        if pricing_update_booking_id:
            updated_booking = get_booking_by_id(pricing_update_booking_id)
            if updated_booking:
                email = row_value(updated_booking, "contact_email")
                if email and "@" in email:
                    send_booking_pricing_update_email(
                        email,
                        row_value(updated_booking, "contact_name") or "FairFares customer",
                        updated_booking,
                        self.public_origin(),
                    )
        self.redirect("/admin/pickup")

    def prefill_pickup_documents(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        fields, missing_fields, message = extract_pickup_prefill_from_images(form)
        self.send_json(
            {
                "ok": True,
                "fields": fields,
                "missing_fields": missing_fields,
                "message": message,
            }
        )

    def run_admin_idscan_check(self) -> None:
        user = self.require_admin()
        if not user:
            return
        form = self.read_form()
        try:
            booking_id = int(form.get("booking_id", "0") or 0)
        except ValueError:
            booking_id = 0
        if not booking_id:
            self.send_json({"ok": False, "status": "FAILED", "message": "Booking is required for IDScan verification."}, 400)
            return
        front_image = form.get("front_image_url", "")
        back_image = form.get("back_image_url", "")
        with db() as con:
            booking = con.execute("SELECT id, user_id FROM bookings WHERE id = ?", (booking_id,)).fetchone()
            if not booking:
                self.send_json({"ok": False, "status": "FAILED", "message": "Booking not found."}, 404)
                return
            license_row = con.execute(
                "SELECT front_image_url, back_image_url FROM driver_licenses WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (booking["user_id"],),
            ).fetchone()
        if license_row:
            front_image = front_image or row_value(license_row, "front_image_url")
            back_image = back_image or row_value(license_row, "back_image_url")
        ok, status, message = run_idscan_verification(
            int(booking["user_id"]),
            int(booking["id"]),
            front_image,
            back_image,
            int(user["id"]),
        )
        self.send_json({"ok": ok, "status": status, "message": message})

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
        inventory_locations = get_inventory_locations()
        user_bookings = get_bookings_for_user(user["id"]) if user else []
        saved_cars = get_saved_cars_for_user(user["id"]) if user else []
        support_tickets = get_support_tickets_for_user(user["id"]) if user else []
        is_first_time_user = bool(user and not user_bookings)
        is_guest_checkout = bool(not user and booking and selected_car_id)
        show_start_experience = bool(user and is_first_time_user and not selected_car_id)
        show_signed_out_empty = bool(not user and not selected_car_id)
        trip_rows = render_user_trip_rows(user_bookings, saved_cars)
        upcoming_count = sum(1 for row in user_bookings if row["booking_status"] not in {"CANCELLED", "RETURNED", "EXPIRED_HOLD"})
        past_count = sum(1 for row in user_bookings if row["booking_status"] in {"CANCELLED", "RETURNED", "EXPIRED_HOLD"})
        live_status = live_status_for_booking(booking)
        default_pickup, default_return = default_trip_dates()
        modify_pickup_date = display_date_to_input(booking["pickup_date"] if booking else "", default_pickup)
        modify_return_date = display_date_to_input(booking["dropoff_date"] if booking else "", default_return)
        current_total_label = format_money(row_value(booking, "total_price")) if booking else "Current booking total"
        no_upgrade_option = f"""
            <label class="upgrade-current">
                <input type="radio" name="vehicle" value="" data-price="0" checked>
                <span><b>No upgrade</b><small>Keep current vehicle and change timing/location only</small></span>
                <strong>{escape(current_total_label)}</strong>
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
        booking_status = row_value(booking, "booking_status") if booking else ""
        hold_pending = booking_status == "PENDING_HOLD"
        hold_expired = booking_status == "EXPIRED_HOLD"
        if is_guest_checkout:
            dashboard_booking_title = "Complete Your Booking"
            dashboard_booking_body = "Review the selected vehicle, confirm your contact details, and complete the payment window to reserve this trip."
        elif show_signed_out_empty:
            dashboard_booking_title = "Start Booking"
            dashboard_booking_body = "Choose a vehicle to begin. Your booking tools will appear here after checkout starts."
        elif show_start_experience:
            dashboard_booking_title = "Start Your First Trip"
            dashboard_booking_body = (
                "No active bookings yet. Search available cars and your trip details will appear here after checkout starts."
            )
        elif hold_expired:
            dashboard_booking_title = "Reservation Expired"
            dashboard_booking_body = "Review the vehicle and choose whether to restart checkout or remove it from your trip."
        elif hold_pending:
            dashboard_booking_title = "Complete Payment"
            dashboard_booking_body = "Complete the required payment before the timer ends to reserve this vehicle."
        elif has_current_booking:
            dashboard_booking_title = "Upcoming Trip"
            dashboard_booking_body = "Your upcoming rental details are ready to review and manage."
        else:
            dashboard_booking_title = "Last Booking"
            dashboard_booking_body = "You do not have an active booking. Your most recent trip details remain available here."
        sidebar_title = "Start Booking" if (show_start_experience or show_signed_out_empty or is_guest_checkout) else "Manage Booking"
        sidebar_primary_label = "Complete Booking" if is_guest_checkout else ("Find Your First Car" if (show_start_experience or show_signed_out_empty) else "Upcoming Trips")
        sidebar_primary_body = (
            "Confirm your contact details to continue this reservation."
            if is_guest_checkout
            else ("Select a vehicle to begin booking." if show_signed_out_empty else ("Search available student deals and create your first booking." if is_first_time_user else "Review and manage your active reservations."))
        )
        booking_link_class = "is-hidden" if (show_start_experience or show_signed_out_empty or is_guest_checkout) else ""
        car_color_class = escape(f"car-{booking['color']}" if booking and booking["color"] else "car-charcoal")
        if booking and booking["image_url"]:
            booking_car_visual = f'<img class="trip-car-image" src="{escape(booking["image_url"])}" alt="{escape(booking["car_name"])}">'
        else:
            booking_car_visual = f'<div class="car-art {car_color_class}"><div class="car-shape"></div></div>'
        active_breakdown = booking_price_breakdown(booking) if booking else booking_price_breakdown(None)
        cancel_refund_amount, cancel_refund_note = booking_refund_estimate(booking)
        trip_payment_summary = ""
        trip_identity_summary = ""
        if booking:
            payment_status = row_value(booking, "payment_status")
            if payment_status == "PAID":
                trip_payment_summary = """
                    <div class="trip-payment-summary is-paid-full">
                        <div><b>Full payment received</b><span>Your pickup balance is $0.00.</span></div>
                    </div>
                """
            elif payment_status == "HOLD_PAID":
                trip_payment_summary = f"""
                    <div class="trip-payment-summary is-hold-paid">
                        <div><b>10% hold received</b><span>Pay the remaining {escape(format_money(active_breakdown["due_at_pickup"]))} for hassle-free pickup.</span></div>
                        <form class="payment-hold-form trip-payment-form" id="paymentHoldForm">
                            <button class="stripe-pay-button full-pay-button" type="submit" name="payment_option" value="full">
                                <span>Pay remaining balance</span>
                            </button>
                        </form>
                    </div>
                """
            elif payment_status == "HOLD_PENDING":
                trip_payment_summary = f"""
                    <div class="trip-payment-summary">
                        <div><b>Payment pending</b><span>{escape(format_money(active_breakdown["booking_hold"]))} due now to hold this booking.</span></div>
                    </div>
                """
            identity_row = latest_identity_verification(int(row_value(user, "id") or 0), int(row_value(booking, "id") or 0)) if user else None
            identity_status = row_value(identity_row, "status") if identity_row else "PENDING"
            identity_title, identity_body = identity_status_copy(identity_status)
            if identity_status != "VERIFIED":
                identity_title = "Identity checked at pickup"
                identity_body = "Staff will start Stripe Identity during pickup before the vehicle is released."
            trip_identity_summary = f"""
                <section class="trip-identity-summary {escape(str(identity_status).lower().replace("_", "-"))}" aria-label="Identity verification">
                    <div>
                        <b>{escape(identity_title)}</b>
                        <span>{escape(identity_body)}</span>
                    </div>
                </section>
            """
        price_breakdown_summary = ""
        if booking:
            price_breakdown_summary = f"""
              <div class="price-breakdown-summary">
                {rental_subtotal_breakdown_html(active_breakdown)}
                {tax_fee_breakdown_html(active_breakdown)}
                <span><b>{escape(format_money(active_breakdown["booking_hold"]))}</b>10% due now</span>
                <span><b>{escape(format_money(active_breakdown["due_at_pickup"]))}</b>Due at pickup</span>
              </div>
            """
        trip_policy_cards = ""
        policy_info_cards = ""
        if booking:
            with db() as con:
                active_insurance = con.execute(
                    "SELECT * FROM insurances WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
                    (booking["id"],),
                ).fetchone()
            insurance_summary = (
                f"{row_value(active_insurance, 'insurance_provider')} - {row_value(active_insurance, 'insurance_type')} - coverage {format_money(row_value(active_insurance, 'coverage_amount'))}"
                if active_insurance
                else "Insurance is reviewed at pickup. Bring proof of personal coverage or choose provider-approved rental coverage when offered."
            )
            cancellation_timeline = cancellation_policy_timeline(booking)
            policy_day_ticks = "".join(
                f"<span>{escape(str(label))}</span>"
                for label in cancellation_timeline["day_ticks"]
            )
            policy_info_cards = f"""
                <section class="checkout-policy-stack trip-policy-stack" aria-label="Rental protection and policies">
                    <article class="checkout-policy-card protection">
                        <div class="policy-card-heading">
                            <span aria-hidden="true">OK</span>
                            <div>
                                <p class="eyebrow">Rental car protection</p>
                                <h3>Feel more secure before pickup.</h3>
                            </div>
                        </div>
                        <ul>
                            <li>If an accident happens, make sure everyone is safe, call emergency services if needed, document photos, collect other driver information, then <a href="#support" data-manage-tab="support" data-support-escalate="accident">create an urgent support ticket</a>.</li>
                            <li><b>Insurance requirement:</b> bring proof of a valid auto policy that extends coverage to rental vehicles. Recommended coverage includes collision, comprehensive, liability, rental vehicle coverage when required, and roadside assistance.</li>
                            <li><b>Coverage on file:</b> {escape(insurance_summary)}</li>
                            <li>FairFares may verify insurance coverage before releasing the vehicle. If your policy does not cover rentals, contact your insurer before completing pickup.</li>
                            <li><a href="/wiki?q=insurance%20requirement">View the full insurance requirement</a>.</li>
                            <li>Out-of-state breakdowns, unauthorized repairs, towing, tire, glass, key, ticket, toll, cleaning, misuse, or damage costs may be your responsibility under the rental agreement.</li>
                        </ul>
                        <button class="policy-see-more" type="button" data-policy-toggle aria-expanded="false">See more</button>
                    </article>
                    <article class="checkout-policy-card">
                        <p class="eyebrow">Cancellation policy</p>
                        <h3>Cancel before pickup when plans change.</h3>
                        <div class="policy-timeline" aria-label="Cancellation timeline">
                            <div class="policy-timeline-labels"><span>Today</span><strong>{escape(str(cancellation_timeline["day_label"]))}</strong><span>Pickup</span></div>
                            <div class="policy-timeline-track">
                                <img class="policy-car-marker" src="/static/img/policy-family-car.png?v={ASSET_VERSION}" alt="" aria-hidden="true">
                                <span class="policy-cutoff-marker" aria-hidden="true"></span>
                            </div>
                            <div class="policy-day-ticks" aria-hidden="true">{policy_day_ticks}<strong>24h</strong></div>
                            <p><b>24-hour cutoff:</b> {escape(str(cancellation_timeline["cutoff_copy"]))}</p>
                        </div>
                        <ul>
                            <li>Use Manage Booking > Cancel Reservation to submit the request.</li>
                            <li>Refund eligibility depends on pickup timing, payment status, provider terms, no-show rules, and discount conditions.</li>
                            <li>Cancellations 24+ hours before pickup can be automatically reviewed; inside 24 hours, admin approval is required.</li>
                            <li>Hold-payment cancellations are not automatically accepted after the 24-hour cutoff.</li>
                        </ul>
                        <button class="policy-see-more" type="button" data-policy-toggle aria-expanded="false">See more</button>
                    </article>
                    <article class="checkout-policy-card">
                        <p class="eyebrow">Rental policies</p>
                        <h3>Driver rules and required documents.</h3>
                        <ul>
                            <li><b>Age restriction:</b> drivers under 25 may need extra review, fees, or provider approval.</li>
                            <li>Bring a valid driver license, payment method, insurance information when required, student verification when using student benefits, and booking confirmation.</li>
                            <li>Only approved drivers listed on the booking or rental agreement may drive the vehicle.</li>
                            <li><a href="/wiki">View FairFares wiki rules and restrictions</a>.</li>
                        </ul>
                        <button class="policy-see-more" type="button" data-policy-toggle aria-expanded="false">See more</button>
                    </article>
                </section>
            """
            trip_policy_cards = policy_info_cards
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
        if booking and (selected_car_id or hold_pending or hold_expired):
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
            hold_paid = bool(row_value(booking, "payment_status") == "HOLD_PAID")
            full_paid = bool(row_value(booking, "payment_status") == "PAID")
            hold_remaining = booking_hold_remaining_label(booking)
            active_discount_amount = float(active_breakdown["discount_amount"] or 0)
            active_discount_code = row_value(booking, "discount_code") if booking else ""
            discount_summary = (
                f'<span class="is-discount"><b>-{escape(format_money(active_discount_amount))}</b>{escape(active_discount_code or "Discount")} applied</span>'
                if active_discount_amount > 0
                else '<span class="is-muted"><b>$0.00</b>No promo discount applied</span>'
            )
            savings_summary = booking_savings_label(booking) if booking else "FairFares pricing is typically around 10% lower than comparable major rental totals."
            hold_decision = ""
            post_hold_full_payment_form = ""
            if hold_expired:
                hold_decision = """
                    <div class="booking-hold-expired-actions">
                        <button type="button" class="select-button" id="continueHoldButton">Restart checkout</button>
                        <button type="button" class="light-button" id="removeHoldButton">Remove</button>
                    </div>
                """
            elif hold_pending:
                hold_decision = f"""
                    <div class="booking-hold-timer" data-hold-seconds="{booking_hold_remaining_seconds(booking)}">
                        <span>Complete payment in</span>
                        <b id="holdCountdown">{escape(hold_remaining)}</b>
                    </div>
                """
            elif hold_paid:
                post_hold_full_payment_form = f"""
                    <form class="payment-hold-form payment-balance-form" id="paymentHoldForm">
                        <button class="stripe-pay-button full-pay-button" type="submit" name="payment_option" value="full">
                            <span>Pay remaining {escape(format_money(active_breakdown["due_at_pickup"]))} for hassle-free pickup.</span>
                            <img src="https://logosmarken.com/wp-content/uploads/2021/03/Stripe-Logo.png" alt="Stripe">
                        </button>
                        <small>Your 10% hold is already paid. Paying the balance now makes pickup faster.</small>
                    </form>
                """
            payment_hold_card = f"""
                <section class="booking-hold-panel {'is-expired' if hold_expired else ''}" id="bookingHoldPanel">
                    <div class="booking-hold-panel-copy">
                        <p class="eyebrow">{'Action needed' if hold_expired else 'Payment window'}</p>
                    <h3>{'Window expired' if hold_expired else 'Choose payment option'}</h3>
                    <p>{'Restart checkout or remove this vehicle.' if hold_expired else 'Pay in full for pickup savings, or hold the booking with 10% due now.'}</p>
                    </div>
                    {hold_decision}
                    <div class="booking-hold-breakdown">
                        {rental_subtotal_breakdown_html(active_breakdown)}
                        {tax_fee_breakdown_html(active_breakdown)}
                        {discount_summary}
                        <span><b>{escape(format_money(active_breakdown["total"]))}</b>Total estimate</span>
                        <span><b id="holdAmountLabel">{escape(format_money(active_breakdown["booking_hold"]))}</b>Due now</span>
                        <span><b id="dueAtPickupLabel">{escape(format_money(active_breakdown["due_at_pickup"]))}</b>Due at pickup</span>
                    </div>
                    <p class="checkout-savings-note">{escape(savings_summary)}</p>
                    {'<p class="payment-hold-paid">10% hold received. Your pickup balance is updated.</p>' if hold_paid else ''}
                    {'<p class="payment-hold-paid">Full payment received. Your pickup balance is $0.00.</p>' if full_paid else ''}
                    {post_hold_full_payment_form}
                    <form class="payment-hold-form" id="{'paymentHoldFormInactive' if hold_paid else 'paymentHoldForm'}"{' hidden' if (is_guest_checkout or hold_paid or full_paid or hold_expired) else ''}>
                        <button class="stripe-pay-button full-pay-button" type="submit" name="payment_option" value="full">
                            <span>Pay in full and save $10. Enjoy faster, hassle-free pickup.</span>
                            <img src="https://logosmarken.com/wp-content/uploads/2021/03/Stripe-Logo.png" alt="Stripe">
                        </button>
                        <button class="stripe-pay-button" type="submit" name="payment_option" value="hold">
                            <span>Pay 10% now to hold your booking. Balance due at pickup.</span>
                            <img src="https://logosmarken.com/wp-content/uploads/2021/03/Stripe-Logo.png" alt="Stripe">
                        </button>
                        <small>Card details are handled by Stripe. FairFares stores only the payment status and receipt reference.</small>
                    </form>
                    {'<p class="guest-booking-note">Save your contact details first, then sign in or create an account to pay.</p>' if is_guest_checkout else ''}
                    <p class="modify-status" id="paymentHoldStatus" aria-live="polite"></p>
                </section>
            """
            booking_summary_heading = "Review booking" if hold_expired else ("Review booking" if hold_pending else "Booking confirmed")
            booking_summary_copy = (
                "Confirm details before choosing the next step."
                if hold_expired
                else "Save contact details and complete the 10% hold."
                if hold_pending
                else "Vehicle, dates, documents, and payment status are saved here."
            )
            booking_confirmation_card = f"""
            <div class="checkout-finalize-heading" id="checkoutFinalizeHeading">
                <p class="eyebrow">Checkout</p>
                <h2>{'Review trip' if hold_expired else "Finalize trip"}</h2>
            </div>
            <section class="booking-confirmation-card {'is-expired-checkout' if hold_expired else ''}" id="bookingConfirmation">
                <div class="booking-confirmation-intro">
                    <p class="eyebrow">{escape(booking_status_label(row_value(booking, "booking_status"), row_value(booking, "payment_status")))}</p>
                    <h2>{booking_summary_heading}</h2>
                    <p>{booking_summary_copy}</p>
                    {guest_account_note}
                </div>
                {payment_hold_card}
                {trip_identity_summary}
                {policy_info_cards}
                <form class="customer-info-form" id="customerInfoForm"{submit_endpoint_hint}>
                    <h3>Your information</h3>
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
                    <img class="guest-offer-logo" src="/static/img/fairfares-glow-logo.png" alt="FairFares logo">
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
            trip_policy_cards = ""
        request_notice = ""
        if booking and booking["booking_status"] in {"MODIFIED", "CANCELLATION_REQUESTED"}:
            label = "Modification request" if booking["booking_status"] == "MODIFIED" else "Cancellation request"
            request_notice = f"""
            <div class="request-notice" id="requestNotice">
                <div><b>{escape(label)} sent to admin</b><span>{escape(row_value(booking, "cancellation_reason") or "Admin review pending.")}</span></div>
                <button class="light-button" type="button" id="cancelPendingRequest">Cancel Request</button>
            </div>
            """
        support_ticket_message, support_history = render_support_history(
            support_tickets,
            int(row_value(booking, "id") or 0) if booking else None,
        )
        support_provider_summary = (
            f"{row_value(booking, 'provider') or 'Provider'} pickup support for {row_value(booking, 'pickup_location') or 'your pickup location'}."
            if booking
            else "Provider contact details appear after a booking is selected."
        )
        signed_out_auth = f'<a class="user-chip" href="/login">{user_avatar_span(None)}<b>Sign in</b><small>Join FairFares</small></a><a href="/login">Sign in / Join</a>'
        booking_id_label = public_booking_id_label(booking)
        body = render_template(
            "dashboard.html",
            name=escape(user["name"] if user else "FairFares Member"),
            role="Admin" if user and user["is_admin"] else "Student",
            admin_panel=admin_panel,
            manage_auth=(
                f'<a class="user-chip" href="/dashboard">{user_avatar_span(user)}<b>Hi, {escape(user["name"])}</b><small>Student</small></a><a href="/logout">Log out</a>'
                if user
                else signed_out_auth
            ),
            booking_id=escape(booking_id_label),
            dashboard_booking_title=escape(dashboard_booking_title),
            dashboard_booking_body=escape(dashboard_booking_body),
            sidebar_title=escape(sidebar_title),
            sidebar_primary_label=escape(sidebar_primary_label),
            sidebar_primary_body=escape(sidebar_primary_body),
            manage_flow_class="manage-checkout-screen" if booking_confirmation_card else "",
            booking_link_class=booking_link_class,
            first_booking_promo=first_booking_promo,
            booking_confirmation_card=booking_confirmation_card,
            trip_policy_cards=trip_policy_cards,
            request_notice=request_notice,
            trip_payment_summary=trip_payment_summary,
            trip_card_class="trip-card" if booking else "trip-card is-hidden",
            booking_car_visual=booking_car_visual,
            first_time_manage_content=first_time_manage_content,
            support_ticket_message=support_ticket_message,
            support_history=support_history,
            support_provider_summary=escape(support_provider_summary),
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
            price_text=escape(format_money(active_breakdown["total"]) if booking else "$0.00"),
            cancel_refund_amount=escape(format_money(cancel_refund_amount)),
            cancel_refund_note=escape(cancel_refund_note),
            price_breakdown_summary=price_breakdown_summary,
            savings_label=escape(booking_savings_label(booking) if booking else ""),
            price_match_note=escape(booking_savings_explainer(booking) if booking else ""),
            status=escape(booking_status_label(booking["booking_status"], booking["payment_status"]) if booking else "NO BOOKING"),
            status_class=escape(booking_status_class(booking["booking_status"]) if booking else "status-muted"),
            upgrade_options=upgrade_options,
            upgrade_select_options=upgrade_select_options,
            current_vehicle=escape(current_car_name),
            modify_pickup_date=escape(modify_pickup_date),
            modify_return_date=escape(modify_return_date),
            modify_pickup_location_options=select_options(inventory_locations, booking["pickup_location"] if booking else ""),
            modify_dropoff_location_options=select_options(inventory_locations, booking["dropoff_location"] if booking else ""),
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
        user = self.require_owner_admin()
        if not user:
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
    log_explorer_config_status()
    init_db()
    auto_backup_on_startup()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), FairFaresHandler)
    print(f"FairFares running at http://{host}:{port}")
    server.serve_forever()
