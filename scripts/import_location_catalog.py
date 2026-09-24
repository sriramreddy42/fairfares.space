#!/usr/bin/env python3
"""Import GeoNames US/India cities and neighborhoods into FairFares.

The importer downloads database dumps only when it is explicitly run. The
application performs no GeoNames or Google request while members search.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

GEONAMES_BASE = "https://download.geonames.org/export/dump"
SUPPORTED_COUNTRIES = {"US", "IN"}
IMPORT_VERSION = 4
MIN_CITY_POPULATION = 100
CITY_CODES = {
    "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC",
    "PPLG", "PPLL", "PPLR", "PPLS",
}
NEIGHBORHOOD_CODES = {"PPLX"}
POI_TYPES = {
    "AIRP": "AIRPORT",
    "AIRT": "AIRPORT",
    "BUSTN": "TRANSIT",
    "FYT": "TRANSIT",
    "MTRO": "TRANSIT",
    "RSTN": "TRANSIT",
    "RSTP": "TRANSIT",
    "TRANT": "TRANSIT",
    "UNIV": "UNIVERSITY",
    "SCHC": "UNIVERSITY",
    "SCH": "UNIVERSITY",
    "MALL": "MALL",
    "HSP": "HOSPITAL",
    "CTRM": "HOSPITAL",
}


def download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        print(f"Downloading {url}")
        with urllib.request.urlopen(url, timeout=120) as response, destination.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    return destination


def admin1_names(cache_dir: Path) -> dict[str, str]:
    path = download(f"{GEONAMES_BASE}/admin1CodesASCII.txt", cache_dir / "admin1CodesASCII.txt")
    names: dict[str, str] = {}
    with path.open(encoding="utf-8") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t")
            if len(fields) >= 2:
                names[fields[0]] = fields[1]
    return names


def normalized_search(*values: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", " ".join(values).casefold()).split())


def import_country(con, country: str, archive: Path, states: dict[str, str]) -> tuple[int, int]:
    inserted = 0
    skipped = 0
    batch: list[tuple[object, ...]] = []
    with zipfile.ZipFile(archive) as bundle:
        member = next((name for name in bundle.namelist() if name.upper().endswith(f"{country}.TXT")), "")
        if not member:
            raise RuntimeError(f"{archive} does not contain {country}.txt")
        with bundle.open(member) as raw:
            for encoded in raw:
                fields = encoded.decode("utf-8", "replace").rstrip("\n").split("\t")
                if len(fields) < 19 or fields[6] not in {"P", "S"}:
                    continue
                feature_code = fields[7].strip().upper()
                if feature_code not in CITY_CODES | NEIGHBORHOOD_CODES | POI_TYPES.keys():
                    continue
                geoname_id, name, ascii_name, aliases = fields[0], fields[1], fields[2], fields[3]
                # GeoNames uses SCH for everything from elementary schools to
                # universities. Keep higher-education campuses while excluding
                # the much larger K-12 set from location autocomplete.
                if feature_code == "SCH":
                    school_name = f"{name} {ascii_name}"
                    if not re.search(
                        r"\b(?:university|college|institute of technology|polytechnic)\b",
                        school_name,
                        re.IGNORECASE,
                    ) or (
                        re.search(r"\b(?:academy|school)\b", school_name, re.IGNORECASE)
                        and not re.search(r"\buniversity\b", school_name, re.IGNORECASE)
                    ):
                        continue
                try:
                    lat, lng = float(fields[4]), float(fields[5])
                    population = max(0, int(fields[14] or 0))
                except ValueError:
                    skipped += 1
                    continue
                # GeoNames country dumps contain hundreds of thousands of
                # zero-population hamlets, especially for India. They make the
                # SQLite file several hundred MB larger without improving the
                # city/neighborhood/POI search experience. Keep administrative
                # capitals regardless of population and retain ordinary
                # settlements once GeoNames records at least 100 residents.
                if (
                    feature_code in CITY_CODES
                    and feature_code not in {"PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5"}
                    and population < MIN_CITY_POPULATION
                ):
                    skipped += 1
                    continue
                admin1_code = fields[10].strip()
                admin1_name = states.get(f"{country}.{admin1_code}", "")
                location_type = (
                    "NEIGHBORHOOD" if feature_code in NEIGHBORHOOD_CODES
                    else POI_TYPES.get(feature_code, "CITY")
                )
                city_name = name if location_type == "CITY" else ""
                display_state = admin1_code if country == "US" else admin1_name or admin1_code
                search_name = normalized_search(name, display_state, country, ascii_name, aliases[:1000])
                batch.append((
                    "GEONAMES", geoname_id, country, admin1_code, admin1_name, "", city_name,
                    name, ascii_name, aliases[:1000], feature_code, location_type, lat, lng,
                    population, search_name,
                ))
                if len(batch) >= 2000:
                    con.executemany(UPSERT, batch)
                    inserted += len(batch)
                    batch.clear()
        if batch:
            con.executemany(UPSERT, batch)
            inserted += len(batch)
    return inserted, skipped


def rebuild_poi_aliases(con, country: str) -> int:
    """Index short names and transport codes without scanning alias blobs."""
    con.execute(
        "DELETE FROM location_catalog_aliases WHERE location_id IN (SELECT id FROM location_catalog WHERE source = 'GEONAMES' AND country_code = ?)",
        (country,),
    )
    rows = con.execute(
        """
        SELECT id, name, ascii_name, alternate_names
        FROM location_catalog
        WHERE source = 'GEONAMES' AND country_code = ?
          AND location_type NOT IN ('CITY', 'NEIGHBORHOOD')
        """,
        (country,),
    ).fetchall()
    batch: list[tuple[int, str, str]] = []
    for row in rows:
        canonical = {normalized_search(str(row[1] or "")), normalized_search(str(row[2] or ""))}
        seen: set[str] = set()
        for alias in str(row[3] or "").split(","):
            label = alias.strip()
            normalized = normalized_search(label)
            if (
                len(normalized) < 2
                or len(normalized) > 100
                or normalized in canonical
                or normalized in seen
                or "://" in label
            ):
                continue
            seen.add(normalized)
            batch.append((int(row[0]), normalized, label[:120]))
            if len(batch) >= 2000:
                con.executemany(
                    "INSERT OR IGNORE INTO location_catalog_aliases (location_id, alias_search, alias_label) VALUES (?, ?, ?)",
                    batch,
                )
                batch.clear()
    if batch:
        con.executemany(
            "INSERT OR IGNORE INTO location_catalog_aliases (location_id, alias_search, alias_label) VALUES (?, ?, ?)",
            batch,
        )
    return int(con.execute(
        "SELECT COUNT(*) FROM location_catalog_aliases alias JOIN location_catalog place ON place.id = alias.location_id WHERE place.country_code = ?",
        (country,),
    ).fetchone()[0])


UPSERT = """
    INSERT INTO location_catalog
        (source, external_id, country_code, admin1_code, admin1_name, admin2_name,
         city_name, name, ascii_name, alternate_names, feature_code, location_type,
         lat, lng, population, search_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
        country_code = excluded.country_code,
        admin1_code = excluded.admin1_code,
        admin1_name = excluded.admin1_name,
        city_name = excluded.city_name,
        name = excluded.name,
        ascii_name = excluded.ascii_name,
        alternate_names = excluded.alternate_names,
        feature_code = excluded.feature_code,
        location_type = excluded.location_type,
        lat = excluded.lat,
        lng = excluded.lng,
        population = excluded.population,
        search_name = excluded.search_name,
        updated_at = CURRENT_TIMESTAMP
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--countries", nargs="+", default=["US", "IN"])
    parser.add_argument("--cache-dir", type=Path, default=Path("/tmp/fairfares-geonames"))
    parser.add_argument("--db-path", type=Path)
    parser.add_argument(
        "--if-needed",
        action="store_true",
        help="skip countries that already contain at least 1,000 catalogue rows",
    )
    args = parser.parse_args()
    countries = [country.upper() for country in args.countries]
    unsupported = set(countries) - SUPPORTED_COUNTRIES
    if unsupported:
        parser.error(f"unsupported countries: {', '.join(sorted(unsupported))}")
    if args.db_path:
        os.environ["FAIRFARES_DB_PATH"] = str(args.db_path.resolve())

    import app

    app.refresh_storage_paths()
    app.init_db()
    if args.if_needed:
        with app.db() as con:
            imported_versions = {
                str(row[0]): int(row[1])
                for row in con.execute(
                    "SELECT country_code, import_version FROM location_catalog_imports WHERE source = 'GEONAMES'"
                ).fetchall()
            }
        countries = [country for country in countries if imported_versions.get(country, 0) < IMPORT_VERSION]
        if not countries:
            print("Location catalogue already populated; skipping import")
            return 0
    states = admin1_names(args.cache_dir)
    for country in countries:
        # Commit each country independently. This bounds SQLite rollback space
        # on Render's 1 GB persistent disk and preserves the prior country
        # catalogue if a download or import fails.
        with app.db() as con:
            archive = download(f"{GEONAMES_BASE}/{country}.zip", args.cache_dir / f"{country}.zip")
            con.execute(
                "DELETE FROM location_catalog WHERE source = 'GEONAMES' AND country_code = ?",
                (country,),
            )
            inserted, skipped = import_country(con, country, archive, states)
            alias_count = rebuild_poi_aliases(con, country)
            record_count = int(con.execute(
                "SELECT COUNT(*) FROM location_catalog WHERE source = 'GEONAMES' AND country_code = ?",
                (country,),
            ).fetchone()[0])
            con.execute(
                """
                INSERT INTO location_catalog_imports (source, country_code, import_version, record_count, imported_at)
                VALUES ('GEONAMES', ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(source, country_code) DO UPDATE SET
                    import_version = excluded.import_version,
                    record_count = excluded.record_count,
                    imported_at = CURRENT_TIMESTAMP
                """,
                (country, IMPORT_VERSION, record_count),
            )
            print(f"{country}: imported {inserted:,}; skipped {skipped:,}; POI aliases {alias_count:,}")
    with app.db() as con:
        totals = con.execute(
            "SELECT country_code, location_type, COUNT(*) FROM location_catalog GROUP BY country_code, location_type ORDER BY country_code, location_type"
        ).fetchall()
    for country, location_type, count in totals:
        print(f"{country} {location_type}: {count:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
