import json

from app import create_app
from app.commands import import_archive

ADMIN = "Administrative Location"


def location(title, location_type, full_location):
    return {
        "id": abs(hash(full_location)) % 10000,
        "title": title,
        "location_type": location_type,
        "full_location": full_location,
    }


def build(tmp_path, monkeypatch):
    export = tmp_path / "export"
    (export / "media").mkdir(parents=True)
    docs = [
        {
            "id": 1,
            "title": "City doc",
            "locations": [
                location("Idleb City", ADMIN, "Idleb, Idleb, Idleb, Idleb City")
            ],
        },
        {
            "id": 2,
            "title": "Governorate doc",
            "locations": [location("Idleb", ADMIN, "Idleb")],
        },
        {
            "id": 3,
            "title": "Prison doc",
            "locations": [
                location("Sidnaya", "Point of Interest, Detention Facility", "Sidnaya")
            ],
        },
    ]
    (export / "documents.json").write_text(json.dumps(docs))
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))
    app = create_app()
    assert app.test_cli_runner().invoke(import_archive, [str(export)]).exit_code == 0
    return app


def test_places_collapse_to_governorate_and_split_from_facilities(
    tmp_path, monkeypatch
):
    app = build(tmp_path, monkeypatch)
    with app.test_request_context("/search"):
        from app import get_db
        from app.routes.search import _facet_options, _get_facets

        options = _facet_options(_get_facets(get_db(), None, [], [], None, None))

    # The four-segment path and the bare governorate become one "Idleb" entry.
    assert options["all_places"] == ["Idleb"]
    assert options["place_counts"]["Idleb"] == 2
    assert options["all_facilities"] == ["Sidnaya"]
    # The mobile drawer keeps both kinds in one list.
    assert options["all_locations"] == ["Idleb", "Sidnaya"]


def test_one_param_filters_both_places_and_facilities(tmp_path, monkeypatch):
    app = build(tmp_path, monkeypatch)
    client = app.test_client()

    def ids(query):
        page = client.get(query, headers={"HX-Request": "true"}).get_data(as_text=True)
        return {n for n in ("City doc", "Governorate doc", "Prison doc") if n in page}

    assert ids("/search?location=Idleb") == {"City doc", "Governorate doc"}
    assert ids("/search?location=Sidnaya") == {"Prison doc"}
    assert ids("/search?location=Idleb&location=Sidnaya") == {
        "City doc",
        "Governorate doc",
        "Prison doc",
    }
