#!/usr/bin/env python3
"""Seed an isolated local database for People discovery visual testing.

It never accepts the normal production database path. The viewer is
``Avery Park`` (avery@demo.fairfares.test) with password
``FairFaresDemo!2026``. The pool deliberately contains local, mutual,
community, relocation, and unrelated members.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import random
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/private/tmp/fairfares-people-pool.sqlite3")
    args = parser.parse_args()
    db_path = Path(args.db).expanduser().resolve()
    if "people-pool" not in db_path.name:
        raise SystemExit("Refusing to seed a database that is not explicitly named *people-pool*.")

    os.environ["FAIRFARES_DB_PATH"] = str(db_path)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import app  # Imported only after the isolated database path is set.

    app.init_db()
    password_hash = app.hash_password("FairFaresDemo!2026")
    users = [
        # The signed-in viewer.
        ("Avery Park", "avery@demo.fairfares.test", "Denver, CO", "Viewer", "", "", 0, 0),
        # Direct connections create mutual paths but are never suggested themselves.
        ("Jordan Miles", "jordan@demo.fairfares.test", "Denver, CO", "Capitol Hill", "", "", 0, 0),
        ("Nia Brooks", "nia@demo.fairfares.test", "Denver, CO", "Five Points", "", "", 0, 0),
        # Expected high-signal suggestions: two and one mutual connections.
        ("Maya Patel", "maya@demo.fairfares.test", "Denver, CO", "RiNo", "", "", 0, 0),
        ("Owen Carter", "owen@demo.fairfares.test", "Denver, CO", "Capitol Hill", "", "", 0, 0),
        # Same-city / college-community suggestions.
        ("Sofia Nguyen", "sofia@demo.fairfares.test", "Denver, CO", "University of Denver", "", "", 0, 0),
        ("Eli Thompson", "eli@demo.fairfares.test", "Denver, CO", "University of Denver", "", "", 0, 0),
        ("Camila Reyes", "camila@demo.fairfares.test", "Denver, CO", "Cherry Creek", "", "", 0, 0),
        ("Noah Kim", "noah@demo.fairfares.test", "Denver, CO", "Highland", "", "", 0, 0),
        ("Zoe Martin", "zoe@demo.fairfares.test", "Denver, CO", "Auraria", "", "", 0, 0),
        ("Leo Grant", "leo@demo.fairfares.test", "Denver, CO", "Baker", "", "", 0, 0),
        ("Aisha Bell", "aisha@demo.fairfares.test", "Denver, CO", "Washington Park", "", "", 0, 0),
        # Austin locals and movers appear only after Avery chooses Austin.
        ("Harper Jones", "harper@demo.fairfares.test", "Austin, TX", "South Congress", "", "", 0, 1),
        ("Diego Flores", "diego@demo.fairfares.test", "Austin, TX", "East Austin", "", "", 0, 1),
        ("Ravi Shah", "ravi@demo.fairfares.test", "Denver, CO", "", "Austin, TX", "Acme Labs", 1, 0),
        ("Lena Walker", "lena@demo.fairfares.test", "Chicago, IL", "", "Austin, TX", "Acme Labs", 1, 0),
        ("Grace Liu", "grace@demo.fairfares.test", "Seattle, WA", "", "Austin, TX", "University of Texas", 1, 0),
        ("Marcus Hill", "marcus@demo.fairfares.test", "Denver, CO", "", "Austin, TX", "", 1, 0),
        # Unrelated cities must not appear in the initial suggestion list.
        ("Priya Desai", "priya@demo.fairfares.test", "Houston, TX", "Medical Center", "", "", 0, 0),
        ("Ben Foster", "ben@demo.fairfares.test", "Boston, MA", "Cambridge", "", "", 0, 0),
        ("Isabel Cruz", "isabel@demo.fairfares.test", "Phoenix, AZ", "Tempe", "", "", 0, 0),
        ("Theo Adams", "theo@demo.fairfares.test", "New York, NY", "Queens", "", "", 0, 0),
        ("Meera Iyer", "meera@demo.fairfares.test", "Dallas, TX", "Irving", "", "", 0, 0),
        ("Caleb Moore", "caleb@demo.fairfares.test", "San Diego, CA", "La Jolla", "", "", 0, 0),
    ]
    # These mutuals create a varied, easy-to-read first map view for Avery.
    # Each value is a city-level location, never a street address.
    map_showcase = [
        ("Anika Rao", "anika-rao@demo.fairfares.test", "Aurora, CO", "Stanley Marketplace"),
        ("Carlos Vega", "carlos-vega@demo.fairfares.test", "Centennial, CO", "The Streets at SouthGlenn"),
        ("Devon Lee", "devon-lee@demo.fairfares.test", "Thornton, CO", "Eastlake"),
        ("Farah Khan", "farah-khan@demo.fairfares.test", "Lakewood, CO", "Belmar"),
        ("Gabe Turner", "gabe-turner@demo.fairfares.test", "Arvada, CO", "Olde Town"),
        ("Hana Cho", "hana-cho@demo.fairfares.test", "Englewood, CO", "South Broadway"),
        ("Ishan Patel", "ishan-patel@demo.fairfares.test", "Littleton, CO", "Downtown Littleton"),
        ("Jules Martin", "jules-martin@demo.fairfares.test", "Westminster, CO", "Orchard Town Center"),
        ("Kira Evans", "kira-evans@demo.fairfares.test", "Broomfield, CO", "FlatIron Crossing"),
        ("Luis Romero", "luis-romero@demo.fairfares.test", "Commerce City, CO", "Prairie Center"),
    ]
    users.extend((name, email, city, area, "", "", 0, 1) for name, email, city, area in map_showcase)

    # A dense but deterministic metro pool lets us test map grouping and
    # performance with realistic city distribution. These are synthetic
    # accounts in the isolated *people-pool* database only.
    metro_places = [
        ("Denver, CO", "RiNo"), ("Denver, CO", "Capitol Hill"), ("Denver, CO", "Cherry Creek"),
        ("Aurora, CO", "Central Aurora"), ("Centennial, CO", "DTC"), ("Thornton, CO", "North Creek"),
        ("Lakewood, CO", "Belmar"), ("Arvada, CO", "Olde Town"), ("Englewood, CO", "South Broadway"),
        ("Littleton, CO", "Historic Downtown"), ("Westminster, CO", "Bradburn"), ("Broomfield, CO", "Interlocken"),
        ("Golden, CO", "Colorado School of Mines"), ("Northglenn, CO", "Webster Lake"), ("Parker, CO", "Mainstreet"),
    ]
    first_names = ("Aiden", "Amara", "Arjun", "Brielle", "Cameron", "Dalia", "Emery", "Fatima", "Gianna", "Harish", "Imani", "Jonah", "Keira", "Levi", "Mina", "Nolan", "Olivia", "Parker", "Rohan", "Sana")
    last_names = ("Adams", "Bennett", "Chaudhary", "Diaz", "Ellis", "Fischer", "Gupta", "Hughes", "Ibrahim", "Johnson", "Kim", "Lopez", "Morgan", "Nguyen", "Ortiz", "Price", "Quinn", "Reed", "Singh", "Taylor")
    organizations = ("Acme Labs", "Google", "UCHealth", "Lockheed Martin", "University of Denver", "CU Denver", "Colorado School of Mines")
    schools = {"University of Denver", "CU Denver", "Colorado School of Mines"}
    randomizer = random.Random(20261103)
    while len(users) < 1000:
        member_number = len(users) + 1
        city, neighborhood = randomizer.choice(metro_places)
        name = f"{randomizer.choice(first_names)} {randomizer.choice(last_names)} {member_number}"
        organization = randomizer.choice(organizations) if randomizer.random() < .52 else ""
        users.append((
            name,
            f"metro-member-{member_number:04d}@demo.fairfares.test",
            city,
            neighborhood,
            "",
            organization,
            0,
            1,
        ))

    with app.db() as con:
        existing = con.execute("SELECT id FROM users WHERE email LIKE '%@demo.fairfares.test'").fetchall()
        existing_ids = [int(row["id"]) for row in existing]
        if existing_ids:
            marks = ",".join("?" for _ in existing_ids)
            # The simulator can create analytics and location-observation rows while
            # exercising the pool. Clear every demo-owned child row before reseeding.
            con.execute(f"DELETE FROM product_analytics_events WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM user_location_stays WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM chat_device_keys WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM chat_key_backups WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM mobile_push_tokens WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM mobile_notification_preferences WHERE user_id IN ({marks})", existing_ids)
            con.execute(
                f"DELETE FROM member_suggestion_feedback WHERE viewer_user_id IN ({marks}) OR suggested_user_id IN ({marks})",
                (*existing_ids, *existing_ids),
            )
            con.execute(f"DELETE FROM member_connections WHERE user_low_id IN ({marks}) OR user_high_id IN ({marks})", (*existing_ids, *existing_ids))
            con.execute(f"DELETE FROM chat_community_members WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM user_ratings WHERE reviewer_user_id IN ({marks}) OR reviewed_user_id IN ({marks})", (*existing_ids, *existing_ids))
            con.execute(f"DELETE FROM sessions WHERE user_id IN ({marks})", existing_ids)
            con.execute(f"DELETE FROM users WHERE id IN ({marks})", existing_ids)
        for public_id in ("DEMO-DENVER-NEW", "DEMO-DU-CAMPUS"):
            con.execute("DELETE FROM chat_communities WHERE public_id = ?", (public_id,))

        ids: dict[str, int] = {}
        for member_number, (name, email, city, neighborhood, relocation_city, organization, moving, local_helper) in enumerate(users, start=1):
            reason = "SCHOOL_COLLEGE" if organization in schools else "NEW_JOB" if organization else ""
            con.execute(
                """INSERT INTO users
                   (name, email, phone, phone_verified_at, password_hash, is_verified, verified_at, consented_at,
                    terms_version, privacy_version, community_guidelines_version, local_city,
                    address, relocation_city, relocation_month, relocation_company,
                    relocation_reason, relocation_discoverable, local_connection_discoverable,
                    people_discoverable, people_discovery_configured, avatar_mode, avatar_seed)
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?,
                           '2026-12', ?, ?, ?, ?, 1, 1, 'DICEBEAR', ?)""",
                (
                    name, email, f"+1555000{member_number:04d}", password_hash, app.TERMS_VERSION, app.PRIVACY_VERSION,
                    app.COMMUNITY_GUIDELINES_VERSION, city, neighborhood, relocation_city,
                    organization, reason, moving, local_helper, name,
                ),
            )
            ids[email] = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])

        communities = [
            ("DEMO-DENVER-NEW", "Denver Newcomers", "A local demo community", "Denver, CO"),
            ("DEMO-DU-CAMPUS", "University of Denver", "A local demo campus community", "Denver, CO"),
        ]
        community_ids: dict[str, int] = {}
        for public_id, name, description, area in communities:
            con.execute("INSERT INTO chat_communities (public_id, name, description, area_label, visibility) VALUES (?, ?, ?, ?, 'PUBLIC')", (public_id, name, description, area))
            community_ids[public_id] = int(con.execute("SELECT last_insert_rowid()").fetchone()[0])

        def join(public_id: str, *emails: str) -> None:
            for email in emails:
                con.execute("INSERT INTO chat_community_members (community_id, user_id) VALUES (?, ?)", (community_ids[public_id], ids[email]))

        join("DEMO-DENVER-NEW", "avery@demo.fairfares.test", "maya@demo.fairfares.test", "owen@demo.fairfares.test", "camila@demo.fairfares.test", "zoe@demo.fairfares.test")
        join("DEMO-DU-CAMPUS", "avery@demo.fairfares.test", "sofia@demo.fairfares.test", "eli@demo.fairfares.test", "maya@demo.fairfares.test")

        def connect(left: str, right: str) -> None:
            low, high = sorted((ids[left], ids[right]))
            con.execute(
                "INSERT INTO member_connections (user_low_id, user_high_id, requested_by_user_id, status) VALUES (?, ?, ?, 'ACCEPTED')",
                (low, high, ids[left]),
            )

        connect("avery@demo.fairfares.test", "jordan@demo.fairfares.test")
        connect("avery@demo.fairfares.test", "nia@demo.fairfares.test")
        connect("jordan@demo.fairfares.test", "maya@demo.fairfares.test")
        connect("nia@demo.fairfares.test", "maya@demo.fairfares.test")
        connect("jordan@demo.fairfares.test", "owen@demo.fairfares.test")
        for _name, email, _city, _area in map_showcase:
            connect("jordan@demo.fairfares.test", email)

        for email, score, comment in (
            ("maya@demo.fairfares.test", 5, "Helpful move-in advice."),
            ("sofia@demo.fairfares.test", 5, "Great campus resource."),
            ("owen@demo.fairfares.test", 4, "Responsive and kind."),
        ):
            con.execute(
                "INSERT INTO user_ratings (reviewer_user_id, reviewed_user_id, score, comment) VALUES (?, ?, ?, ?)",
                (ids["avery@demo.fairfares.test"], ids[email], score, comment),
            )
        con.execute("INSERT INTO sessions (token, user_id) VALUES ('demo-avery-session', ?)", (ids["avery@demo.fairfares.test"],))

    print(f"Seeded {len(users)} local demo users in {db_path}")
    print(f"Map showcase: {len(map_showcase)} mutuals across the Denver metro")
    print("Viewer: avery@demo.fairfares.test / FairFaresDemo!2026")
    print("Session token: demo-avery-session")


if __name__ == "__main__":
    main()
