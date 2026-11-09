import json

from app import create_app
from app.commands import import_archive


def test_publication_links_import_and_render(tmp_path, monkeypatch):
    export = tmp_path / "export"
    (export / "media").mkdir(parents=True)
    links = [
        "https://syriaaccountability.org/r/",
        "https://ar.syriaaccountability.org/r/",
    ]
    docs = [
        {"id": 1, "title": "Doc", "publication_links": links},
        {"id": 2, "title": "Other"},
    ]
    (export / "documents.json").write_text(json.dumps(docs))
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))

    app = create_app()
    runner = app.test_cli_runner()
    for args in ([str(export)], ["--append", str(export)]):
        assert runner.invoke(import_archive, args).exit_code == 0

    client = app.test_client()
    linked = client.get("/documents/1/doc", follow_redirects=True).get_data(
        as_text=True
    )
    other = client.get("/documents/2/other", follow_redirects=True).get_data(
        as_text=True
    )
    assert all(linked.count(f'href="{u}"') == 1 for u in links)
    assert "Published In" in linked and "Published In" not in other
