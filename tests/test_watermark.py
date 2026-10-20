import os
import tempfile
import unittest
from unittest import mock

import pymupdf
from PIL import Image

from app.watermark import (
    INK_DARK,
    INK_LIGHT,
    PERCEPTIBLE_CONTRAST,
    TARGET_CONTRAST,
    _reachable_contrast,
    _solve_mark,
    apply_watermark,
    load_watermark,
    watermark_file,
)


class SolverTestCase(unittest.TestCase):
    def solve(self, paper):
        ink, alpha = _solve_mark(paper, 1)
        return ink, _reachable_contrast(ink, paper, alpha)

    def test_every_page_ends_up_perceptible(self):
        # A white scan and a photographed page must both carry a visible mark.
        for paper in (255, 250, 235, 210, 180, 160, 128, 60, 10):
            _, ratio = self.solve(paper)
            self.assertGreaterEqual(ratio, PERCEPTIBLE_CONTRAST, msg=f"{paper=}")
            self.assertLessEqual(ratio, TARGET_CONTRAST + 0.05, msg=f"{paper=}")

    def test_keeps_the_white_house_mark_wherever_it_reads(self):
        # SJAC's published articles use the white wordmark on photographed paper.
        for paper in (210, 180, 160, 128, 60, 10):
            self.assertEqual(self.solve(paper)[0], INK_LIGHT, msg=f"{paper=}")

    def test_flips_to_dark_only_on_bright_paper(self):
        # White on a bright scan cannot reach any contrast, whatever the opacity.
        for paper in (255, 250, 240):
            self.assertEqual(self.solve(paper)[0], INK_DARK, msg=f"{paper=}")

    def test_opacity_env_is_only_a_ceiling(self):
        _, alpha = _solve_mark(160, 0.05)
        self.assertEqual(alpha, 0.05)


class WatermarkTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.mark_path = os.path.join(self.tmp, "mark.png")
        Image.new("RGBA", (200, 40), (255, 255, 255, 255)).save(self.mark_path)
        self.env = {"WATERMARK_IMAGE": self.mark_path}

    def page(self, name, paper, stroke=True):
        """A page of `paper` tone with a black stroke across the middle."""
        path = os.path.join(self.tmp, name)
        image = Image.new("RGB", (400, 600), (paper, paper, paper))
        if stroke:
            for x in range(40, 360):
                for y in range(295, 305):
                    image.putpixel((x, y), (0, 0, 0))
        exif = Image.Exif()
        exif[0x0110] = "PhoneModel"  # Model
        image.save(path, exif=exif)
        return path

    def stamp(self, src, dest):
        with mock.patch.dict(os.environ, self.env):
            apply_watermark(src, dest, load_watermark())
        return Image.open(dest).convert("L")

    def test_keeps_size_and_drops_metadata(self):
        out = self.stamp(self.page("w.jpg", 255), os.path.join(self.tmp, "out.jpg"))
        self.assertEqual(out.size, (400, 600))
        self.assertFalse(out.getexif())

    def test_marks_white_paper_without_darkening_the_writing(self):
        out = self.stamp(self.page("w.jpg", 255), os.path.join(self.tmp, "out.png"))
        # Visible on paper the old fixed-opacity version left blank.
        self.assertLess(out.getpixel((200, 240)), 240)
        # The stroke underneath stays essentially as dark as it was.
        self.assertLess(out.getpixel((200, 300)), 40)

    def test_photographed_page_keeps_a_light_mark(self):
        out = self.stamp(
            self.page("grey.jpg", 160, stroke=False), os.path.join(self.tmp, "g.png")
        )
        self.assertGreater(out.getpixel((200, 300)), 165)

    def test_pdf_is_stamped_and_scrubbed(self):
        src = os.path.join(self.tmp, "doc.pdf")
        dest = os.path.join(self.tmp, "doc_out.pdf")
        doc = pymupdf.open()
        doc.new_page(width=400, height=600)
        doc.set_metadata({"author": "Someone", "producer": "Scanner"})
        doc.save(src)
        doc.close()

        with mock.patch.dict(os.environ, self.env):
            self.assertTrue(watermark_file(src, dest, load_watermark()))

        with pymupdf.open(dest) as out:
            self.assertEqual(out.page_count, 1)
            self.assertEqual(len(out[0].get_images()), 1)
            self.assertFalse(out.metadata.get("author"))

    def test_unsupported_type_is_left_alone(self):
        src = os.path.join(self.tmp, "clip.mp4")
        with open(src, "wb") as handle:
            handle.write(b"not really a video")
        with mock.patch.dict(os.environ, self.env):
            mark = load_watermark()
        self.assertFalse(watermark_file(src, os.path.join(self.tmp, "o.mp4"), mark))

    def test_disabled_without_env(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(load_watermark())
