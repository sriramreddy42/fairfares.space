import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import app


class PickupPrefillTest(unittest.TestCase):
    sample_image = "data:image/jpeg;base64," + ("a" * 32)

    def test_no_photos_returns_manual_entry_message(self):
        fields, missing, message = app.extract_pickup_prefill_from_images({})

        self.assertEqual(fields, {})
        self.assertIn("driver license number", missing)
        self.assertIn("Take or upload DL/insurance photos first", message)

    def test_missing_provider_key_does_not_block_pickup(self):
        with patch.dict(os.environ, {}, clear=True):
            fields, missing, message = app.extract_pickup_prefill_from_images(
                {"front_image_url": self.sample_image}
            )

        self.assertEqual(fields, {})
        self.assertIn("customer full name", missing)
        self.assertIn("OPENAI_API_KEY", message)

    def test_prefill_extracts_and_sanitizes_provider_fields(self):
        provider_payload = {
            "fields": {
                "customer_name": "  Sriram   Reddy  Bandari ",
                "address": "1665 Logan St, Denver, CO 80203",
                "date_of_birth": "DOB: 2001-04-05",
                "license_number": " CO-1234-5678 ",
                "license_state": "Colorado CO",
                "license_expiry": "expires 2028-12-31",
                "insurance_provider": "State Farm",
                "insurance_type": "Full coverage",
                "coverage_amount": "$100,000.00 liability",
                "unknown_field": "ignored",
            },
            "missing_fields": ["phone"],
            "notes": "Review before save.",
        }

        class FakeCompletions:
            def create(self, **_kwargs):
                message = types.SimpleNamespace(content=json.dumps(provider_payload))
                choice = types.SimpleNamespace(message=message)
                return types.SimpleNamespace(choices=[choice])

        class FakeClient:
            def __init__(self, api_key):
                self.api_key = api_key
                self.chat = types.SimpleNamespace(completions=FakeCompletions())

        fake_openai = types.SimpleNamespace(OpenAI=FakeClient)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=False), patch.dict(
            sys.modules, {"openai": fake_openai}
        ):
            fields, missing, message = app.extract_pickup_prefill_from_images(
                {
                    "front_image_url": self.sample_image,
                    "back_image_url": self.sample_image,
                    "insurance_document_url": self.sample_image,
                }
            )

        self.assertEqual(fields["customer_name"], "Sriram Reddy Bandari")
        self.assertEqual(fields["date_of_birth"], "2001-04-05")
        self.assertEqual(fields["license_state"], "CO")
        self.assertEqual(fields["license_expiry"], "2028-12-31")
        self.assertEqual(fields["coverage_amount"], "100000.00")
        self.assertNotIn("unknown_field", fields)
        self.assertEqual(missing, ["phone"])
        self.assertEqual(message, "Review before save.")

    def test_driver_license_basic_validation_still_runs_after_prefill(self):
        status, note = app.evaluate_driver_license(
            "CO1234567",
            "CO",
            "2099-01-01",
            self.sample_image,
            self.sample_image,
        )

        self.assertEqual(status, "BASIC_CHECK_PASSED")
        self.assertIn("licensed ID verification provider", note)

    def test_frontend_prefill_fetch_hook_exists(self):
        js = Path("static/js/app.js").read_text()
        self.assertIn("/admin/pickup/prefill", js)
        self.assertIn("data-pickup-prefill-button", js)
        self.assertIn("if (input.value.trim()) return", js)

        page = Path("app.py").read_text()
        self.assertIn("/admin/pickup/prefill", page)
        self.assertIn("Prefill empty fields", page)
        self.assertIn("This is not DMV verification", page)


if __name__ == "__main__":
    unittest.main()
