import os
import tempfile
import unittest
from pathlib import Path

import app


class InventoryReceiptTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        self.old_drive_json = os.environ.get(app.DRIVE_SERVICE_ACCOUNT_ENV)
        self.old_drive_root = os.environ.get(app.DRIVE_ROOT_ENV)
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        os.environ.pop(app.DRIVE_SERVICE_ACCOUNT_ENV, None)
        os.environ.pop(app.DRIVE_ROOT_ENV, None)
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                """
                INSERT INTO users (name, email, password_hash, is_admin, role, is_verified)
                VALUES ('Owner Admin', 'owner@example.com', ?, 1, 'ADMIN', 1)
                """,
                (app.hash_password("Password123!"),),
            )
            self.admin = con.execute("SELECT * FROM users WHERE email = 'owner@example.com'").fetchone()

    def tearDown(self):
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        if self.old_drive_json is None:
            os.environ.pop(app.DRIVE_SERVICE_ACCOUNT_ENV, None)
        else:
            os.environ[app.DRIVE_SERVICE_ACCOUNT_ENV] = self.old_drive_json
        if self.old_drive_root is None:
            os.environ.pop(app.DRIVE_ROOT_ENV, None)
        else:
            os.environ[app.DRIVE_ROOT_ENV] = self.old_drive_root
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def make_handler(self, form, files=None):
        test_case = self

        class DummyHandler:
            def require_owner_admin(self):
                return test_case.admin

            def read_form_with_files(self):
                return form, files or {}

            def redirect(self, path):
                self.redirect_path = path

        return DummyHandler()

    def base_form(self):
        return {
            "brand": "Toyota",
            "model": "Corolla",
            "year": "2026",
            "type": "Sedan",
            "fuel_type": "Gasoline",
            "seats": "5",
            "daily_price": "39.99",
            "purchase_cost": "12000.00",
            "location": "Denver International Airport (DEN)",
            "status": "AVAILABLE",
        }

    def test_add_inventory_requires_purchase_receipt(self):
        handler = self.make_handler(self.base_form())

        app.FairFaresHandler.create_admin_car(handler)

        self.assertEqual(handler.redirect_path, "/admin/inventory?error=purchase_receipt_required")
        with app.db() as con:
            total = con.execute("SELECT COUNT(*) AS total FROM cars").fetchone()["total"]
        self.assertEqual(total, 0)

    def test_add_inventory_saves_purchase_receipt_reference(self):
        files = {
            "purchase_receipt_file": {
                "filename": "purchase-receipt.pdf",
                "mime_type": "application/pdf",
                "payload": b"%PDF-1.4 FairFares test receipt",
            }
        }
        handler = self.make_handler(self.base_form(), files)

        app.FairFaresHandler.create_admin_car(handler)

        self.assertEqual(handler.redirect_path, "/admin/inventory")
        with app.db() as con:
            car = con.execute("SELECT * FROM cars WHERE brand = 'Toyota' AND model = 'Corolla'").fetchone()
        self.assertIsNotNone(car)
        self.assertGreater(float(car["purchase_cost"]), 0)
        self.assertTrue(car["purchase_receipt_url"].startswith("local://uploads/vehicle-purchase-receipts/"))
        with app.db() as con:
            drive_failure = con.execute("SELECT * FROM drive_files WHERE drive_file_id = 'UPLOAD_FAILED'").fetchone()
        self.assertIsNotNone(drive_failure)
        self.assertIn("Drive folder is not configured", drive_failure["drive_web_view_link"])

    def test_admin_inventory_form_requires_receipt_upload(self):
        template = (Path(app.BASE_DIR) / "templates" / "admin.html").read_text(encoding="utf-8")

        self.assertIn('enctype="multipart/form-data"', template)
        self.assertIn('name="purchase_receipt_file"', template)
        self.assertIn("required", template)

    def test_drive_folder_env_accepts_full_google_folder_url(self):
        folder_id = "1AbCdEfGhIjKlMnOpQrStUvWxYz123456"
        os.environ[app.DRIVE_ROOT_ENV] = f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing"

        self.assertEqual(app.drive_folder_id("roi"), folder_id)
        self.assertEqual(app.google_drive_config_status()["root_folder_id"], folder_id)


if __name__ == "__main__":
    unittest.main()
