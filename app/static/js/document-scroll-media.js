window.createDocumentScrollMedia = function createDocumentScrollMedia(options) {
  "use strict";

  var PDF_WORKER =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var pdfCache = new Map();
  var getDocx = options.getDocx;
  var labels = window.BDA_SCROLL_LABELS || {};

  function t(key, values) {
    var text = labels[key] || "";
    if (values) {
      Object.keys(values).forEach(function (name) {
        text = text.replace("{" + name + "}", values[name]);
      });
    }
    return text;
  }

  function loadPdf(src) {
    if (!pdfCache.has(src)) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      pdfCache.set(src, window.pdfjsLib.getDocument(src).promise);
    }
    return pdfCache.get(src);
  }

  async function renderPdfHost(host) {
    var src = host.dataset.pdfSrc;
    var filename = host.dataset.pdfFilename || "";
    var title = host.dataset.lightboxTitle || filename || t("pdf");
    if (!window.pdfjsLib) {
      host.innerHTML = pdfFallback(src);
      return;
    }
    try {
      var pdf = await loadPdf(src);
      var page = await pdf.getPage(1);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var style = window.getComputedStyle(host);
      var containerW = host.clientWidth
        - parseFloat(style.paddingLeft || "0")
        - parseFloat(style.paddingRight || "0")
        || 860;
      var base = page.getViewport({ scale: 1 });
      var scale = containerW / base.width;
      var renderViewport = page.getViewport({ scale: scale * dpr });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.className = "scroll-pdf-preview-canvas mx-auto block w-full";

      var context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: context,
        viewport: renderViewport,
      }).promise;
      host.innerHTML = "";
      host.appendChild(canvas);
      host.appendChild(previewActions({
        src: src,
        summary: (pdf.numPages || 1) > 1
          ? t("previewingPdfPage", { total: pdf.numPages })
          : t("previewingPdf"),
        openLabel: t("viewFullPdf"),
        downloadLabel: t("download"),
        openDataset: "openFullPdf",
        filename: filename,
        title: title,
      }));
    } catch (error) {
      host.innerHTML = pdfFallback(src);
    }
  }

  async function renderDocxHost(host) {
    var src = host.dataset.docxSrc;
    var filename = host.dataset.docxFilename || "";
    var title = host.dataset.lightboxTitle || filename || t("docx");
    try {
      var scrollDocx = getDocx ? getDocx() : null;
      if (!scrollDocx) {
        throw new Error("Scroll DOCX adapter failed to load.");
      }
      host.innerHTML = "";
      var previewFrame = document.createElement("div");
      previewFrame.className = "scroll-docx-frame";
      var preview = document.createElement("div");
      preview.className = "doc-docx-scope scroll-docx-preview";
      var fade = document.createElement("div");
      fade.className = "scroll-docx-fade";

      previewFrame.appendChild(preview);
      previewFrame.appendChild(fade);
      host.appendChild(previewFrame);
      await scrollDocx.renderInto(src, preview);
      host.appendChild(previewActions({
        src: src,
        summary: t("previewingDocx"),
        openLabel: t("viewFullDocx"),
        downloadLabel: t("download"),
        openDataset: "openFullDocx",
        filename: filename,
        title: title,
      }));
    } catch (error) {
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("Scroll DOCX preview failed.", error, { src: src });
      }
      host.innerHTML = fileFallback(src, t("docxRenderFailed"), t("downloadDocx"));
    }
  }

  function previewActions(options) {
    var actions = document.createElement("div");
    actions.className = "scroll-preview-actions";

    var summary = document.createElement("p");
    summary.className = "scroll-preview-actions__summary";
    summary.textContent = options.summary;

    var links = document.createElement("div");
    links.className = "scroll-preview-actions__links";

    var open = document.createElement("button");
    open.type = "button";
    open.dataset[options.openDataset] = options.src;
    open.dataset.lightboxTitle = options.title || "";
    open.dataset.lightboxFilename = options.filename || "";
    open.className = "scroll-preview-button-primary";
    open.textContent = options.openLabel;

    var download = document.createElement("a");
    download.href = options.src;
    download.download = options.filename || "";
    download.className = "scroll-preview-button-secondary";
    download.textContent = options.downloadLabel;

    links.appendChild(open);
    links.appendChild(download);
    actions.appendChild(summary);
    actions.appendChild(links);
    return actions;
  }

  function pdfFallback(src) {
    return (
      '<div class="scroll-preview-fallback">' +
      "<span>" + t("pdfRenderFailed") + "</span>" +
      '<a class="scroll-preview-button-primary" href="' +
      src +
      '" target="_blank" rel="noopener noreferrer" hx-boost="false">' +
      t("viewFullPdf") +
      "</a>" +
      '<a class="scroll-preview-button-primary" href="' +
      src +
      '" download>' +
      t("downloadPdf") +
      "</a></div>"
    );
  }

  function fileFallback(src, message, downloadLabel) {
    return (
      '<div class="scroll-preview-fallback">' +
      "<span>" +
      message +
      "</span>" +
      '<a class="scroll-preview-button-primary" href="' +
      src +
      '" download>' +
      downloadLabel +
      "</a></div>"
    );
  }

  function initLazyPreviews() {
    var hosts = Array.from(document.querySelectorAll("[data-pdf-src], [data-docx-src]"));

    function renderHost(host) {
      if (host.dataset.previewRendered === "true") return;
      host.dataset.previewRendered = "true";
      if (host.dataset.pdfSrc) {
        renderPdfHost(host);
      } else if (host.dataset.docxSrc) {
        renderDocxHost(host);
      }
    }

    // render all hosts immediately so rail navigation always lands on
    // a fully-sized card rather than a collapsed placeholder
    hosts.forEach(renderHost);
  }

  return {
    initLazyPreviews: initLazyPreviews,
    loadPdf: loadPdf,
  };
};
