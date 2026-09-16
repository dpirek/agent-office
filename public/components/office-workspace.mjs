import OfficeComponent from "./office-component.mjs";
import { escapeHtml, formatBytes, fetchJson } from "./office-format.mjs";
import { normalizeFileUrl, workspaceFileUrl } from "../lib/file-url.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";
import { initWorkspaceResizing } from "../lib/workspace-resize.mjs";

class OfficeWorkspace extends OfficeComponent {
  static hostAttributes = {"class": "panel shared-workspace-panel"};
  model = { sharedWorkspaceTree: [], sharedWorkspaceRoot: "", projectId: "central-office" };

  render() {
    this.appendChildren(this, [
      this.createElement("header", { "class": "panel-header", children: [
        this.createElement("div", { children: [
          this.createElement("svg", { "class": "header-icon bi", "width": "20", "height": "20", "viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": "true", "focusable": "false", children: [
            this.createElement("use", { "href": "/assets/bootstrap-icons/bootstrap-icons.svg#folder2-open" })
          ] }),
          this.createElement("h2", { textContent: "SHARED WORKSPACE" })
        ] }),
        this.createElement("button", { "class": "header-action", "id": "refresh-workspace-button", "type": "button", textContent: "REFRESH" })
      ] }),
      this.createElement("div", { "class": "shared-workspace-summary panel-body", children: [
        this.createElement("div", { children: [
          this.createElement("strong", { "id": "workspace-file-count", textContent: "0 FILES" }),
          this.createElement("span", { textContent: "Shared project files organized by function: app, docs, designs, research, scripts." })
        ] }),
        this.createElement("code", { "id": "shared-workspace-root", textContent: "—" })
      ] }),
      this.createElement("div", { "class": "workspace-explorer panel-body", children: [
        this.createElement("nav", { "id": "workspace-tree-pane", "class": "workspace-tree-pane", "aria-label": "Project files", children: [
          this.createElement("div", { "class": "workspace-tree-heading", textContent: "FILES" }),
          this.createElement("div", { "class": "shared-workspace-browser", "id": "shared-workspace-browser" })
        ] }),
        this.createElement("div", { "id": "workspace-tree-resizer", "class": "workspace-tree-resizer", "role": "separator", "tabindex": "0", "aria-label": "Resize file tree", "aria-orientation": "vertical", "aria-controls": "workspace-tree-pane", "title": "Drag to resize · Arrow keys to adjust · Double-click to reset" }),
        this.createElement("section", { "class": "workspace-preview", "aria-labelledby": "file-preview-title", children: [
          this.createElement("header", { "class": "workspace-preview-header", children: [
            this.createElement("h3", { "id": "file-preview-title", textContent: "FILE PREVIEW" }),
            this.createElement("div", { "class": "file-preview-actions", "id": "file-preview-actions", "hidden": "", children: [
              this.createElement("a", { "id": "file-preview-open", "target": "_blank", "rel": "noopener noreferrer", textContent: "OPEN ↗" }),
              this.createElement("a", { "id": "file-preview-download", "download": "", textContent: "DOWNLOAD ↓" })
            ] })
          ] }),
          this.createElement("div", { "class": "file-preview-content", "id": "file-preview-content", children: [
            this.createElement("div", { "class": "workspace-preview-empty", children: [
              this.createElement("span", { "aria-hidden": "true", textContent: "▱" }),
              this.createElement("strong", { textContent: "Select a file to preview" }),
              this.createElement("p", { textContent: "Browse your project files on the left." })
            ] })
          ] })
        ] })
      ] })
    ]);
  }

