import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    title_ar TEXT,
    slug TEXT NOT NULL,
    description TEXT,
    source_link TEXT,
    publish_date TEXT,
    documentation_date TEXT,
    ocr_text TEXT,
    translation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(slug);

CREATE TABLE IF NOT EXISTS document_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    label_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_ar TEXT,
    verified INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_document_labels_doc ON document_labels(document_id);
CREATE INDEX IF NOT EXISTS idx_document_labels_title ON document_labels(title);

CREATE TABLE IF NOT EXISTS document_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    location_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_ar TEXT,
    lat REAL,
    lng REAL,
    location_type TEXT,
    country TEXT,
    full_location TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_locations_doc ON document_locations(document_id);

CREATE TABLE IF NOT EXISTS document_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_ar TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_sources_doc ON document_sources(document_id);

CREATE TABLE IF NOT EXISTS document_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    event_id INTEGER NOT NULL,
    title TEXT,
    title_ar TEXT,
    event_type TEXT,
    from_date TEXT,
    to_date TEXT,
    location TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_events_doc ON document_events(document_id);

CREATE TABLE IF NOT EXISTS document_geo_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    geo_location_id INTEGER NOT NULL,
    title TEXT,
    lat REAL,
    lng REAL,
    type TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_geo_locations_doc ON document_geo_locations(document_id);

CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    media_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    media_type TEXT,
    title TEXT,
    title_ar TEXT,
    ocr_text TEXT,
    original_text TEXT,
    confidence REAL,
    language TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_doc ON media(document_id);

CREATE TABLE IF NOT EXISTS document_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    related_id INTEGER NOT NULL,
    related_type TEXT NOT NULL,
    title TEXT,
    title_ar TEXT,
    name TEXT,
    related_as TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_relations_doc ON document_relations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_relations_type ON document_relations(related_type);

CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER REFERENCES documents(id),
    path TEXT NOT NULL,
    ip_hash TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_page_views_doc ON page_views(document_id);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rating TEXT,
    comment TEXT,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

FTS_SETUP = """
DROP TABLE IF EXISTS documents_fts;
CREATE VIRTUAL TABLE documents_fts USING fts5(
    title,
    title_ar,
    description,
    ocr_text,
    translation,
    content='documents',
    content_rowid='id',
    tokenize='unicode61'
);

INSERT INTO documents_fts(rowid, title, title_ar, description, ocr_text, translation)
SELECT id, COALESCE(title, ''), COALESCE(title_ar, ''), COALESCE(description, ''),
       COALESCE(ocr_text, ''), COALESCE(translation, '')
FROM documents;
"""


def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def build_fts(conn):
    conn.executescript(FTS_SETUP)
    conn.commit()
