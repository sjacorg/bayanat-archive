import json

from app import create_app
from app.commands import import_archive

ARABIC_SUMMARY = "ملخص عربي للوثيقة"
ARABIC_TITLE = "تقرير أمني"


def build(tmp_path, monkeypatch):
    export = tmp_path / "export"
    (export / "media").mkdir(parents=True)
    docs = [
        {
            "id": 1,
            "title": "Security report",
            "title_ar": ARABIC_TITLE,
            "public_description": "English summary",
            "public_description_ar": ARABIC_SUMMARY,
        },
        {
            "id": 2,
            "title": "Untranslated report",
            "public_description": "Only English here",
        },
    ]
    (export / "documents.json").write_text(json.dumps(docs, ensure_ascii=False))
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))
    app = create_app()
    assert app.test_cli_runner().invoke(import_archive, [str(export)]).exit_code == 0
    return app.test_client()


def test_arabic_page_prefers_arabic_and_falls_back(tmp_path, monkeypatch):
    client = build(tmp_path, monkeypatch)

    ar = client.get(
        "/documents/1/security-report?lang=ar", follow_redirects=True
    ).get_data(as_text=True)
    assert ARABIC_TITLE in ar and ARABIC_SUMMARY in ar

    en = client.get(
        "/documents/1/security-report?lang=en", follow_redirects=True
    ).get_data(as_text=True)
    assert "English summary" in en and ARABIC_SUMMARY not in en

    # Nothing Arabic stored: the Arabic page still shows the English text.
    fallback = client.get(
        "/documents/2/untranslated-report?lang=ar", follow_redirects=True
    ).get_data(as_text=True)
    assert "Untranslated report" in fallback and "Only English here" in fallback


def test_arabic_summary_is_searchable(tmp_path, monkeypatch):
    client = build(tmp_path, monkeypatch)
    page = client.get("/search?q=عربي", headers={"HX-Request": "true"}).get_data(
        as_text=True
    )
    assert "Security report" in page or ARABIC_TITLE in page
