import os
import re
import sqlite3
from datetime import datetime
from urllib.parse import urlencode

from flask import Flask, g, render_template, request
from markupsafe import Markup, escape

from app.i18n import DEFAULT_LANG, SUPPORTED_LANGS, translate


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
        return Markup(
            "".join(f'<div dir="auto">{escape(run.strip())}</div>' for _, run in runs)
        )

    @app.before_request
    def resolve_locale():
        requested_lang = request.args.get("lang", "").strip()
        cookie_lang = request.cookies.get("lang", "").strip()
        g.lang = (
            requested_lang
            if requested_lang in SUPPORTED_LANGS
            else cookie_lang
            if cookie_lang in SUPPORTED_LANGS
            else DEFAULT_LANG
        )
        g.dir = "rtl" if g.lang == "ar" else "ltr"

    @app.after_request
    def persist_locale(response):
        requested_lang = request.args.get("lang", "").strip()
        if requested_lang in SUPPORTED_LANGS:
            response.set_cookie(
                "lang",
                requested_lang,
                max_age=60 * 60 * 24 * 365,
                samesite="Lax",
            )
        return response

    def language_url(target_lang):
        query = request.args.to_dict(flat=False)
        query["lang"] = [target_lang]
        return request.path + "?" + urlencode(query, doseq=True)

    @app.context_processor
    def inject_template_globals():
        lang = getattr(g, "lang", DEFAULT_LANG)
        return {
            "current_year": datetime.now().year,
            "dir": getattr(g, "dir", "ltr"),
            "lang": lang,
            "language_url": language_url,
            "t": lambda key, **kwargs: translate(lang, key, **kwargs),
        }

    app.teardown_appcontext(close_db)

    from app.commands import import_archive

    app.cli.add_command(import_archive)

    from app.routes.documents import bp as documents_bp
    from app.routes.pages import bp as pages_bp
    from app.routes.search import bp as search_bp
    from app.routes.search import search_shell_context

    app.register_blueprint(documents_bp)
    app.register_blueprint(pages_bp)
    app.register_blueprint(search_bp)

    @app.errorhandler(404)
    def not_found(e):
        return render_template("404.html", **search_shell_context(get_db())), 404

    return app
