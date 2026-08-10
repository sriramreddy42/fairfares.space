import json
import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

import app


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class ImmediateThread:
    def __init__(self, target, args, **_kwargs):
        self.target = target
        self.args = args

    def start(self):
        self.target(*self.args)


class PushNotificationTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()
        with app.db() as con:
            con.execute(
                "INSERT INTO users (name, email, password_hash, is_verified) VALUES (?, ?, ?, 1)",
                ("Push User", "push@example.com", app.hash_password("Password123!")),
            )
            self.user_id = int(con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])

    def tearDown(self):
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def add_token(self, token, enabled=1):
        with app.db() as con:
            con.execute(
                "INSERT INTO mobile_push_tokens (user_id, token, platform, enabled) VALUES (?, ?, 'android', ?)",
                (self.user_id, token, enabled),
            )

    def test_carpool_payload_uses_carpool_channel_and_disables_unregistered_token(self):
        good_token = "ExpoPushToken[good-device]"
        stale_token = "ExpoPushToken[stale-device]"
        self.add_token(good_token)
        self.add_token(stale_token)
        response = FakeResponse(
            {
                "data": [
                    {"status": "ok", "id": "ticket-1"},
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}},
                ]
            }
        )
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [good_token, stale_token, good_token, "invalid-token"],
                "Carpool request accepted",
                "Denver → Dayton",
                {"type": "CARPOOL_STATUS", "rideId": "ride-1", "status": "ACCEPTED"},
            )

        request = mock_open.call_args.args[0]
        messages = json.loads(request.data.decode("utf-8"))
        self.assertEqual([message["to"] for message in messages], [good_token, stale_token])
        self.assertTrue(all(message["channelId"] == "carpool" for message in messages))
        self.assertEqual(messages[0]["data"]["rideId"], "ride-1")
        with app.db() as con:
            states = {row["token"]: row["enabled"] for row in con.execute("SELECT token, enabled FROM mobile_push_tokens")}
        self.assertEqual(states[good_token], 1)
        self.assertEqual(states[stale_token], 0)

    def test_user_delivery_excludes_disabled_tokens(self):
        enabled_token = "ExpoPushToken[enabled-device]"
        self.add_token(enabled_token, 1)
        self.add_token("ExpoPushToken[disabled-device]", 0)
        with patch.object(app.threading, "Thread", ImmediateThread), patch.object(app, "send_expo_push") as mock_send:
            app.send_mobile_push_for_users(
                [self.user_id, self.user_id, 0],
                "New carpool request",
                "Denver → Dayton",
                {"type": "CARPOOL_REQUEST", "rideId": "ride-2"},
            )

        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], [enabled_token])
        self.assertEqual(mock_send.call_args.args[3]["type"], "CARPOOL_REQUEST")

    def test_fchat_payload_stays_on_chitthi_message_channel(self):
        token = "ExponentPushToken[fchat-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-chat"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push([token], "New message", "Hello", {"type": "FCHAT_MESSAGE"})
        messages = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(messages[0]["channelId"], "chitthi-messages-v2")
        self.assertTrue(messages[0]["mutableContent"])
        self.assertEqual(messages[0]["categoryId"], "FCHAT_MESSAGE")

    def test_promotional_payload_includes_rich_image_for_android_and_ios(self):
        token = "ExpoPushToken[promo-rich-device]"
        image_url = "https://www.fairfare.space/static/img/notifications/denver-rental-deals.jpg"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-promo"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [token],
                "Denver rental deals are live",
                "Compare low daily and weekly car rates.",
                {"type": "FAIRFARES_PROMO", "target": "rentals", "imageUrl": image_url},
            )
        message = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))[0]
        self.assertEqual(message["channelId"], "marketing")
        self.assertTrue(message["mutableContent"])
        self.assertEqual(message["richContent"], {"image": image_url})

    def test_fchat_avatar_urls_are_short_lived_and_tamper_evident(self):
        with patch.object(app.time, "time", return_value=2_000_000_000):
            url = app.chat_notification_avatar_url("https://www.fairfare.space", self.user_id)
        parsed = app.urllib.parse.urlparse(url)
        query = app.urllib.parse.parse_qs(parsed.query)
        expires_at = int(query["expires"][0])
        signature = query["signature"][0]
        self.assertEqual(parsed.path, "/api/chat/notification-avatar")
        self.assertEqual(int(query["user"][0]), self.user_id)
        self.assertEqual(expires_at, 2_000_000_900)
        self.assertTrue(app.hmac.compare_digest(signature, app.chat_notification_avatar_signature(self.user_id, expires_at)))
        self.assertFalse(app.hmac.compare_digest(signature, app.chat_notification_avatar_signature(self.user_id + 1, expires_at)))

    def test_rental_payload_uses_rental_channel_and_booking_context(self):
        token = "ExpoPushToken[rental-device]"
        response = FakeResponse({"data": [{"status": "ok", "id": "ticket-rental"}]})
        with patch.object(app.urllib.request, "urlopen", return_value=response) as mock_open:
            app.send_expo_push(
                [token],
                "Rental booking confirmed",
                "Payment received.",
                {"type": "RENTAL_BOOKING", "event": "PAYMENT_CONFIRMED", "bookingId": "FF-100"},
            )
        messages = json.loads(mock_open.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(messages[0]["channelId"], "rentals")
        self.assertEqual(messages[0]["data"]["bookingId"], "FF-100")
        self.assertNotIn("mutableContent", messages[0])

    def test_rental_helper_targets_booking_owner(self):
        booking = {
            "user_id": self.user_id,
            "booking_id": "FF-200",
            "booking_status": "CONFIRMED",
            "payment_status": "HOLD_PAID",
        }
        with patch.object(app, "send_mobile_push_for_users") as mock_send:
            app.send_rental_booking_push(booking, "Rental confirmed", "Payment received.", "PAYMENT_CONFIRMED")
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], [self.user_id])
        self.assertEqual(mock_send.call_args.args[3]["type"], "RENTAL_BOOKING")
        self.assertEqual(mock_send.call_args.args[3]["bookingId"], "FF-200")

    def test_pickup_reminder_pushes_once_with_email_automation_reservation(self):
        booking = {
            "id": 200,
            "user_id": self.user_id,
            "booking_id": "FF-REMINDER",
            "contact_email": "push@example.com",
            "contact_name": "Push User",
            "car_name": "Nissan Versa",
            "pickup_location": "Denver International Airport",
            "booking_status": "CONFIRMED",
            "payment_status": "HOLD_PAID",
        }
        with patch.object(app, "reserve_and_send_automation", return_value={"event": "pickup_24h", "sent": True, "status": "sent"}), patch.object(app, "send_rental_booking_push") as mock_push:
            app.automated_booking_email("pickup_24h", booking, "https://fairfare.space", "Reminder", "Pickup", "Body")
        mock_push.assert_called_once()
        self.assertEqual(mock_push.call_args.args[3], "PICKUP_24H")

        with patch.object(app, "reserve_and_send_automation", return_value={"event": "pickup_24h", "sent": False, "status": "already sent"}), patch.object(app, "send_rental_booking_push") as duplicate_push:
            app.automated_booking_email("pickup_24h", booking, "https://fairfare.space", "Reminder", "Pickup", "Body")
        duplicate_push.assert_not_called()

    def test_promotional_push_rotates_weekly_and_requires_opt_in(self):
        self.add_token("ExpoPushToken[promo-device]")
        scheduled = datetime(2026, 8, 6, 11, 0)  # Thursday, ISO week 32: Denver rentals rotation.
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 0)
        send_push.assert_not_called()

        with app.db() as con:
            con.execute("UPDATE users SET promo_email_opt_in = 1 WHERE id = ?", (self.user_id,))
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
            duplicate = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(duplicate["sent"], 0)
        send_push.assert_called_once()
        self.assertEqual(send_push.call_args.args[3]["type"], "FAIRFARES_PROMO")
        self.assertEqual(send_push.call_args.args[3]["target"], "rentals")
        self.assertTrue(send_push.call_args.args[1].startswith("🔥"))
        self.assertTrue(send_push.call_args.args[2].startswith("🚙"))
        self.assertEqual(
            send_push.call_args.args[3]["imageUrl"],
            f"{app.schema_origin()}/static/img/notifications/denver-rental-deals.jpg",
        )

    def test_festival_push_uses_poster_and_sends_only_once(self):
        self.add_token("ExpoPushToken[festival-device]")
        with app.db() as con:
            con.execute("UPDATE users SET promo_email_opt_in = 1 WHERE id = ?", (self.user_id,))
        scheduled = datetime(2026, 11, 8, 10, 0)
        with patch.object(app, "send_mobile_push_for_users") as send_push:
            result = app.run_promotional_push_automation(scheduled)
            duplicate = app.run_promotional_push_automation(scheduled)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["campaign"], "diwali")
        self.assertEqual(duplicate["sent"], 0)
        send_push.assert_called_once()
        self.assertEqual(send_push.call_args.args[1], "🎉 Happy Diwali from FairFares!")
        self.assertEqual(
            send_push.call_args.args[3]["imageUrl"],
            f"{app.schema_origin()}/static/img/notifications/festivals/diwali.jpg",
        )

    def test_fixed_festival_dates_repeat_each_year(self):
        self.assertEqual(app.festival_campaign_for_day(date(2034, 8, 15))["slug"], "independence-day")
        self.assertEqual(app.festival_campaign_for_day(date(2034, 12, 25))["slug"], "christmas")
        self.assertIsNone(app.festival_campaign_for_day(date(2034, 8, 16)))


if __name__ == "__main__":
    unittest.main()
