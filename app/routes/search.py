import math
from datetime import datetime
from urllib.parse import urlencode

from flask import Blueprint, make_response, render_template, request

from app import get_db

bp = Blueprint("search", __name__)

PER_PAGE = 20
ALLOWED_SORTS = {"relevance", "date_desc", "date_asc"}
ALLOWED_VIEWS = {"grid", "list"}


def _clean_list(values):
    cleaned = []
    seen = set()
    for value in values:
        if not value:
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned


def _default_sort_for_query(q):
    return "relevance" if q else "date_desc"


def _parse_sort(raw_sort, q):
    default = _default_sort_for_query(q)
    return raw_sort if raw_sort in ALLOWED_SORTS else default


def _parse_view(raw_view):
    return raw_view if raw_view in ALLOWED_VIEWS else "grid"


def _base_query(q=None, labels=None, locations=None, date_from=None, date_to=None):
    """Build search query parts.

    Returns tuple: (joins, wheres, params, order).
    """
    labels = labels or []
    locations = locations or []

    joins = []
    wheres = []
    params = []
    order = "d.publish_date DESC, d.id DESC"

    if q:
        joins.append("JOIN documents_fts f ON f.rowid = d.id")
        wheres.append("f.documents_fts MATCH ?")
        tokens = q.split()
        fts_query = " ".join(f'"{t}"*' for t in tokens)
        params.append(fts_query)
        order = "f.rank"

    if labels:
        joins.append("JOIN document_labels dl_filter ON dl_filter.document_id = d.id")
        placeholders = ",".join("?" * len(labels))
        wheres.append(f"dl_filter.title IN ({placeholders})")
        params.extend(labels)

    if locations:
        joins.append(
            "JOIN document_locations dloc_filter ON dloc_filter.document_id = d.id"
        )
        placeholders = ",".join("?" * len(locations))
        wheres.append(f"dloc_filter.full_location IN ({placeholders})")
        params.extend(locations)

    if date_from:
        wheres.append("d.publish_date >= ?")
        params.append(date_from)

    if date_to:
        wheres.append("d.publish_date <= ?")
        params.append(date_to)

    return joins, wheres, params, order


def _get_results(db, q, labels, locations, date_from, date_to, sort, page):
    joins, wheres, params, order = _base_query(
        q=q,
        labels=labels,
        locations=locations,
        date_from=date_from,
        date_to=date_to,
    )

    if sort == "date_asc":
        order = "d.publish_date ASC, d.id ASC"
    elif sort == "date_desc":
        order = "d.publish_date DESC, d.id DESC"

    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    join_sql = " ".join(joins)

    count_sql = f"SELECT COUNT(DISTINCT d.id) FROM documents d {join_sql}{where_sql}"
    total = db.execute(count_sql, params).fetchone()[0]

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


def _get_facets(db, q, labels, locations, date_from, date_to):
    """Get label/location facet counts for the current filtered set."""
    joins, wheres, params, _ = _base_query(
        q=q,
        labels=labels,
        locations=locations,
        date_from=date_from,
        date_to=date_to,
    )
    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    join_sql = " ".join(joins)

    label_sql = f"""
        SELECT dl.title, COUNT(DISTINCT d.id) as count
        FROM documents d {join_sql}
        JOIN document_labels dl ON dl.document_id = d.id
        {where_sql}
        GROUP BY dl.title
        ORDER BY count DESC
        LIMIT 20
    """
    facet_labels = db.execute(label_sql, params).fetchall()

    location_wheres = list(wheres) + ["dloc.full_location IS NOT NULL"]
    location_where_sql = " WHERE " + " AND ".join(location_wheres)
    location_sql = f"""
        SELECT dloc.full_location, COUNT(DISTINCT d.id) as count
        FROM documents d {join_sql}
        JOIN document_locations dloc ON dloc.document_id = d.id
        {location_where_sql}
        GROUP BY dloc.full_location
        ORDER BY count DESC
        LIMIT 20
    """
    facet_locations = db.execute(location_sql, params).fetchall()

    return {"labels": facet_labels, "locations": facet_locations}


