import html
import os
import re
import sqlite3
from datetime import datetime
from urllib.parse import urlencode

import nh3
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


def _script_direction(text):
    """ "rtl" when Arabic letters outnumber Latin ones, else "ltr"."""
    letters = [char for char in str(text or "") if char.isalpha()]
    arabic = sum(1 for char in letters if _contains_arabic_script(char))
    return "rtl" if arabic * 2 > len(letters) else "ltr"


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
    # The only form is feedback; cap request bodies so it cannot be used to fill the disk.
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

    # Bring an existing archive.db up to the current schema (new tables only), so a
    # code deploy without a re-import cannot 500 on a missing table.
    db_path = os.environ.get("DATABASE_PATH", "data/archive.db")
    if os.path.exists(db_path):
        from app.database import init_db

        init_db(db_path).close()

    # Version static URLs by file mtime so a deploy is never masked by browser or Cloudflare cache.
    @app.url_defaults
    def version_static(endpoint, values):
        if endpoint == "static" and "filename" in values:
            path = os.path.join(app.static_folder, values["filename"])
            if os.path.isfile(path):
                values["v"] = int(os.stat(path).st_mtime)

    _re_tags = re.compile(r"<[^>]+>")
    _re_spaces = re.compile(r"\s+")
    # Everything _re_spaces matches except a line break.
    _re_inline_spaces = re.compile(r"[^\S\n\r]+")
    # "- Page 1 of 1", "– Page 2 of 4", or a bare "pg 1 of 1" after an Arabic
    # document reference. Searched anywhere, since a few titles carry it mid-way.
    _re_page_marker = re.compile(
        r"\s*[-\u2013\u2014]?\s*(?:page|pg)\s*(\d+)\s*of\s*(\d+)\s*", re.I
    )

    @app.template_filter("strip_html")
    def strip_html(value):
        if not value:
            return ""
        text = html.unescape(_re_tags.sub(" ", value))
        return _re_spaces.sub(" ", text).strip()

    @app.template_filter("highlight")
    def highlight(value):
        # FTS snippet markers are \x02/\x03 so the title text itself is always escaped.
        return Markup(
            str(escape(value)).replace("\x02", "<mark>").replace("\x03", "</mark>")
        )

    _re_block_tags = re.compile(
        r"<(h[1-6]|p|li|td|th|blockquote|div)(\s|>)",
        re.IGNORECASE,
    )
    _rich_text_tags = {
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "span",
        "div",
        "ul",
        "ol",
        "li",
        "strong",
        "em",
        "b",
        "i",
        "u",
        "a",
        "blockquote",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "img",
    }
    _rich_text_attrs = {"a": {"href", "title"}, "img": {"src", "alt", "title"}}

    @app.template_filter("safe_html")
    def safe_html(value):
        # Renders trusted TinyMCE HTML (public_description/description from the
        # Bayanat export) as rich text. nh3 strips scripts, event handlers, and
        # javascript: URLs; then dir="auto" is added to block tags for bidi.
        if not value:
            return Markup("")
        cleaned = nh3.clean(value, tags=_rich_text_tags, attributes=_rich_text_attrs)
        cleaned = _re_block_tags.sub(r'<\1 dir="auto"\2', cleaned)
        return Markup(cleaned)

    @app.template_global("localized")
    def localized(row, field):
        """The Arabic value on Arabic pages, falling back to the English one.

        SJAC fills the Arabic fields over time, so a row may hold either or both.
        """
        if getattr(g, "lang", DEFAULT_LANG) == "ar":
            try:
                value = row[f"{field}_ar"]
            except (IndexError, KeyError, TypeError):
                value = None
            if value and str(value).strip():
                return value
        return row[field]

    @app.template_filter("document_title")
    def document_title(value):
        """The title without its "Page 1 of 1" tail.

        SJAC files one bulletin per page and writes the page into the title, so
        103 of 118 titles carry a marker and 70 of those read "Page 1 of 1",
        which says only that the document is a single page. In a 240px column
        that costs a line of headline and sometimes two. Extent is a fact about
        the record, so the card shows it as one (see page_extent) instead of
        leaving it inside the sentence.
        """
        text = _re_page_marker.sub(" ", str(value or ""))
        return _re_inline_spaces.sub(" ", text).strip(" -\u2013\u2014,")

    @app.template_filter("page_extent")
    def page_extent(value):
        """("2", "4") when a title says which page of several this is, else None.

        A single-page document returns None: "Page 1 of 1" tells a reader
        nothing they would not assume.
        """
        match = _re_page_marker.search(str(value or ""))
        if not match:
            return None
        page, total = match.group(1), match.group(2)
        return None if total == "1" else (page, total)

    @app.template_filter("text_dir")
    def text_dir(value):
        # dir="auto" follows the first strong character, so an English title that
        # opens with an Arabic reference ("#14129\س ت2 follow up") flips to RTL.
        # The majority script decides instead.
        return _script_direction(value)

    @app.template_filter("bidirectional_text")
    def bidirectional_text(value):
        """Render extracted text one line per block, each in its own direction.

        A line is the unit the page has to preserve: OCR returns a document's
        own lines, and "التاريخ :" means nothing once the colon is moved. Splitting
        any finer is what broke it before, because a run holding only a colon has
        no strong character, so dir="auto" laid it out left to right on a line of
        its own. Mixed scripts inside one line need no help: that is exactly what
        the browser's bidi algorithm does, given a direction to resolve against.
        """
        if not value:
            return Markup("")
        # strip_html() collapses every whitespace run, newlines included, which
        # would flatten the document into one paragraph before it can be split.
        text = html.unescape(_re_tags.sub(" ", value))
        lines = [_re_inline_spaces.sub(" ", line).strip() for line in text.splitlines()]
        return Markup(
            "".join(
                f'<div dir="{_script_direction(line)}">{escape(line)}</div>'
                for line in lines
                if line
            )
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
    def security_headers(response):
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Content-Security-Policy",
            "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
        )
        return response

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
