"""Diagonal watermark stamped on public copies of media at import time.

The corpus is mixed: white paper scans and photographs of documents. A fixed
opacity reads completely differently on the two, so the mark is solved per page
for a target *contrast* against the paper instead, and it fades over ink so
handwriting, stamps and signatures stay legible underneath.
"""

import io
import math
import os

import click
import pymupdf
from PIL import Image, ImageFilter, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
PDF_EXTS = {".pdf"}
WATERMARK_EXTS = IMAGE_EXTS | PDF_EXTS
# Mark length as a share of the page diagonal.
WATERMARK_SCALE = 0.62
# Matched to SJAC's published articles, where the white wordmark sits around
# 1.2:1 on photographed paper and reaches ~1.7:1 on its strongest strokes.
TARGET_CONTRAST = 1.45
# Below this the mark is not perceptible at all, so the polarity has to flip.
PERCEPTIBLE_CONTRAST = 1.25
INK_DARK = (26, 26, 26)
INK_LIGHT = (255, 255, 255)
# Alpha range the solver may choose from.
ALPHA_BOUNDS = (0.06, 0.6)
# Backdrop sampled for the solve, and the raster used to fade the mark over ink.
SAMPLE_DPI = 96


def load_watermark():
    """Return the configured watermark, or None when disabled.

    WATERMARK_OPACITY is an optional ceiling; the per-page solve decides the
    actual alpha, so leaving it unset is the usual case.
    """
    path = os.environ.get("WATERMARK_IMAGE")
    if not path:
        return None
    if not os.path.exists(path):
        raise click.ClickException(f"WATERMARK_IMAGE not found: {path}")
    ceiling = float(os.environ.get("WATERMARK_OPACITY", "1"))
    if not 0 < ceiling <= 1:
        raise click.ClickException("WATERMARK_OPACITY must be between 0 and 1")

    mark = Image.open(path).convert("RGBA")
    mark.info["alpha_ceiling"] = ceiling
    return mark