def _facet_options(facets):
    all_labels = [row["title"] for row in facets["labels"] if row["title"]]
    all_locations = [
        row["full_location"] for row in facets["locations"] if row["full_location"]
    ]
    label_counts = {row["title"]: row["count"] for row in facets["labels"] if row["title"]}
    location_counts = {
        row["full_location"]: row["count"]
        for row in facets["locations"]
        if row["full_location"]
    }
    return all_labels, all_locations, label_counts, location_counts


def _get_timeline_bins(db):
    rows = db.execute(
        """
        SELECT CAST(substr(publish_date, 1, 4) AS INTEGER) AS year, COUNT(*) AS count
        FROM documents
        WHERE publish_date IS NOT NULL
          AND length(publish_date) >= 4
          AND substr(publish_date, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
        GROUP BY year
        ORDER BY year
        """
    ).fetchall()

    timeline_bins = [{"year": row["year"], "count": row["count"]} for row in rows]
    if timeline_bins:
        timeline_min_year = timeline_bins[0]["year"]
        timeline_max_year = timeline_bins[-1]["year"]
    else:
        current_year = datetime.now().year
        timeline_bins = [{"year": current_year, "count": 0}]
        timeline_min_year = current_year
        timeline_max_year = current_year

    return timeline_bins, timeline_min_year, timeline_max_year


def _build_search_url(
    q,
    labels,
    locations,
    sort,
    view,
    date_from,
    date_to,
    page=1,
):
    params = []
    if q:
        params.append(("q", q))
    for label in labels:
        params.append(("label", label))
    for location in locations:
        params.append(("location", location))
    if date_from:
        params.append(("date_from", date_from))
    if date_to:
        params.append(("date_to", date_to))

    default_sort = _default_sort_for_query(q)
    if sort != default_sort:
        params.append(("sort", sort))
    if view != "grid":
        params.append(("view", view))
    if page > 1:
        params.append(("page", page))

    qs = urlencode(params, doseq=True)
    return "/search" + (f"?{qs}" if qs else "")


def _parse_date_bounds(args):
    """Parse canonical date bounds from query params.

    Supports legacy params (`year_start`, `year_end`) for backward compatibility.
    """
    date_from = args.get("date_from", "").strip() or None
    date_to = args.get("date_to", "").strip() or None

    if not date_from:
        year_start = args.get("year_start", "").strip()
        if year_start.isdigit():
            date_from = f"{year_start[:4]}-01-01"
    if not date_to:
        year_end = args.get("year_end", "").strip()
        if year_end.isdigit():
            date_to = f"{year_end[:4]}-12-31"

    return date_from, date_to


def _parse_search_request(args):
    """Normalize request args into a canonical search payload."""
    q = args.get("q", "").strip()
    labels = _clean_list(args.getlist("label"))
    locations = _clean_list(args.getlist("location"))
    date_from, date_to = _parse_date_bounds(args)
    sort = _parse_sort(args.get("sort", ""), q=q)
    view = _parse_view(args.get("view", "grid"))
    page = max(1, args.get("page", 1, type=int))

    return {
        "q": q,
        "labels": labels,
        "locations": locations,
        "date_from": date_from,
        "date_to": date_to,
        "sort": sort,
        "view": view,
        "page": page,
    }


def _active_filters(
    q,
    labels,
    locations,
    sort,
    view,
    date_from,
    date_to,
    min_year,
    max_year,
):
    active = []

    for selected_label in labels:
        remove_labels = list(labels)
        remove_labels.remove(selected_label)
        active.append(
            {
                "label": selected_label,
                "remove_url": _build_search_url(
                    q=q,
                    labels=remove_labels,
                    locations=locations,
                    sort=sort,
                    view=view,
                    date_from=date_from,
                    date_to=date_to,
                ),
            }
        )

    for selected_location in locations:
        remove_locations = list(locations)
        remove_locations.remove(selected_location)
        active.append(
            {
                "label": selected_location,
                "remove_url": _build_search_url(
                    q=q,
                    labels=labels,
                    locations=remove_locations,
                    sort=sort,
                    view=view,
                    date_from=date_from,
                    date_to=date_to,
                ),
            }
        )

    if date_from or date_to:
        from_year = date_from[:4] if date_from else str(min_year)
        to_year = date_to[:4] if date_to else str(max_year)
        range_label = from_year if from_year == to_year else f"{from_year} - {to_year}"
        active.append(
            {
                "label": range_label,
                "remove_url": _build_search_url(
                    q=q,
                    labels=labels,
                    locations=locations,
                    sort=sort,
                    view=view,
                    date_from=None,
                    date_to=None,
                ),
            }
        )

    return active


