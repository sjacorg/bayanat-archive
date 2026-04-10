import json
import os
import shutil

import click
from flask import current_app
from flask.cli import with_appcontext
from slugify import slugify

from app.database import build_fts, init_db


@click.command("import-archive")
@click.argument("export_dir", type=click.Path(exists=True))
@with_appcontext
def import_archive(export_dir):
    """Import documents from a Bayanat export directory."""
    json_path = os.path.join(export_dir, "documents.json")
    media_src = os.path.join(export_dir, "media")

    if not os.path.exists(json_path):
        raise click.ClickException(f"documents.json not found in {export_dir}")

    with open(json_path) as f:
        documents = json.load(f)

    if not isinstance(documents, list):
        raise click.ClickException("documents.json must be a JSON array")

    db_path = os.environ.get("DATABASE_PATH", "data/archive.db")
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    # Drop and rebuild for idempotent import
    if os.path.exists(db_path):
        os.remove(db_path)

    conn = init_db(db_path)
    media_dest = os.path.join(current_app.root_path, "static", "media")
    os.makedirs(media_dest, exist_ok=True)

    media_count = 0
    relation_count = 0

    for doc in documents:
        doc_id = doc["id"]
        title = doc.get("title", "")
        slug = slugify(title) or f"document-{doc_id}"

        # Aggregate OCR text and translations from media
        ocr_parts = []
        translation_parts = []
        for m in doc.get("media", []):
            ext = m.get("extraction")
            if ext:
                if ext.get("original_text"):
                    ocr_parts.append(ext["original_text"])
                if ext.get("text"):
                    translation_parts.append(ext["text"])

        ocr_text = "\n".join(ocr_parts) if ocr_parts else None
        translation = "\n".join(translation_parts) if translation_parts else None

        conn.execute(
            """INSERT INTO documents
               (id, title, title_ar, slug, description, source_link,
                publish_date, documentation_date, ocr_text, translation)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                doc_id,
                title,
                doc.get("title_ar"),
                slug,
                doc.get("description"),
                doc.get("source_link"),
                doc.get("publish_date"),
                doc.get("documentation_date"),
                ocr_text,
                translation,
            ),
        )

        # Labels (both regular and verified)
        for label in doc.get("labels", []):
            conn.execute(
                """INSERT INTO document_labels
                   (document_id, label_id, title, title_ar, verified)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    label["id"],
                    label["title"],
                    label.get("title_ar"),
                    0,
                ),
            )
        for label in doc.get("verified_labels", []):
            conn.execute(
                """INSERT INTO document_labels
                   (document_id, label_id, title, title_ar, verified)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    label["id"],
                    label["title"],
                    label.get("title_ar"),
                    1,
                ),
            )

        # Locations
        for loc in doc.get("locations", []):
            conn.execute(
                """INSERT INTO document_locations
                   (document_id, location_id, title, title_ar, lat, lng,
                    location_type, country, full_location)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    loc["id"],
                    loc["title"],
                    loc.get("title_ar"),
                    loc.get("lat"),
                    loc.get("lng"),
                    loc.get("location_type"),
                    loc.get("country"),
                    loc.get("full_location"),
                ),
            )

        # Geo locations
        for geo in doc.get("geo_locations", []):
            conn.execute(
                """INSERT INTO document_geo_locations
                   (document_id, geo_location_id, title, lat, lng, type)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    geo["id"],
                    geo.get("title"),
                    geo.get("lat"),
                    geo.get("lng"),
                    geo.get("type"),
                ),
            )

        # Sources
        for src in doc.get("sources", []):
            conn.execute(
                """INSERT INTO document_sources
                   (document_id, source_id, title, title_ar)
                   VALUES (?, ?, ?, ?)""",
                (doc_id, src["id"], src["title"], src.get("title_ar")),
            )

        # Events
        for evt in doc.get("events", []):
            conn.execute(
                """INSERT INTO document_events
                   (document_id, event_id, title, title_ar, event_type,
                    from_date, to_date, location)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    evt["id"],
                    evt["title"],
                    evt.get("title_ar"),
                    evt.get("type"),
                    evt.get("from_date"),
                    evt.get("to_date"),
                    evt.get("location"),
                ),
            )

        # Media
        for m in doc.get("media", []):
            ext = m.get("extraction")
            conn.execute(
                """INSERT INTO media
                   (document_id, media_id, filename, media_type, title, title_ar,
                    ocr_text, original_text, confidence, language)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    m["id"],
                    m["filename"],
                    m.get("type"),
                    m.get("title"),
                    m.get("title_ar"),
                    ext.get("text") if ext else None,
                    ext.get("original_text") if ext else None,
                    ext.get("confidence") if ext else None,
                    ext.get("language") if ext else None,
                ),
            )

            # Copy media file
            src_file = os.path.join(media_src, m["filename"])
            if os.path.exists(src_file):
                shutil.copy2(src_file, os.path.join(media_dest, m["filename"]))
                media_count += 1
            else:
                click.echo(f"  Warning: media file not found: {m['filename']}")

        # Relations
        for rel in doc.get("related_bulletins", []):
            related_as = rel.get("related_as")
            if isinstance(related_as, list):
                related_as = ",".join(str(x) for x in related_as)
            conn.execute(
                """INSERT INTO document_relations
                   (document_id, related_id, related_type, title, title_ar, related_as)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    rel["id"],
                    "bulletin",
                    rel.get("title"),
                    rel.get("title_ar"),
                    str(related_as) if related_as is not None else None,
                ),
            )
            relation_count += 1

        for rel in doc.get("related_actors", []):
            related_as = rel.get("related_as")
            if isinstance(related_as, list):
                related_as = ",".join(str(x) for x in related_as)
            conn.execute(
                """INSERT INTO document_relations
                   (document_id, related_id, related_type, title, name, related_as)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    rel["id"],
                    "actor",
                    rel.get("type"),
                    rel.get("name"),
                    str(related_as) if related_as is not None else None,
                ),
            )
            relation_count += 1

        for rel in doc.get("related_incidents", []):
            related_as = rel.get("related_as")
            if isinstance(related_as, list):
                related_as = ",".join(str(x) for x in related_as)
            conn.execute(
                """INSERT INTO document_relations
                   (document_id, related_id, related_type, title, title_ar, related_as)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    doc_id,
                    rel["id"],
                    "incident",
                    rel.get("title"),
                    rel.get("title_ar"),
                    str(related_as) if related_as is not None else None,
                ),
            )
            relation_count += 1

    conn.commit()

    # Build FTS index
    build_fts(conn)

    # Summary
    fts_count = conn.execute("SELECT COUNT(*) FROM documents_fts").fetchone()[0]
    conn.close()

    click.echo(f"Imported {len(documents)} documents")
    click.echo(f"  Media files copied: {media_count}")
    click.echo(f"  Relations: {relation_count}")
    click.echo(f"  FTS index rows: {fts_count}")
