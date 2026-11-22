import json

import pytest

from app import create_app
from app.commands import import_archive
from app.labels import AmbiguousLabels, assert_unique, display_titles


def test_path_is_dropped_but_an_ambiguous_leaf_keeps_what_sets_it_apart():
    names = display_titles(
        [
            "Content, Document, Security Report",
            "Content, Document",
            "Alleged Perpetrator, Affiliation, Pro-Government, Armed Forces",
            "Injured Party, Affiliation, Pro-Government, Armed Forces",
            "Content, Document, Transfer, Body Transfer, Transfer to Hospital",
            "Content, Document, Transfer, Detainee Transfer, Transfer to Hospital",
        ]
    )
    assert names["Content, Document, Security Report"] == "Security Report"
    # Every item here is a document, so the bare family tag says nothing.
    assert names["Content, Document"] is None
    # A perpetrator must never collapse into the same tag as an injured party.
    assert names["Alleged Perpetrator, Affiliation, Pro-Government, Armed Forces"] == (
        "Alleged Perpetrator: Armed Forces"
    )
    assert names["Injured Party, Affiliation, Pro-Government, Armed Forces"] == (
        "Injured Party: Armed Forces"
    )
    # Ambiguity can sit deep in the path rather than at the root.
    assert names["Content, Document, Transfer, Body Transfer, Transfer to Hospital"] == (
        "Body Transfer: Transfer to Hospital"
    )


def test_internal_process_labels_never_reach_the_public_filter():
    # These read clearly in Bayanat and read as a verdict on the document once
    # the path is dropped, so they are hidden whatever the export was told.
    names = display_titles(
        [
            "Meta, Published",
            "Meta, Bad Import, Low Quality",
            "Priority, High",
            "Peer Review, Needs Review",
            "Content, Document, Security Report",
        ]
    )
    assert names["Meta, Published"] is None
    assert names["Meta, Bad Import, Low Quality"] is None
    assert names["Priority, High"] is None
    assert names["Peer Review, Needs Review"] is None
    assert names["Content, Document, Security Report"] == "Security Report"


def test_a_party_is_named_even_when_its_leaf_collides_with_nothing():
    # The leaf alone is unique here, so a collision rule would leave both bare
    # and a reader could not tell who did what to whom.
    names = display_titles(
        [
            "Alleged Perpetrator, Affiliation, Pro-Government",
            "Injured Party, Affiliation, Pro-Opposition",
            "Content, Document, Minorities, Kurds",
        ]
    )
    assert names["Alleged Perpetrator, Affiliation, Pro-Government"] == (
        "Alleged Perpetrator: Pro-Government"
    )
    assert names["Injured Party, Affiliation, Pro-Opposition"] == (
        "Injured Party: Pro-Opposition"
    )
    # A document subject is not a party, so it keeps its plain name.
    assert names["Content, Document, Minorities, Kurds"] == "Kurds"


def test_a_name_does_not_depend_on_which_other_labels_were_exported():
    # The name is the filter value in a URL people cite, so importing more
    # labels later must not rename the ones already published.
    alone = display_titles(["Alleged Perpetrator, Affiliation, Pro-Government"])
    crowded = display_titles(
        [
            "Alleged Perpetrator, Affiliation, Pro-Government",
            "Content, Document, Security Report",
            "Type, Human, Killing",
        ]
    )
    path = "Alleged Perpetrator, Affiliation, Pro-Government"
    assert alone[path] == crowded[path]


def test_two_paths_under_one_name_stop_the_import():
    # Three paths on one leaf, where the segment that separates two of them from
    # the third does not separate them from each other.
    with pytest.raises(AmbiguousLabels) as clash:
        assert_unique(
            display_titles(
                [
                    "Content, Orders, Referral",
                    "Content, Reports, Referral",
                    "Type, Orders, Referral",
                ]
            )
        )
    assert "Content: Referral" in str(clash.value)


def build(tmp_path, monkeypatch):
    export = tmp_path / "export"
    (export / "media").mkdir(parents=True)
    label = lambda i, t: {"id": i, "title": t, "title_ar": None, "verified": False}  # noqa: E731
    docs = [
        {
            "id": 1,
            "title": "Report one",
            "labels": [label(1, "Content, Document"), label(2, "Content, Document, Secret")],
        },
        {
            "id": 2,
            "title": "Report two",
            "labels": [label(1, "Content, Document")],
        },
    ]
    (export / "documents.json").write_text(json.dumps(docs))
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))
    app = create_app()
    assert app.test_cli_runner().invoke(import_archive, [str(export)]).exit_code == 0
    return app


def test_facets_and_filtering_use_the_shown_name(tmp_path, monkeypatch):
    app = build(tmp_path, monkeypatch)
    with app.test_request_context("/search"):
        from app import get_db
        from app.routes.search import _facet_options, _get_facets

        options = _facet_options(_get_facets(get_db(), None, [], [], None, None))

    # The empty tag is on both documents and still never offered as a filter.
    assert options["all_labels"] == ["Secret"]
    assert options["label_counts"]["Secret"] == 1

    client = app.test_client()
    page = client.get("/search?label=Secret", headers={"HX-Request": "true"}).get_data(
        as_text=True
    )
    assert "Report one" in page and "Report two" not in page
    # The stored path is not a filter value any more.
    empty = client.get(
        "/search?label=Content,+Document,+Secret", headers={"HX-Request": "true"}
    ).get_data(as_text=True)
    assert "Report one" not in empty
