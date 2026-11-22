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
flask export public --label "public-archive" --output ./export/ \
  --exclude-label "Meta, Published" \
  --exclude-label "Priority, High"

# In this repo:
uv run flask import-archive /path/to/export/
```

`--exclude-label` leaves a label out of the export, matching the full path
exactly, so it needs one flag per label. Use it for anything recording how the
team works rather than what a document says: review states, priorities, project
and funder tags.

The archive refuses to show a label under `Meta`, `Priority`, `Peer Review` or
`Workflow` even if one reaches it (`app/labels.py`), because a tag like "Low
Quality" or "Needs Review" on a piece of evidence is not a mistake worth
resting on a command-line flag. Excluding them at the export is still better:
they then never leave Bayanat at all.

The import is destructive: it rebuilds `data/archive.db` and copies media into `app/static/media/`. See `EXPORT_SCHEMA.md` for the JSON contract.

To watermark public copies, set `WATERMARK_IMAGE` (a transparent PNG). The mark runs along each page's diagonal on images and PDFs alike, and copies are written without their source metadata. Each page is solved for a consistent contrast against its own paper rather than a fixed opacity, so a white scan and a photograph end up equally legible; the mark stays SJAC white wherever that reads and flips dark only on bright scans where white cannot be seen. It also fades over ink so handwriting and stamps stay clear. `WATERMARK_OPACITY` is an optional ceiling on the solved alpha. Media already in `app/static/media/` is not reprocessed, so clear it after changing the watermark.

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
    search.html, about.html, document_scroll_proto.html, components.html, 404.html
    partials/              # HTMX fragments (search results, feedback, timeline)
  static/
    css/                   # archive.css (DaisyUI overrides), print.css
    js/                    # search-page.js, document-scroll-proto.js
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