def _get_document_media(db, doc_ids):
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


def _search_shell_context(db):
    try:
        total = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        facets = _get_facets(
            db=db,
            q=None,
            labels=[],
            locations=[],
            date_from=None,
            date_to=None,
        )
        timeline_bins, timeline_min_year, timeline_max_year = _get_timeline_bins(db)
    except Exception:
        total = 0
        facets = {"labels": [], "locations": []}
        now_year = datetime.now().year
        timeline_bins = [{"year": now_year, "count": 0}]
        timeline_min_year = now_year
        timeline_max_year = now_year

    all_labels, all_locations, label_counts, location_counts = _facet_options(facets)
    return {
        "total": total,
        "all_labels": all_labels,
        "all_locations": all_locations,
        "label_counts": label_counts,
        "location_counts": location_counts,
        "timeline_bins": timeline_bins,
        "timeline_min_year": timeline_min_year,
        "timeline_max_year": timeline_max_year,
    }


def _render_results_partial_response(
    *,
    q,
    labels,
    locations,
    date_from,
    date_to,
    sort,
    view,
    page,
    results,
    total,
    total_pages,
    facets,
    thumbnails,
    doc_labels,
    active_filters,
    clear_url,
    timeline_min_year,
    timeline_max_year,
):
    """Render HTMX results fragment and attach canonical URL push header."""
    response = make_response(
        render_template(
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
            selected_labels=labels,
            selected_locations=locations,
            date_from=date_from,
            date_to=date_to,
            sort=sort,
            view=view,
            active_filters=active_filters,
            clear_url=clear_url,
            timeline_min_year=timeline_min_year,
            timeline_max_year=timeline_max_year,
        )
    )
    # Keep browser URL canonical when HTMX pushes history (drop empty params).
    response.headers["HX-Push-Url"] = _build_search_url(
        q=q,
        labels=labels,
        locations=locations,
        sort=sort,
        view=view,
        date_from=date_from,
        date_to=date_to,
        page=page,
    )
    return response


@bp.route("/")
def index():
    db = get_db()
    return render_template("search.html", **_search_shell_context(db))


@bp.route("/search")
def search():
    db = get_db()
    is_htmx = request.headers.get("HX-Request", "").lower() == "true"

    if not is_htmx:
        # Direct loads of /search must render the full page shell (with CSS/JS assets),
        # while HTMX requests to this endpoint still return only partial results.
        return render_template("search.html", **_search_shell_context(db))

    params = _parse_search_request(request.args)
    q = params["q"]
    labels = params["labels"]
    locations = params["locations"]
    date_from = params["date_from"]
    date_to = params["date_to"]
    sort = params["sort"]
    view = params["view"]
    page = params["page"]

    results, total, total_pages = _get_results(
        db=db,
        q=q or None,
        labels=labels,
        locations=locations,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
        page=page,
    )

    facets = _get_facets(
        db=db,
        q=q or None,
        labels=labels,
        locations=locations,
        date_from=date_from,
        date_to=date_to,
    )
    timeline_bins, timeline_min_year, timeline_max_year = _get_timeline_bins(db)

    active_filters = _active_filters(
        q=q,
        labels=labels,
        locations=locations,
        sort=sort,
        view=view,
        date_from=date_from,
        date_to=date_to,
        min_year=timeline_min_year,
        max_year=timeline_max_year,
    )
    clear_url = _build_search_url(
        q=q,
        labels=[],
        locations=[],
        sort=sort,
        view=view,
        date_from=None,
        date_to=None,
        page=1,
    )

    doc_ids = [row["id"] for row in results]
    thumbnails = _get_document_media(db, doc_ids)
    doc_labels = _get_document_labels(db, doc_ids)

    return _render_results_partial_response(
        q=q,
        labels=labels,
        locations=locations,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
        view=view,
        page=page,
        results=results,
        total=total,
        total_pages=total_pages,
        facets=facets,
        thumbnails=thumbnails,
        doc_labels=doc_labels,
        active_filters=active_filters,
        clear_url=clear_url,
        timeline_min_year=timeline_min_year,
        timeline_max_year=timeline_max_year,
    )
