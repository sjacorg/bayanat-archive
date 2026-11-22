"""Turn Bayanat's label paths into names a reader can scan.

Bayanat stores a label as its whole path, "Content, Document, Security Report".
The leading segments are how SJAC files a tag, not what the tag says, and the
archive was showing them in full on every card and filter. The leaf alone is
what a reader wants, except where two different tags share one, so a leaf that
is not unique keeps the segment that tells the two apart.
"""

# Every document in the archive is a document, so the bare family tag adds
# nothing to a listing of documents.
EMPTY_PATHS = {"Content, Document"}


def _segments(title):
    return [part.strip() for part in title.split(",") if part.strip()]


def display_titles(titles):
    """Map each full label path to the name to show, or None to hide it."""
    paths = {}
    for title in titles:
        if not title or not title.strip():
            continue
        segments = _segments(title)
        if segments:
            paths[title.strip()] = segments

    leaves = {}
    for title, segments in paths.items():
        leaves.setdefault(segments[-1], []).append(title)

    display = {}
    for title, segments in paths.items():
        if title in EMPTY_PATHS:
            display[title] = None
            continue
        leaf = segments[-1]
        sharing = leaves[leaf]
        if len(sharing) == 1:
            display[title] = leaf
            continue
        # Shared leaf: keep the first segment that sets these paths apart, so
        # an injured party is never filed under the same tag as a perpetrator.
        others = [paths[other] for other in sharing if other != title]
        qualifier = next(
            (
                segment
                for index, segment in enumerate(segments[:-1])
                if any(index >= len(o) or o[index] != segment for o in others)
            ),
            segments[-2] if len(segments) > 1 else None,
        )
        display[title] = f"{qualifier}: {leaf}" if qualifier else leaf
    return display
