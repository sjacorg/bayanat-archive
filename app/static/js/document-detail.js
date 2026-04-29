window.documentDetailViewer = function documentDetailViewer(payload) {
  const LOG_PREFIX = "[document-detail]";
  let rawPdfDoc = null;
  let rawPdfSrc = "";
  let rawPdfRenderToken = 0;
  let rawPdfLoadPromise = null;
  let rawPdfLoadSrc = "";
  let rawDocxBuffer = null;
  let rawDocxRenderToken = 0;

  const pdfModule = {
    reset(viewer) {
      rawPdfRenderToken += 1;
      rawPdfLoadPromise = null;
      rawPdfLoadSrc = "";
      if (rawPdfDoc && typeof rawPdfDoc.destroy === "function") {
        try {
          rawPdfDoc.destroy();
        } catch (error) {
          // Best-effort cleanup only.
        }
      }
      rawPdfDoc = null;
      rawPdfSrc = "";
      viewer.pdfReady = false;
      viewer.pdfTotalPages = 1;
      viewer.pdfStatusText = "";
      viewer.pdfError = false;
    },

    async openPdfDocument(input) {
      const loadingTask = window.pdfjsLib.getDocument(input);
      return loadingTask.promise;
    },

    sleep(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    },

    async loadWithAttempts(viewer, src) {
      const urlAttempts = [
        { label: "url-worker", input: src },
        { label: "url-no-worker", input: { url: src, disableWorker: true } },
      ];

      for (let i = 0; i < urlAttempts.length; i += 1) {
        const attempt = urlAttempts[i];
        try {
          viewer.logDebug("PDF load attempt started.", { attempt: attempt.label, src });
          return await this.openPdfDocument(attempt.input);
        } catch (error) {
          viewer.logError("PDF load attempt failed.", error, { attempt: attempt.label, src });
        }
      }

      try {
        const response = await fetch(src, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF (${response.status})`);
        }
        const data = await response.arrayBuffer();
        const dataAttempts = [
          { label: "data-no-worker", input: { data, disableWorker: true } },
          { label: "data-worker", input: { data } },
        ];
        for (let i = 0; i < dataAttempts.length; i += 1) {
          const attempt = dataAttempts[i];
          try {
            viewer.logDebug("PDF data attempt started.", { attempt: attempt.label, src });
            return await this.openPdfDocument(attempt.input);
          } catch (error) {
            viewer.logError("PDF data attempt failed.", error, { attempt: attempt.label, src });
          }
        }
      } catch (error) {
        viewer.logError("PDF fetch fallback failed.", error, { src });
      }

      return null;
    },

    async resolveContainer(viewer) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await viewer.$nextTick();
        const container = viewer.isMobile ? viewer.$refs.pdfMobileList : viewer.$refs.pdfDesktopList;
        if (!container) {
          await new Promise((resolve) => window.setTimeout(resolve, 16));
          continue;
        }
        const width = container.clientWidth || container.getBoundingClientRect().width || 0;
        if (width > 40) return container;
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      return viewer.isMobile ? viewer.$refs.pdfMobileList : viewer.$refs.pdfDesktopList;
    },

    async load(viewer, src) {
      if (!window.pdfjsLib) {
        viewer.pdfError = true;
        viewer.pdfStatusText = "PDF viewer failed to load.";
        return;
      }

      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      viewer.pdfStatusText = "Loading PDF...";
      if (rawPdfDoc && rawPdfSrc === src) {
        viewer.pdfTotalPages = rawPdfDoc.numPages || 1;
        viewer.pdfError = false;
        viewer.pdfStatusText = `${viewer.pdfTotalPages} page PDF`;
        return;
      }

      if (rawPdfLoadPromise && rawPdfLoadSrc === src) {
        rawPdfDoc = await rawPdfLoadPromise;
      } else {
        rawPdfLoadSrc = src;
        rawPdfLoadPromise = this.loadWithAttempts(viewer, src);
        try {
          rawPdfDoc = await rawPdfLoadPromise;
        } finally {
          if (rawPdfLoadPromise) {
            rawPdfLoadPromise = null;
            rawPdfLoadSrc = "";
          }
        }
      }
      if (rawPdfDoc) {
        rawPdfSrc = src;
        viewer.pdfTotalPages = rawPdfDoc.numPages || 1;
        viewer.pdfError = false;
        viewer.pdfStatusText = `${viewer.pdfTotalPages} page PDF`;
        return;
      }

      rawPdfDoc = null;
      rawPdfSrc = "";
      viewer.pdfError = true;
      viewer.pdfReady = false;
      viewer.pdfStatusText = "Unable to render PDF.";
    },

    async render(viewer) {
      if (!rawPdfDoc) return;
      const token = ++rawPdfRenderToken;
      const pdfDoc = rawPdfDoc;
      viewer.pdfReady = false;
      const container = await this.resolveContainer(viewer);
      if (!container) {
        if (token === rawPdfRenderToken && pdfDoc === rawPdfDoc) {
          viewer.logError("PDF render skipped: container ref unavailable.", null, {
            isMobile: viewer.isMobile,
          });
          viewer.pdfError = true;
          viewer.pdfStatusText = "Unable to render PDF.";
        }
        return;
      }

      try {
        let renderedPages = 0;
        if (viewer.isMobile) {
          renderedPages = await this.renderPages(viewer, pdfDoc, token, container, {
            className: "doc-mobile-pdf-canvas",
            gutter: 8,
            minWidth: 220,
            preferredScale: 1.1,
            minScale: 0.35,
          });
        } else {
          renderedPages = await this.renderPages(viewer, pdfDoc, token, container, {
            className: "doc-pdf-canvas",
            gutter: 12,
            minWidth: 280,
            preferredScale: 1.35,
            minScale: 0,
          });
        }

        if (token === rawPdfRenderToken && pdfDoc === rawPdfDoc) {
          if (renderedPages > 0) {
            viewer.pdfReady = true;
            viewer.rememberRenderedWidth("pdf", container);
          } else {
            viewer.logDebug("PDF render produced zero pages; retrying once.", {
              pageCount: viewer.pdfTotalPages,
              zoom: viewer.zoom,
              isMobile: viewer.isMobile,
            });
            await this.sleep(120);
            if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
            const retryContainer = await this.resolveContainer(viewer);
            const retryRenderedPages = await this.renderPages(viewer, pdfDoc, token, retryContainer, viewer.isMobile
              ? {
                className: "doc-mobile-pdf-canvas",
                gutter: 8,
                minWidth: 220,
                preferredScale: 1.1,
                minScale: 0.35,
              }
              : {
                className: "doc-pdf-canvas",
                gutter: 12,
                minWidth: 280,
                preferredScale: 1.35,
                minScale: 0,
              });
            if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
            if (retryRenderedPages > 0) {
              viewer.pdfReady = true;
              viewer.rememberRenderedWidth("pdf", retryContainer || container);
              return;
            }
            viewer.pdfError = true;
            viewer.pdfReady = false;
            viewer.pdfStatusText = "Unable to render PDF.";
          }
        }
      } catch (error) {
        if (token === rawPdfRenderToken && pdfDoc === rawPdfDoc) {
          viewer.logError("PDF render failed.", error, {
            pageCount: viewer.pdfTotalPages,
            zoom: viewer.zoom,
            isMobile: viewer.isMobile,
          });
          viewer.pdfError = true;
          viewer.pdfReady = false;
          viewer.pdfStatusText = "Unable to render PDF.";
        }
      }
    },

    async renderPages(viewer, pdfDoc, token, container, opts) {
      if (!container || !pdfDoc) return 0;

      container.innerHTML = "";
      let renderedPages = 0;
      for (let pageNumber = 1; pageNumber <= viewer.pdfTotalPages; pageNumber += 1) {
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return renderedPages;

        const page = await pdfDoc.getPage(pageNumber);
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return renderedPages;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max((container.clientWidth || 0) - opts.gutter, opts.minWidth);
        const fitScale = availableWidth / Math.max(baseViewport.width, 1);
        const scaled = Math.min(opts.preferredScale, fitScale);
        const cssScale = Math.max(opts.minScale || 0, scaled);

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = document.createElement("canvas");
        canvas.className = opts.className;
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = "auto";

        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
          throw new Error("Unable to initialize PDF canvas context.");
        }
        await page.render({ canvasContext: context, viewport: renderViewport }).promise;

        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return renderedPages;
        container.appendChild(canvas);
        renderedPages += 1;
      }
      return renderedPages;
    },
  };

  const docxModule = {
    normalizeInlineMedia(container) {
      if (!container) return;
      const fixedInlineBlocks = container.querySelectorAll(
        "div[style*='display: inline-block'][style*='width'][style*='pt']",
      );
      fixedInlineBlocks.forEach((node) => {
        // DOCX often injects fixed pt wrappers around images that overflow on mobile.
        node.style.maxWidth = "100%";
        node.style.width = "100%";
        node.style.height = "auto";
        node.style.left = "auto";
        node.style.right = "auto";
      });

      const media = container.querySelectorAll("img[style], svg[style], canvas[style], video[style]");
      media.forEach((node) => {
        node.style.maxWidth = "100%";
        node.style.height = "auto";
        node.style.left = "auto";
        node.style.right = "auto";
        // Neutralize fixed DOCX pt widths that overflow on responsive layouts.
        if (node.tagName === "IMG" || node.tagName === "VIDEO") {
          node.style.width = "auto";
        }
      });
    },

    reset(viewer) {
      rawDocxRenderToken += 1;
      rawDocxBuffer = null;
      viewer.docxReady = false;
      viewer.docxError = false;
    },

    getRenderer() {
      if (window.docx && typeof window.docx.renderAsync === "function") {
        return window.docx.renderAsync;
      }
      if (window.docxPreview && typeof window.docxPreview.renderAsync === "function") {
        return window.docxPreview.renderAsync;
      }
      if (typeof window.renderAsync === "function") {
        return window.renderAsync;
      }
      return null;
    },

    async resolveContainer(viewer) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await viewer.$nextTick();
        const container = viewer.isMobile ? viewer.$refs.docxMobileList : viewer.$refs.docxDesktopList;
        if (!container) {
          await new Promise((resolve) => window.setTimeout(resolve, 16));
          continue;
        }
        return container;
      }
      return viewer.isMobile ? viewer.$refs.docxMobileList : viewer.$refs.docxDesktopList;
    },

    async load(viewer, src) {
      const docxRenderer = this.getRenderer();
      if (!docxRenderer) {
        viewer.docxError = true;
        return;
      }

      try {
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error(`Failed to load DOCX (${response.status})`);
        }

        rawDocxBuffer = await response.arrayBuffer();
        const header = new Uint8Array(rawDocxBuffer.slice(0, 4));
        const isZip =
          header.length === 4 &&
          header[0] === 0x50 &&
          header[1] === 0x4b &&
          (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07) &&
          (header[3] === 0x04 || header[3] === 0x06 || header[3] === 0x08);

        if (!isZip) {
          throw new Error("Loaded file is not a valid DOCX package.");
        }

        viewer.docxError = false;
      } catch (error) {
        viewer.logError("DOCX load failed.", error, { src });
        rawDocxBuffer = null;
        viewer.docxError = true;
        viewer.docxReady = false;
      }
    },

    async render(viewer) {
      if (!rawDocxBuffer || viewer.docxError) return;

      const docxRenderer = this.getRenderer();
      if (!docxRenderer) {
        viewer.docxError = true;
        viewer.docxReady = false;
        return;
      }

      const token = ++rawDocxRenderToken;
      const container = await this.resolveContainer(viewer);
      if (!container) {
        if (token === rawDocxRenderToken) {
          viewer.logError("DOCX render skipped: container ref unavailable.", null, {
            isMobile: viewer.isMobile,
          });
          viewer.docxError = true;
          viewer.docxReady = false;
        }
        return;
      }

      container.innerHTML = "";
      viewer.docxReady = false;
      try {
        await docxRenderer(rawDocxBuffer, container, container, {
          className: "docx-preview",
          inWrapper: false,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        });
        if (token !== rawDocxRenderToken) return;
        viewer.docxReady = true;
        await viewer.$nextTick();
        this.normalizeInlineMedia(container);
        viewer.syncDocxBaseWidth(container);
        viewer.rememberRenderedWidth("docx", container);
      } catch (error) {
        viewer.logError("DOCX render failed (arrayBuffer), trying blob fallback.", error);
        try {
          const blob = new Blob(
            [rawDocxBuffer],
            { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          );
          await docxRenderer(blob, container, container, {
            className: "docx-preview",
            inWrapper: false,
            breakPages: true,
            ignoreWidth: false,
            ignoreHeight: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            useBase64URL: true,
          });
          if (token !== rawDocxRenderToken) return;
          viewer.docxReady = true;
          await viewer.$nextTick();
          this.normalizeInlineMedia(container);
          viewer.syncDocxBaseWidth(container);
          viewer.rememberRenderedWidth("docx", container);
        } catch (fallbackError) {
          if (token !== rawDocxRenderToken) return;
          viewer.logError("DOCX render failed (blob fallback).", fallbackError);
          viewer.docxError = true;
          viewer.docxReady = false;
        }
      }
    },
  };

  return {
    media: payload.media || [],
    title: payload.title || "Document",
    docId: payload.id,
    documentOcrText: payload.documentOcrText || "",
    documentTranslation: payload.documentTranslation || "",
    pageIndex: 0,
    zoom: 1,
    tapZoomLevel: 1.5,
    minZoom: 0.75,
    maxZoom: 5,
    zoomStep: 0.25,
    pinchZoomStep: 0.01,
    pinchSensitivity: 0.35,
    activePanel: null,
    showDocumentDetails: false,
    relatedOpen: false,
    pinchStartDistance: null,
    pinchStartZoom: 1,
    isMobile: window.matchMedia("(max-width: 767px)").matches,
    pdfTotalPages: 1,
    pdfStatusText: "",
    pdfError: false,
    pdfReady: false,
    docxError: false,
    docxReady: false,
    mediaErrors: {},
    mediaReady: {},
    isMediaLoading: false,
    mediaLoadingKind: "",
    mediaLoadToken: 0,
    requestedDisplayPage: null,
    isAnimating: false,
    carouselPhase: null,
    carouselDirection: 1,
    keydownHandler: null,
    resizeHandler: null,
    pagehideHandler: null,
    resizeDebounceTimer: null,
    pendingScrollRestore: null,
    scrollRestoreRafId: null,
    pdfZoomRafId: null,
    initPromise: null,
    hasInitialized: false,
    renderWidths: {
      pdf: { desktop: 0, mobile: 0 },
      docx: { desktop: 0, mobile: 0 },
    },
    nativeCssZoomSupported:
      typeof window.CSS !== "undefined" &&
      typeof window.CSS.supports === "function" &&
      window.CSS.supports("zoom", "2"),
    logPrefix: LOG_PREFIX,

    async init() {
      if (this.hasInitialized) return;
      if (this.initPromise) {
        await this.initPromise;
        return;
      }
      this.initPromise = (async () => {
      this.updateViewportMode();
      this.syncLayoutMetrics();

      this.keydownHandler = this.onKeydown.bind(this);
      this.resizeHandler = this.onResize.bind(this);
      this.pagehideHandler = this.destroy.bind(this);

      window.addEventListener("keydown", this.keydownHandler);
      window.addEventListener("resize", this.resizeHandler);
      window.addEventListener("pagehide", this.pagehideHandler);

      const url = new URL(window.location.href);
      const requestedPage = Number(url.searchParams.get("page") || 1);
      if (Number.isFinite(requestedPage) && requestedPage > 0) {
        this.requestedDisplayPage = requestedPage;
      }
      if (Number.isFinite(requestedPage) && requestedPage > 0 && requestedPage <= this.pageCount) {
        this.pageIndex = requestedPage - 1;
      }

      this.$watch("pageIndex", () => {
        this.persistPageInUrl();
      });

      await this.loadCurrentMedia();
      this.hasInitialized = true;
      })();
      try {
        await this.initPromise;
      } finally {
        this.initPromise = null;
      }
    },

    destroy() {
      if (this.keydownHandler) {
        window.removeEventListener("keydown", this.keydownHandler);
        this.keydownHandler = null;
      }
      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
        this.resizeHandler = null;
      }
      if (this.pagehideHandler) {
        window.removeEventListener("pagehide", this.pagehideHandler);
        this.pagehideHandler = null;
      }
      if (this.resizeDebounceTimer) {
        window.clearTimeout(this.resizeDebounceTimer);
        this.resizeDebounceTimer = null;
      }
      if (this.scrollRestoreRafId !== null) {
        window.cancelAnimationFrame(this.scrollRestoreRafId);
        this.scrollRestoreRafId = null;
      }
      if (this.pdfZoomRafId !== null) {
        window.cancelAnimationFrame(this.pdfZoomRafId);
        this.pdfZoomRafId = null;
      }
    },

    get pageCount() {
      return this.media.length;
    },

    get currentMedia() {
      return this.media[this.pageIndex] || null;
    },

    get displayPage() {
      if (!this.currentMedia) return 0;
      return this.pageIndex + 1;
    },

    get displayTotal() {
      return this.pageCount;
    },

    get hasPrev() {
      return this.pageIndex > 0;
    },

    get hasNext() {
      return this.pageIndex < this.pageCount - 1;
    },

    get hasPrevMedia() {
      return this.hasPrev;
    },

    get hasNextMedia() {
      return this.hasNext;
    },

    get panelTitle() {
      if (this.activePanel === "info") return "Info";
      if (this.activePanel === "arabic") return "Arabic Text";
      if (this.activePanel === "translation") return "English Translation";
      return "";
    },

    get currentArabicText() {
      const mediaOriginal = (this.currentMedia?.original_text || "").trim();
      const mediaOcr = (this.currentMedia?.ocr_text || "").trim();
      const docOcr = (this.documentOcrText || "").trim();
      return mediaOriginal || mediaOcr || docOcr;
    },

    get arabicTextDir() {
      const text = this.currentArabicText;
      if (!text) return "rtl";
      return /[\u0600-\u06FF]/.test(text) ? "rtl" : "auto";
    },

    get currentTranslationText() {
      const mediaOcr = (this.currentMedia?.ocr_text || "").trim();
      const docTranslation = (this.documentTranslation || "").trim();
      const docOcr = (this.documentOcrText || "").trim();
      return mediaOcr || docTranslation || docOcr;
    },

    get carouselClass() {
      if (this.carouselPhase === "out") return "is-sliding-out";
      if (this.carouselPhase === "in") return "is-sliding-in";
      return "";
    },

    get canvasCursorClass() {
      if (!this.isZoomableMedia()) return "cursor-default";
      return this.zoom >= (this.tapZoomLevel - 0.01) ? "cursor-zoom-out" : "cursor-zoom-in";
    },

    get canZoomIn() {
      if (!this.isZoomableMedia()) return false;
      return this.zoom < this.currentMaxZoom - 0.001;
    },

    get canZoomOut() {
      if (!this.isZoomableMedia()) return false;
      return this.zoom > this.currentMinZoom + 0.001;
    },

    get currentMinZoom() {
      if (this.isImageMedia()) return 1;
      if (this.isPdfMedia() || this.isDocxMedia()) return 1;
      return 1;
    },

    get currentMaxZoom() {
      if (this.isImageMedia()) return this.maxZoom;
      if (this.isPdfMedia() || this.isDocxMedia()) return this.maxZoom;
      return 1;
    },

    isPdfMedia(item = this.currentMedia) {
      return item?.media_kind === "pdf";
    },

    isImageMedia(item = this.currentMedia) {
      return item?.media_kind === "image";
    },

    isDocxMedia(item = this.currentMedia) {
      return item?.media_kind === "docx";
    },

    isZoomableMedia(item = this.currentMedia) {
      return this.isImageMedia(item) || this.isPdfMedia(item) || this.isDocxMedia(item);
    },

    shouldIgnoreZoomInteraction(target) {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(
        target.closest(
          "a, button, input, textarea, select, label, summary, iframe, video, audio, [contenteditable='true'], [data-no-zoom]",
        ),
      );
    },

    clearMediaErrors() {
      this.mediaErrors = {};
    },

    clearMediaReady() {
      this.mediaReady = {};
    },

    setMediaReady(kind) {
      if (!kind) return;
      this.mediaReady = { ...this.mediaReady, [kind]: true };
      if (this.currentMedia?.media_kind === kind) {
        this.isMediaLoading = false;
      }
    },

    setMediaError(kind) {
      if (!kind) return;
      this.logError("Media element signaled an error event.", null, {
        kind,
        mediaId: this.currentMedia?.media_id || null,
        filename: this.currentMedia?.filename || null,
        src: this.currentMedia?.src || null,
      });
      this.mediaErrors = { ...this.mediaErrors, [kind]: true };
      this.mediaReady = { ...this.mediaReady, [kind]: false };
      if (this.currentMedia?.media_kind === kind) {
        this.isMediaLoading = false;
      }
    },

    logDebug(message, meta = null) {
      if (meta) {
        console.debug(this.logPrefix, message, meta);
        return;
      }
      console.debug(this.logPrefix, message);
    },

    logError(message, error = null, meta = null) {
      if (meta) {
        console.error(this.logPrefix, message, meta);
      } else {
        console.error(this.logPrefix, message);
      }
      if (error) {
        console.error(error);
      }
    },

    isKindLoading(kind) {
      return this.isMediaLoading && this.mediaLoadingKind === kind;
    },

    hasKindError(kind) {
      if (kind === "pdf") return this.pdfError;
      if (kind === "docx") return this.docxError;
      return Boolean(this.mediaErrors[kind]);
    },

    isKindReady(kind) {
      if (!this.currentMedia || this.currentMedia.media_kind !== kind) return false;
      if (kind === "pdf") return this.pdfReady && !this.pdfError;
      if (kind === "docx") return this.docxReady && !this.docxError;
      if (kind === "other") return !this.isKindLoading(kind);
      return !this.hasKindError(kind);
    },

    onResize() {
      if (this.resizeDebounceTimer) {
        window.clearTimeout(this.resizeDebounceTimer);
      }
      this.resizeDebounceTimer = window.setTimeout(() => {
        const wasMobile = this.isMobile;
        this.updateViewportMode();
        this.syncLayoutMetrics();
        if (this.isImageMedia() && !this.hasKindError("image")) {
          this.applyImageZoom();
        } else if (this.isPdfMedia() && !this.pdfError) {
          if (this.shouldRerenderOnResize("pdf", wasMobile)) {
            pdfModule.render(this).then(() => {
              this.applyPdfZoom();
            });
          } else {
            this.applyPdfZoom();
          }
        } else if (this.isDocxMedia() && !this.docxError) {
          if (this.shouldRerenderOnResize("docx", wasMobile)) {
            docxModule.render(this).then(() => {
              this.applyDocxZoom();
            });
          } else {
            this.applyDocxZoom();
          }
        }
      }, 120);
    },

    updateViewportMode() {
      this.isMobile = window.matchMedia("(max-width: 767px)").matches;
    },

    syncLayoutMetrics() {
      const header = this.$refs.topHeader;
      if (!header) return;
      const headerHeight = Math.round(header.getBoundingClientRect().height);
      const root = this.$root;
      if (!root || !Number.isFinite(headerHeight) || headerHeight <= 0) return;
      root.style.setProperty("--doc-header-height", `${headerHeight}px`);
    },

    getViewportSlot(isMobile = this.isMobile) {
      return isMobile ? "mobile" : "desktop";
    },

    getMediaContainer(kind, isMobile = this.isMobile) {
      if (kind === "pdf") {
        return isMobile ? this.$refs.pdfMobileList : this.$refs.pdfDesktopList;
      }
      if (kind === "docx") {
        return isMobile ? this.$refs.docxMobileList : this.$refs.docxDesktopList;
      }
      if (kind === "image") {
        return isMobile ? this.$refs.imageMobileList : this.$refs.imageDesktopList;
      }
      return null;
    },

    measureContainerWidth(kind, isMobile = this.isMobile) {
      const container = this.getMediaContainer(kind, isMobile);
      if (!container) return 0;
      const rectWidth = container.getBoundingClientRect?.().width || 0;
      const width = Math.round(Math.max(container.clientWidth || 0, rectWidth));
      return width > 0 ? width : 0;
    },

    getStoredRenderWidth(kind, isMobile = this.isMobile) {
      const slot = this.getViewportSlot(isMobile);
      return this.renderWidths?.[kind]?.[slot] || 0;
    },

    rememberRenderedWidth(kind, container = null, isMobile = this.isMobile) {
      if (!this.renderWidths[kind]) {
        this.renderWidths[kind] = { desktop: 0, mobile: 0 };
      }
      const targetContainer = container || this.getMediaContainer(kind, isMobile);
      if (!targetContainer) return;
      const rectWidth = targetContainer.getBoundingClientRect?.().width || 0;
      const width = Math.round(Math.max(targetContainer.clientWidth || 0, rectWidth));
      if (!Number.isFinite(width) || width <= 0) return;
      const slot = this.getViewportSlot(isMobile);
      this.renderWidths[kind][slot] = width;
    },

    shouldRerenderOnResize(kind, wasMobile) {
      if (wasMobile !== this.isMobile) return true;
      const currentWidth = this.measureContainerWidth(kind, this.isMobile);
      if (currentWidth <= 0) return false;
      const storedWidth = this.getStoredRenderWidth(kind, this.isMobile);
      if (storedWidth <= 0) return true;
      return Math.abs(currentWidth - storedWidth) >= 24;
    },

    syncDocxBaseWidth(container = null) {
      const target = container || this.getDocxContainer();
      if (!target) return;
      const root = this.$root;
      if (!root) return;
      const page = target.querySelector(".docx-wrapper .docx, .docx");
      if (!page) return;
      const pageRectWidth = page.getBoundingClientRect?.().width || 0;
      const width = Math.round(Math.max(pageRectWidth, page.offsetWidth || 0));
      if (!Number.isFinite(width) || width < 220) return;
      root.style.setProperty("--doc-docx-page-max-width", `${width}px`);
    },

    async loadCurrentMedia() {
      const token = ++this.mediaLoadToken;
      this.isMediaLoading = true;
      this.mediaLoadingKind = this.currentMedia?.media_kind || "";
      this.clearMediaErrors();
      this.clearMediaReady();

      pdfModule.reset(this);
      docxModule.reset(this);

      try {
        if (!this.currentMedia) return;

        if (this.isPdfMedia()) {
          await pdfModule.load(this, this.currentMedia.src);
          if (token !== this.mediaLoadToken) return;
          await pdfModule.render(this);
          return;
        }

        if (this.isDocxMedia()) {
          await docxModule.load(this, this.currentMedia.src);
          if (token !== this.mediaLoadToken) return;
          await docxModule.render(this);
          return;
        }

        if (this.currentMedia?.media_kind === "other") {
          this.setMediaReady("other");
          return;
        }

        // Give Alpine a tick so non-async media can show the normalized states cleanly.
        await this.$nextTick();
      } finally {
        if (token === this.mediaLoadToken) {
          this.isMediaLoading = false;
        }
        await this.$nextTick();
        this.applyAllZoom();
      }
    },

    async prevPage() {
      await this.prevMedia();
    },

    async nextPage() {
      await this.nextMedia();
    },

    async prevMedia() {
      if (!this.pageCount) return;
      if (!this.hasPrevMedia || this.isAnimating) return;
      await this.runCarouselTransition("prev", async () => {
        this.pageIndex -= 1;
        this.resetZoomState();
        await this.loadCurrentMedia();
        this.persistPageInUrl();
      });
    },

    async nextMedia() {
      if (!this.pageCount) return;
      if (!this.hasNextMedia || this.isAnimating) return;
      await this.runCarouselTransition("next", async () => {
        this.pageIndex += 1;
        this.resetZoomState();
        await this.loadCurrentMedia();
        this.persistPageInUrl();
      });
    },

    async runCarouselTransition(direction, applyChange) {
      this.isAnimating = true;
      this.carouselDirection = direction === "next" ? 1 : -1;
      try {
        this.carouselPhase = "out";
        await this.sleep(120);
        await applyChange();
        await this.$nextTick();
        this.carouselPhase = "in";
        await this.sleep(180);
      } catch (error) {
        console.error("Carousel transition failed", error);
      } finally {
        this.carouselPhase = null;
        this.isAnimating = false;
      }
    },

    sleep(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    },

    persistPageInUrl() {
      const url = new URL(window.location.href);
      const nextPage = this.pageIndex + 1;
      url.searchParams.set("page", String(nextPage > 0 ? nextPage : 1));
      window.history.replaceState({}, "", url);
    },

    resetZoomState() {
      this.zoom = 1;
      this.pinchStartDistance = null;
      this.pinchStartZoom = this.zoom;
      this.pendingScrollRestore = null;
      if (this.scrollRestoreRafId !== null) {
        window.cancelAnimationFrame(this.scrollRestoreRafId);
        this.scrollRestoreRafId = null;
      }
      this.applyAllZoom();
    },

    getImageContainer() {
      return this.isMobile ? this.$refs.imageMobileList : this.$refs.imageDesktopList;
    },

    applyZoomToContainer(container, isActive, options = {}) {
      const transformOrigin = options.transformOrigin || "top left";
      if (!container) return;
      if (!isActive) {
        container.classList.remove("is-zoomed");
        container.style.zoom = "";
        container.style.transform = "";
        container.style.transformOrigin = "";
        container.style.width = "";
        return;
      }
      container.classList.toggle("is-zoomed", this.zoom > 1.001);
      if (this.nativeCssZoomSupported) {
        container.style.zoom = String(this.zoom);
        container.style.transform = "";
        container.style.transformOrigin = transformOrigin;
        container.style.width = "";
      } else {
        container.style.zoom = "";
        container.style.transform = `scale(${this.zoom})`;
        container.style.transformOrigin = transformOrigin;
        container.style.width = `${(100 / this.zoom).toFixed(4)}%`;
      }
    },

    applyImageZoom() {
      const container = this.getImageContainer();
      if (!container) return;
      const image = container.querySelector("img");

      if (!this.isImageMedia() || !image) {
        if (image) {
          image.style.width = "";
          image.style.maxWidth = "";
          image.style.height = "";
          image.style.maxHeight = "";
          delete image.dataset.baseRenderWidth;
        }
        this.applyZoomToContainer(container, false);
        return;
      }

      // Keep 100% as the baseline rendered size, then zoom from that baseline.
      if (this.zoom <= 1.001) {
        image.style.width = "";
        image.style.maxWidth = "";
        image.style.height = "";
        image.style.maxHeight = "";
        this.applyZoomToContainer(container, true);
        const measuredWidth = image.getBoundingClientRect().width;
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
          image.dataset.baseRenderWidth = String(measuredWidth);
        } else {
          delete image.dataset.baseRenderWidth;
        }
        return;
      }

      let baseWidth = Number(image.dataset.baseRenderWidth || 0);
      if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
        const measuredWidth = image.getBoundingClientRect().width;
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
          const divisor = Math.max(this.zoom, 1);
          baseWidth = measuredWidth / divisor;
          if (Number.isFinite(baseWidth) && baseWidth > 0) {
            image.dataset.baseRenderWidth = String(baseWidth);
          }
        }
      }

      if (Number.isFinite(baseWidth) && baseWidth > 0) {
        image.style.width = `${baseWidth}px`;
        image.style.maxWidth = "none";
        image.style.height = "auto";
        image.style.maxHeight = "none";
      }

      this.applyZoomToContainer(container, true);
    },

    getPdfContainer() {
      return this.isMobile ? this.$refs.pdfMobileList : this.$refs.pdfDesktopList;
    },

    applyPdfZoom() {
      if (this.pdfZoomRafId !== null) {
        window.cancelAnimationFrame(this.pdfZoomRafId);
      }
      this.pdfZoomRafId = window.requestAnimationFrame(() => {
        this.pdfZoomRafId = null;
        this.applyPdfZoomNow();
      });
    },

    applyPdfZoomNow() {
      const container = this.getPdfContainer();
      if (!container) return;

      if (!this.isPdfMedia()) {
        container.style.width = "";
        container.style.maxWidth = "";
        container.querySelectorAll("canvas").forEach((canvas) => {
          canvas.style.width = "";
          delete canvas.dataset.baseRenderWidth;
        });
        this.applyZoomToContainer(container, false);
        return;
      }

      // For PDF use layout-based canvas sizing instead of transform-based scaling.
      // This preserves real scroll bounds on Firefox and avoids left-edge clipping at high zoom.
      this.applyZoomToContainer(container, false);
      container.classList.toggle("is-zoomed", this.zoom > 1.001);

      const canvases = container.querySelectorAll("canvas");
      canvases.forEach((canvas) => {
        let baseWidth = Number(canvas.dataset.baseRenderWidth || 0);
        if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
          const styleWidth = Number.parseFloat(canvas.style.width || "");
          const measuredWidth = styleWidth || canvas.getBoundingClientRect().width || 0;
          if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
            baseWidth = measuredWidth;
            canvas.dataset.baseRenderWidth = String(baseWidth);
          }
        }
        if (!Number.isFinite(baseWidth) || baseWidth <= 0) return;
        canvas.style.width = `${baseWidth * this.zoom}px`;
        canvas.style.height = "auto";
        canvas.style.maxWidth = "none";
      });
    },

    getScrollPane() {
      return this.isMobile ? this.$refs.mobileScrollPane : this.$refs.desktopScrollPane;
    },

    captureScrollForZoom(currentZoom, nextZoom, anchor = null) {
      if (nextZoom <= 0 || currentZoom <= 0) {
        this.pendingScrollRestore = null;
        return;
      }
      const pane = this.getScrollPane();
      if (!pane) {
        this.pendingScrollRestore = null;
        return;
      }
      const rect = pane.getBoundingClientRect();
      const localX = anchor ? anchor.clientX - rect.left : (pane.clientWidth / 2);
      const localY = anchor ? anchor.clientY - rect.top : (pane.clientHeight / 2);
      const worldX = pane.scrollLeft + localX;
      const worldY = pane.scrollTop + localY;
      const ratio = nextZoom / currentZoom;
      this.pendingScrollRestore = {
        left: (worldX * ratio) - localX,
        top: (worldY * ratio) - localY,
      };
    },

    restoreScrollAfterZoom() {
      if (!this.pendingScrollRestore) return;
      if (this.scrollRestoreRafId !== null) {
        window.cancelAnimationFrame(this.scrollRestoreRafId);
        this.scrollRestoreRafId = null;
      }
      const restore = this.pendingScrollRestore;
      this.pendingScrollRestore = null;
      this.scrollRestoreRafId = window.requestAnimationFrame(() => {
        this.scrollRestoreRafId = null;
        const pane = this.getScrollPane();
        if (!pane) return;
        const maxLeft = Math.max((pane.scrollWidth || 0) - pane.clientWidth, 0);
        const maxTop = Math.max((pane.scrollHeight || 0) - pane.clientHeight, 0);
        pane.scrollLeft = Math.max(0, Math.min(maxLeft, restore.left));
        pane.scrollTop = Math.max(0, Math.min(maxTop, restore.top));
      });
    },

    getDocxContainer() {
      return this.isMobile ? this.$refs.docxMobileList : this.$refs.docxDesktopList;
    },

    applyDocxZoom() {
      const container = this.getDocxContainer();
      if (!container) return;

      const preview = container.querySelector(".docx-preview");
      const wrapper = container.querySelector(".docx-wrapper");
      const zoomTarget = wrapper || preview || container;
      if (!this.isDocxMedia()) {
        this.applyZoomToContainer(container, false);
        if (preview && preview !== container) {
          this.applyZoomToContainer(preview, false);
        }
        if (zoomTarget && zoomTarget !== preview && zoomTarget !== container) {
          this.applyZoomToContainer(zoomTarget, false);
          zoomTarget.style.width = "";
          zoomTarget.style.maxWidth = "";
        }
        return;
      }

      // Keep container/preview neutral and scale only the DOCX wrapper surface to preserve page proportions.
      container.classList.remove("is-zoomed");
      container.style.zoom = "";
      container.style.transform = "";
      container.style.transformOrigin = "";
      container.style.width = "";
      if (preview && preview !== container) {
        preview.classList.remove("is-zoomed");
        preview.style.zoom = "";
        preview.style.transform = "";
        preview.style.transformOrigin = "";
        preview.style.width = "";
      }

      if (zoomTarget) {
        let baseWidth = Number(zoomTarget.dataset.baseRenderWidth || 0);
        if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
          // Freeze DOCX at its initially rendered size, then zoom from that baseline.
          const measuredWidth = zoomTarget.getBoundingClientRect().width;
          if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
            baseWidth = measuredWidth / Math.max(this.zoom, 1);
            zoomTarget.dataset.baseRenderWidth = String(baseWidth);
          }
        }

        this.applyZoomToContainer(zoomTarget, true);

        if (Number.isFinite(baseWidth) && baseWidth > 0) {
          zoomTarget.style.width = `${baseWidth}px`;
          zoomTarget.style.maxWidth = "none";
        } else {
          zoomTarget.style.width = "";
          zoomTarget.style.maxWidth = "";
        }
        return;
      }

      this.applyZoomToContainer(zoomTarget, true);
    },

    applyAllZoom() {
      this.applyImageZoom();
      this.applyPdfZoom();
      this.applyDocxZoom();
    },

    setZoom(nextZoom, options = {}) {
      if (!this.isZoomableMedia()) return;
      const current = this.zoom;
      const minAllowed = this.currentMinZoom;
      const maxAllowed = this.currentMaxZoom;
      const clamped = Math.max(minAllowed, Math.min(maxAllowed, nextZoom));
      if (Math.abs(clamped - current) < 0.001) return;

      const anchor = options.anchor || null;
      if (this.isImageMedia() || this.isPdfMedia() || this.isDocxMedia()) {
        this.captureScrollForZoom(current, clamped, anchor);
      } else {
        this.pendingScrollRestore = null;
      }

      this.zoom = clamped;

      if (this.isImageMedia()) {
        this.applyImageZoom();
        this.restoreScrollAfterZoom();
      } else if (this.isPdfMedia()) {
        this.applyPdfZoom();
        this.restoreScrollAfterZoom();
      } else if (this.isDocxMedia()) {
        this.applyDocxZoom();
        this.restoreScrollAfterZoom();
      }
    },

    snapZoomToStep(value, step) {
      if (!Number.isFinite(value)) return this.zoom;
      if (!Number.isFinite(step) || step <= 0) return value;
      return Math.round(value / step) * step;
    },

    zoomIn() {
      if (!this.isZoomableMedia()) return;
      this.setZoom(this.zoom + this.zoomStep);
    },

    zoomOut() {
      if (!this.isZoomableMedia()) return;
      this.setZoom(this.zoom - this.zoomStep);
    },

    toggleZoom(event = null) {
      if (!this.isZoomableMedia()) return;
      const nextZoom = this.zoom > 1.01 ? 1 : 2;
      this.setZoom(nextZoom, event ? { anchor: event } : {});
    },

    onCanvasClick(event) {
      if (!this.isZoomableMedia()) return;
      if (this.shouldIgnoreZoomInteraction(event.target)) return;
      const targetZoom = this.zoom >= (this.tapZoomLevel - 0.01) ? 1 : this.tapZoomLevel;
      this.setZoom(targetZoom, { anchor: event });
    },

    togglePanel(panelName) {
      if (this.activePanel === panelName) {
        this.activePanel = null;
        this.showDocumentDetails = false;
        return;
      }
      this.activePanel = panelName;
      this.showDocumentDetails = false;
    },

    closePanel() {
      this.activePanel = null;
      this.showDocumentDetails = false;
    },

    handleDownload() {
      const item = this.currentMedia;
      if (item && item.src) {
        const anchor = document.createElement("a");
        anchor.href = item.src;
        anchor.download = item.filename || "document-file";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      }
    },

    onCanvasWheel(event) {
      if (!this.isZoomableMedia()) return;
      if (this.shouldIgnoreZoomInteraction(event.target)) return;
      if (event.metaKey) {
        // Keep cmd+wheel disabled.
        return;
      }
      if (event.ctrlKey) {
        // Trackpad pinch on desktop commonly emits ctrl+wheel.
        event.preventDefault();
        const factor = Math.exp((-event.deltaY || 0) * 0.0015);
        this.setZoom(this.zoom * factor, { anchor: event });
        return;
      }

      const pane = this.getScrollPane();
      if (!pane) return;

      const viewportHeight = pane.clientHeight || window.innerHeight || 900;
      const deltaMultiplier =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewportHeight
            : 1;
      const rawDx = (event.deltaX || 0) * deltaMultiplier;
      const rawDy = (event.deltaY || 0) * deltaMultiplier;
      const dx = event.shiftKey && Math.abs(rawDx) < 0.001 ? rawDy : rawDx;
      const dy = event.shiftKey && Math.abs(rawDx) < 0.001 ? 0 : rawDy;

      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

      const canScrollX = pane.scrollWidth > pane.clientWidth + 1;
      const canScrollY = pane.scrollHeight > pane.clientHeight + 1;
      if (!canScrollX && !canScrollY) return;

      // Keep gestures inside the viewer so horizontal swipes do not trigger browser history navigation.
      event.preventDefault();
      if (canScrollX && Math.abs(dx) > 0.001) {
        pane.scrollLeft += dx;
      }
      if (canScrollY && Math.abs(dy) > 0.001) {
        pane.scrollTop += dy;
      }
    },

    onTouchStart(event) {
      if (!this.isZoomableMedia()) return;
      if (this.shouldIgnoreZoomInteraction(event.target)) return;
      if (event.touches.length === 2) {
        this.pinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
        this.pinchStartZoom = this.zoom;
      }
    },

    onTouchMove(event) {
      if (!this.isZoomableMedia()) return;
      if (event.touches.length === 2 && this.pinchStartDistance) {
        event.preventDefault();
        const currentDistance = this.touchDistance(event.touches[0], event.touches[1]);
        const scale = currentDistance / this.pinchStartDistance;
        const smoothedScale = 1 + ((scale - 1) * this.pinchSensitivity);
        const nextZoomRaw = this.pinchStartZoom * smoothedScale;
        const nextZoom = this.snapZoomToStep(nextZoomRaw, this.pinchZoomStep);
        const firstTouch = event.touches[0];
        const secondTouch = event.touches[1];
        const anchor = {
          clientX: (firstTouch.clientX + secondTouch.clientX) / 2,
          clientY: (firstTouch.clientY + secondTouch.clientY) / 2,
        };
        this.setZoom(nextZoom, { anchor });
      }
    },

    onTouchEnd() {
      this.pinchStartDistance = null;
      this.pinchStartZoom = this.zoom;
      this.pendingScrollRestore = null;
    },

    touchDistance(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.sqrt((dx * dx) + (dy * dy));
    },

    onKeydown(event) {
      const tagName = event.target?.tagName;
      const isTypingTarget =
        (tagName === "INPUT" && event.target?.type !== "button" && event.target?.type !== "range") ||
        tagName === "TEXTAREA" ||
        event.target?.isContentEditable;
      if (isTypingTarget || this.isAnimating || event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key;
      const code = event.code;

      if (key === "ArrowLeft" || code === "ArrowLeft") {
        event.preventDefault();
        this.prevPage();
      } else if (key === "ArrowRight" || code === "ArrowRight") {
        event.preventDefault();
        this.nextPage();
      }
    },
  };
};
