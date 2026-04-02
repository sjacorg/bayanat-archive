from collections import Counter

from flask import Blueprint, make_response, redirect, render_template, request, url_for

bp = Blueprint("pages", __name__)


# ── Mock documents (replace with DB queries once real data is imported) ────────

_PAGE_SIZE = 12

MOCK_DOCUMENTS = [
    {
        "id": 1,
        "title": "Security Directive on Detention Procedures — Aleppo Branch",
        "type": "Intelligence Report",
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
        "type": "Presidential Decree",
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
        "type": "Administrative Order",
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
        "type": "Intelligence Report",
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
        "type": "Correspondence",
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
        "type": "Court Document",
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
        "type": "Security Report",
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
        "type": "Administrative Order",
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
        "type": "Presidential Decree",
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
        "type": "Military Order",
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
        "type": "Intelligence Report",
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
        "type": "Administrative Order",
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
        "type": "Correspondence",
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
        "type": "Security Report",
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
        "type": "Court Document",
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
        "type": "Security Report",
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
        "type": "Presidential Decree",
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
        "type": "Correspondence",
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
        "type": "Military Order",
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
        "type": "Administrative Order",
        "date": "2013-11-25",
        "date_display": "25 Nov 2013",
        "department": "Ministry of Interior",
        "location": "Daraa",
        "source": "Syrian Archive",
        "snippet": "Order for the confiscation of real property belonging to individuals convicted or suspected of offences against state security, effective immediately.",
        "pages": 3,
    },
]


# ── Routes ─────────────────────────────────────────────────────────────────────

@bp.route("/")
def index():
    q = request.args.get("q", "").strip()
    selected_types = request.args.getlist("type")
    selected_locations = request.args.getlist("location")
    selected_departments = request.args.getlist("department")
    selected_sources = request.args.getlist("source")
    sort = request.args.get("sort", "date_new")
    view = request.args.get("view", "grid")

    type_counts = Counter(d["type"] for d in MOCK_DOCUMENTS)
    location_counts = Counter(d["location"] for d in MOCK_DOCUMENTS)
    department_counts = Counter(d["department"] for d in MOCK_DOCUMENTS)
    source_counts = Counter(d["source"] for d in MOCK_DOCUMENTS)

    return render_template(
        "search.html",
        q=q,
        sort=sort,
        view=view,
        selected_types=selected_types,
        selected_locations=selected_locations,
        selected_departments=selected_departments,
        selected_sources=selected_sources,
        type_counts=type_counts,
        location_counts=location_counts,
        department_counts=department_counts,
        source_counts=source_counts,
        all_types=sorted(type_counts.keys()),
        all_locations=sorted(location_counts.keys()),
        all_departments=sorted(department_counts.keys()),
        all_sources=sorted(source_counts.keys()),
    )


@bp.route("/search")
def search():
    # Non-HTMX direct visits get redirected to / with params preserved
    if not request.headers.get("HX-Request"):
        qs = request.query_string.decode()
        return redirect(url_for("pages.index") + ("?" + qs if qs else ""))

    q = request.args.get("q", "").strip()
    selected_types = request.args.getlist("type")
    selected_locations = request.args.getlist("location")
    selected_departments = request.args.getlist("department")
    selected_sources = request.args.getlist("source")
    sort = request.args.get("sort", "date_new")
    view = request.args.get("view", "grid")
    try:
        page = max(1, int(request.args.get("page") or 1))
    except ValueError:
        page = 1

    q_lower = q.lower()

    # Q-filtered base used for facet counts (counts shown regardless of active facets)
    base = [
        d for d in MOCK_DOCUMENTS
        if not q or q_lower in d["title"].lower() or q_lower in d["snippet"].lower()
    ]

    type_counts = Counter(d["type"] for d in base)
    location_counts = Counter(d["location"] for d in base)
    department_counts = Counter(d["department"] for d in base)
    source_counts = Counter(d["source"] for d in base)

    # Apply facet filters on top of base
    docs = list(base)
    if selected_types:
        docs = [d for d in docs if d["type"] in selected_types]
    if selected_locations:
        docs = [d for d in docs if d["location"] in selected_locations]
    if selected_departments:
        docs = [d for d in docs if d["department"] in selected_departments]
    if selected_sources:
        docs = [d for d in docs if d["source"] in selected_sources]

    if sort == "date_new":
        docs.sort(key=lambda d: d["date"], reverse=True)
    elif sort == "date_old":
        docs.sort(key=lambda d: d["date"])

    total = len(docs)
    total_pages = max(1, (total + _PAGE_SIZE - 1) // _PAGE_SIZE)
    page = min(page, total_pages)
    paginated = docs[(page - 1) * _PAGE_SIZE: page * _PAGE_SIZE]

    # Build server-side remove URLs for active filter badges
    def _remove_url(excl_param, excl_value):
        parts = []
        if q:
            parts.append(f"q={q}")
        for v in selected_types:
            if not (excl_param == "type" and excl_value == v):
                parts.append(f"type={v}")
        for v in selected_locations:
            if not (excl_param == "location" and excl_value == v):
                parts.append(f"location={v}")
        for v in selected_departments:
            if not (excl_param == "department" and excl_value == v):
                parts.append(f"department={v}")
        for v in selected_sources:
            if not (excl_param == "source" and excl_value == v):
                parts.append(f"source={v}")
        parts += [f"sort={sort}", f"view={view}"]
        return "/search?" + "&".join(parts)

    active_filters = (
        [{"label": t, "remove_url": _remove_url("type", t)} for t in selected_types]
        + [{"label": l, "remove_url": _remove_url("location", l)} for l in selected_locations]
        + [{"label": d, "remove_url": _remove_url("department", d)} for d in selected_departments]
        + [{"label": s, "remove_url": _remove_url("source", s)} for s in selected_sources]
    )

    clear_url = "/search?" + "&".join(
        ([f"q={q}"] if q else []) + [f"sort={sort}", f"view={view}"]
    )

    ctx = dict(
        documents=paginated,
        total=total,
        page=page,
        total_pages=total_pages,
        q=q,
        sort=sort,
        view=view,
        selected_types=selected_types,
        selected_locations=selected_locations,
        selected_departments=selected_departments,
        selected_sources=selected_sources,
        active_filters=active_filters,
        clear_url=clear_url,
        type_counts=type_counts,
        location_counts=location_counts,
        department_counts=department_counts,
        source_counts=source_counts,
        all_types=sorted(type_counts.keys()),
        all_locations=sorted(location_counts.keys()),
        all_departments=sorted(department_counts.keys()),
        all_sources=sorted(source_counts.keys()),
    )

    return render_template("partials/search_documents.html", **ctx)


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
