from flask import Blueprint, abort, redirect, render_template, request

from app import get_db

bp = Blueprint("documents", __name__)


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
        metadata=metadata,
        relations=[],
        canonical_url=request.url_root.rstrip("/")
        + f"/documents/{document['id']}/{document['slug']}",
    )
