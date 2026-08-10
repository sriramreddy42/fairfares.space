#!/usr/bin/env python3
"""Run the FairFares k6 workload against an isolated, populated local database."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "k6" / "fairfares.js"
PROFILE_USERS = {"smoke": 10, "normal": 50, "100": 100, "medium": 250, "high": 500, "cold250": 250, "cold500": 500, "stress": 1000, "spike": 500}
PASSWORD = "FairFaresK6!"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=PROFILE_USERS)
    parser.add_argument("--k6", default=os.environ.get("K6_BIN", "k6"))
    parser.add_argument("--summary", type=Path)
    return parser.parse_args()


def main():
    args = parse_args()
    users = PROFILE_USERS[args.profile]
    with tempfile.TemporaryDirectory(prefix="fairfares-k6-") as temp_name:
        temp = Path(temp_name)
        os.environ.update({
            "FAIRFARES_DB_PATH": str(temp / "fairfares.sqlite3"),
            "FAIRFARES_BACKUP_DIR": str(temp / "backups"),
            "FAIRFARES_SEED_DEFAULTS": "1", "RESEND_API_KEY": "", "SMTP_HOST": "",
            "GOOGLE_PLACES_API_KEY": "", "GOOGLE_MAPS_API_KEY": "", "EXPO_ACCESS_TOKEN": "",
        })
        sys.path.insert(0, str(ROOT))
        import app

        class QuietHandler(app.FairFaresHandler):
            def log_message(self, _format, *_args):
                return

        app.OUTBOX_DIR = temp / "outbox"
        app.refresh_storage_paths()
        app.init_db()
        password_hash = app.hash_password(PASSWORD)
        pickup = (date.today() + timedelta(days=14)).isoformat()
        with app.db() as con:
            con.executemany(
                "INSERT INTO users (name,email,phone,password_hash,is_verified,verified_at) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)",
                [(f"K6 User {i:04d}", f"k6.user.{i:04d}@example.test", f"72055{i:05d}", password_hash) for i in range(1, users + 1)],
            )
            ids = [row[0] for row in con.execute("SELECT id FROM users WHERE email LIKE 'k6.user.%@example.test' ORDER BY id")]
            con.executemany(
                """INSERT INTO accommodation_posts
                (public_id,user_id,post_mode,category,title,description,city,primary_neighborhood,area_or_apartment,
                 move_in_date,rent_min,rent_max,contact_name,contact_email,visibility_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE')""",
                [(f"K6H-{i:05d}", uid, "HAVE_PLACE" if i % 2 else "NEED_PLACE", "single_room",
                  f"K6 Denver housing {i}", "Populated load-test listing", "Denver, CO", "Capitol Hill", "Capitol Hill",
                  pickup, 850 + i % 300, 1200 + i % 400, f"K6 User {i:04d}", f"k6.user.{i:04d}@example.test")
                 for i, uid in enumerate(ids[: min(users, 500)], 1)],
            )
            con.executemany(
                """INSERT INTO ride_posts
                (public_id,user_id,ride_type,rider_role,title,origin_label,origin_lat,origin_lng,destination_label,
                 destination_lat,destination_lng,city_label,pickup_date,pickup_time,seats,status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE')""",
                [(f"K6R-{i:05d}", uid, "CARPOOL_OFFER", "DRIVER", f"K6 ride {i}", "Denver, CO", 39.7392, -104.9903,
                  "Colorado Springs, CO", 38.8339, -104.8214, "Denver, CO", pickup, "8:00 AM", 3)
                 for i, uid in enumerate(ids[: min(users, 500)], 1)],
            )
            for city in ("Denver, CO", "St. Louis, MO", "Menlo Park, CA", "Miami, FL"):
                con.execute(
                    "INSERT INTO chat_communities (public_id,name,description,area_label,visibility,created_by_user_id) VALUES (?,?,?,?, 'PUBLIC', ?)",
                    (f"K6C-{uuid.uuid4().hex[:12]}", f"{city.split(',')[0]} Community", "Public load-test community", city, ids[0]),
                )
            assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

        server = app.FairFaresHTTPServer(("127.0.0.1", 0), QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        summary = args.summary or (ROOT / "artifacts" / "k6" / f"{args.profile}.json")
        summary.parent.mkdir(parents=True, exist_ok=True)
        command = [args.k6, "run", "--summary-export", str(summary), "-e", f"PROFILE={args.profile}",
                   "-e", f"BASE_URL=http://127.0.0.1:{server.server_port}", str(SCRIPT)]
        print(json.dumps({"profile": args.profile, "users": users, "baseUrl": f"http://127.0.0.1:{server.server_port}", "summary": str(summary)}))
        try:
            result = subprocess.run(command, cwd=ROOT, check=False)
            return result.returncode
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            app.refresh_storage_paths()


if __name__ == "__main__":
    raise SystemExit(main())
