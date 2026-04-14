import re

from flask import Blueprint, make_response, redirect, render_template, request, url_for

bp = Blueprint("pages", __name__)


@bp.route("/components")
def components():
    return render_template("components.html")


@bp.route("/about")
def about():
    return render_template("about.html")


@bp.route("/feedback", methods=["GET", "POST"])
def feedback():
    if request.method == "GET":
        return redirect(url_for("search.index"), code=302)

    try:
        rating_raw = (request.form.get("rating") or "").strip()
        comment = (request.form.get("comment") or "").strip()
        email = (request.form.get("email") or "").strip()

        try:
            rating = int(rating_raw)
        except (TypeError, ValueError):
            rating = 0

        if rating < 1 or rating > 5 or not comment:
            return render_template("partials/feedback_error.html"), 200

        if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
            return render_template("partials/feedback_error.html"), 200

        # TODO: persist/email submission
        return render_template("partials/feedback_success.html"), 200
    except Exception:
        return render_template("partials/feedback_error.html"), 200


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
