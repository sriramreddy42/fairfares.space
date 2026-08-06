import unittest
from unittest.mock import patch

import app


class ImmediateThread:
    def __init__(self, target, args, **_kwargs):
        self.target = target
        self.args = args

    def start(self):
        self.target(*self.args)


class OperationalAlertsTest(unittest.TestCase):
    def setUp(self):
        app._OPERATIONAL_ALERTS.clear()

    def tearDown(self):
        app._OPERATIONAL_ALERTS.clear()

    def test_alert_uses_dedicated_slack_channel_and_formats_details(self):
        with patch.object(app, "slack_alerts_configured", return_value=True), patch.object(
            app.threading, "Thread", ImmediateThread
        ), patch.object(app, "send_slack_notification", return_value="sent") as send:
            queued = app.send_operational_alert(
                "database-down",
                "Database health check failed",
                severity="critical",
                details=["Error type: OperationalError"],
                now=1000,
            )

        self.assertTrue(queued)
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0], "alerts")
        self.assertIn("CRITICAL", send.call_args.args[1])
        self.assertIn("OperationalError", send.call_args.args[1])

    def test_duplicate_alert_is_throttled_but_distinct_alert_is_sent(self):
        with patch.object(app, "slack_alerts_configured", return_value=True), patch.object(
            app.threading, "Thread", ImmediateThread
        ), patch.object(app, "send_slack_notification", return_value="sent") as send:
            first = app.send_operational_alert("api:/login", "Failure", now=1000)
            duplicate = app.send_operational_alert("api:/login", "Failure", now=1001)
            distinct = app.send_operational_alert("api:/signup", "Failure", now=1001)

        self.assertTrue(first)
        self.assertFalse(duplicate)
        self.assertTrue(distinct)
        self.assertEqual(send.call_count, 2)

    def test_alert_is_not_queued_without_slack_configuration(self):
        with patch.object(app, "slack_alerts_configured", return_value=False), patch.object(
            app.threading, "Thread"
        ) as thread:
            queued = app.send_operational_alert("api:/health", "Failure", now=1000)

        self.assertFalse(queued)
        thread.assert_not_called()

    def test_alert_redacts_personal_data_and_credentials(self):
        with patch.object(app, "slack_alerts_configured", return_value=True), patch.object(
            app.threading, "Thread", ImmediateThread
        ), patch.object(app, "send_slack_notification", return_value="sent") as send:
            app.send_operational_alert(
                "mobile:render",
                "Mobile diagnostic",
                details=[
                    "User user@example.com called +1 (720) 555-1234",
                    "Authorization: Bearer secret.token-value",
                ],
                now=1000,
            )

        alert_text = send.call_args.args[1]
        self.assertNotIn("user@example.com", alert_text)
        self.assertNotIn("720", alert_text)
        self.assertNotIn("secret.token-value", alert_text)
        self.assertIn("[REDACTED_EMAIL]", alert_text)
        self.assertIn("[REDACTED_PHONE]", alert_text)
        self.assertIn("Bearer [REDACTED]", alert_text)


if __name__ == "__main__":
    unittest.main()
