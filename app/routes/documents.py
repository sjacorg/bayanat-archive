from flask import Blueprint, abort, redirect, render_template, request

from app import get_db

bp = Blueprint("documents", __name__)


def _get_document_labels(db, document_id):
    rows = db.execute(
        """
        SELECT DISTINCT title
        FROM document_labels
        WHERE document_id = ?
          AND title IS NOT NULL
          AND trim(title) != ''
        ORDER BY title COLLATE NOCASE
        """,
        [document_id],
    ).fetchall()
    return [row["title"] for row in rows]


def _get_document_locations(db, document_id):
    rows = db.execute(
        """
        SELECT DISTINCT full_location
        FROM document_locations
        WHERE document_id = ?
          AND full_location IS NOT NULL
          AND trim(full_location) != ''
        ORDER BY full_location COLLATE NOCASE
        """,
        [document_id],
    ).fetchall()
    return [row["full_location"] for row in rows]


def _get_document_sources(db, document_id):
    rows = db.execute(
        """
        SELECT DISTINCT title
        FROM document_sources
        WHERE document_id = ?
          AND title IS NOT NULL
          AND trim(title) != ''
        ORDER BY title COLLATE NOCASE
        """,
        [document_id],
    ).fetchall()
    return [row["title"] for row in rows]


def _get_document_events(db, document_id):
    return db.execute(
        """
        SELECT title, event_type, from_date, to_date, location
        FROM document_events
        WHERE document_id = ?
        ORDER BY
          CASE WHEN from_date IS NULL OR trim(from_date) = '' THEN 1 ELSE 0 END,
          from_date,
          id
        """,
        [document_id],
    ).fetchall()


def _media_summary(media_rows):
    summary = {
        "total": len(media_rows),
        "images": 0,
        "pdfs": 0,
        "videos": 0,
        "audios": 0,
        "docx": 0,
        "other": 0,
    }
    for row in media_rows:
        media_type = (row["media_type"] or "").lower()
        if media_type.startswith("image/"):
            summary["images"] += 1
        elif media_type == "application/pdf":
            summary["pdfs"] += 1
        elif media_type.startswith("video/"):
            summary["videos"] += 1
        elif media_type.startswith("audio/"):
            summary["audios"] += 1
        elif media_type in {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        }:
            summary["docx"] += 1
        else:
            summary["other"] += 1
    return summary


def _related_count(db, document_id):
    row = db.execute(
        """
        SELECT COUNT(*) AS count
        FROM document_relations
        WHERE document_id = ?
        """,
        [document_id],
    ).fetchone()
    return row["count"] if row else 0


def _get_related_documents(db, document_id, limit=4):
    rows = db.execute(
        """
        SELECT
          d.id AS related_document_id,
          d.slug,
          d.title AS display_title,
          d.description,
          d.publish_date,
          m.filename AS related_filename,
          m.media_type AS related_media_type
        FROM documents d
        LEFT JOIN media m
          ON m.id = (
            SELECT m2.id
            FROM media m2
            WHERE m2.document_id = d.id
            ORDER BY
              CASE WHEN lower(coalesce(m2.media_type, '')) LIKE 'image/%' THEN 0 ELSE 1 END,
              m2.id
            LIMIT 1
          )
        WHERE d.id != ?
        ORDER BY
          CASE
            WHEN coalesce(d.documentation_date, d.publish_date) IS NULL
              OR trim(coalesce(d.documentation_date, d.publish_date)) = '' THEN 1
            ELSE 0
          END,
          coalesce(d.documentation_date, d.publish_date) DESC,
          d.id DESC
        LIMIT ?
        """,
        [document_id, limit],
    ).fetchall()

    return rows


@bp.route("/documents/<int:document_id>/<slug>")
def detail(document_id, slug):
    db = get_db()

    document = db.execute(
        """
        SELECT d.*
        FROM documents d
        WHERE d.id = ?
        """,
        [document_id],
    ).fetchone()

    if not document:
        abort(404)

    if slug != document["slug"]:
        return redirect(
            f"/documents/{document['id']}/{document['slug']}",
            code=301,
        )

    media_rows = db.execute(
        """
        SELECT id, media_id, filename, media_type, title, title_ar, language, ocr_text, original_text, confidence
        FROM media
        WHERE document_id = ?
        ORDER BY id
        """,
        [document_id],
    ).fetchall()
    document_labels = _get_document_labels(db, document_id)
    document_locations = _get_document_locations(db, document_id)
    document_sources = _get_document_sources(db, document_id)
    document_events = _get_document_events(db, document_id)
    media_summary = _media_summary(media_rows)
    related_count = _related_count(db, document_id)
    relations = _get_related_documents(db, document_id)

    metadata = {
        "date": document["documentation_date"] or document["publish_date"],
        "department": None,
        "rights": None,
        "location": None,
    }

    return render_template(
        "document_detail.html",
        document=document,
        media_rows=media_rows,
        document_labels=document_labels,
        document_locations=document_locations,
        document_sources=document_sources,
        document_events=document_events,
        media_summary=media_summary,
        related_count=related_count,
        metadata=metadata,
        relations=relations,
        canonical_url=request.url_root.rstrip("/")
        + f"/documents/{document['id']}/{document['slug']}",
    )
