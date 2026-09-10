const MINIMIZED_STORAGE_KEY = "agent-office.collapsed-panels.v1";

function readMinimizedPanels(storage, availablePanels) {
  try {
    const saved = JSON.parse(storage.getItem(MINIMIZED_STORAGE_KEY));
    if (!Array.isArray(saved)) return new Set();
    return new Set(saved.filter((panelId) => availablePanels.has(panelId)));
  } catch {
    return new Set();
  }
}

function panelId(panel, index) {
  if (panel.dataset.panelId) return panel.dataset.panelId;
  const classId = [...panel.classList].find((name) => name !== "panel" && name.endsWith("-panel"));
  const headingId = panel.querySelector(":scope > .panel-header h2")?.id;
  const id = classId || headingId || `panel-${index + 1}`;
  panel.dataset.panelId = id;
  return id;
}

function writeMinimizedPanels(storage, panels) {
  try {
    const minimized = panels
      .filter((panel) => panel.classList.contains("is-minimized"))
      .map((panel) => panel.dataset.panelId);
    storage.setItem(MINIMIZED_STORAGE_KEY, JSON.stringify(minimized));
  } catch {
    // Collapsing should keep working when storage is unavailable or full.
  }
}

function updateButton(button, minimized) {
  const panelName = button.dataset.panelName || "panel";
  const action = minimized ? "Expand" : "Collapse";
  button.setAttribute("aria-expanded", String(!minimized));
  button.setAttribute("aria-label", `${action} ${panelName}`);
  button.title = `${action} ${panelName}`;
  button.querySelector(".panel-toggle-symbol").textContent = minimized ? "+" : "−";
}

function createButton(header) {
  const heading = header.querySelector("h2")?.textContent?.trim() || "panel";
  let actions = header.querySelector(":scope > .panel-header-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "panel-header-actions";
    [...header.children].slice(1).forEach((node) => actions.append(node));
    header.append(actions);
  }
  const button = document.createElement("button");
  button.className = "panel-collapse-button";
  button.type = "button";
  button.dataset.panelToggle = "";
  button.dataset.panelName = heading;
  button.innerHTML = '<span class="panel-toggle-symbol" aria-hidden="true">−</span>';
  actions.append(button);
  return button;
}

function initPanelMinimizing({ storage = window.localStorage, onChange = () => {} } = {}) {
  const panels = [...document.querySelectorAll(".panel")]
    .filter((panel) => panel.querySelector(":scope > .panel-header"));
  const availablePanels = new Set(panels.map(panelId));
  const minimizedPanels = readMinimizedPanels(storage, availablePanels);

  panels.forEach((panel) => {
    const header = panel.querySelector(":scope > .panel-header");
    const button = header.querySelector("[data-panel-toggle]") || createButton(header);
    const minimized = minimizedPanels.has(panel.dataset.panelId);
    panel.classList.toggle("is-minimized", minimized);
    updateButton(button, minimized);
    button.addEventListener("click", () => {
      const nextMinimized = panel.classList.toggle("is-minimized");
      updateButton(button, nextMinimized);
      writeMinimizedPanels(storage, panels);
      onChange(panel, nextMinimized);
    });
  });
  onChange();
  return { panels };
}

export { MINIMIZED_STORAGE_KEY, initPanelMinimizing, readMinimizedPanels };
