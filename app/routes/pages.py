from collections import Counter
from urllib.parse import urlencode

from flask import Blueprint, make_response, redirect, render_template, request, url_for

bp = Blueprint("pages", __name__)


# ── Mock documents (replace with DB queries once real data is imported) ────────

_PAGE_SIZE = 12
_FACET_KEYS = ("type", "location", "department", "source")
_DEFAULT_SORT = "date_new"
_DEFAULT_VIEW = "grid"

MOCK_DOCUMENTS = [
    {
        "id": 1,
        "title": "Security Directive on Detention Procedures — Aleppo Branch",
        "type": "Audios",
        "date": "2011-08-14",
        "date_display": "14 Aug 2011",
        "department": "General Intelligence Directorate",
        "location": "Aleppo",
        "source": "Syrian Archive",
        "snippet": "Instructions issued to branch commanders regarding the processing and transfer of detainees following civil unrest in northern districts of the city.",
        "pages": 4,
    },
    {
        "id": 2,
        "title": "Presidential Decree No. 161 — Emergency Powers Extension",
        "type": "Documents",
        "date": "2011-04-21",
        "date_display": "21 Apr 2011",
        "department": "Presidential Palace",
        "location": "Damascus",
        "source": "Commission for International Justice and Accountability",
        "snippet": "Extension of emergency law provisions granting expanded detention authority to security services across all governorates.",
        "pages": 2,
    },
    {
        "id": 3,
        "title": "Transfer Order for Political Prisoners — Homs Governorate",
        "type": "Photos",
        "date": "2012-02-09",
        "date_display": "9 Feb 2012",
        "department": "Ministry of Interior",
        "location": "Homs",
        "source": "Caesar Files",
        "snippet": "Directive authorising the movement of individuals held under Law No. 49 to Saydnaya Military Prison pending trial.",
        "pages": 1,
    },
    {
        "id": 4,
        "title": "Air Force Intelligence Report on Hama Protests",
        "type": "Audios",
        "date": "2011-07-31",
        "date_display": "31 Jul 2011",
        "department": "Air Force Intelligence",
        "location": "Hama",
        "source": "Syrian Archive",
        "snippet": "Assessment of protest leadership structure and alleged foreign funding sources based on intercepted communications and informant reports.",
        "pages": 7,
    },
    {
        "id": 5,
        "title": "Correspondence: Coordination Between Security Branches",
        "type": "Videos",
        "date": "2012-05-18",
        "date_display": "18 May 2012",
        "department": "Military Intelligence",
        "location": "Damascus",
        "source": "Human Rights Watch",
        "snippet": "Internal communication between Branch 215 and Branch 291 regarding shared detainee lists and interrogation protocols.",
        "pages": 3,
    },
    {
        "id": 6,
        "title": "Military Court Ruling — Case No. 882/2012",
        "type": "Photos",
        "date": "2012-11-03",
        "date_display": "3 Nov 2012",
        "department": "Ministry of Defense",
        "location": "Damascus",
        "source": "Commission for International Justice and Accountability",
        "snippet": "Verdict issued by the Military Field Court in absentia for 14 individuals charged with undermining national security.",
        "pages": 5,
    },
    {
        "id": 7,
        "title": "Security Report: Deir ez-Zor Tribal Leadership Assessment",
        "type": "Documents",
        "date": "2013-01-12",
        "date_display": "12 Jan 2013",
        "department": "Political Security",
        "location": "Deir ez-Zor",
        "source": "Syrian Archive",
        "snippet": "Analysis of tribal dynamics in eastern Syria and recommendations for co-opting or neutralising key figures perceived as sympathetic to the opposition.",
        "pages": 9,
    },
    {
        "id": 8,
        "title": "Detention Register — Branch 285, October 2011",
        "type": "Photos",
        "date": "2011-10-01",
        "date_display": "1 Oct 2011",
        "department": "General Intelligence Directorate",
        "location": "Damascus",
        "source": "Caesar Files",
        "snippet": "Monthly register of individuals held at the General Intelligence facility listing detainee names, dates of arrest, and current status.",
        "pages": 12,
    },
    {
        "id": 9,
        "title": "Order for Release of Detainees — Reconciliation Decree",
        "type": "Documents",
        "date": "2013-06-05",
        "date_display": "5 Jun 2013",
        "department": "Presidential Palace",
        "location": "Damascus",
        "source": "Amnesty International",
        "snippet": "Amnesty decree ordering the conditional release of detainees arrested during March–December 2011, subject to written pledges of non-participation.",
        "pages": 3,
    },
    {
        "id": 10,
        "title": "Military Intelligence Directive — Latakia Operations",
        "type": "Documents",
        "date": "2012-08-22",
        "date_display": "22 Aug 2012",
        "department": "Military Intelligence",
        "location": "Latakia",
        "source": "Syrian Archive",
        "snippet": "Operational orders for Military Intelligence units in Latakia governorate, including rules of engagement and reporting chains during Phase II operations.",
        "pages": 6,
    },
    {
        "id": 11,
        "title": "Ba'ath Party Report on Opposition Networks — Daraa",
        "type": "Audios",
        "date": "2011-05-28",
        "date_display": "28 May 2011",
        "department": "Ba'ath Party Regional Command",
        "location": "Daraa",
        "source": "Human Rights Watch",
        "snippet": "Report prepared for the Regional Command identifying individuals involved in early protest movements and their alleged organisational affiliations.",
        "pages": 8,
    },
    {
        "id": 12,
        "title": "Administrative Circular on Media Reporting Restrictions",
        "type": "Photos",
        "date": "2011-09-14",
        "date_display": "14 Sep 2011",
        "department": "Ministry of Interior",
        "location": "Damascus",
        "source": "Syrian Archive",
        "snippet": "Circular issued to all governorate directorates prohibiting the provision of information to foreign media without prior authorisation from the Ministry.",
        "pages": 2,
    },
    {
        "id": 13,
        "title": "Correspondence: Request for Additional Detention Capacity",
        "type": "Videos",
        "date": "2012-03-07",
        "date_display": "7 Mar 2012",
        "department": "General Intelligence Directorate",
        "location": "Homs",
        "source": "Commission for International Justice and Accountability",
        "snippet": "Letter from Homs branch commander to Damascus headquarters requesting expansion of holding facilities following increased intake after operations in Baba Amr.",
        "pages": 2,
    },
    {
        "id": 14,
        "title": "Security Report: Border Crossing Surveillance — Deir ez-Zor",
        "type": "Documents",
        "date": "2013-04-30",
        "date_display": "30 Apr 2013",
        "department": "Military Intelligence",
        "location": "Deir ez-Zor",
        "source": "Syrian Archive",
        "snippet": "Surveillance report on movement of persons and materiel across the Iraqi border, with notation of individuals flagged for investigation.",
        "pages": 5,
    },
    {
        "id": 15,
        "title": "Military Court Judgment — Mass Trial, Damascus 2013",
        "type": "Photos",
        "date": "2013-09-17",
        "date_display": "17 Sep 2013",
        "department": "Ministry of Defense",
        "location": "Damascus",
        "source": "Amnesty International",
        "snippet": "Judgment against 47 defendants tried collectively before the Counter-Terrorism Court, with sentences ranging from five years to death.",
        "pages": 18,
    },
    {
        "id": 16,
        "title": "Political Security Weekly Bulletin — Aleppo, March 2012",
        "type": "Audios",
        "date": "2012-03-19",
        "date_display": "19 Mar 2012",
        "department": "Political Security",
        "location": "Aleppo",
        "source": "Caesar Files",
        "snippet": "Weekly intelligence summary covering demonstration activity, identified organisers, and recommended actions for the coming week.",
        "pages": 4,
    },
    {
        "id": 17,
        "title": "Presidential Decree on Counter-Terrorism Court Establishment",
        "type": "Documents",
        "date": "2012-07-02",
        "date_display": "2 Jul 2012",
        "department": "Presidential Palace",
        "location": "Damascus",
        "source": "Human Rights Watch",
        "snippet": "Decree establishing the Counter-Terrorism Court with jurisdiction over cases referred by any security or intelligence branch, removing civilian oversight.",
        "pages": 4,
    },
    {
        "id": 18,
        "title": "Correspondence: Inter-Branch Coordination on Disappearances",
        "type": "Videos",
        "date": "2014-02-11",
        "date_display": "11 Feb 2014",
        "department": "Air Force Intelligence",
        "location": "Damascus",
        "source": "Syrian Archive",
        "snippet": "Communication directing branches not to confirm or deny holding status of any individual in response to family inquiries.",
        "pages": 1,
    },
    {
        "id": 19,
        "title": "Military Order — Siege Operations Protocol, Homs",
        "type": "Audios",
        "date": "2012-02-01",
        "date_display": "1 Feb 2012",
        "department": "Ministry of Defense",
        "location": "Homs",
        "source": "Commission for International Justice and Accountability",
        "snippet": "Operational protocol for the conduct of siege operations in urban areas, including supply line interdiction and civilian movement control measures.",
        "pages": 11,
    },
    {
        "id": 20,
        "title": "Administrative Order — Confiscation of Property, Daraa",
        "type": "Photos",
        "date": "2013-11-25",
        "date_display": "25 Nov 2013",
        "department": "Ministry of Interior",
        "location": "Daraa",
        "source": "Syrian Archive",
        "snippet": "Order for the confiscation of real property belonging to individuals convicted or suspected of offences against state security, effective immediately.",
        "pages": 3,
    },
]

