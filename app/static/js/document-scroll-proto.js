/*
 * Continuous-scroll document viewer — FOUNDATION prototype (BDA-12).
 *
 * Goal: natural vertical scroll through all pages of a record, while losing
 * none of the classic viewer's capabilities. Three pillars:
 *
 *   1. Inline PDF rendering   — PDFs render to <canvas> in the page flow
 *                               (no nested <embed> scrollbar).
 *   2. Global fit-width zoom  — one control scales the whole reading column.
 *   3. Click-to-zoom focus    — click any page for a pan + wheel-zoom lightbox
 *                               (deep inspection; PDFs re-render sharp on demand).
 *
 * Decoupled from the classic viewer on purpose so it can't regress it. Daniel
 * can reconcile this with document-detail-pdf.js / -zoom.js when productizing.
 *
 * DOM contract:
 *   #reading                        reading column; carries --page-width
 *   [data-page]                     each page section (data-page="0" = overview)
 *   img[data-zoom-src]              an image page (click to focus)
 *   [data-pdf-src]                  a PDF host; JS fills it with page canvases
 *   [data-zoom]                     zoom buttons: "fit" | "in" | "out"
 *   #zoom-label                     shows current zoom %
 *   #page-counter                   live "Page n / N"
 *   [data-rail]                     page-rail jump buttons
 */
