import os
import tempfile
import unittest
from pathlib import Path

import app


class AssistantKnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_path = os.environ.get("FAIRFARES_DB_PATH")
        self.old_seed = os.environ.get("FAIRFARES_SEED_DEFAULTS")
        os.environ["FAIRFARES_DB_PATH"] = str(Path(self.temp_dir.name) / "fairfares.sqlite3")
        os.environ["FAIRFARES_SEED_DEFAULTS"] = "0"
        app.refresh_storage_paths()
        app.init_db()

    def tearDown(self):
        if self.old_db_path is None:
            os.environ.pop("FAIRFARES_DB_PATH", None)
        else:
            os.environ["FAIRFARES_DB_PATH"] = self.old_db_path
        if self.old_seed is None:
            os.environ.pop("FAIRFARES_SEED_DEFAULTS", None)
        else:
            os.environ["FAIRFARES_SEED_DEFAULTS"] = self.old_seed
        self.clear_mcp_env()
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def clear_mcp_env(self):
        os.environ.pop("OPENAI_AGENT_MCP_SERVERS", None)
        os.environ.pop("OPENAI_AGENT_MCP_ALLOW_UNRESTRICTED", None)
        os.environ.pop("OPENAI_DOCS_MCP_TOKEN", None)

    def assertTopArticle(self, query, expected_title):
        articles = app.search_wiki_articles(query, include_internal=False)
        self.assertTrue(articles, f"No article found for {query!r}")
        self.assertEqual(articles[0]["title"], expected_title)

    def assertArticlePresent(self, query, expected_title):
        articles = app.search_wiki_articles(query, include_internal=False)
        self.assertIn(expected_title, [article["title"] for article in articles])

    def test_seeded_assistant_faq_answers_common_questions(self):
        self.assertTopArticle("How do I book a car?", "Booking help FAQ")
        self.assertTopArticle("Why is there a hold on my card?", "Payment FAQ")
        self.assertArticlePresent("insurance requirement", "Insurance Requirement")
        self.assertTopArticle("What do I do if I get a flat tire?", "Fees, tolls, tickets, and roadside FAQ")
        self.assertTopArticle("Can I upload reels?", "Explorer FAQ")
        self.assertTopArticle("Can I list my car on FairFares?", "Marketplace and future host program FAQ")

    def test_booking_policy_surfaces_insurance_requirement(self):
        py = Path("app.py").read_text()
        self.assertIn("Insurance requirement:", py)
        self.assertIn("valid auto policy that extends coverage to rental vehicles", py)
        self.assertIn("/wiki?q=insurance%20requirement", py)

    def test_assistant_actions_are_guided_not_silent_writes(self):
        context = app.assistant_database_context("cancel my booking", None, include_internal=False)
        actions = app.assistant_actions("cancel my booking", context)
        self.assertIn("/manage-booking?agent=cancel#cancel", [action["href"] for action in actions])

    def test_openai_assistant_payload_omits_mcp_without_config(self):
        self.clear_mcp_env()
        payload = app.build_openai_assistant_payload("refund policy", {"role": "guest"})
        self.assertNotIn("tools", payload)

    def test_openai_assistant_mcp_requires_allowed_tools_by_default(self):
        self.clear_mcp_env()
        os.environ["OPENAI_AGENT_MCP_SERVERS"] = '[{"server_label":"docs","server_url":"https://example.com/mcp"}]'
        self.assertEqual(app.parse_openai_agent_mcp_servers(), [])

    def test_openai_assistant_payload_allows_mcp_tool_allowlist(self):
        self.clear_mcp_env()
        os.environ["OPENAI_DOCS_MCP_TOKEN"] = "secret-token"
        os.environ["OPENAI_AGENT_MCP_SERVERS"] = """
        [
          {
            "server_label": "openai_docs",
            "server_url": "https://developers.openai.com/mcp",
            "allowed_tools": ["search_openai_docs", "fetch_openai_doc"],
            "bearer_token_env": "OPENAI_DOCS_MCP_TOKEN"
          }
        ]
        """
        payload = app.build_openai_assistant_payload("OpenAI docs", {"role": "guest"})
        self.assertEqual(payload["tools"][0]["type"], "mcp")
        self.assertEqual(payload["tools"][0]["server_label"], "openai_docs")
        self.assertEqual(payload["tools"][0]["allowed_tools"], ["search_openai_docs", "fetch_openai_doc"])
        self.assertEqual(payload["tools"][0]["headers"]["Authorization"], "Bearer secret-token")


if __name__ == "__main__":
    unittest.main()
