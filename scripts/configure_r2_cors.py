#!/usr/bin/env python3
"""Apply the minimal browser CORS policy needed for Chitthi presigned transfers."""

import os
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


def allowed_origins(value: str) -> list[str]:
    origins: list[str] = []
    for candidate in value.split(","):
        origin = candidate.strip().rstrip("/")
        parsed = urllib.parse.urlparse(origin)
        is_local = parsed.hostname in {"localhost", "127.0.0.1"}
        if parsed.path or parsed.params or parsed.query or parsed.fragment:
            raise ValueError(f"Origin must not contain a path: {origin}")
        if not parsed.hostname or (parsed.scheme != "https" and not (parsed.scheme == "http" and is_local)):
            raise ValueError(f"Origin must use HTTPS (except localhost): {origin}")
        origins.append(origin)
    return sorted(set(origins))


def main() -> int:
    origins = allowed_origins(os.environ.get("FAIRFARES_R2_ALLOWED_ORIGINS", ""))
    if not origins:
        print("Set FAIRFARES_R2_ALLOWED_ORIGINS to one or more exact comma-separated origins.", file=sys.stderr)
        return 2
    if not app.r2_storage_configured():
        print("Cloudflare R2 credentials are not configured.", file=sys.stderr)
        return 2
    try:
        app.r2_storage_client().put_bucket_cors(
            Bucket=app.R2_BUCKET_NAME,
            CORSConfiguration={"CORSRules": [{
                "AllowedOrigins": origins,
                "AllowedMethods": ["GET", "PUT", "HEAD"],
                "AllowedHeaders": ["content-type", "x-amz-checksum-sha256", "x-amz-meta-upload-id"],
                "ExposeHeaders": ["etag", "content-length", "x-amz-checksum-sha256"],
                "MaxAgeSeconds": 3600,
            }]},
        )
    except Exception as error:
        if error.__class__.__name__ in {"AccessDenied", "ClientError"}:
            print("The R2 object key cannot change bucket CORS. Add this policy in Cloudflare R2 → bucket → Settings → CORS Policy.", file=sys.stderr)
            return 3
        raise
    print(f"Applied restricted Chitthi R2 CORS policy for {len(origins)} origin(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
