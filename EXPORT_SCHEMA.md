# Export Schema Reference

This documents the JSON structure produced by Bayanat's `flask export public` command. The import command in this repo must consume this format.

## How to generate an export

In the Bayanat installation:

```bash
flask export public --label "public-archive" --output ./export/
```

This produces:

```
export/
  documents.json      # Array of document objects
  media/              # Flat directory of media files (images, PDFs)
```

## Usage flags

| Flag | Default | Description |
|------|---------|-------------|
| `--label` | required | Label title to filter bulletins |
| `--output` | required | Output directory path |
| `--copy-media` / `--no-copy-media` | copy | Whether to download/copy media files |

The command auto-detects local filesystem vs S3 storage from Bayanat's config.

## Document schema

Each element in the `documents.json` array:

```json
{
  "id": 12345,
  "title": "Security Report - Damascus Branch 251",
  "title_ar": "تقرير أمني - فرع 251 دمشق",
  "description": "Monthly security summary...",
  "source_link": "https://...",
  "publish_date": "2013-04-15T00:00:00",
  "documentation_date": "2024-01-20T00:00:00",
  "labels": [],
  "verified_labels": [],
  "sources": [],
  "locations": [],
  "geo_locations": [],
  "events": [],
  "media": [],
  "related_bulletins": [],
  "related_actors": [],
  "related_incidents": []
}
```

## Field details

### Top-level fields

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | int | no | Bayanat bulletin ID |
| `title` | string | no | English title |
| `title_ar` | string | yes | Arabic title |
| `description` | string | yes | Free-text description (may contain HTML) |
| `source_link` | string | yes | External URL reference |
| `publish_date` | string | yes | ISO 8601 datetime |
| `documentation_date` | string | yes | ISO 8601 datetime |

### labels / verified_labels

```json
{
  "id": 42,
  "title": "Intelligence Directorate",
  "title_ar": "إدارة المخابرات",
  "verified": true
}
```

`verified_labels` omits the `verified` field (they are all verified by definition).

### sources

```json
{
  "id": 1,
  "title": "SJAC Archive"
}
```

### locations

```json
{
  "id": 10,
  "title": "Damascus",
  "title_ar": "دمشق",
  "lat": 33.5138,
  "lng": 36.2765,
  "location_type": "City",
  "country": "Syria",
  "full_location": "Syria > Damascus Governorate > Damascus"
}
```

`lat`/`lng` are null if the location has no coordinates.

### geo_locations

Pin-dropped coordinates (distinct from structured locations above).

```json
{
  "id": 5,
  "title": "Checkpoint near Mezzeh",
  "lat": 33.4965,
  "lng": 36.2344,
  "type": "Point of Interest"
}
```

### events

```json
{
  "id": 7,
  "title": "Detention",
  "title_ar": "اعتقال",
  "type": "Arrest / Detention",
  "from_date": "2013-04-10T00:00:00",
  "to_date": "2013-04-15T00:00:00",
  "location": "Damascus"
}
```

`type` is the event type label. `location` is the location title string (not an object).

### media

```json
{
  "id": 99,
  "filename": "20241223-161712-scan001.jpg",
  "type": "image/jpeg",
  "title": "Page 1",
  "title_ar": null,
  "extraction": {
    "text": "Translated or cleaned OCR text",
    "original_text": "Raw OCR text in original language",
    "confidence": 85.2,
    "language": "ar"
  }
}
```

`extraction` is only present if OCR has been processed for this media item. The `filename` corresponds to a file in the `media/` directory.

Common `type` values: `image/jpeg`, `image/png`, `application/pdf`.

### related_bulletins

```json
{
  "id": 12346,
  "title": "Related Document Title",
  "title_ar": "عنوان الوثيقة",
  "related_as": [1, 3]
}
```

`related_as` is an array of relationship type IDs (integer codes defined in Bayanat's AtobInfo/BtobInfo tables).

### related_actors

```json
{
  "id": 500,
  "name": "Col. [redacted]",
  "type": "Military",
  "related_as": [2]
}
```

### related_incidents

```json
{
  "id": 200,
  "title": "Damascus Detention Campaign 2013",
  "title_ar": "حملة اعتقالات دمشق 2013",
  "related_as": 1
}
```

Note: `related_as` is a single integer here (not an array), matching Bayanat's Itob model.

## Fields intentionally excluded

These exist in Bayanat but are stripped from the public export:

| Field | Reason |
|-------|--------|
| status | Internal workflow state |
| assigned_to, user_id | Staff assignment |
| first_peer_reviewer, second_peer_reviewer | Review workflow |
| comments | Internal staff notes |
| review, review_action | Review workflow |
| sjac_title, sjac_title_ar | Internal naming |
| tags, originid | ETL/import metadata |
| meta, tsv | Internal search/metadata |
| roles | Access control |
| reliability_score | Internal scoring |
| dynamic_fields | Custom form fields |
| extraction.raw | Full OCR provider JSON (large) |
| extraction.history | Edit history |
| extraction.reviewed_by, reviewed_at | Staff tracking |

## Workflow

1. Bayanat team reviews, redacts, and translates documents
2. Team applies a label (e.g. "public-archive") to approved bulletins
3. Admin runs `flask export public --label "public-archive" --output ./export/`
4. Export directory is transferred to the archive server
5. Archive runs `flask import-archive ./export/` to load into SQLite
