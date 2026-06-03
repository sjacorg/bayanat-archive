import os
import re
import sqlite3
from datetime import datetime
from markupsafe import Markup, escape

from flask import Flask, g, render_template


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            os.environ.get("DATABASE_PATH", "data/archive.db"),
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


_ARABIC_SCRIPT_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+")


def _contains_arabic_script(word):
    return bool(_ARABIC_SCRIPT_RE.search(word))


def _split_bidirectional_runs(text):
    if not text:
        return []
    runs = []
    for token in re.split(r"(\s+)", text):
        if not token:
            continue
        if not token.strip():
            if runs:
                runs[-1] = (runs[-1][0], runs[-1][1] + token)
            continue
        is_arabic = _contains_arabic_script(token)
        if runs and runs[-1][0] == is_arabic:
            runs[-1] = (is_arabic, runs[-1][1] + token)
        else:
            runs.append((is_arabic, token))
    return runs


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")

    _re_tags = re.compile(r"<[^>]+>")
    _re_spaces = re.compile(r"\s+")

    @app.template_filter("strip_html")
    def strip_html(value):
        if not value:
            return ""
        text = _re_tags.sub(" ", value)
        return _re_spaces.sub(" ", text).strip()

    @app.template_filter("bidirectional_text")
    def bidirectional_text(value):
        if not value:
            return Markup("")
        text = _re_spaces.sub(" ", _re_tags.sub(" ", value)).strip()
        runs = _split_bidirectional_runs(text)
        return Markup("".join(f'<div dir="auto">{escape(run.strip())}</div>' for _, run in runs))

    @app.context_processor
    def inject_template_globals():
        return {"current_year": datetime.now().year}

    app.teardown_appcontext(close_db)

    from app.commands import import_archive

    app.cli.add_command(import_archive)

    from app.routes.documents import bp as documents_bp
    from app.routes.pages import bp as pages_bp
    from app.routes.search import bp as search_bp, search_shell_context

    app.register_blueprint(documents_bp)
    app.register_blueprint(pages_bp)
    app.register_blueprint(search_bp)

    @app.errorhandler(404)
    def not_found(e):
        return render_template("404.html", **search_shell_context(get_db())), 404

    return app
