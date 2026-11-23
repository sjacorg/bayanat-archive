"""Turn Bayanat's label paths into names a reader can scan.

Bayanat stores a label as its whole path, "Content, Document, Security Report".
The leading segments are how SJAC files a tag, not what the tag says, and the
archive was showing them in full on every card and filter. The leaf alone is
what a reader wants.

Two rules keep that from losing meaning. A tag naming a party to the events
always carries which party it is, because "Armed Forces" alleged to have done
something and "Armed Forces" it was done to are not the same tag. And any other
leaf shared by two paths keeps the segment that tells them apart.

A name is also the filter value in the URL, and those URLs get cited, so a name
has to be a function of its own path and nothing else. Both rules above are.
`assert_unique` guards the one thing that could still break it: a later import
introducing a second path that renders to a name already in use.

Labels recording SJAC's own process are dropped rather than renamed, because a
path that reads clearly in Bayanat can arrive stripped of the context that
explained it: "Peer Review, Needs Review" becomes "Needs Review".
"""

# Every document in the archive is a document, so the bare family tag adds
# nothing to a listing of documents.
EMPTY_PATHS = {"Content, Document"}

# Families that record how SJAC works rather than what a document says. The
# export can leave these out, but it has to be told to, and a tag like "Low
# Quality" or "Bad Import" reaching a public evidence archive is not the kind
# of mistake to leave resting on a command-line flag.
INTERNAL_FAMILIES = {"Meta", "Priority", "Peer Review", "Workflow"}

# Families that name a party rather than a property of the document. The same
# name appears under both, so the family is part of what the tag means.
PARTY_FAMILIES = {"Alleged Perpetrator", "Injured Party"}


class AmbiguousLabels(Exception):
    """Two label paths would be shown, and filtered, under one name."""


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
        if title in EMPTY_PATHS or segments[0] in INTERNAL_FAMILIES:
            display[title] = None
            continue
        leaf = segments[-1]
        if segments[0] in PARTY_FAMILIES and len(segments) > 1:
            display[title] = f"{segments[0]}: {leaf}"
            continue
        sharing = leaves[leaf]
        if len(sharing) == 1:
            display[title] = leaf
            continue
        # Shared leaf, so keep the segment that sets these paths apart.
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


def assert_unique(display):
    """Raise when two paths share a name, since the name is also the filter value."""
    seen = {}
    clashes = []
    for title, name in sorted(display.items()):
        if name is None:
            continue
        if name in seen:
            clashes.append(f"{name!r}: {seen[name]!r} and {title!r}")
        seen[name] = title
    if clashes:
        raise AmbiguousLabels(
            "These label paths would be shown under one name, so filtering on it "
            "would return both:\n  " + "\n  ".join(clashes)
        )
    return display


# What a result card can show at a glance, in the order a researcher scanning a
# list of results asks for it: what happened, what kind of paper records it,
# then who was involved. Any family not listed sorts after these.
CARD_FAMILY_ORDER = (
    "Type",
    "Content",
    "Alleged Perpetrator",
    "Injured Party",
    "Weapons",
)


def _family_rank(title):
    family = _segments(title or "")
    family = family[0] if family else ""
    try:
        return (0, CARD_FAMILY_ORDER.index(family), family)
    except ValueError:
        return (1, 0, family)


def card_order(labels):
    """Order a document's tags for a card, one per family in turn.

    A card has room for about three tags, and showing whichever sorted first
    alphabetically meant a detention record led with "Child" and a transfer
    letter with "Immediate". Alone above a photograph those read as claims
    about the document; beside the violation and the document kind they read
    as what they are. Taking one tag per family before any family's second is
    what guarantees them that company, so the three visible tags answer three
    different questions instead of three shades of one.

    `labels` are mappings carrying `path` (the full label path, which is where
    the family comes from) and `title` (the name shown), already in the order
    the query returned them, which puts verified tags first. Every tag is
    returned, so a caller can show some and count the rest.
    """
    families = {}
    for label in labels:
        families.setdefault(_family_rank(label["path"]), []).append(label)

    ordered = []
    rounds = max((len(group) for group in families.values()), default=0)
    for index in range(rounds):
        for rank in sorted(families):
            group = families[rank]
            if index < len(group):
                ordered.append(group[index])
    return ordered
