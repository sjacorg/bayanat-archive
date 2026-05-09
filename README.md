# Bayanat Document Archive

Public searchable archive for human rights documents exported from Bayanat.

A lightweight, read-only portal for browsing and searching documents exported from [Bayanat](https://bayanat.org).

## Stack

Flask, SQLite (FTS5), HTMX, Alpine.js, Tailwind 4, DaisyUI 5, Caddy.

## Quick Start

```bash
git clone git@github.com:sjacorg/bayanat-archive.git && cd bayanat-archive
cp .env.example .env
uv sync
uv run flask run
```

Open http://localhost:5000. The archive will be empty until you import documents.

## Import Documents

Export from Bayanat, then import:

```bash
# In your Bayanat installation:
flask export public --label "public-archive" --output ./export/

# In this repo:
uv run flask import-archive /path/to/export/
```

The import is destructive: it rebuilds `data/archive.db` and copies media into `app/static/media/`. See `EXPORT_SCHEMA.md` for the JSON contract.

## Docker

```bash
docker compose up --build
```

## Project Structure

```
app/
  __init__.py              # Flask factory, SQLite (WAL), blueprint wiring
  database.py              # Schema DDL + init/build_fts helpers
  commands.py              # `flask import-archive` CLI
  routes/
    pages.py               # /about, /feedback, /components, /health, /robots.txt, /sitemap.xml
    search.py              # / (home) + /search (FTS5, facets, pagination)
    documents.py           # /documents/<id>/<slug>
  templates/
    base.html              # Layout: header, footer, CDN includes
    search.html, about.html, document_detail.html, components.html, 404.html
    partials/              # HTMX fragments (search results, feedback, timeline, media renderers)
  static/
    css/                   # archive.css (DaisyUI overrides), print.css
    js/                    # search-page.js, document-detail.js
    assets/                # logos, favicons, OG image
    media/                 # document files (populated by import)
data/
  archive.db               # SQLite database (populated by import)
Caddyfile                  # Reverse proxy + static files
Dockerfile
docker-compose.yml
EXPORT_SCHEMA.md           # JSON contract between Bayanat and this portal
```

## License

MIT
