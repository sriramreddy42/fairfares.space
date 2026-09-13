import base64
import io
import socket
import sqlite3
import unittest
import urllib.parse
from unittest.mock import patch

import app


class ChatLinkPreviewTest(unittest.TestCase):
    def _capture_open_landing(self, method_name, path):
        handler = object.__new__(app.FairFaresHandler)
        sent = {}

        def send_text(body, content_type="text/plain; charset=utf-8", status=200, head_only=False, cache_control=""):
            sent.update(
                {
                    "body": body,
                    "content_type": content_type,
                    "status": status,
                    "head_only": head_only,
                    "cache_control": cache_control,
                }
            )

        handler.send_text = send_text
        getattr(handler, method_name)(urllib.parse.urlparse(path))
        return sent

    def test_open_landing_pages_have_visible_first_paint_shell(self):
        cases = [
            ("accommodations_open_landing", "/accommodations/open"),
            ("carpool_open_landing", "/carpool/open"),
            ("community_open_landing", "/community/open"),
        ]
        for method_name, path in cases:
            with self.subTest(path=path):
                sent = self._capture_open_landing(method_name, path)
                body = sent["body"]
                self.assertEqual(sent["status"], 200)
                self.assertIn("text/html", sent["content_type"])
                self.assertIn("<style>html,body{margin:0;background:#07101f!important", body)
                self.assertIn("<main", body)
                self.assertIn("Open in FairFares", body)
                self.assertIn("Install FairFares", body)
                self.assertNotIn("button.href=fairfares://", body)
                self.assertNotIn("window.location.href=fairfares://", body)
                self.assertIn("intent://www.fairfare.space", body)

    def test_open_landing_pages_fallback_to_visible_shell_when_lookup_fails(self):
        failing_db = sqlite3.OperationalError("database is locked")
        with patch.object(app, "db", side_effect=failing_db):
            accommodations = self._capture_open_landing(
                "accommodations_open_landing",
                "/accommodations/open?postId=FFH-LOCKED",
            )
            carpool = self._capture_open_landing(
                "carpool_open_landing",
                "/carpool/open?rideId=FRD-LOCKED",
            )
        with patch.object(app, "community_post_rows", side_effect=failing_db):
            community = self._capture_open_landing(
                "community_open_landing",
                "/community/open?postId=ASK-LOCKED",
            )
        for sent in (accommodations, carpool, community):
            with self.subTest(body=sent["body"][:80]):
                self.assertEqual(sent["status"], 200)
                self.assertIn("Open in FairFares", sent["body"])
                self.assertIn("background:#07101f!important", sent["body"])

    def test_open_landing_pages_handle_head_without_404_or_gateway_failure(self):
        for path in (
            "/accommodations/open",
            "/carpool/open",
            "/community/open",
            "/chitthi/invite",
            "/chitthi/group",
            "/fchat/invite",
            "/fchat/group",
        ):
            with self.subTest(path=path):
                handler = object.__new__(app.FairFaresHandler)
                handler.path = f"{path}?share=3"
                handler.headers = {}
                calls = []
                handler.send_response = lambda status: calls.append(("status", status))
                handler.send_header = lambda key, value: calls.append(("header", key, value))
                handler.end_headers = lambda: calls.append(("end",))
                handler.do_HEAD()
                self.assertIn(("status", 200), calls)
                self.assertIn(("header", "Content-Type", "text/html; charset=utf-8"), calls)
                self.assertIn(("end",), calls)

    def test_public_share_pages_never_auto_open_an_app_only_scheme(self):
        script = app.app_only_open_script("fairfares://housing?postId=FFH-TEST")
        self.assertNotIn("location.replace", script)
        self.assertNotIn("fairfares://", script)
        self.assertIn("/app/fairfares-ltd/id6797162820", script)
        self.assertIn("id=com.fairfares.mobile", script)
        self.assertIn("/android/i.test(navigator.userAgent)", script)
        self.assertIn("Install FairFares", script)

    def test_render_origin_is_never_published_as_share_origin(self):
        with patch.dict(app.os.environ, {"PUBLIC_BASE_URL": "https://fairfares.onrender.com"}, clear=False):
            app.os.environ.pop("FAIRFARES_CANONICAL_ORIGIN", None)
            self.assertEqual(app.schema_origin(), "https://www.fairfare.space")

    def test_chitthi_share_links_use_verified_public_app_link_domain(self):
        handler = object.__new__(app.FairFaresHandler)
        with patch.dict(app.os.environ, {"PUBLIC_BASE_URL": "https://www.fairfare.space"}):
            public_join_url = handler.community_join_url("FFG-TEST")
            self.assertTrue(public_join_url.startswith("https://www.fairfare.space/chitthi/invite?group_invite=public."))
            self.assertTrue(public_join_url.endswith("&preview=2"))
            self.assertEqual(
                handler.community_invite_url("private-token"),
                "https://www.fairfare.space/chitthi/invite?group_invite=private-token",
            )

    def test_android_chitthi_invite_uses_verified_www_app_link_and_play_fallback(self):
        intent = app.android_chitthi_invite_intent("group_invite=private-token")
        self.assertTrue(intent.startswith("intent://www.fairfare.space/chitthi/invite?group_invite=private-token"))
        self.assertIn("scheme=https", intent)
        self.assertIn("package=com.fairfares.mobile", intent)
        self.assertIn("play.google.com", intent)
        self.assertNotIn("intent://group", intent)

    def test_metadata_parser_prefers_open_graph_content(self):
        parser = app.ChatLinkMetadataParser()
        parser.feed(
            """<html><head><title>Fallback title</title>
            <meta property="og:title" content="World Happiness Report - Wikipedia">
            <meta property="og:description" content="An annual publication.">
            <meta property="og:image" content="/preview.jpg">
            <meta property="og:site_name" content="Wikipedia">
            <link rel="icon" href="/favicon.ico"></head></html>"""
        )
        self.assertEqual(parser.metadata["og:title"], "World Happiness Report - Wikipedia")
        self.assertEqual(parser.metadata["og:image"], "/preview.jpg")
        self.assertEqual(parser.icon_candidates, [(0, "/favicon.ico")])

    def test_metadata_parser_prefers_native_friendly_favicon_candidates(self):
        parser = app.ChatLinkMetadataParser()
        parser.feed(
            """<link rel="icon" type="image/svg+xml" href="/mark.svg">
            <link rel="icon" type="image/png" href="/favicon.png">
            <link rel="apple-touch-icon" href="/touch.png">"""
        )
        self.assertEqual(
            sorted(parser.icon_candidates, reverse=True),
            [(50, "/touch.png"), (20, "/favicon.png"), (-20, "/mark.svg")],
        )

    @unittest.skipIf(app.Image is None, "Pillow is unavailable")
    def test_favicon_is_normalized_to_small_png_data_url(self):
        source = io.BytesIO()
        app.Image.new("RGB", (256, 128), "#00c997").save(source, format="JPEG")

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _limit):
                return source.getvalue()

        class Opener:
            def open(self, _request, timeout=0):
                self.timeout = timeout
                return Response()

        with patch.object(app, "safe_chat_preview_url", side_effect=lambda value: value):
            result = app.chat_favicon_data_url(
                "https://example.com/article",
                [(20, "/favicon.jpg")],
                Opener(),
            )
        self.assertTrue(result.startswith("data:image/png;base64,"))
        normalized = app.Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1])))
        self.assertLessEqual(normalized.width, 64)
        self.assertLessEqual(normalized.height, 64)

    def test_preview_url_rejects_private_network_addresses(self):
        private_result = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with patch.object(app.socket, "getaddrinfo", return_value=private_result):
            self.assertEqual(app.safe_chat_preview_url("https://example.test/page"), "")

    def test_preview_url_accepts_public_https_and_removes_fragment(self):
        public_result = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch.object(app.socket, "getaddrinfo", return_value=public_result):
            self.assertEqual(app.safe_chat_preview_url("https://example.com/page#section"), "https://example.com/page")

    def test_preview_url_rejects_credentials_and_non_http_protocols(self):
        self.assertEqual(app.safe_chat_preview_url("file:///etc/passwd"), "")
        self.assertEqual(app.safe_chat_preview_url("https://user:password@example.com"), "")


if __name__ == "__main__":
    unittest.main()
