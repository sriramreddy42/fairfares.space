import socket
import unittest
from unittest.mock import patch

import app


class ChatLinkPreviewTest(unittest.TestCase):
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
        self.assertEqual(parser.metadata["icon"], "/favicon.ico")

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