_DOC_YEARS = [int(d["date"][:4]) for d in MOCK_DOCUMENTS]
_MIN_YEAR = min(_DOC_YEARS)
_MAX_YEAR = max(_DOC_YEARS)
_YEAR_COUNTS = Counter(_DOC_YEARS)
_TIMELINE_BINS = [
    {"year": year, "count": _YEAR_COUNTS.get(year, 0)}
    for year in range(_MIN_YEAR, _MAX_YEAR + 1)
]


def _parse_year(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _get_search_params():
    q = request.args.get("q", "").strip()
    selected = {key: request.args.getlist(key) for key in _FACET_KEYS}
    sort = request.args.get("sort", _DEFAULT_SORT)
    view = request.args.get("view", _DEFAULT_VIEW)
    year_start = _parse_year(request.args.get("year_start"), _MIN_YEAR)
    year_end = _parse_year(request.args.get("year_end"), _MAX_YEAR)
    year_start = min(max(year_start, _MIN_YEAR), _MAX_YEAR)
    year_end = min(max(year_end, _MIN_YEAR), _MAX_YEAR)
    if year_start > year_end:
        year_start, year_end = year_end, year_start
    try:
        page = max(1, int(request.args.get("page") or 1))
    except ValueError:
        page = 1
    return q, selected, sort, view, page, year_start, year_end


def _filter_documents(documents, q, selected, year_start, year_end):
    q_lower = q.lower()
    docs = [
        d
        for d in documents
        if not q or q_lower in d["title"].lower() or q_lower in d["snippet"].lower()
    ]

    for key, selected_values in selected.items():
        if selected_values:
            allowed = set(selected_values)
            docs = [d for d in docs if d[key] in allowed]

    docs = [
        d for d in docs
        if year_start <= int(d["date"][:4]) <= year_end
    ]
    return docs


def _sort_documents(documents, sort):
    docs = list(documents)
    if sort == "date_new":
        docs.sort(key=lambda d: d["date"], reverse=True)
    elif sort == "date_old":
        docs.sort(key=lambda d: d["date"])
    return docs


def _paginate_documents(documents, page, page_size):
    total = len(documents)
    total_pages = max(1, (total + page_size - 1) // page_size)
    page = min(page, total_pages)
    start = (page - 1) * page_size
    end = start + page_size
    return documents[start:end], total, page, total_pages


def _search_url(q, selected, sort, view, year_start, year_end, exclude=None):
    params = []
    if q:
        params.append(("q", q))

    for key in _FACET_KEYS:
        for value in selected[key]:
            if exclude == (key, value):
                continue
            params.append((key, value))

    params.extend((
        ("year_start", year_start),
        ("year_end", year_end),
        ("sort", sort),
        ("view", view),
    ))
    return "/search?" + urlencode(params, doseq=True)


def _active_filters(q, selected, sort, view, year_start, year_end):
    filters = []
    for key in _FACET_KEYS:
        filters.extend(
            {
                "label": value,
                "remove_url": _search_url(
                    q, selected, sort, view, year_start, year_end, exclude=(key, value)
                ),
            }
            for value in selected[key]
        )
    return filters


def _facet_counts(documents):
    return {key: Counter(d[key] for d in documents) for key in _FACET_KEYS}


# ── Routes ─────────────────────────────────────────────────────────────────────

@bp.route("/")
def index():
    facet_counts = _facet_counts(MOCK_DOCUMENTS)
    return render_template(
        "search.html",
        all_types=sorted(facet_counts["type"]),
        all_locations=sorted(facet_counts["location"]),
        all_departments=sorted(facet_counts["department"]),
        all_sources=sorted(facet_counts["source"]),
        type_counts=facet_counts["type"],
        location_counts=facet_counts["location"],
        department_counts=facet_counts["department"],
        source_counts=facet_counts["source"],
        timeline_bins=_TIMELINE_BINS,
        timeline_min_year=_MIN_YEAR,
        timeline_max_year=_MAX_YEAR,
    )


@bp.route("/search")
def search():
    # Non-HTMX direct visits get redirected to / with params preserved
    if not request.headers.get("HX-Request"):
        qs = request.query_string.decode()
        return redirect(url_for("pages.index") + ("?" + qs if qs else ""))

    q, selected, sort, view, page, year_start, year_end = _get_search_params()

    docs = _filter_documents(MOCK_DOCUMENTS, q, selected, year_start, year_end)
    docs = _sort_documents(docs, sort)
    paginated, total, page, total_pages = _paginate_documents(docs, page, _PAGE_SIZE)

    ctx = dict(
        documents=paginated,
        total=total,
        page=page,
        total_pages=total_pages,
        q=q,
        sort=sort,
        view=view,
        year_start=year_start,
        year_end=year_end,
        active_filters=_active_filters(q, selected, sort, view, year_start, year_end),
        clear_url=_search_url(
            q, {key: [] for key in _FACET_KEYS}, sort, view, year_start, year_end
        ),
    )

    return render_template("partials/search_results.html", **ctx)


@bp.route("/components")
def components():
    return render_template("components.html")


@bp.route("/about")
def about():
    return render_template("about.html")


@bp.route("/feedback", methods=["GET", "POST"])
def feedback():
    if request.method == "POST":
        try:
            # TODO: persist/email submission
            _ = request.form.get("rating")
            _ = request.form.get("comment", "").strip()
            _ = request.form.get("email", "").strip() or None
            return render_template("partials/feedback_success.html"), 200
        except Exception:
            return render_template("partials/feedback_error.html"), 200
    return render_template("feedback.html")


@bp.route("/health")
def health():
    return {"status": "ok"}


@bp.route("/robots.txt")
def robots():
    body = render_template("robots.txt")
    return make_response(body, 200, {"Content-Type": "text/plain"})


@bp.route("/sitemap.xml")
def sitemap():
    body = render_template("sitemap.xml")
    return make_response(body, 200, {"Content-Type": "application/xml"})
