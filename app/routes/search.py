import math

from flask import Blueprint, render_template, request

from app import get_db

bp = Blueprint("search", __name__)

PER_PAGE = 20


def _base_query(db, q=None, label=None, location=None, date_from=None, date_to=None):
    """Build search query parts. Returns (where_clauses, params, join, order).

    When q is provided, joins FTS5 for full-text search with BM25 ranking.
    Otherwise, returns all documents.
    """
    joins = []
    wheres = []
    params = []
    order = "d.publish_date DESC, d.id DESC"

    if q:
        joins.append("JOIN documents_fts f ON f.rowid = d.id")
        wheres.append("f.documents_fts MATCH ?")
        # Add * suffix for prefix matching (e.g. "comm" matches "communication")
        # Escape quotes in query, wrap each token with *
        tokens = q.split()
        fts_query = " ".join(f'"{t}"*' for t in tokens)
        params.append(fts_query)
        order = "f.rank"  # BM25 relevance (lower = better)

    if label:
        joins.append("JOIN document_labels dl_filter ON dl_filter.document_id = d.id")
        wheres.append("dl_filter.title = ?")
        params.append(label)

    if location:
        joins.append(
            "JOIN document_locations dloc_filter ON dloc_filter.document_id = d.id"
        )
        wheres.append("dloc_filter.full_location = ?")
        params.append(location)

    if date_from:
        wheres.append("d.publish_date >= ?")
        params.append(date_from)

    if date_to:
        wheres.append("d.publish_date <= ?")
        params.append(date_to)

    return joins, wheres, params, order


def _get_results(db, q, label, location, date_from, date_to, sort, page):
    joins, wheres, params, order = _base_query(
        db, q, label, location, date_from, date_to
    )

    if sort == "date_asc":
        order = "d.publish_date ASC, d.id ASC"
    elif sort == "date_desc":
        order = "d.publish_date DESC, d.id DESC"
    # sort == "relevance" keeps FTS rank or default date desc

    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    join_sql = " ".join(joins)

    # Count
    count_sql = f"SELECT COUNT(DISTINCT d.id) FROM documents d {join_sql}{where_sql}"
    total = db.execute(count_sql, params).fetchone()[0]

    # Results with snippet if searching
    offset = (page - 1) * PER_PAGE
    if q:
        select = """
            SELECT DISTINCT d.*,
                snippet(documents_fts, 0, '<mark>', '</mark>', '...', 32) as snippet_title,
                snippet(documents_fts, 2, '<mark>', '</mark>', '...', 48) as snippet_desc
            FROM documents d
        """
    else:
        select = "SELECT DISTINCT d.*, NULL as snippet_title, NULL as snippet_desc FROM documents d "

    results_sql = f"{select}{join_sql}{where_sql} ORDER BY {order} LIMIT ? OFFSET ?"
    results = db.execute(results_sql, params + [PER_PAGE, offset]).fetchall()

    total_pages = math.ceil(total / PER_PAGE) if total > 0 else 1

    return results, total, total_pages


def _get_facets(db, q, label, location, date_from, date_to):
    """Get facet counts for the current result set."""
    joins, wheres, params, _ = _base_query(db, q, label, location, date_from, date_to)
    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    join_sql = " ".join(joins)

    # Label facets
    label_sql = f"""
        SELECT dl.title, COUNT(DISTINCT d.id) as count
        FROM documents d {join_sql}
        JOIN document_labels dl ON dl.document_id = d.id
        {where_sql}
        GROUP BY dl.title
        ORDER BY count DESC
        LIMIT 20
    """
    labels = db.execute(label_sql, params).fetchall()

    # Location facets
    location_sql = f"""
        SELECT dloc.full_location, COUNT(DISTINCT d.id) as count
        FROM documents d {join_sql}
        JOIN document_locations dloc ON dloc.document_id = d.id
        {where_sql}
        AND dloc.full_location IS NOT NULL
        GROUP BY dloc.full_location
        ORDER BY count DESC
        LIMIT 20
    """
    locations = db.execute(location_sql, params).fetchall()

    return {"labels": labels, "locations": locations}


def _get_document_media(db, doc_ids):
    """Get first media item per document for thumbnails."""
    if not doc_ids:
        return {}
    placeholders = ",".join("?" * len(doc_ids))
    rows = db.execute(
        f"""SELECT document_id, filename, media_type
            FROM media
            WHERE document_id IN ({placeholders})
            ORDER BY document_id, id""",
        doc_ids,
    ).fetchall()
    thumbnails = {}
    for row in rows:
        if row["document_id"] not in thumbnails:
            thumbnails[row["document_id"]] = row
    return thumbnails


def _get_document_labels(db, doc_ids):
    """Get labels per document for result cards."""
    if not doc_ids:
        return {}
    placeholders = ",".join("?" * len(doc_ids))
    rows = db.execute(
        f"""SELECT document_id, title, verified
            FROM document_labels
            WHERE document_id IN ({placeholders})
            ORDER BY verified DESC, title""",
        doc_ids,
    ).fetchall()
    labels = {}
    for row in rows:
        labels.setdefault(row["document_id"], []).append(row)
    return labels


@bp.route("/")
def index():
    db = get_db()
    try:
        total = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    except Exception:
        total = 0
    return render_template("search.html", total=total)


@bp.route("/search")
def search():
    db = get_db()
    q = request.args.get("q", "").strip()
    label = request.args.get("label", "").strip() or None
    location = request.args.get("location", "").strip() or None
    date_from = request.args.get("date_from", "").strip() or None
    date_to = request.args.get("date_to", "").strip() or None
    sort = request.args.get("sort", "relevance" if q else "date_desc")
    page = request.args.get("page", 1, type=int)
    page = max(1, page)

    results, total, total_pages = _get_results(
        db, q or None, label, location, date_from, date_to, sort, page
    )

    doc_ids = [r["id"] for r in results]
    thumbnails = _get_document_media(db, doc_ids)
    doc_labels = _get_document_labels(db, doc_ids)
    facets = _get_facets(db, q or None, label, location, date_from, date_to)

    return render_template(
        "partials/search_results.html",
        results=results,
        thumbnails=thumbnails,
        doc_labels=doc_labels,
        facets=facets,
        total=total,
        page=page,
        total_pages=total_pages,
        per_page=PER_PAGE,
        q=q,
        label=label,
        location=location,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
    )
