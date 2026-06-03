window.createDocumentScrollDocx = function createDocumentScrollDocx() {
  "use strict";

  function getRenderer() {
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
  }

  async function waitForRenderer() {
    for (var attempt = 0; attempt < 50; attempt += 1) {
      var renderer = getRenderer();
      if (renderer) return renderer;
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 50);
      });
    }
    return null;
  }

  async function waitForDetailModule() {
    for (var attempt = 0; attempt < 50; attempt += 1) {
      if (typeof window.createDocumentDocxModule === "function") {
        return window.createDocumentDocxModule;
      }
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 50);
      });
    }
    return null;
  }

  function createViewerAdapter(container) {
    return {
      $refs: { docxList: container },
      $root: container,
      docxReady: false,
      docxError: false,
      isMobile: window.matchMedia("(max-width: 767px)").matches,
      $nextTick: function () {
        return new Promise(function (resolve) {
          window.requestAnimationFrame(resolve);
        });
      },
      logError: function (message, error, context) {
        if (window.console && typeof window.console.warn === "function") {
          window.console.warn(message, error || "", context || "");
        }
      },
      syncDocxBaseWidth: function (targetContainer) {
        var target = targetContainer || container;
        if (!target) return;
        var page = target.querySelector(".docx-wrapper .docx, .docx");
        if (!page) return;
        var pageRectWidth = page.getBoundingClientRect
          ? page.getBoundingClientRect().width
          : 0;
        var width = Math.round(Math.max(pageRectWidth, page.offsetWidth || 0));
        if (!Number.isFinite(width) || width < 220) return;
        target.style.setProperty("--doc-docx-page-max-width", width + "px");
      },
      rememberRenderedWidth: function () {},
    };
  }

  async function renderInto(src, container) {
    var moduleFactory = await waitForDetailModule();
    var renderer = await waitForRenderer();
    if (!moduleFactory) {
      throw new Error("DOCX module failed to load.");
    }
    if (!renderer) {
      throw new Error("DOCX renderer failed to load.");
    }

    var docxModule = moduleFactory();
    var viewer = createViewerAdapter(container);
    docxModule.reset(viewer);
    await docxModule.load(viewer, src);
    if (viewer.docxError) {
      throw new Error("DOCX load failed.");
    }
    await docxModule.render(viewer);
    if (viewer.docxError || !viewer.docxReady) {
      throw new Error("DOCX render failed.");
    }
  }

  return {
    renderInto: renderInto,
  };
};