def _channel_luminance(value):
    channel = value / 255
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _luminance(rgb):
    red, green, blue = (_channel_luminance(c) for c in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast(first, second):
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def _paper_tone(page):
    """The page's paper tone: the median of a downsample, so ink cannot drag it.

    Ink, stamps and shadows are a minority of any page, so the median lands on
    the paper (or on the photograph's mid tone) rather than on the writing.
    """
    small = page.convert("L").resize((64, 64), Image.Resampling.BILINEAR)
    values = sorted(
        small.get_flattened_data()
        if hasattr(small, "get_flattened_data")
        else small.getdata()
    )
    return values[len(values) // 2]


def _reachable_contrast(ink, paper, alpha):
    blended = tuple(round(alpha * channel + (1 - alpha) * paper) for channel in ink)
    return _contrast(_luminance(blended), _luminance((paper,) * 3))


def _solve_alpha(ink, paper, ceiling):
    """The smallest alpha reaching TARGET_CONTRAST, capped by `ceiling`."""
    low, high = ALPHA_BOUNDS
    for _ in range(14):
        alpha = (low + high) / 2
        if _reachable_contrast(ink, paper, alpha) < TARGET_CONTRAST:
            low = alpha
        else:
            high = alpha
    return min(high, ceiling)


def _solve_mark(paper, ceiling):
    """Pick the ink and alpha for this page. Returns (ink, alpha).

    The white wordmark is SJAC's published look, so it stays the default wherever
    it can be seen at all. On a bright paper scan white cannot reach any contrast,
    whatever the opacity, so the mark flips to dark rather than vanishing.
    """
    light_alpha = _solve_alpha(INK_LIGHT, paper, ceiling)
    if _reachable_contrast(INK_LIGHT, paper, light_alpha) >= PERCEPTIBLE_CONTRAST:
        return INK_LIGHT, light_alpha
    return INK_DARK, _solve_alpha(INK_DARK, paper, ceiling)


def _tinted_mark(mark, ink, alpha):
    """The logo repainted in `ink` at `alpha`, keeping its shape."""
    tinted = Image.new("RGBA", mark.size, ink + (255,))
    tinted.putalpha(mark.getchannel("A").point(lambda a: round(a * alpha)))
    return tinted


def _ink_guard(backdrop, size):
    """A mask that fades the mark out over dark content.

    Without it the mark lays a flat veil across Arabic handwriting and stamps.
    Scaled to `size` and blurred so the falloff is gradual rather than cut out.
    """
    guard = backdrop.convert("L").resize(size, Image.Resampling.BILINEAR)
    guard = guard.filter(ImageFilter.GaussianBlur(max(size) / 160))
    # Full strength on paper, fading to a fifth over the darkest ink.
    return guard.point(lambda v: round(51 + v * 204 / 255))


def _guard_alpha(rotated, backdrop_patch):
    """Scale the mark's own alpha by the ink guard, leaving the page untouched."""
    guard = _ink_guard(backdrop_patch, rotated.size)
    rotated.putalpha(
        Image.frombytes(
            "L",
            rotated.size,
            bytes(
                (a * g) // 255
                for a, g in zip(
                    rotated.getchannel("A").tobytes(), guard.tobytes(), strict=True
                )
            ),
        )
    )
    return rotated


def _stamp(page, mark):
    """Composite the solved mark onto a PIL page and return it."""
    paper = _paper_tone(page)
    ink, alpha = _solve_mark(paper, mark.info.get("alpha_ceiling", 1))
    rotated = _diagonal_mark(_tinted_mark(mark, ink, alpha), *page.size)

    width, height = page.size
    left, top = (width - rotated.width) // 2, (height - rotated.height) // 2
    patch = page.crop((left, top, left + rotated.width, top + rotated.height))
    rotated = _guard_alpha(rotated, patch)
    page.paste(rotated, (left, top), rotated)
    return page


def _diagonal_mark(mark, width, height):
    """The mark scaled to the page and rotated onto its diagonal."""
    length = int(math.hypot(width, height) * WATERMARK_SCALE)
    sized = mark.resize(
        (length, max(1, length * mark.height // mark.width)), Image.Resampling.LANCZOS
    )
    return sized.rotate(
        -math.degrees(math.atan2(height, width)),
        expand=True,
        resample=Image.Resampling.BICUBIC,
    )


def apply_watermark(src, dest, mark):
    """Write src to dest with the mark centered along the page diagonal.

    The copy is re-encoded without the source metadata (camera model, capture time).
    """
    with Image.open(src) as im:
        # Bake in EXIF rotation, since the saved copy no longer carries the tag.
        page = ImageOps.exif_transpose(im).convert("RGB")

    page = _stamp(page, mark)
    if os.path.splitext(dest)[1].lower() in {".jpg", ".jpeg"}:
        page.save(dest, quality=90)
    else:
        page.save(dest)


def apply_pdf_watermark(src, dest, mark):
    """Stamp every page of a PDF, then write it to dest without source metadata.

    The scan itself is never re-encoded: the page is rasterised only to measure
    its paper tone and to build the ink guard, and the mark goes on as an overlay.
    """
    with pymupdf.open(src) as doc:
        for page in doc:
            box = page.rect
            preview = page.get_pixmap(dpi=SAMPLE_DPI)
            backdrop = Image.frombytes(
                "RGB", (preview.width, preview.height), preview.samples
            )

            paper = _paper_tone(backdrop)
            ink, alpha = _solve_mark(paper, mark.info.get("alpha_ceiling", 1))
            rotated = _diagonal_mark(
                _tinted_mark(mark, ink, alpha), box.width, box.height
            )

            scale = preview.width / box.width
            left = (box.width - rotated.width) / 2
            top = (box.height - rotated.height) / 2
            patch = backdrop.crop(
                (
                    round(left * scale),
                    round(top * scale),
                    round((left + rotated.width) * scale),
                    round((top + rotated.height) * scale),
                )
            )
            rotated = _guard_alpha(rotated, patch)

            buffer = io.BytesIO()
            rotated.save(buffer, format="PNG")
            page.insert_image(
                pymupdf.Rect(
                    box.x0 + left,
                    box.y0 + top,
                    box.x0 + left + rotated.width,
                    box.y0 + top + rotated.height,
                ),
                stream=buffer.getvalue(),
                overlay=True,
                keep_proportion=False,
            )
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.save(dest, garbage=3, deflate=True)


def watermark_file(src, dest, mark):
    """Stamp src to dest when the type is supported. Returns False when it is not."""
    extension = os.path.splitext(src)[1].lower()
    if extension in IMAGE_EXTS:
        apply_watermark(src, dest, mark)
    elif extension in PDF_EXTS:
        apply_pdf_watermark(src, dest, mark)
    else:
        return False
    return True
