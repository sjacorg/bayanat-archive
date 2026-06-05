window.createDocumentScrollLightbox = function createDocumentScrollLightbox(options) {
  "use strict";

  var loadPdf = options.loadPdf;
  var renderDocxInto = options.renderDocxInto;

  function init() {
    var overlay = document.createElement("div");
    overlay.className = "scroll-lightbox";
    overlay.innerHTML =
      '<div data-lb="toolbar" class="scroll-lightbox__toolbar">' +
      '<div class="scroll-lightbox__zoom-controls">' +
      '<button type="button" data-lb="out" class="scroll-lightbox__button" aria-label="Zoom out">-</button>' +
      '<span data-lb="label" class="scroll-lightbox__label">100%</span>' +
      '<button type="button" data-lb="in" class="scroll-lightbox__button" aria-label="Zoom in">+</button>' +
      '<button type="button" data-lb="fit" class="scroll-lightbox__fit" aria-label="Fit to screen">Fit</button>' +
      '</div>' +
      '<button type="button" data-lb="close" class="scroll-lightbox__close" aria-label="Close">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>' +
      "</svg></button>" +
      "</div>" +
      '<div data-lb="stage" class="scroll-lightbox__stage">' +
      '<div data-lb="content" class="scroll-lightbox__content"></div>' +
      "</div>" +
      '<div data-lb="filebar" class="scroll-lightbox__filebar">' +
      '<p data-lb="title" class="scroll-lightbox__title">Preview</p>' +
      '<a data-lb="download" class="scroll-lightbox__download" href="#" download>Download</a>' +
      "</div>";
    document.body.appendChild(overlay);

    var stage = overlay.querySelector('[data-lb="stage"]');
    var content = overlay.querySelector('[data-lb="content"]');
    var label = overlay.querySelector('[data-lb="label"]');
    var title = overlay.querySelector('[data-lb="title"]');
    var download = overlay.querySelector('[data-lb="download"]');
    var zoomIn = overlay.querySelector('[data-lb="in"]');
    var zoomOut = overlay.querySelector('[data-lb="out"]');
    var media = null;
    var activeZoomTarget = null;
    var activeZoomMode = "width";
    var zoom = 1;
    var baseWidth = 1;
    var minZoom = 1;
    var maxZoom = 6;
    var lastZoomAt = 0;
    var isOpen = false;
    var loadToken = 0;
    var pageObserver = null;
    var dragging = false;
    var px = 0;
    var py = 0;
    var lockedScrollY = 0;
    var previousBodyStyles = null;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function filenameFromSrc(src) {
      if (!src) return "";
      try {
        var url = new URL(src, window.location.href);
        var pathname = url.pathname || "";
        return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
      } catch (error) {
        return String(src).split("/").filter(Boolean).pop() || "";
      }
    }

    function updateToolbar(meta) {
      meta = meta || {};
      var src = meta.src || "";
      var filename = meta.filename || filenameFromSrc(src);
      var labelText = meta.title || filename || "Preview";
      if (title) title.textContent = labelText;
      if (download) {
        download.href = src || "#";
        download.download = filename || "";
        download.setAttribute("aria-label", "Download " + labelText);
        download.classList.toggle("is-hidden", !src);
      }
    }

    function updateControls() {
      if (label) label.textContent = Math.round(zoom * 100) + "%";
      if (zoomOut) zoomOut.disabled = zoom <= minZoom + 0.001;
      if (zoomIn) zoomIn.disabled = zoom >= maxZoom - 0.001;
    }

    function lockDocumentScroll() {
      if (previousBodyStyles) return;
      lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      previousBodyStyles = {
        position: document.body.style.position,
        top: document.body.style.top,
        left: document.body.style.left,
        right: document.body.style.right,
        width: document.body.style.width,
        overflow: document.body.style.overflow,
      };
      document.body.style.position = "fixed";
      document.body.style.top = "-" + lockedScrollY + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
    }

    function unlockDocumentScroll() {
      if (!previousBodyStyles) return;
      document.body.style.position = previousBodyStyles.position;
      document.body.style.top = previousBodyStyles.top;
      document.body.style.left = previousBodyStyles.left;
      document.body.style.right = previousBodyStyles.right;
      document.body.style.width = previousBodyStyles.width;
      document.body.style.overflow = previousBodyStyles.overflow;
      previousBodyStyles = null;
      window.scrollTo(0, lockedScrollY);
    }

    var pendingScroll = null;
    var scrollRafId = null;

    function findPdfAnchor(anchor, localX, localY) {
      if (!media || activeZoomMode !== "pdf") return null;
      var pages = Array.from(media.querySelectorAll(".scroll-lightbox__pdf-page"));
      var pointerY = anchor ? anchor.clientY : stage.getBoundingClientRect().top + localY;
      var pointerX = anchor ? anchor.clientX : stage.getBoundingClientRect().left + localX;
      var best = null;
      var bestDistance = Infinity;

      pages.forEach(function (page) {
        var rect = page.getBoundingClientRect();
        var insideY = pointerY >= rect.top && pointerY <= rect.bottom;
        var insideX = pointerX >= rect.left && pointerX <= rect.right;
        var centerY = rect.top + rect.height / 2;
        var distance = insideY ? 0 : Math.abs(pointerY - centerY);
        if (insideY && insideX) distance = -1;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { page: page, rect: rect };
        }
      });

      if (!best || !best.page || !best.page.dataset.pdfPageNumber) return null;
      return {
        type: "pdf-page",
        pageNumber: best.page.dataset.pdfPageNumber,
        localX: localX,
        localY: localY,
        xRatio: clamp((pointerX - best.rect.left) / Math.max(best.rect.width, 1), 0, 1),
        yRatio: clamp((pointerY - best.rect.top) / Math.max(best.rect.height, 1), 0, 1),
      };
    }

    function captureScroll(currentZoom, nextZoom, anchor) {
      if (nextZoom <= 0 || currentZoom <= 0) { pendingScroll = null; return; }
      var rect = stage.getBoundingClientRect();
      var localX = anchor ? anchor.clientX - rect.left : stage.clientWidth / 2;
      var localY = anchor ? anchor.clientY - rect.top : stage.clientHeight / 2;
      var pdfAnchor = findPdfAnchor(anchor, localX, localY);
      if (pdfAnchor) {
        pendingScroll = pdfAnchor;
        return;
      }
      var worldX = stage.scrollLeft + localX;
      var worldY = stage.scrollTop + localY;
      var ratio = nextZoom / currentZoom;
      pendingScroll = {
        left: worldX * ratio - localX,
        top: worldY * ratio - localY,
      };
    }

    function restoreScroll() {
      if (!pendingScroll) return;
      if (scrollRafId !== null) window.cancelAnimationFrame(scrollRafId);
      var restore = pendingScroll;
      pendingScroll = null;
      scrollRafId = window.requestAnimationFrame(function () {
        scrollRafId = null;
        var maxLeft = Math.max(stage.scrollWidth - stage.clientWidth, 0);
        var maxTop = Math.max(stage.scrollHeight - stage.clientHeight, 0);
        if (restore.type === "pdf-page") {
          var page = media && media.querySelector('[data-pdf-page-number="' + restore.pageNumber + '"]');
          if (page) {
            var stageRect = stage.getBoundingClientRect();
            var pageRect = page.getBoundingClientRect();
            var pageLeft = stage.scrollLeft + pageRect.left - stageRect.left;
            var pageTop = stage.scrollTop + pageRect.top - stageRect.top;
            stage.scrollLeft = Math.max(0, Math.min(maxLeft, pageLeft + pageRect.width * restore.xRatio - restore.localX));
            stage.scrollTop = Math.max(0, Math.min(maxTop, pageTop + pageRect.height * restore.yRatio - restore.localY));
            return;
          }
        }
        stage.scrollLeft = Math.max(0, Math.min(maxLeft, restore.left));
        stage.scrollTop = Math.max(0, Math.min(maxTop, restore.top));
      });
    }

    function applyZoom(nextZoom, anchor) {
      if (!media) return;
      var previous = zoom;
      var target = activeZoomTarget || media;

      zoom = clamp(nextZoom, minZoom, maxZoom);
      if (Math.abs(zoom - previous) < 0.001) return;
      lastZoomAt = Date.now();

      captureScroll(previous, zoom, anchor);

      if (activeZoomMode === "docx") {
        media.style.width = Math.round(baseWidth * zoom) + "px";
        media.style.maxWidth = "none";
        target.style.width = Math.round(baseWidth) + "px";
        target.style.maxWidth = "none";
        target.style.transform = "";
        target.style.transformOrigin = "top left";
        target.style.zoom = String(zoom);
      } else {
        target.style.width = Math.round(baseWidth * zoom) + "px";
        target.style.maxWidth = "none";
        target.style.height = "auto";
      }

      restoreScroll();
      updateControls();
    }

    function mount(el, naturalWidth, naturalHeight, mountOptions) {
      mountOptions = mountOptions || {};
      content.innerHTML = "";
      media = el;
      activeZoomTarget = null;
      activeZoomMode = "width";

      var viewportW = Math.max(stage.clientWidth - 32, 280);
      var viewportH = Math.max(stage.clientHeight - 32, 240);
      var width = Math.max(naturalWidth || el.naturalWidth || el.width || viewportW, 1);
      var height = Math.max(naturalHeight || el.naturalHeight || el.height || viewportH, 1);
      baseWidth = Math.min(viewportW, width, Math.max(1, width * (viewportH / height)));
      minZoom = 1;
      zoom = 1;
      media.className = mountOptions.className || "scroll-lightbox__media";
      media.style.display = "block";
      media.style.width = Math.round(baseWidth) + "px";
      media.style.maxWidth = "none";
      media.style.height = "auto";
      media.style.cursor = "grab";
      content.appendChild(media);
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
      activeZoomMode = mountOptions.zoomMode || activeZoomMode;
      updateControls();
    }

    function useDocxZoomTarget(root) {
      if (!root) return;
      var target = root.querySelector(".docx-wrapper") ||
        root.querySelector(".docx-preview") ||
        root;
      var measuredWidth = target.getBoundingClientRect
        ? target.getBoundingClientRect().width
        : 0;
      var width = Math.round(Math.max(measuredWidth, target.offsetWidth || 0));
      if (!Number.isFinite(width) || width < 220) return;

      activeZoomTarget = target;
      activeZoomMode = "docx";
      baseWidth = width / Math.max(zoom, 1);
      target.dataset.baseRenderWidth = String(baseWidth);
      target.style.width = Math.round(baseWidth) + "px";
      target.style.maxWidth = "none";
      target.style.transformOrigin = "top left";
      target.style.zoom = String(zoom);
      media.style.width = Math.round(baseWidth * zoom) + "px";
      media.style.maxWidth = "none";
      updateControls();
    }

    function open(meta) {
      isOpen = true;
      loadToken += 1;
      updateToolbar(meta);
      overlay.classList.add("is-open");
      lockDocumentScroll();
      return loadToken;
    }

    function close() {
      isOpen = false;
      loadToken += 1;
      if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
      overlay.classList.remove("is-open");
      unlockDocumentScroll();
      content.querySelectorAll("canvas").forEach(function (c) { c.width = 0; c.height = 0; });
      content.innerHTML = "";
      media = null;
      activeZoomTarget = null;
      activeZoomMode = "width";
      dragging = false;
      updateToolbar({});
    }

    function openImage(src, meta) {
      var img = new Image();
      meta = meta || {};
      meta.src = src;
      var token = open(meta);
      content.innerHTML = '<p class="scroll-lightbox__loading">Loading image...</p>';
      img.onload = function () {
        if (!isOpen || token !== loadToken) return;
        mount(img, img.naturalWidth, img.naturalHeight);
      };
      img.onerror = function () {
        if (token === loadToken) close();
      };
      img.src = src;
    }

    async function openFullPdf(src, meta) {
      meta = meta || {};
      meta.src = src;
      var token = open(meta);
      content.innerHTML = '<p class="scroll-lightbox__loading">Loading PDF...</p>';
      try {
        var pdf = await loadPdf(src);
        if (!isOpen || token !== loadToken) return;

        var firstPage = await pdf.getPage(1);
        if (!isOpen || token !== loadToken) return;

        // cap dpr at 1.5 and canvas pixel width at 1200 to avoid OOM on low-RAM devices
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        var target = Math.min(window.innerWidth * 1.2, 1200);
        var firstBase = firstPage.getViewport({ scale: 1 });
        var cssScale = target / firstBase.width;
        var firstDisplayViewport = firstPage.getViewport({ scale: cssScale });

        var wrapper = document.createElement("div");
        wrapper.setAttribute("role", "document");
        wrapper.setAttribute("aria-label", "Full PDF preview");
        mount(wrapper, firstDisplayViewport.width, firstDisplayViewport.height, {
          className: "scroll-lightbox__pdf-stack",
          zoomMode: "pdf",
        });

        // tracks in-progress renders so we don't double-render a page
        var rendering = new Set();
        // live DOM node for each page number (placeholder or canvas)
        var pageEls = {};
        // aspect ratios keep offloaded placeholders the same height as rendered pages
        var pageAspectRatios = {};
        pageAspectRatios[1] = firstBase.width / firstBase.height;

        var scrollDebounceTimer = null;
        // keep at most this many rendered canvases in memory
        var MAX_RENDERED = 6;

        function mutatePagePreservingScroll(el, mutate) {
          if (!el) {
            mutate();
            return;
          }
          var stageRect = stage.getBoundingClientRect();
          var before = el.getBoundingClientRect();
          var shouldPreserve = before.bottom <= stageRect.top + 1;
          var beforeHeight = before.height;
          mutate();
          if (!shouldPreserve) return;
          var replacement = pageEls[el.dataset.pdfPageNumber] || el;
          var after = replacement.getBoundingClientRect();
          var delta = after.height - beforeHeight;
          if (Math.abs(delta) > 0.5) {
            stage.scrollTop += delta;
          }
        }

        function makePlaceholder(n) {
          var ph = document.createElement("div");
          ph.className = "scroll-lightbox__pdf-page scroll-lightbox__pdf-placeholder";
          ph.dataset.pdfPageNumber = String(n);
          ph.style.width = "100%";
          ph.style.aspectRatio = String(pageAspectRatios[n] || pageAspectRatios[1]);
          return ph;
        }

        function unloadPage(pageNumber) {
          var el = pageEls[pageNumber];
          if (!el || el.tagName !== "CANVAS") return;
          var ph = makePlaceholder(pageNumber);
          mutatePagePreservingScroll(el, function () {
            el.replaceWith(ph);
            pageEls[pageNumber] = ph;
          });
          el.width = 0;
          el.height = 0;
        }

        async function renderPage(pageNumber) {
          if (rendering.has(pageNumber)) return;
          var el = pageEls[pageNumber];
          if (!el || el.tagName === "CANVAS") return;
          rendering.add(pageNumber);
          try {
            var page = await pdf.getPage(pageNumber);
            if (!isOpen || token !== loadToken) return;
            var base = page.getViewport({ scale: 1 });
            pageAspectRatios[pageNumber] = base.width / base.height;
            var renderViewport = page.getViewport({ scale: (target / base.width) * dpr });
            var canvas = document.createElement("canvas");
            canvas.width = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            canvas.style.width = "100%";
            canvas.style.height = "auto";
            canvas.className = "scroll-lightbox__pdf-page";
            canvas.setAttribute("aria-label", "PDF page " + pageNumber);
            canvas.dataset.pdfPageNumber = String(pageNumber);
            mutatePagePreservingScroll(pageEls[pageNumber], function () {
              pageEls[pageNumber].replaceWith(canvas);
              pageEls[pageNumber] = canvas;
            });
            await page.render({
              canvasContext: canvas.getContext("2d", { alpha: false }),
              viewport: renderViewport,
            }).promise;
          } catch (renderErr) {
            console.error("[pdf-lightbox] renderPage " + pageNumber + " failed:", renderErr);
          } finally {
            rendering.delete(pageNumber);
          }
        }

        // called after scroll stops — figures out which pages are near the viewport,
        // renders them, and unloads everything outside the keep window
        function onScrollSettle() {
          if (!isOpen || token !== loadToken) return;
          if (Date.now() - lastZoomAt < 350) {
            onScroll();
            return;
          }
          var stageRect = stage.getBoundingClientRect();
          var stageH = stageRect.height;
          var margin = stageH; // one screen above and below

          // find the center page by scroll position to anchor the keep window
          var centerPage = 1;
          var bestDist = Infinity;
          for (var n = 1; n <= pdf.numPages; n++) {
            var el = pageEls[n];
            if (!el) continue;
            var r = el.getBoundingClientRect();
            var dist = Math.abs((r.top + r.bottom) / 2 - (stageRect.top + stageH / 2));
            if (dist < bestDist) { bestDist = dist; centerPage = n; }
          }

          var half = Math.floor(MAX_RENDERED / 2);
          var keepFrom = Math.max(1, centerPage - half);
          var keepTo = Math.min(pdf.numPages, centerPage + half);

          // unload pages outside the keep window
          for (var u = 1; u <= pdf.numPages; u++) {
            if (u < keepFrom || u > keepTo) unloadPage(u);
          }

          // render pages in the keep window that are within one screen of the viewport
          for (var r2 = keepFrom; r2 <= keepTo; r2++) {
            var el2 = pageEls[r2];
            if (!el2 || el2.tagName === "CANVAS" || rendering.has(r2)) continue;
            var rect = el2.getBoundingClientRect();
            var inRange = rect.bottom >= stageRect.top - margin &&
                          rect.top <= stageRect.bottom + margin;
            if (inRange) renderPage(r2);
          }
        }

        function onScroll() {
          if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
          scrollDebounceTimer = setTimeout(onScrollSettle, 200);
        }

        async function loadPageMetrics() {
          for (var n = 2; n <= pdf.numPages; n += 1) {
            if (!isOpen || token !== loadToken) return;
            if (pageAspectRatios[n]) continue;
            try {
              var page = await pdf.getPage(n);
              if (!isOpen || token !== loadToken) return;
              var base = page.getViewport({ scale: 1 });
              pageAspectRatios[n] = base.width / base.height;
              var el = pageEls[n];
              if (el && el.classList.contains("scroll-lightbox__pdf-placeholder")) {
                mutatePagePreservingScroll(el, function () {
                  el.style.aspectRatio = String(pageAspectRatios[n]);
                });
              }
            } catch (metricErr) {
              if (window.console && typeof window.console.warn === "function") {
                window.console.warn("[pdf-lightbox] page metric failed:", n, metricErr);
              }
            }
          }
        }

        stage.addEventListener("scroll", onScroll, { passive: true });

        // build placeholders for all pages upfront so the scroll height is correct
        for (var i = 1; i <= pdf.numPages; i += 1) {
          var ph = makePlaceholder(i);
          wrapper.appendChild(ph);
          pageEls[i] = ph;
        }

        pageObserver = {
          disconnect: function () {
            stage.removeEventListener("scroll", onScroll);
            if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
          }
        };

        // render page 1 immediately
        await renderPage(1);
        if (!isOpen || token !== loadToken) return;

        // trigger a settle to render pages visible on open
        onScrollSettle();
        loadPageMetrics();

      } catch (error) {
        console.error("[pdf-lightbox] openFullPdf crashed:", error);
        if (token === loadToken) close();
      }
    }

    async function openFullDocx(src, meta) {
      meta = meta || {};
      meta.src = src;
      var token = open(meta);
      content.innerHTML = '<p class="scroll-lightbox__loading">Loading DOCX...</p>';
      try {
        var wrapper = document.createElement("div");
        wrapper.setAttribute("role", "document");
        wrapper.setAttribute("aria-label", "Full DOCX preview");
        mount(wrapper, 880, 1245, {
          className: "doc-docx-scope scroll-docx-lightbox-doc",
        });
        await renderDocxInto(src, wrapper);
        if (!isOpen || token !== loadToken) return;
        useDocxZoomTarget(wrapper);
      } catch (error) {
        if (token === loadToken) close();
      }
    }

    stage.addEventListener(
      "wheel",
      function (event) {
        if (!media) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          applyZoom(zoom * Math.exp((-event.deltaY || 0) * 0.0015), event);
        }
      },
      { passive: false }
    );

    stage.addEventListener("pointerdown", function (event) {
      if (!media || event.target.closest("button, a")) return;
      dragging = true;
      px = event.clientX;
      py = event.clientY;
      stage.setPointerCapture(event.pointerId);
      media.style.cursor = "grabbing";
    });

    stage.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      stage.scrollLeft -= event.clientX - px;
      stage.scrollTop -= event.clientY - py;
      px = event.clientX;
      py = event.clientY;
    });

    stage.addEventListener("pointerup", function () {
      dragging = false;
      if (media) media.style.cursor = "grab";
    });
    stage.addEventListener("pointercancel", function () {
      dragging = false;
      if (media) media.style.cursor = "grab";
    });

    // pinch-to-zoom via touch events
    var pinchStartDist = null;
    var pinchStartZoom = 1;
    var pinchAnchor = null;

    function touchDist(a, b) {
      var dx = a.clientX - b.clientX;
      var dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    stage.addEventListener("touchstart", function (event) {
      if (!media || event.touches.length !== 2) return;
      event.preventDefault();
      dragging = false;
      pinchStartDist = touchDist(event.touches[0], event.touches[1]);
      pinchStartZoom = zoom;
    }, { passive: false });

    stage.addEventListener("touchmove", function (event) {
      if (!media || !pinchStartDist || event.touches.length !== 2) return;
      event.preventDefault();
      var dist = touchDist(event.touches[0], event.touches[1]);
      var scale = dist / pinchStartDist;
      var nextZoom = pinchStartZoom * Math.pow(scale, 0.85);
      var anchor = {
        clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
        clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2,
      };
      applyZoom(nextZoom, anchor);
    }, { passive: false });

    stage.addEventListener("touchend", function () {
      pinchStartDist = null;
      pendingScroll = null;
    });

    zoomIn.addEventListener("click", function (event) {
      event.stopPropagation();
      applyZoom(zoom * 1.25);
    });
    zoomOut.addEventListener("click", function (event) {
      event.stopPropagation();
      applyZoom(zoom / 1.25);
    });
    overlay.querySelector('[data-lb="fit"]').addEventListener("click", function (event) {
      event.stopPropagation();
      applyZoom(1);
    });
    overlay.querySelector('[data-lb="close"]').addEventListener("click", function (event) {
      event.stopPropagation();
      close();
    });
    overlay.querySelector('[data-lb="toolbar"]').addEventListener("click", function (event) {
      event.stopPropagation();
    });
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", function (event) {
      if (!isOpen) return;
      if (event.key === "Escape") close();
      else if (media && (event.key === "+" || event.key === "=")) applyZoom(zoom * 1.25);
      else if (media && event.key === "-") applyZoom(zoom / 1.25);
    });

    document.addEventListener("click", function (event) {
      var img = event.target.closest("[data-zoom-src]");
      if (img) {
        openImage(img.dataset.zoomSrc, {
          title: img.dataset.lightboxTitle || "",
          filename: img.dataset.lightboxFilename || "",
        });
        return;
      }
      var fullPdf = event.target.closest("[data-open-full-pdf]");
      if (fullPdf) {
        openFullPdf(fullPdf.dataset.openFullPdf, {
          title: fullPdf.dataset.lightboxTitle || "",
          filename: fullPdf.dataset.lightboxFilename || "",
        });
        return;
      }
      var fullDocx = event.target.closest("[data-open-full-docx]");
      if (fullDocx) {
        openFullDocx(fullDocx.dataset.openFullDocx, {
          title: fullDocx.dataset.lightboxTitle || "",
          filename: fullDocx.dataset.lightboxFilename || "",
        });
      }
    });
  }

  return {
    init: init,
  };
};
