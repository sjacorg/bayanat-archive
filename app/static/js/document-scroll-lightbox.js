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

    function captureScroll(currentZoom, nextZoom, anchor) {
      if (nextZoom <= 0 || currentZoom <= 0) { pendingScroll = null; return; }
      var rect = stage.getBoundingClientRect();
      var localX = anchor ? anchor.clientX - rect.left : stage.clientWidth / 2;
      var localY = anchor ? anchor.clientY - rect.top : stage.clientHeight / 2;
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

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var target = Math.min(window.innerWidth * 1.55, 1600);
        var firstBase = firstPage.getViewport({ scale: 1 });
        var cssScale = target / firstBase.width;
        var firstDisplayViewport = firstPage.getViewport({ scale: cssScale });

        var wrapper = document.createElement("div");
        wrapper.setAttribute("role", "document");
        wrapper.setAttribute("aria-label", "Full PDF preview");
        mount(wrapper, firstDisplayViewport.width, firstDisplayViewport.height, {
          className: "scroll-lightbox__pdf-stack",
        });

        // tracks in-progress renders so we don't double-render a page
        var rendering = new Set();
        // live DOM node for each page number (placeholder or canvas)
        var pageEls = {};

        async function renderPage(pageNumber) {
          if (rendering.has(pageNumber)) return;
          rendering.add(pageNumber);
          try {
            var page = await pdf.getPage(pageNumber);
            if (!isOpen || token !== loadToken) return;
            var base = page.getViewport({ scale: 1 });
            var renderViewport = page.getViewport({ scale: (target / base.width) * dpr });
            var canvas = document.createElement("canvas");
            canvas.width = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            canvas.style.width = "100%";
            canvas.style.height = "auto";
            canvas.className = "scroll-lightbox__pdf-page";
            canvas.setAttribute("aria-label", "PDF page " + pageNumber);
            pageEls[pageNumber].replaceWith(canvas);
            pageEls[pageNumber] = canvas;
            await page.render({
              canvasContext: canvas.getContext("2d", { alpha: false }),
              viewport: renderViewport,
            }).promise;
          } finally {
            rendering.delete(pageNumber);
          }
        }

        // build placeholders for all pages upfront so the scroll height is correct
        var placeholders = [];
        for (var i = 1; i <= pdf.numPages; i += 1) {
          var ph = document.createElement("div");
          ph.className = "scroll-lightbox__pdf-page scroll-lightbox__pdf-placeholder";
          ph.dataset.pdfPageNumber = String(i);
          ph.style.width = "100%";
          ph.style.aspectRatio = String(firstBase.width / firstBase.height);
          wrapper.appendChild(ph);
          pageEls[i] = ph;
          placeholders.push(ph);
        }

        // render page 1 immediately
        await renderPage(1);
        if (!isOpen || token !== loadToken) return;

        // observe remaining placeholders and render when they enter the viewport
        var observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              var n = parseInt(entry.target.dataset.pdfPageNumber, 10);
              if (!n) return;
              observer.unobserve(entry.target);
              renderPage(n);
            });
          },
          { root: stage, rootMargin: "400px 0px", threshold: 0.01 }
        );

        pageObserver = observer;
        for (var j = 1; j < placeholders.length; j += 1) {
          observer.observe(placeholders[j]);
        }

      } catch (error) {
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
