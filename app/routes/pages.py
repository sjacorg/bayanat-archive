from flask import Blueprint, render_template

bp = Blueprint("pages", __name__)


@bp.route("/")
def index():
    return render_template("search.html")


@bp.route("/components")
def components():
    return render_template("components.html")


@bp.route("/about")
def about():
    return render_template("about.html")


@bp.route("/feedback")
def feedback():
    return render_template("feedback.html")


@bp.route("/health")
def health():
    return {"status": "ok"}
