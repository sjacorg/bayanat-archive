from flask import Blueprint, make_response, render_template, request

bp = Blueprint("pages", __name__)


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
