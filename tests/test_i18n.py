import sqlite3
import unittest

from app import create_app
from app.i18n import translate


class I18nTestCase(unittest.TestCase):
    def test_translate_falls_back_to_english_then_key(self):
        self.assertEqual(translate("ar", "nav.search"), "بحث")
        self.assertEqual(translate("ar", "missing.key"), "missing.key")

    def test_text_dir_follows_majority_script_not_first_character(self):
        text_dir = create_app().jinja_env.filters["text_dir"]

        self.assertEqual(text_dir("#14129\\س ت2 follow up"), "ltr")
        self.assertEqual(
            text_dir("Doc #1604/ع ر Page 1 of 1 Surveillance report"), "ltr"
        )
        self.assertEqual(text_dir("مذكرة حول الوضع الأمني في Raqqa"), "rtl")
        self.assertEqual(text_dir(None), "ltr")

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

        self.assertIn(
            "أرشيف الوثائق الخاص بالمركز السوري للعدالة والمساءلة", response.text
        )
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


class ExtractedTextTestCase(unittest.TestCase):
    def render(self, text):
        app = create_app()
        with app.test_request_context("/"):
            return str(app.jinja_env.filters["bidirectional_text"](text))

    def test_a_line_stays_one_block_in_one_direction(self):
        # Splitting per script run put a lone colon in its own block, where
        # dir="auto" had no strong character and laid it out left to right.
        html = self.render("التاريخ :\nالمبلغ :")
        self.assertIn('<div dir="rtl">التاريخ :</div>', html)
        self.assertIn('<div dir="rtl">المبلغ :</div>', html)
        self.assertNotIn(">:<", html)

    def test_mixed_scripts_on_one_line_are_left_to_the_browser(self):
        html = self.render("رقم الهاتف : 11902 memo")
        self.assertEqual(html.count("<div"), 1)
        self.assertIn('dir="rtl"', html)

    def test_a_latin_line_keeps_its_own_direction(self):
        self.assertIn('<div dir="ltr">', self.render("التاريخ :\nRef 2011/7/8 memo"))

    def test_blank_lines_do_not_become_empty_blocks(self):
        self.assertEqual(self.render("التاريخ :\n\n\nالمبلغ :").count("<div"), 2)