  initialize() {
    const state = this.model;
    const $ = (selector, root = this) => root.querySelector(selector);
    const showToast = (message, error = false) => this.emit("office-notify", { message, error });
    function workspaceFiles(nodes, prefix = "") {
      return nodes.flatMap((node) => node.type === "file"
        ? [{ ...node, nestedPath: prefix ? `${prefix}/${node.name}` : node.name }]
        : workspaceFiles(node.children || [], prefix ? `${prefix}/${node.name}` : node.name));
    }

    function renderSharedWorkspace() {
      const root = $("#shared-workspace-root");
      const browser = $("#shared-workspace-browser");
      if (!root || !browser) return;
      const files = workspaceFiles(state.sharedWorkspaceTree);
      root.textContent = state.sharedWorkspaceRoot || "—";
      root.title = state.sharedWorkspaceRoot || "";
      $("#workspace-file-count").textContent = `${files.length} FILE${files.length === 1 ? "" : "S"}`;
      const renderTree = (nodes) => `<ul class="workspace-tree">${nodes.map((node) => {
        if (node.type === "directory") return `<li><details data-folder-path="${escapeHtml(node.path)}" ${collapsedWorkspaceFolders.has(node.path) ? "" : "open"}><summary><span class="workspace-folder-icon" aria-hidden="true">▰</span><span>${escapeHtml(node.name)}</span></summary>${node.children?.length ? renderTree(node.children) : '<div class="workspace-tree-empty">Empty folder</div>'}</details></li>`;
        return `<li><a class="workspace-tree-file${selectedWorkspaceFile === node.path ? " selected" : ""}" href="${escapeHtml(workspaceFileUrl(node.path))}" ${selectedWorkspaceFile === node.path ? 'aria-current="true"' : ""} title="${escapeHtml(node.name)} · ${formatBytes(node.size)}"><span aria-hidden="true">▱</span><span>${escapeHtml(node.name)}</span></a></li>`;
      }).join("")}</ul>`;
      const markup = state.sharedWorkspaceTree.length ? renderTree(state.sharedWorkspaceTree) : '<div class="workspace-tree-empty">No project files yet.</div>';
      if (markup !== workspaceTreeMarkup) {
        browser.innerHTML = markup;
        workspaceTreeMarkup = markup;
      }
    }

    async function loadSharedWorkspace({ quiet = false } = {}) {
      try {
        const projectId = state.projectId;
        const data = await fetchJson(`/api/shared-workspace?projectId=${encodeURIComponent(projectId)}`);
        if (projectId !== state.projectId) return;
        state.sharedWorkspaceRoot = data.root || "";
        state.sharedWorkspaceTree = data.tree || [];
        renderSharedWorkspace();
      } catch (error) {
        if (!quiet) showToast(error.message, true);
      }
    }
    let previewRequest = 0;
    let previewController = null;
    let selectedWorkspaceFile = null;
    const collapsedWorkspaceFolders = new Set();
    let workspaceTreeMarkup = "";
    function resetFilePreview() {
      previewRequest += 1;
      previewController?.abort();
      selectedWorkspaceFile = null;
      $("#file-preview-title").textContent = "FILE PREVIEW";
      $("#file-preview-actions").hidden = true;
      $("#file-preview-content").innerHTML = '<div class="workspace-preview-empty"><span aria-hidden="true">▱</span><strong>Select a file to preview</strong><p>Browse your project files on the left.</p></div>';
    }
    $("#shared-workspace-browser").addEventListener("toggle", (event) => {
      const folder = event.target;
      if (!folder.matches("details[data-folder-path]")) return;
      if (folder.open) collapsedWorkspaceFolders.delete(folder.dataset.folderPath);
      else collapsedWorkspaceFolders.add(folder.dataset.folderPath);
    }, true);

    async function openFilePreview(href) {
      const url = normalizeFileUrl(href);
      const pathname = new URL(url, location.href).pathname;
      const name = decodeURIComponent(pathname.split("/").pop() || "File");
      const extension = name.split(".").pop()?.toLowerCase();
      if (extension === "zip") {
        const download = document.createElement("a");
        download.href = url;
        download.download = name;
        download.click();
        return;
      }
      const request = ++previewRequest;
      previewController?.abort();
      previewController = new AbortController();
      selectedWorkspaceFile = decodeURIComponent(pathname.slice("/files/".length));
      for (const folder of [...collapsedWorkspaceFolders]) {
        if (selectedWorkspaceFile.startsWith(folder + "/")) collapsedWorkspaceFolders.delete(folder);
      }
      renderSharedWorkspace();
      const content = $("#file-preview-content");
      content.replaceChildren();
      content.textContent = "Loading preview…";
      $("#file-preview-title").textContent = selectedWorkspaceFile.replace(state.projectId + "/", "");
      $("#file-preview-title").title = selectedWorkspaceFile;
      $("#file-preview-actions").hidden = false;
      $("#file-preview-open").href = url;
      const download = $("#file-preview-download");
      download.href = url;
      download.download = name;
      try {
        let node;
        if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension)) {
          node = document.createElement("img");
          node.src = url;
          node.alt = name;
          node.className = "file-preview-image";
        } else if (["html", "htm", "pdf"].includes(extension)) {
          node = document.createElement("iframe");
          node.src = url;
          node.title = name;
          if (extension !== "pdf") node.setAttribute("sandbox", "allow-scripts");
        } else {
          const response = await fetch(url, { signal: previewController.signal });
          if (!response.ok) throw new Error(`Could not load file (HTTP ${response.status}).`);
          const contentType = response.headers.get("content-type") || "";
          if (!/^(?:text\/|application\/(?:json|javascript|xml))/.test(contentType)) throw new Error("Preview is unavailable for this file type. Use Download instead.");
          const body = await response.text();
          node = document.createElement(extension === "md" ? "div" : "pre");
          if (extension === "md") {
            node.className = "markdown-body file-preview-markdown";
            node.innerHTML = renderMarkdown(body);
          } else {
            node.className = "file-preview-text";
            node.textContent = body;
          }
        }
        if (request === previewRequest) content.replaceChildren(node);
      } catch (error) {
        if (request === previewRequest) content.textContent = error.message;
      }
    }

    $('#refresh-workspace-button').addEventListener('click', () => void loadSharedWorkspace());
    this.addEventListener('click', event => {
      const link = event.target.closest('#shared-workspace-browser a[href]');
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      void openFilePreview(link.getAttribute('href'));
    });
    this.load = loadSharedWorkspace;
    this.openFile = openFilePreview;
    this.reset = () => {
      collapsedWorkspaceFolders.clear();
      state.sharedWorkspaceTree = [];
      state.sharedWorkspaceRoot = '';
      resetFilePreview();
      renderSharedWorkspace();
    };
    this.update = renderSharedWorkspace;
    this.onConnect = () => initWorkspaceResizing({ root: this, signal: this.connectionSignal });
    this.onDisconnect = () => { previewRequest += 1; previewController?.abort(); };
  }
}

customElements.define("office-workspace", OfficeWorkspace);
export default OfficeWorkspace;
