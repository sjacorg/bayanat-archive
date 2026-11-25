"""The filed title carries the page it came from; the card should not."""

import pytest

from app import create_app


@pytest.fixture
def filters():
    app = create_app()
    return app.jinja_env.filters


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Detainee Death Explanation - Page 1 of 1", "Detainee Death Explanation"),
        ("Body Release Denial – Page 1 of 1", "Body Release Denial"),
        (
            "Transfer letter for five detainees - pg 1 of 1",
            "Transfer letter for five detainees",
        ),
        # The marker sits mid-title on the records filed from the raw import.
        (
            "Doc #4199/ب ص Page 2 of 4 Daily security report",
            "Doc #4199/ب ص Daily security report",
        ),
        # Nothing to strip.
        ("#14129\\س ت2  follow up", "#14129\\س ت2 follow up"),
        ("", ""),
        (None, ""),
    ],
)
def test_the_page_marker_leaves_the_title(filters, title, expected):
    assert filters["document_title"](title) == expected


@pytest.mark.parametrize(
    "title,expected",
    [
        # One page of one is what a reader assumes, so it is not worth a line.
        ("Detainee Death Explanation - Page 1 of 1", None),
        ("Memo about Ar-Raqqa - Page 2 of 4", ("2", "4")),
        ("Doc #4199/ب ص Page 2 of 4 Daily security report", ("2", "4")),
        ("#14129 follow up", None),
        (None, None),
    ],
)
def test_extent_is_reported_only_when_there_is_more_than_one_page(
    filters, title, expected
):
    assert filters["page_extent"](title) == expected


def test_a_title_that_is_only_a_marker_does_not_become_a_stray_dash(filters):
    assert filters["document_title"]("- Page 1 of 1") == ""


def test_arabic_page_marker_leaves_the_title(filters):
    title = filters["document_title"]
    extent = filters["page_extent"]
    assert title("تقرير أمني وتقرير احتجاز - الصفحة 1 من 2") == "تقرير أمني وتقرير احتجاز"
    assert extent("تقرير أمني وتقرير احتجاز - الصفحة 1 من 2") == ("1", "2")
    assert extent("تقرير اعتقال - صفحة 1 من 1") is None
