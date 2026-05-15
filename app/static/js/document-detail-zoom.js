window.createDocumentZoomModule = function createDocumentZoomModule() {
  return {
    reset(viewer) {
      viewer.zoom = 1;
      viewer.pinchStartDistance = null;
      viewer.pinchStartZoom = viewer.zoom;
      viewer.pendingScrollRestore = null;
      if (viewer.scrollRestoreRafId !== null) {
        window.cancelAnimationFrame(viewer.scrollRestoreRafId);
        viewer.scrollRestoreRafId = null;
      }
      this.applyAll(viewer);
    },

    getImageContainer(viewer) {
      return viewer.$refs.imageList;
    },

    getPdfContainer(viewer) {
      return viewer.$refs.pdfList;
    },

    getDocxContainer(viewer) {
      return viewer.$refs.docxList;
    },

    getCatalogContainer(viewer) {
      return viewer.$refs.catalogTextList;
    },

    getScrollPane(viewer) {
      return viewer.$refs.mediaScrollPane;
    },

    shouldIgnoreInteraction(target) {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(
        target.closest(
          "a, button, input, textarea, select, label, summary, iframe, video, audio, [contenteditable='true'], [data-no-zoom]",
        ),
      );
    },

    applyToContainer(viewer, container, isActive, options = {}) {
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
      container.classList.toggle("is-zoomed", viewer.zoom > 1.001);
      if (viewer.nativeCssZoomSupported) {
        container.style.zoom = String(viewer.zoom);
        container.style.transform = "";
        container.style.transformOrigin = transformOrigin;
        container.style.width = "";
      } else {
        container.style.zoom = "";
        container.style.transform = `scale(${viewer.zoom})`;
        container.style.transformOrigin = transformOrigin;
        container.style.width = `${(100 / viewer.zoom).toFixed(4)}%`;
      }
    },

    applyImage(viewer) {
      const container = this.getImageContainer(viewer);
      if (!container) return;
      const image = container.querySelector("img");

      if (!viewer.isImageMedia() || !image) {
        if (image) {
          image.style.width = "";
          image.style.maxWidth = "";
          image.style.height = "";
          image.style.maxHeight = "";
          delete image.dataset.baseRenderWidth;
        }
        this.applyToContainer(viewer, container, false);
        return;
      }

      this.applyToContainer(viewer, container, false);
      if (viewer.zoom <= 1.001) {
        image.style.width = "";
        image.style.maxWidth = "";
        image.style.height = "";
        image.style.maxHeight = "";
        container.classList.remove("is-zoomed");
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
          const divisor = Math.max(viewer.zoom, 1);
          baseWidth = measuredWidth / divisor;
          if (Number.isFinite(baseWidth) && baseWidth > 0) {
            image.dataset.baseRenderWidth = String(baseWidth);
          }
        }
      }

      if (Number.isFinite(baseWidth) && baseWidth > 0) {
        image.style.width = `${baseWidth * viewer.zoom}px`;
        image.style.maxWidth = "none";
        image.style.height = "auto";
        image.style.maxHeight = "none";
      }

      container.classList.toggle("is-zoomed", viewer.zoom > 1.001);
    },

    applyPdf(viewer) {
      if (viewer.pdfZoomRafId !== null) {
        window.cancelAnimationFrame(viewer.pdfZoomRafId);
      }
      viewer.pdfZoomRafId = window.requestAnimationFrame(() => {
        viewer.pdfZoomRafId = null;
        this.applyPdfNow(viewer);
      });
    },

    applyPdfNow(viewer) {
      const container = this.getPdfContainer(viewer);
      if (!container) return;

      if (!viewer.isPdfMedia()) {
        container.style.width = "";
        container.style.maxWidth = "";
        container.querySelectorAll("canvas").forEach((canvas) => {
          canvas.style.width = "";
          delete canvas.dataset.baseRenderWidth;
        });
        this.applyToContainer(viewer, container, false);
        return;
      }

      this.applyToContainer(viewer, container, false);
      container.classList.toggle("is-zoomed", viewer.zoom > 1.001);

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
        canvas.style.width = `${baseWidth * viewer.zoom}px`;
        canvas.style.height = "auto";
        canvas.style.maxWidth = "none";
      });
    },

    applyDocx(viewer) {
      const container = this.getDocxContainer(viewer);
      if (!container) return;

      const preview = container.querySelector(".docx-preview");
      const wrapper = container.querySelector(".docx-wrapper");
      const zoomTarget = wrapper || preview || container;
      if (!viewer.isDocxMedia()) {
        this.applyToContainer(viewer, container, false);
        if (preview && preview !== container) {
          this.applyToContainer(viewer, preview, false);
        }
        if (zoomTarget && zoomTarget !== preview && zoomTarget !== container) {
          this.applyToContainer(viewer, zoomTarget, false);
          zoomTarget.style.width = "";
          zoomTarget.style.maxWidth = "";
        }
        return;
      }

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
          const measuredWidth = zoomTarget.getBoundingClientRect().width;
          if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
            baseWidth = measuredWidth / Math.max(viewer.zoom, 1);
            zoomTarget.dataset.baseRenderWidth = String(baseWidth);
          }
        }

        this.applyToContainer(viewer, zoomTarget, true);

        if (Number.isFinite(baseWidth) && baseWidth > 0) {
          zoomTarget.style.width = `${baseWidth}px`;
          zoomTarget.style.maxWidth = "none";
        } else {
          zoomTarget.style.width = "";
          zoomTarget.style.maxWidth = "";
        }
        return;
      }

      this.applyToContainer(viewer, zoomTarget, true);
    },

    applyCatalog(viewer) {
      const container = this.getCatalogContainer(viewer);
      const frame = viewer.$refs.catalogTextZoomFrame;
      const page = viewer.$refs.catalogTextPage;
      if (!container || !frame || !page) return;

      if (!viewer.isCatalogMedia()) {
        frame.classList.remove("is-zoomed");
        frame.style.width = "";
        frame.style.minHeight = "";
        frame.style.transform = "";
        frame.style.transformOrigin = "";
        frame.style.zoom = "";
        delete page.dataset.baseRenderWidth;
        delete page.dataset.baseRenderHeight;
        return;
      }

      let baseWidth = Number(page.dataset.baseRenderWidth || 0);
      const layoutWidth = page.offsetWidth || 0;
      if (
        Number.isFinite(layoutWidth) &&
        layoutWidth > 0 &&
        (!Number.isFinite(baseWidth) || baseWidth <= 0 || Math.abs(layoutWidth - baseWidth) >= 24)
      ) {
        baseWidth = layoutWidth;
        page.dataset.baseRenderWidth = String(baseWidth);
      }
      if (!Number.isFinite(baseWidth) || baseWidth <= 0) {
        const measuredWidth = page.getBoundingClientRect().width / Math.max(viewer.zoom, 1);
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
          baseWidth = measuredWidth;
          page.dataset.baseRenderWidth = String(baseWidth);
        }
      }

      let baseHeight = Number(page.dataset.baseRenderHeight || 0);
      const measuredHeight = page.offsetHeight || (page.getBoundingClientRect().height / Math.max(viewer.zoom, 1));
      if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
        baseHeight = measuredHeight;
        page.dataset.baseRenderHeight = String(baseHeight);
      }

      frame.classList.toggle("is-zoomed", viewer.zoom > 1.001);
      frame.style.zoom = "";
      frame.style.transformOrigin = "top left";
      frame.style.transform = `scale(${viewer.zoom})`;

      if (Number.isFinite(baseWidth) && baseWidth > 0) {
        frame.style.width = `${baseWidth * viewer.zoom}px`;
      }
      if (Number.isFinite(baseHeight) && baseHeight > 0) {
        frame.style.minHeight = `${baseHeight * viewer.zoom}px`;
      }
    },

    applyAll(viewer) {
      this.applyImage(viewer);
      this.applyPdf(viewer);
      this.applyDocx(viewer);
      this.applyCatalog(viewer);
    },

    captureScroll(viewer, currentZoom, nextZoom, anchor = null) {
      if (nextZoom <= 0 || currentZoom <= 0) {
        viewer.pendingScrollRestore = null;
        return;
      }
      const pane = this.getScrollPane(viewer);
      if (!pane) {
        viewer.pendingScrollRestore = null;
        return;
      }
      const rect = pane.getBoundingClientRect();
      const localX = anchor ? anchor.clientX - rect.left : (pane.clientWidth / 2);
      const localY = anchor ? anchor.clientY - rect.top : (pane.clientHeight / 2);
      const worldX = pane.scrollLeft + localX;
      const worldY = pane.scrollTop + localY;
      const ratio = nextZoom / currentZoom;
      viewer.pendingScrollRestore = {
        left: (worldX * ratio) - localX,
        top: (worldY * ratio) - localY,
        centerX: !anchor && viewer.isImageMedia(),
      };
    },

    restoreScroll(viewer) {
      if (!viewer.pendingScrollRestore) return;
      if (viewer.scrollRestoreRafId !== null) {
        window.cancelAnimationFrame(viewer.scrollRestoreRafId);
        viewer.scrollRestoreRafId = null;
      }
      const restore = viewer.pendingScrollRestore;
      viewer.pendingScrollRestore = null;
      viewer.scrollRestoreRafId = window.requestAnimationFrame(() => {
        viewer.scrollRestoreRafId = null;
        const pane = this.getScrollPane(viewer);
        if (!pane) return;
        const maxLeft = Math.max((pane.scrollWidth || 0) - pane.clientWidth, 0);
        const maxTop = Math.max((pane.scrollHeight || 0) - pane.clientHeight, 0);
        pane.scrollLeft = restore.centerX
          ? maxLeft / 2
          : Math.max(0, Math.min(maxLeft, restore.left));
        pane.scrollTop = Math.max(0, Math.min(maxTop, restore.top));
      });
    },

    set(viewer, nextZoom, options = {}) {
      if (!viewer.isZoomableMedia()) return;
      const current = viewer.zoom;
      const minAllowed = viewer.currentMinZoom;
      const maxAllowed = viewer.currentMaxZoom;
      const clamped = Math.max(minAllowed, Math.min(maxAllowed, nextZoom));
      if (Math.abs(clamped - current) < 0.001) return;

      const anchor = options.anchor || null;
      if (viewer.isImageMedia() || viewer.isPdfMedia() || viewer.isDocxMedia() || viewer.isCatalogMedia()) {
        this.captureScroll(viewer, current, clamped, anchor);
      } else {
        viewer.pendingScrollRestore = null;
      }

      viewer.zoom = clamped;

      if (viewer.isImageMedia()) {
        this.applyImage(viewer);
        this.restoreScroll(viewer);
      } else if (viewer.isPdfMedia()) {
        this.applyPdf(viewer);
        this.restoreScroll(viewer);
      } else if (viewer.isDocxMedia()) {
        this.applyDocx(viewer);
        this.restoreScroll(viewer);
      } else if (viewer.isCatalogMedia()) {
        this.applyCatalog(viewer);
        this.restoreScroll(viewer);
      }
    },

    snapToStep(viewer, value, step) {
      if (!Number.isFinite(value)) return viewer.zoom;
      if (!Number.isFinite(step) || step <= 0) return value;
      return Math.round(value / step) * step;
    },

    onWheel(viewer, event) {
      if (!viewer.isZoomableMedia()) return;
      if (this.shouldIgnoreInteraction(event.target)) return;
      if (event.metaKey) return;
      if (event.ctrlKey) {
        event.preventDefault();
        const sensitivity = viewer.isMobile
          ? (viewer.wheelZoomSensitivityMobile || 0.0015)
          : (viewer.wheelZoomSensitivityDesktop || 0.0015);
        const factor = Math.exp((-event.deltaY || 0) * sensitivity);
        this.set(viewer, viewer.zoom * factor, { anchor: event });
        return;
      }

      const pane = this.getScrollPane(viewer);
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

      event.preventDefault();
      if (canScrollX && Math.abs(dx) > 0.001) {
        pane.scrollLeft += dx;
      }
      if (canScrollY && Math.abs(dy) > 0.001) {
        pane.scrollTop += dy;
      }
    },

    onTouchStart(viewer, event) {
      if (event.touches.length === 2) {
        if (!viewer.isZoomableMedia()) return;
        if (this.shouldIgnoreInteraction(event.target)) return;
        viewer.pinchStartDistance = this.touchDistance(event.touches[0], event.touches[1]);
        viewer.pinchStartZoom = viewer.zoom;
        viewer.swipeStartX = null;
        viewer.swipeStartY = null;
        viewer.swipeAxis = null;
      } else if (event.touches.length === 1 && viewer.zoom === 1) {
        viewer.swipeStartX = event.touches[0].clientX;
        viewer.swipeStartY = event.touches[0].clientY;
        viewer.swipeAxis = null;
      }
    },

    onTouchMove(viewer, event) {
      if (event.touches.length === 2 && viewer.pinchStartDistance) {
        if (!viewer.isZoomableMedia()) return;
        event.preventDefault();
        const currentDistance = this.touchDistance(event.touches[0], event.touches[1]);
        const scale = currentDistance / viewer.pinchStartDistance;
        const rawSensitivity = viewer.isMobile
          ? viewer.pinchSensitivityMobile
          : viewer.pinchSensitivityDesktop;
        const sensitivity = Number.isFinite(rawSensitivity)
          ? Math.max(rawSensitivity, 0.1)
          : 1;
        const nextZoomRaw = viewer.pinchStartZoom * Math.pow(scale, sensitivity);
        const nextZoom = this.snapToStep(viewer, nextZoomRaw, viewer.pinchZoomStep);
        const firstTouch = event.touches[0];
        const secondTouch = event.touches[1];
        const anchor = {
          clientX: (firstTouch.clientX + secondTouch.clientX) / 2,
          clientY: (firstTouch.clientY + secondTouch.clientY) / 2,
        };
        this.set(viewer, nextZoom, { anchor });
      } else if (event.touches.length === 1 && viewer.swipeStartX !== null) {
        const dx = event.touches[0].clientX - viewer.swipeStartX;
        const dy = event.touches[0].clientY - viewer.swipeStartY;
        if (!viewer.swipeAxis) {
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            viewer.swipeAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
          }
        }
        if (viewer.swipeAxis === "x") {
          event.preventDefault();
        }
      }
    },

    onTouchEnd(viewer, event) {
      if (viewer.swipeStartX !== null && viewer.swipeAxis === "x") {
        const endX = event?.changedTouches?.[0]?.clientX ?? viewer.swipeStartX;
        const dx = endX - viewer.swipeStartX;
        const canGo = dx < 0 ? viewer.hasNextMedia : viewer.hasPrevMedia;
        if (Math.abs(dx) > 60 && canGo) {
          viewer.goToMediaIndex(viewer.mediaIndex + (dx < 0 ? 1 : -1));
        }
      }
      viewer.pinchStartDistance = null;
      viewer.pinchStartZoom = viewer.zoom;
      viewer.pendingScrollRestore = null;
      viewer.swipeStartX = null;
      viewer.swipeStartY = null;
      viewer.swipeAxis = null;
    },

    touchDistance(a, b) {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.sqrt((dx * dx) + (dy * dy));
    },
  };
};
