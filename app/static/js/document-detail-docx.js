window.createDocumentDocxModule = function createDocumentDocxModule() {
  let rawDocxBuffer = null;
  let rawDocxSrc = "";
  let rawDocxRenderToken = 0;
  const docxBufferCache = new Map();

  return {
    get src() {
      return rawDocxSrc;
    },

    reset(viewer) {
      rawDocxRenderToken += 1;
      rawDocxBuffer = null;
      rawDocxSrc = "";
      viewer.docxReady = false;
      viewer.docxError = false;
    },

    destroy() {
      rawDocxRenderToken += 1;
      docxBufferCache.clear();
      rawDocxBuffer = null;
      rawDocxSrc = "";
    },

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
        const container = viewer.$refs.docxList;
        if (!container) {
          await new Promise((resolve) => window.setTimeout(resolve, 16));
          continue;
        }
        return container;
      }
      return viewer.$refs.docxList;
    },

    async load(viewer, src) {
      const docxRenderer = this.getRenderer();
      if (!docxRenderer) {
        viewer.docxError = true;
        return;
      }

      try {
        if (docxBufferCache.has(src)) {
          rawDocxBuffer = docxBufferCache.get(src);
        } else {
          const response = await fetch(src, { credentials: "same-origin" });
          if (!response.ok) {
            throw new Error(`Failed to load DOCX (${response.status})`);
          }
          rawDocxBuffer = await response.arrayBuffer();
          docxBufferCache.set(src, rawDocxBuffer);
        }
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

        rawDocxSrc = src;
        viewer.docxError = false;
      } catch (error) {
        viewer.logError("DOCX load failed.", error, { src });
        rawDocxBuffer = null;
        rawDocxSrc = "";
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
};
