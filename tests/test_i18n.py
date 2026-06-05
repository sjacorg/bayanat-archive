import sqlite3
import unittest

from app import create_app
from app.i18n import translate


class I18nTestCase(unittest.TestCase):
    def test_translate_falls_back_to_english_then_key(self):
        self.assertEqual(translate("ar", "nav.search"), "بحث")
        self.assertEqual(translate("ar", "missing.key"), "missing.key")

    def test_query_param_sets_locale_and_cookie(self):
        app = create_app()
        client = app.test_client()

        response = client.get("/?lang=ar")

        self.assertEqual(response.status_code, 200)
        self.assertIn('lang="ar" dir="rtl"', response.text)
        self.assertIn("lang=ar;", response.headers["Set-Cookie"])

    def test_cookie_locale_is_used_when_query_param_is_absent(self):
        app = create_app()
        client = app.test_client()
        client.set_cookie("lang", "ar")

        response = client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn('lang="ar" dir="rtl"', response.text)

    def test_arabic_brand_uses_single_site_name(self):
        app = create_app()
        client = app.test_client()

        response = client.get("/?lang=ar")

        self.assertIn("أرشيف وثائق بيانات", response.text)
        self.assertNotIn("بيانات <span", response.text)

    def test_live_document_viewer_uses_translated_chrome(self):
        db = sqlite3.connect("data/archive.db")
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT id, slug FROM documents ORDER BY id LIMIT 1"
        ).fetchone()
        if not row:
            self.skipTest("archive database has no documents")

        app = create_app()
        client = app.test_client()
        response = client.get(f"/documents/{row['id']}/{row['slug']}?lang=ar")

        self.assertEqual(response.status_code, 200)
        self.assertIn("العودة إلى البحث", response.text)
        self.assertIn("الصفحات", response.text)


if __name__ == "__main__":
    unittest.main()
