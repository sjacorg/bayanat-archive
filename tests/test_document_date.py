"""The date a document carries is the document's own, not the record's."""

import json

import pytest

from app import create_app, get_db
from app.commands import document_date, import_archive


def test_the_issue_event_wins_over_the_filing_date():
    # Where both exist they never agree: the filing date is when SJAC entered
    # the record, down to the minute, years after the document was written.
    doc = {
        "publish_date": "2015-05-18T11:34",
        "events": [
            {"type": "Document Sent", "from_date": "2014-01-01T00:00"},
            {"type": "Document Issued", "from_date": "2013-10-13T23:56"},
        ],
    }
    assert document_date(doc) == ("2013-10-13T23:56", "issued")


def test_the_filing_date_is_a_fallback_and_says_so():
    assert document_date({"publish_date": "2015-05-18T11:34"}) == (
        "2015-05-18T11:34",
        "recorded",
    )
    assert document_date({"events": [{"type": "Document Issued"}]}) == (None, None)
    assert document_date({}) == (None, None)


@pytest.fixture
def archive(tmp_path, monkeypatch):
    export = tmp_path / "export"
    (export / "media").mkdir(parents=True)
    docs = [
        {
            "id": 1,
            "title": "Issued in 2013",
            "publish_date": "2015-05-18T11:34",
            "events": [
                {
                    "id": 9,
                    "title": None,
                    "type": "Document Issued",
                    "from_date": "2013-10-13T23:56",
                }
            ],
        },
        {"id": 2, "title": "Only filed", "publish_date": "2014-10-28T09:27"},
        {"id": 3, "title": "No date at all"},
    ]
    (export / "documents.json").write_text(json.dumps(docs))
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))
    app = create_app()
    assert app.test_cli_runner().invoke(import_archive, [str(export)]).exit_code == 0
    return app


def test_the_import_stores_the_document_date_and_where_it_came_from(archive):
    with archive.test_request_context("/"):
        rows = {
            row["id"]: (row["document_date"], row["document_date_source"])
            for row in get_db().execute(
                "SELECT id, document_date, document_date_source FROM documents"
            )
        }
    assert rows[1] == ("2013-10-13T23:56", "issued")
    assert rows[2] == ("2014-10-28T09:27", "recorded")
    assert rows[3] == (None, None)


@pytest.mark.parametrize("sort", ["date_asc", "date_desc"])
def test_an_undated_document_sorts_last_in_both_directions(archive, sort):
    # SQLite puts NULL first on ASC, which led the oldest-first list with every
    # document that had nothing to sort by.
    page = archive.test_client().get(
        f"/search?sort={sort}", headers={"HX-Request": "true"}
    )
    body = page.get_data(as_text=True)
    assert body.index("No date at all") > body.index("Issued in 2013")
    assert body.index("No date at all") > body.index("Only filed")


def test_the_card_shows_the_issue_date_not_the_filing_date(archive):
    body = (
        archive.test_client()
        .get("/search", headers={"HX-Request": "true"})
        .get_data(as_text=True)
    )
    assert "2013-10-13" in body
    assert "2015-05-18" not in body


def test_the_year_filter_reads_the_document_date(archive):
    client = archive.test_client()
    hit = client.get(
        "/search?date_from=2013-01-01&date_to=2013-12-31",
        headers={"HX-Request": "true"},
    ).get_data(as_text=True)
    assert "Issued in 2013" in hit and "Only filed" not in hit
    # 2015 is the filing date of that same document and must match nothing.
    miss = client.get(
        "/search?date_from=2015-01-01&date_to=2015-12-31",
        headers={"HX-Request": "true"},
    ).get_data(as_text=True)
    assert "Issued in 2013" not in miss
