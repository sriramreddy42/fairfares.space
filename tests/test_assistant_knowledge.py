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
        app.refresh_storage_paths()
        self.temp_dir.cleanup()

    def assertTopArticle(self, query, expected_title):
        articles = app.search_wiki_articles(query, include_internal=False)
        self.assertTrue(articles, f"No article found for {query!r}")
        self.assertEqual(articles[0]["title"], expected_title)

    def test_seeded_assistant_faq_answers_common_questions(self):
        self.assertTopArticle("How do I book a car?", "Booking help FAQ")
        self.assertTopArticle("Why is there a hold on my card?", "Payment FAQ")
        self.assertTopArticle("What do I do if I get a flat tire?", "Fees, tolls, tickets, and roadside FAQ")
        self.assertTopArticle("Can I upload reels?", "Explorer FAQ")
        self.assertTopArticle("Can I list my car on FairFares?", "Marketplace and future host program FAQ")

    def test_assistant_actions_are_guided_not_silent_writes(self):
        context = app.assistant_database_context("cancel my booking", None, include_internal=False)
        actions = app.assistant_actions("cancel my booking", context)
        self.assertIn("/manage-booking?agent=cancel#cancel", [action["href"] for action in actions])


if __name__ == "__main__":
    unittest.main()