(function () {
  "use strict";

  var PDF_WORKER =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var pdfCache = new Map(); // src -> Promise<pdfDoc>

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function loadPdf(src) {
    if (!pdfCache.has(src)) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      pdfCache.set(src, window.pdfjsLib.getDocument(src).promise);
    }
    return pdfCache.get(src);
  }

  // ── 1. Inline PDF rendering ──────────────────────────────────────
  async function renderPdfHost(host) {
    var src = host.dataset.pdfSrc;
    if (!window.pdfjsLib) {
      host.innerHTML = downloadFallback(src);
      return;
    }
    try {
      var pdf = await loadPdf(src);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      host.innerHTML = "";
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var containerW = host.clientWidth || 860;
        var base = page.getViewport({ scale: 1 });
        var scale = containerW / base.width;
        var vp = page.getViewport({ scale: scale * dpr });
        var canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.className = "block w-full cursor-zoom-in";
        if (i > 1) canvas.classList.add("border-t", "border-base-300/60");
        canvas.dataset.zoomPdf = src;
        canvas.dataset.pdfPage = String(i);
        host.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp })
          .promise;
      }
    } catch (e) {
      host.innerHTML = downloadFallback(src);
    }
  }

  function downloadFallback(src) {
    return (
      '<div class="flex flex-col items-center gap-3 p-10 text-center text-sm text-base-content/60">' +
      "<span>Could not render this PDF inline.</span>" +
      '<a class="border border-primary bg-primary px-4 py-1.5 font-semibold text-primary-content no-underline" href="' +
      src +
      '" download>Download PDF</a></div>'
    );
  }

  // ── 2. Global fit-width zoom ──────────────────────────────────────
  function initZoom() {
    var reading = document.getElementById("reading");
    var label = document.getElementById("zoom-label");
    if (!reading) return;
    var BASE = 880,
      MIN = 0.6,
      MAX = 2.0,
      STEP = 0.15;
    var factor = 1;

    function apply() {
      reading.style.setProperty("--page-width", Math.round(BASE * factor) + "px");
      if (label) label.textContent = Math.round(factor * 100) + "%";
    }
    document.querySelectorAll("[data-zoom]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.dataset.zoom;
        if (mode === "in") factor = Math.min(MAX, factor + STEP);
        else if (mode === "out") factor = Math.max(MIN, factor - STEP);
        else factor = 1;
        apply();
      });
    });
    apply();
  }

  // ── 3. Click-to-zoom focus lightbox (pan + wheel zoom) ───────────
  function initLightbox() {
    var overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[120] hidden items-center justify-center bg-slate-900/90 backdrop-blur-sm";
    overlay.innerHTML =
      '<div class="absolute right-4 top-4 flex gap-2">' +
      '<button data-lb="out" class="h-10 w-10 border border-white/40 bg-white/10 text-xl text-white" aria-label="Zoom out">−</button>' +
      '<button data-lb="in" class="h-10 w-10 border border-white/40 bg-white/10 text-xl text-white" aria-label="Zoom in">+</button>' +
      '<button data-lb="close" class="h-10 w-10 border border-white/40 bg-white/10 text-xl text-white" aria-label="Close">×</button>' +
      "</div>" +
      '<div data-lb="stage" class="relative h-full w-full overflow-hidden"></div>';
    document.body.appendChild(overlay);

    var stage = overlay.querySelector('[data-lb="stage"]');
    var media = null; // current <img> or <canvas>
    var s = 1,
      x = 0,
      y = 0,
      dragging = false,
      px = 0,
      py = 0;

    function transform() {
      if (media) media.style.transform =
        "translate(" + x + "px," + y + "px) scale(" + s + ")";
    }
    function resetView() {
      s = 1;
      x = 0;
      y = 0;
      transform();
    }
    function mount(el) {
      stage.innerHTML = "";
      media = el;
      media.style.transformOrigin = "center center";
      media.style.cursor = "grab";
      media.className =
        "absolute left-1/2 top-1/2 max-h-[92vh] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 select-none";
      // our transform is applied on top of the translate via a wrapper
      var wrap = document.createElement("div");
      wrap.className =
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
      media.classList.remove("left-1/2", "top-1/2", "-translate-x-1/2", "-translate-y-1/2", "absolute");
      media.style.display = "block";
      media.style.maxHeight = "92vh";
      media.style.maxWidth = "92vw";
      wrap.appendChild(media);
      stage.appendChild(wrap);
      resetView();
    }
    function open() {
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      document.body.style.overflow = "hidden";
    }
    function close() {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
      document.body.style.overflow = "";
      stage.innerHTML = "";
      media = null;
    }

    function openImage(src) {
      var img = new Image();
      img.src = src;
      mount(img);
      open();
    }
    async function openPdfPage(src, pageNum) {
      open();
      stage.innerHTML =
        '<p class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-white/70">Loading page…</p>';
      try {
        var pdf = await loadPdf(src);
        var page = await pdf.getPage(pageNum);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var target = Math.min(window.innerHeight * 0.92, 1400);
        var base = page.getViewport({ scale: 1 });
        var scale = (target / base.height) * dpr;
        var vp = page.getViewport({ scale: scale });
        var canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp })
          .promise;
        mount(canvas);
      } catch (e) {
        close();
      }
    }

    // wheel zoom (anchored roughly at centre — good enough for foundation)
    stage.addEventListener(
      "wheel",
      function (e) {
        if (!media) return;
        e.preventDefault();
        var delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        s = Math.min(8, Math.max(1, s * delta));
        if (s === 1) {
          x = 0;
          y = 0;
        }
        transform();
      },
      { passive: false }
    );
    // drag pan
    stage.addEventListener("pointerdown", function (e) {
      if (!media || s <= 1) return;
      dragging = true;
      px = e.clientX;
      py = e.clientY;
      media.style.cursor = "grabbing";
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      x += e.clientX - px;
      y += e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      transform();
    });
    window.addEventListener("pointerup", function () {
      dragging = false;
      if (media) media.style.cursor = "grab";
    });

    overlay.querySelector('[data-lb="in"]').addEventListener("click", function () {
      s = Math.min(8, s * 1.25);
      transform();
    });
    overlay.querySelector('[data-lb="out"]').addEventListener("click", function () {
      s = Math.max(1, s / 1.25);
      if (s === 1) {
        x = 0;
        y = 0;
      }
      transform();
    });
    overlay
      .querySelector('[data-lb="close"]')
      .addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    // wire page clicks
    document.addEventListener("click", function (e) {
      var img = e.target.closest("img[data-zoom-src]");
      if (img) {
        openImage(img.dataset.zoomSrc);
        return;
      }
      var cv = e.target.closest("canvas[data-zoom-pdf]");
      if (cv) {
        openPdfPage(cv.dataset.zoomPdf, parseInt(cv.dataset.pdfPage, 10));
      }
    });
  }

  // ── Navigation: live counter, rail highlight, keyboard ───────────
  function initNav() {
    var pages = Array.from(document.querySelectorAll("[data-page]"));
    var rail = Array.from(document.querySelectorAll("[data-rail]"));
    var counter = document.getElementById("page-counter");
    var total = pages.filter(function (p) {
      return p.dataset.page !== "0";
    }).length;
    var current = 0;

    function setActive(n) {
      current = n === "0" ? 0 : parseInt(n, 10);
      if (counter)
        counter.textContent =
          n === "0" || n === 0 ? "Overview" : "Page " + n + " / " + total;
      rail.forEach(function (b) {
        var on = b.dataset.rail === String(n);
        b.classList.toggle("border-secondary", on);
        b.classList.toggle("bg-base-200", on);
      });
    }

    var io = new IntersectionObserver(
      function (entries) {
        var vis = entries.filter(function (e) {
          return e.isIntersecting;
        });
        if (vis.length) {
          vis.sort(function (a, b) {
            return b.intersectionRatio - a.intersectionRatio;
          });
          setActive(vis[0].target.dataset.page);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    pages.forEach(function (p) {
      io.observe(p);
    });

    function jump(n) {
      var el = document.getElementById("page-" + n);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    rail.forEach(function (b) {
      b.addEventListener("click", function () {
        jump(b.dataset.rail);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (current < total) jump(current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (current > 1) jump(current - 1);
      }
    });
  }

  ready(function () {
    document.querySelectorAll("[data-pdf-src]").forEach(renderPdfHost);
    initZoom();
    initLightbox();
    initNav();
  });
})();
