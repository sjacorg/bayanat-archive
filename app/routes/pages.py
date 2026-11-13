import re
from urllib.parse import urlparse

from flask import Blueprint, abort, current_app, make_response, render_template, request

from app import get_db

bp = Blueprint("pages", __name__)


@bp.route("/components")
def components():
    if not current_app.debug:
        abort(404)
    return render_template("components.html")


@bp.route("/about")
def about():
    return render_template("about.html")


@bp.route("/feedback", methods=["POST"])
def feedback():
    rating_raw = (request.form.get("rating") or "").strip()
    comment = (request.form.get("comment") or "").strip()
    email = (request.form.get("email") or "").strip()

    # Same-origin posts only, so other sites cannot submit on a visitor's behalf.
    if request.origin and urlparse(request.origin).netloc != request.host:
        abort(403)
    if len(comment) > 5000 or len(email) > 254:
        return render_template("partials/feedback_error.html"), 422

    try:
        rating = int(rating_raw)
    except (TypeError, ValueError):
        rating = 0

    if rating < 1 or rating > 5 or not comment:
        return render_template("partials/feedback_error.html"), 422

    if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return render_template("partials/feedback_error.html"), 422

    db = get_db()
    db.execute(
        "INSERT INTO feedback (rating, comment, email) VALUES (?, ?, ?)",
        (rating, comment, email or None),
    )
    db.commit()
    return render_template("partials/feedback_success.html"), 200


@bp.route("/health")
def health():
    return {"status": "ok"}


@bp.route("/robots.txt")
def robots():
    body = render_template("robots.txt")
    return make_response(body, 200, {"Content-Type": "text/plain"})


@bp.route("/sitemap.xml")
def sitemap():
    ids = get_db().execute("SELECT id, slug FROM documents ORDER BY id").fetchall()
    body = render_template("sitemap.xml", documents=ids)
    return make_response(body, 200, {"Content-Type": "application/xml"})
