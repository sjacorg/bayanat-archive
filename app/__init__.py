import os
import sqlite3
from datetime import datetime

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


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")

    @app.context_processor
    def inject_template_globals():
        return {"current_year": datetime.now().year}

    app.teardown_appcontext(close_db)

    from app.routes.pages import bp as pages_bp
    app.register_blueprint(pages_bp)

    @app.errorhandler(404)
    def not_found(e):
        return render_template("404.html"), 404

    return app
