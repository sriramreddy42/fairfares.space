from __future__ import annotations

import tempfile
import unittest
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMP_DIR = ROOT / ".tmp"


def main() -> int:
    TEMP_DIR.mkdir(exist_ok=True)
    sys.path.insert(0, str(ROOT))
    tempfile.tempdir = str(TEMP_DIR)
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
