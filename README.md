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
flask export-public --label "public-archive" --output ./export/

# In this repo:
flask import-archive /path/to/export/
```

## Docker

```bash
docker compose up --build
```

## Project Structure

```
app/
  __init__.py              # Flask app factory + SQLite connection
  routes/
    pages.py               # Page routes (search, about, health)
  templates/
    base.html              # Layout: header, footer, CDN includes
    search.html            # Search page with HTMX
    about.html             # About page
    partials/              # HTMX fragments (search results, facets)
  static/
    css/archive.css        # DaisyUI theme overrides
    media/                 # Document images (populated by import)
data/
  archive.db               # SQLite database (populated by import)
Caddyfile                  # Reverse proxy + static files
Dockerfile
docker-compose.yml
```

## License

MIT
