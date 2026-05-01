window.createDocumentPdfModule = function createDocumentPdfModule() {
  let rawPdfDoc = null;
  let rawPdfSrc = "";
  let rawPdfRenderToken = 0;
  let rawPdfLoadPromise = null;
  let rawPdfLoadSrc = "";
  const pdfDocCache = new Map();

  return {
    get src() {
      return rawPdfSrc;
    },

    reset(viewer) {
      rawPdfRenderToken += 1;
      rawPdfLoadPromise = null;
      rawPdfLoadSrc = "";
      rawPdfDoc = null;
      rawPdfSrc = "";
      viewer.pdfReady = false;
      viewer.pdfTotalPages = 1;
      viewer.pdfStatusText = "";
      viewer.pdfError = false;
    },

    destroy() {
      rawPdfRenderToken += 1;
      pdfDocCache.forEach((pdfDoc) => {
        if (pdfDoc && typeof pdfDoc.destroy === "function") {
          try {
            pdfDoc.destroy();
          } catch (error) {
            // Best-effort cleanup only.
          }
        }
      });
      pdfDocCache.clear();
      rawPdfDoc = null;
      rawPdfSrc = "";
      rawPdfLoadPromise = null;
      rawPdfLoadSrc = "";
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
        const container = viewer.$refs.pdfList;
        if (!container) {
          await new Promise((resolve) => window.setTimeout(resolve, 16));
          continue;
        }
        const width = container.clientWidth || container.getBoundingClientRect().width || 0;
        if (width > 40) return container;
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      return viewer.$refs.pdfList;
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

      if (pdfDocCache.has(src)) {
        rawPdfDoc = pdfDocCache.get(src);
      } else if (rawPdfLoadPromise && rawPdfLoadSrc === src) {
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
        pdfDocCache.set(src, rawPdfDoc);
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
            initialPages: 1,
          });
        } else {
          renderedPages = await this.renderPages(viewer, pdfDoc, token, container, {
            className: "doc-pdf-canvas",
            gutter: 12,
            minWidth: 280,
            preferredScale: 1.35,
            minScale: 0,
            initialPages: 1,
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
                initialPages: 1,
              }
              : {
                className: "doc-pdf-canvas",
                gutter: 12,
                minWidth: 280,
                preferredScale: 1.35,
                minScale: 0,
                initialPages: 1,
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

    async renderPage(viewer, pdfDoc, token, container, opts, pageNumber) {
      if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return false;

      const page = await pdfDoc.getPage(pageNumber);
      if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return false;

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

      if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return false;
      container.appendChild(canvas);
      return true;
    },

    scheduleRemainingPages(viewer, pdfDoc, token, container, opts, startPage) {
      const run = async () => {
        for (let pageNumber = startPage; pageNumber <= viewer.pdfTotalPages; pageNumber += 1) {
          if (token !== rawPdfRenderToken || pdfDoc !== rawPdfDoc) return;
          await this.renderPage(viewer, pdfDoc, token, container, opts, pageNumber);
          viewer.applyPdfZoom();
          await this.sleep(0);
        }
      };
      if (window.requestIdleCallback) {
        window.requestIdleCallback(() => { run(); }, { timeout: 500 });
      } else {
        window.setTimeout(run, 0);
      }
    },

    async renderPages(viewer, pdfDoc, token, container, opts) {
      if (!container || !pdfDoc) return 0;

      container.innerHTML = "";
      let renderedPages = 0;
      const initialPages = Math.min(opts.initialPages || 1, viewer.pdfTotalPages);
      for (let pageNumber = 1; pageNumber <= initialPages; pageNumber += 1) {
        const rendered = await this.renderPage(viewer, pdfDoc, token, container, opts, pageNumber);
        if (!rendered) return renderedPages;
        renderedPages += 1;
      }
      if (initialPages < viewer.pdfTotalPages) {
        this.scheduleRemainingPages(viewer, pdfDoc, token, container, opts, initialPages + 1);
      }
      return renderedPages;
    },
  };
};
