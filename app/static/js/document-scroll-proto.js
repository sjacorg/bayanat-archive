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
 *   [data-zoom]                     zoom buttons: "fit" | "in" | "out"
 *   #zoom-label                     shows current zoom %
 *   #page-counter                   live "Page n / N"
 *   [data-rail]                     page-rail jump buttons
 */
(function () {
  "use strict";

  var scrollDocx = null;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // ── 1. Navigation: live counter, rail highlight, keyboard ─────────
  function initNav() {
    var pages = Array.from(document.querySelectorAll("[data-page]"));
    var rail = Array.from(document.querySelectorAll("[data-rail]"));
    var railScroller = document.querySelector(".scroll-page-rail");
    var counter = document.getElementById("page-counter");
    var total = pages.filter(function (p) {
      return p.dataset.page !== "0";
    }).length;
    var current = 0;
    var navRaf = null;

    function keepRailButtonVisible(button) {
      if (!railScroller || !button) return;
      var railRect = railScroller.getBoundingClientRect();
      var buttonRect = button.getBoundingClientRect();
      if (buttonRect.top < railRect.top) {
        railScroller.scrollTop -= railRect.top - buttonRect.top + 8;
      } else if (buttonRect.bottom > railRect.bottom) {
        railScroller.scrollTop += buttonRect.bottom - railRect.bottom + 8;
      }
    }

    function setActive(n) {
      current = n === "0" ? 0 : parseInt(n, 10);
      if (counter)
        counter.textContent =
          n === "0" || n === 0 ? "Overview" : "Page " + n + " / " + total;
      rail.forEach(function (b) {
        var on = b.dataset.rail === String(n);
        b.classList.toggle("is-active", on);
        b.classList.toggle("border-secondary", on);
        b.classList.toggle("bg-base-200", on);
        if (on) keepRailButtonVisible(b);
      });

      var params = new URLSearchParams(window.location.search);
      if (current === 0) {
        params.delete("page");
      } else {
        params.set("page", current);
      }
      var qs = params.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    }

    function updateActivePage() {
      navRaf = null;
      var viewportCenter = window.innerHeight * 0.42;
      var best = null;
      var bestDistance = Infinity;

      pages.forEach(function (page) {
        var rect = page.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;

        var pageCenter = rect.top + rect.height / 2;
        var distance = Math.abs(pageCenter - viewportCenter);
        if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
          distance = 0;
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          best = page;
        }
      });

      if (best) setActive(best.dataset.page);
    }

    function requestActivePageUpdate() {
      if (navRaf !== null) return;
      navRaf = window.requestAnimationFrame(updateActivePage);
    }

    window.addEventListener("scroll", requestActivePageUpdate, { passive: true });
    window.addEventListener("resize", requestActivePageUpdate);
    updateActivePage();

    var initialPage = parseInt(new URLSearchParams(window.location.search).get("page"), 10);
    if (initialPage && initialPage > 0) {
      setTimeout(function () { jump(initialPage); }, 120);
    }

    function jump(n) {
      var el = document.getElementById("page-" + n);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(n);
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
    var media = null;
    if (typeof window.createDocumentScrollDocx === "function") {
      scrollDocx = window.createDocumentScrollDocx();
    }
    if (typeof window.createDocumentScrollMedia === "function") {
      media = window.createDocumentScrollMedia({
        getDocx: function () {
          return scrollDocx;
        },
      });
      media.initLazyPreviews();
    }
    if (media && typeof window.createDocumentScrollLightbox === "function") {
      window.createDocumentScrollLightbox({
        loadPdf: media.loadPdf,
        renderDocxInto: function (src, container) {
          if (!scrollDocx) {
            throw new Error("Scroll DOCX adapter failed to load.");
          }
          return scrollDocx.renderInto(src, container);
        },
      }).init();
    }
    initNav();
  });
})();
