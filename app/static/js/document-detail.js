window.documentDetailViewer = function documentDetailViewer(payload) {
  const LOG_PREFIX = "[document-detail]";
  const pdfModule = window.createDocumentPdfModule();
  const docxModule = window.createDocumentDocxModule();
  const zoomModule = window.createDocumentZoomModule();

  return {
    media: payload.media || [],
    title: payload.title || "Document",
    docId: payload.id,
    documentOcrText: payload.documentOcrText || "",
    documentTranslation: payload.documentTranslation || "",
    mediaIndex: 0,
    zoom: 1,
    tapZoomLevel: 1.5,
    minZoom: 0.75,
    maxZoom: 5,
    zoomStep: 0.25,
    pinchZoomStep: 0.01,
    pinchSensitivityMobile: 1.2,
    pinchSensitivityDesktop: 1.45,
    wheelZoomSensitivityMobile: 0.0015,
    wheelZoomSensitivityDesktop: 0.0022,
    activePanel: null,
    relatedOpen: false,
    pinchStartDistance: null,
    pinchStartZoom: 1,
    swipeStartX: null,
    swipeStartY: null,
    swipeAxis: null,
    isMobile: window.matchMedia("(max-width: 767px)").matches,
    pdfTotalPages: 1,
    pdfStatusText: "",
    pdfError: false,
    pdfReady: false,
    docxError: false,
    docxReady: false,
    mediaState: {
      status: "idle",
      kind: "",
      token: 0,
    },
    isAnimating: false,
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
      if (Number.isFinite(requestedPage) && requestedPage > 0 && requestedPage <= this.mediaCount) {
        this.mediaIndex = requestedPage - 1;
      }

      this.$watch("mediaIndex", () => {
        this.persistPageInUrl();
      });

      await this.loadCurrentMedia();

      if (window.ResizeObserver && this.$refs.mediaScrollPane) {
        let pdfRenderedWidth = 0;
        let pdfResizeTimer = null;
        const pdfRO = new ResizeObserver((entries) => {
          const width = Math.round(entries[0].contentRect.width);
          if (width <= 0 || !this.isPdfMedia() || this.pdfError) return;
          if (Math.abs(width - pdfRenderedWidth) < 24) return;
          window.clearTimeout(pdfResizeTimer);
          pdfResizeTimer = window.setTimeout(() => {
            if (!this.isPdfMedia() || this.pdfError) return;
            pdfModule.render(this).then(() => {
              pdfRenderedWidth = this.$refs.pdfList?.clientWidth || width;
              this.applyPdfZoom();
            });
          }, 100);
        });
        this.$watch("pdfReady", (ready) => {
          if (ready) pdfRenderedWidth = this.$refs.pdfList?.clientWidth || 0;
        });
        pdfRO.observe(this.$refs.mediaScrollPane);
        window.addEventListener("pagehide", () => pdfRO.disconnect(), { once: true });
      }

      if (window.ResizeObserver && this.$refs.mediaScrollPane) {
        let docxRenderedWidth = 0;
        let docxResizeTimer = null;
        const docxRO = new ResizeObserver((entries) => {
          const width = Math.round(entries[0].contentRect.width);
          if (width <= 0 || !this.isDocxMedia() || this.docxError) return;
          if (Math.abs(width - docxRenderedWidth) < 24) return;
          window.clearTimeout(docxResizeTimer);
          docxResizeTimer = window.setTimeout(() => {
            if (!this.isDocxMedia() || this.docxError) return;
            docxModule.render(this).then(() => {
              docxRenderedWidth = this.$refs.docxList?.clientWidth || width;
              this.applyDocxZoom();
            });
          }, 100);
        });
        docxRO.observe(this.$refs.mediaScrollPane);
        this.$watch("docxReady", (ready) => {
          if (ready) docxRenderedWidth = this.$refs.docxList?.clientWidth || 0;
        });
        window.addEventListener("pagehide", () => docxRO.disconnect(), { once: true });
      }

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
      pdfModule.destroy();
      docxModule.destroy();
    },

    get mediaCount() {
      return this.media.length;
    },

    get pageCount() {
      return this.mediaCount;
    },

    get currentMedia() {
      return this.media[this.mediaIndex] || null;
    },

    get displayMediaNumber() {
      if (!this.currentMedia) return 1;
      return this.mediaIndex + 1;
    },

    get displayPage() {
      return this.displayMediaNumber;
    },

    get displayMediaTotal() {
      return Math.max(this.mediaCount, 1);
    },

    get displayTotal() {
      return this.displayMediaTotal;
    },

    get hasPrevMedia() {
      return this.mediaIndex > 0;
    },

    get hasNextMedia() {
      return this.mediaIndex < this.mediaCount - 1;
    },

    get panelTitle() {
      if (this.activePanel === "info") return "Info";
      if (this.activePanel === "extracted") return "Extracted Text";
      if (this.activePanel === "translation") return "English Translation";
      return "";
    },

    get currentExtractedText() {
      const mediaOriginal = (this.currentMedia?.original_text || "").trim();
      const mediaOcr = (this.currentMedia?.ocr_text || "").trim();
      const docOcr = (this.documentOcrText || "").trim();
      return mediaOriginal || mediaOcr || docOcr;
    },

    get currentTranslationText() {
      const docTranslation = (this.documentTranslation || "").trim();
      return docTranslation;
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
      if (this.isCatalogMedia()) return this.maxZoom;
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

    isCatalogMedia(item = this.currentMedia) {
      return item?.media_kind === "catalog";
    },

    isZoomableMedia(item = this.currentMedia) {
      if (this.isCatalogMedia(item)) return true;
      return this.isImageMedia(item) || this.isPdfMedia(item) || this.isDocxMedia(item);
    },

    clearMediaErrors() {
      if (this.mediaState.status === "error") {
        this.mediaState = { ...this.mediaState, status: "idle" };
      }
    },

    clearMediaReady() {
      if (this.mediaState.status === "ready") {
        this.mediaState = { ...this.mediaState, status: "idle" };
      }
    },

    setMediaReady(kind) {
      if (!kind) return;
      if (this.currentMedia?.media_kind === kind) {
        this.mediaState = { ...this.mediaState, kind, status: "ready" };
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
      if (this.currentMedia?.media_kind === kind) {
        this.mediaState = { ...this.mediaState, kind, status: "error" };
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
      return this.mediaState.status === "loading" && this.mediaState.kind === kind;
    },

    hasKindError(kind) {
      if (kind === "pdf") return this.pdfError;
      if (kind === "docx") return this.docxError;
      return this.mediaState.status === "error" && this.mediaState.kind === kind;
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
        this.updateViewportMode();
        this.syncLayoutMetrics();
        if (this.isImageMedia() && !this.hasKindError("image")) {
          this.applyImageZoom();
        }
        if (this.isCatalogMedia()) {
          this.applyCatalogZoom();
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
      if (kind === "pdf") return this.$refs.pdfList;
      if (kind === "docx") return this.$refs.docxList;
      if (kind === "image") return this.$refs.imageList;
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
      const token = this.mediaState.token + 1;
      const kind = this.currentMedia?.media_kind || "";
      this.mediaState = { status: "loading", kind, token };

      try {
        if (!this.currentMedia) return;

        if (this.isPdfMedia()) {
          if (this.pdfReady && pdfModule.src === this.currentMedia.src) {
            await this.$nextTick();
            this.applyAllZoom();
            return;
          }
          this.clearMediaErrors();
          this.clearMediaReady();
          pdfModule.reset(this);
          docxModule.reset(this);
          await pdfModule.load(this, this.currentMedia.src);
          if (token !== this.mediaState.token) return;
          await pdfModule.render(this);
          return;
        }

        if (this.isDocxMedia()) {
          if (this.docxReady && docxModule.src === this.currentMedia.src) {
            await this.$nextTick();
            this.applyAllZoom();
            return;
          }
          this.clearMediaErrors();
          this.clearMediaReady();
          pdfModule.reset(this);
          docxModule.reset(this);
          await docxModule.load(this, this.currentMedia.src);
          if (token !== this.mediaState.token) return;
          await docxModule.render(this);
          return;
        }

        this.clearMediaErrors();
        this.clearMediaReady();
        pdfModule.reset(this);
        docxModule.reset(this);

        if (this.currentMedia?.media_kind === "other") {
          this.setMediaReady("other");
          return;
        }

        // Give Alpine a tick so non-async media can show the normalized states cleanly.
        await this.$nextTick();
      } finally {
        if (token === this.mediaState.token && this.mediaState.status === "loading") {
          this.mediaState = { ...this.mediaState, status: "ready" };
        }
        await this.$nextTick();
        this.applyAllZoom();
      }
    },

    async prevMedia() {
      if (!this.mediaCount) return;
      if (!this.hasPrevMedia || this.isAnimating) return;
      await this.goToMediaIndex(this.mediaIndex - 1);
    },

    async nextMedia() {
      if (!this.mediaCount) return;
      if (!this.hasNextMedia || this.isAnimating) return;
      await this.goToMediaIndex(this.mediaIndex + 1);
    },

    async goToMediaIndex(nextIndex) {
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= this.mediaCount) return;
      if (nextIndex === this.mediaIndex || this.isAnimating) return;
      this.isAnimating = true;
      try {
        this.mediaIndex = nextIndex;
        this.resetZoomState();
        this.persistPageInUrl();
        await this.$nextTick();
        await this.loadCurrentMedia();
        this.resetMediaScroll();
      } catch (error) {
        console.error("Media navigation failed", error);
      } finally {
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
      const nextPage = this.mediaIndex + 1;
      url.searchParams.set("page", String(nextPage > 0 ? nextPage : 1));
      window.history.replaceState({}, "", url);
    },

    resetZoomState() {
      zoomModule.reset(this);
    },

    resetMediaScroll() {
      const pane = this.$refs.mediaScrollPane;
      if (!pane) return;
      window.requestAnimationFrame(() => {
        pane.scrollLeft = 0;
        pane.scrollTop = 0;
      });
    },

    getImageContainer() {
      return zoomModule.getImageContainer(this);
    },

    getPdfContainer() {
      return zoomModule.getPdfContainer(this);
    },

    getDocxContainer() {
      return zoomModule.getDocxContainer(this);
    },

    applyCatalogZoom() {
      zoomModule.applyCatalog(this);
    },

    applyImageZoom() {
      zoomModule.applyImage(this);
    },

    applyPdfZoom() {
      zoomModule.applyPdf(this);
    },

    applyDocxZoom() {
      zoomModule.applyDocx(this);
    },

    applyAllZoom() {
      zoomModule.applyAll(this);
    },

    setZoom(nextZoom, options = {}) {
      zoomModule.set(this, nextZoom, options);
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
      if (zoomModule.shouldIgnoreInteraction(event.target)) return;
      const targetZoom = this.zoom >= (this.tapZoomLevel - 0.01) ? 1 : this.tapZoomLevel;
      this.setZoom(targetZoom, { anchor: event });
    },

    togglePanel(panelName) {
      if (this.activePanel === panelName) {
        this.activePanel = null;
        return;
      }
      this.activePanel = panelName;
    },

    closePanel() {
      this.activePanel = null;
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
      zoomModule.onWheel(this, event);
    },

    onTouchStart(event) {
      zoomModule.onTouchStart(this, event);
    },

    onTouchMove(event) {
      zoomModule.onTouchMove(this, event);
    },

    onTouchEnd(event) {
      zoomModule.onTouchEnd(this, event);
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
        this.prevMedia();
      } else if (key === "ArrowRight" || code === "ArrowRight") {
        event.preventDefault();
        this.nextMedia();
      }
    },
  };
};
