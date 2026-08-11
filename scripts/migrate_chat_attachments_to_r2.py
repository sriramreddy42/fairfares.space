#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Move existing local Chitthi attachments to private Cloudflare R2 storage.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum attachments to migrate in this run.")
    parser.add_argument("--delete-local", action="store_true", help="Delete each local file only after its R2 reference is committed.")
    args = parser.parse_args()
    print(json.dumps(app.migrate_local_chat_attachments_to_r2(args.limit, delete_local=args.delete_local), sort_keys=True))


if __name__ == "__main__":
    main()
