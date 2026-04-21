window.documentDetailViewer = function documentDetailViewer(payload) {
  let rawPdfDoc = null;
  let rawPdfRenderToken = 0;

  return {
    media: payload.media || [],
    title: payload.title || "Document",
    docId: payload.id,
    documentOcrText: payload.documentOcrText || "",
    documentTranslation: payload.documentTranslation || "",
    pageIndex: 0,
    zoom: 1,
    minZoom: 1,
    maxZoom: 2.5,
    activePanel: null,
    showDocumentDetails: false,
    relatedOpen: false,
    pinchStartDistance: null,
    pinchStartZoom: 1,
    isMobile: window.matchMedia("(max-width: 767px)").matches,
    pdfTotalPages: 1,
    pdfStatusText: "",
    pdfError: false,
    requestedDisplayPage: null,
    isAnimating: false,
    carouselPhase: null,
    carouselDirection: 1,
    keydownHandler: null,

    async init() {
      this.updateViewportMode();
      this.syncLayoutMetrics();
      this.keydownHandler = this.onKeydown.bind(this);
      window.addEventListener("keydown", this.keydownHandler);
      window.addEventListener("resize", () => {
        this.updateViewportMode();
        this.syncLayoutMetrics();
        if (this.currentMedia && this.currentMedia.is_pdf) {
          this.renderCurrentPdf();
        }
      });

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
      if (!this.currentMedia) return "cursor-default";
      return this.zoom > 1 ? "cursor-zoom-out" : "cursor-zoom-in";
    },

    get canvasScale() {
      if (this.currentMedia && this.currentMedia.is_pdf) return 1;
      return this.zoom;
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

    async loadCurrentMedia() {
      rawPdfRenderToken += 1;
      rawPdfDoc = null;
      this.pdfTotalPages = 1;
      this.pdfStatusText = "";
      this.pdfError = false;

      if (!this.currentMedia) return;
      if (!this.currentMedia.is_pdf) return;

      await this.loadPdfDocument(this.currentMedia.src);
      await this.renderCurrentPdf();
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
        this.zoom = 1;
        await this.loadCurrentMedia();
        this.persistPageInUrl();
      });
    },

    async nextMedia() {
      if (!this.pageCount) return;
      if (!this.hasNextMedia || this.isAnimating) return;
      await this.runCarouselTransition("next", async () => {
        this.pageIndex += 1;
        this.zoom = 1;
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
        // Prevent Alpine click expression crashes from bubbling to UI.
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

    zoomIn() {
      this.zoom = Math.min(this.maxZoom, this.zoom + 0.1);
      if (this.currentMedia && this.currentMedia.is_pdf && !this.pdfError) {
        this.renderCurrentPdf();
      }
    },

    zoomOut() {
      this.zoom = Math.max(this.minZoom, this.zoom - 0.1);
      if (this.currentMedia && this.currentMedia.is_pdf && !this.pdfError) {
        this.renderCurrentPdf();
      }
    },

    toggleZoom() {
      this.zoom = this.zoom > 1 ? 1 : 1.4;
      if (this.currentMedia && this.currentMedia.is_pdf && !this.pdfError) {
        this.renderCurrentPdf();
      }
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

    onTouchStart(event) {
      if (event.touches.length !== 2) return;
      this.pinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.pinchStartZoom = this.zoom;
    },

    onTouchMove(event) {
      if (event.touches.length !== 2 || !this.pinchStartDistance) return;
      if (this.currentMedia && this.currentMedia.is_pdf) return;
      const currentDistance = this.touchDistance(event.touches[0], event.touches[1]);
      const scale = currentDistance / this.pinchStartDistance;
      const nextZoom = this.pinchStartZoom * scale;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    },

    touchDistance(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.sqrt((dx * dx) + (dy * dy));
    },

    onKeydown(event) {
      const tagName = event.target?.tagName;
      const isTypingTarget =
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        event.target?.isContentEditable;
      if (isTypingTarget || this.isAnimating) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.prevPage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.nextPage();
      }
    },

    async loadPdfDocument(src) {
      if (!window.pdfjsLib) {
        this.pdfError = true;
        this.pdfStatusText = "PDF viewer failed to load.";
        return;
      }

      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

      try {
        this.pdfStatusText = "Loading PDF...";
        const loadingTask = window.pdfjsLib.getDocument(src);
        rawPdfDoc = await loadingTask.promise;
        this.pdfTotalPages = rawPdfDoc.numPages || 1;
        this.pdfError = false;
        this.pdfStatusText = `${this.pdfTotalPages} page PDF`;
      } catch (error) {
        rawPdfDoc = null;
        this.pdfError = true;
        this.pdfStatusText = "Unable to render PDF.";
      }
    },

    async renderCurrentPdf() {
      if (!rawPdfDoc) return;
      const token = ++rawPdfRenderToken;
      const pdfDoc = rawPdfDoc;
      await this.$nextTick();
      await this.renderPdfDesktopPages(pdfDoc, token);
    },

    async renderPdfDesktopPages(pdfDoc, token) {
      const container = this.$refs.pdfDesktopList;
      if (!container || !pdfDoc) return;

      container.innerHTML = "";
      for (let pageNumber = 1; pageNumber <= this.pdfTotalPages; pageNumber += 1) {
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        const page = await pdfDoc.getPage(pageNumber);
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max((container.clientWidth || 0) - 12, 280);
        const fitScale = availableWidth / Math.max(baseViewport.width, 1);
        const preferredScale = 1.35;
        const cssScale = Math.min(preferredScale, fitScale) * this.zoom;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = document.createElement("canvas");
        canvas.className = "doc-pdf-canvas";
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = "auto";
        const context = canvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: context, viewport: renderViewport }).promise;
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        container.appendChild(canvas);
      }
    },

    async renderPdfMobilePages(pdfDoc, token) {
      const container = this.$refs.pdfMobileList;
      if (!container || !pdfDoc) return;

      container.innerHTML = "";
      for (let pageNumber = 1; pageNumber <= this.pdfTotalPages; pageNumber += 1) {
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        const page = await pdfDoc.getPage(pageNumber);
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max((container.clientWidth || 0) - 8, 220);
        const fitScale = availableWidth / Math.max(baseViewport.width, 1);
        const preferredScale = 1.1;
        const cssScale = Math.max(0.35, Math.min(preferredScale, fitScale)) * this.zoom;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = document.createElement("canvas");
        canvas.className = "doc-mobile-pdf-canvas";
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = "auto";
        const context = canvas.getContext("2d", { alpha: false });
        await page.render({ canvasContext: context, viewport: renderViewport }).promise;
        if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
        container.appendChild(canvas);
      }
    }
  };
};
