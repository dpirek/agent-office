const MINIMIZED_STORAGE_KEY = "agent-worker.minimized-panels.v1";

function readMinimizedPanels(storage, availablePanels) {
  try {
    const saved = JSON.parse(storage.getItem(MINIMIZED_STORAGE_KEY));
    if (!Array.isArray(saved)) return new Set();
    return new Set(saved.filter((panelName) => availablePanels.has(panelName)));
  } catch {
    return new Set();
  }
}

function writeMinimizedPanels(storage, panels) {
  try {
    const minimized = panels.filter((panel) => panel.classList.contains("is-minimized")).map((panel) => panel.localName);
    storage.setItem(MINIMIZED_STORAGE_KEY, JSON.stringify(minimized));
  } catch {
    // Panel controls should keep working when storage is unavailable or full.
  }
}

function updateButton(button, minimized) {
  const panelName = button.dataset.panelName || "panel";
  const action = minimized ? "Maximize" : "Minimize";
  button.setAttribute("aria-expanded", String(!minimized));
  button.setAttribute("aria-label", `${action} ${panelName}`);
  button.title = `${action} ${panelName}`;
  button.querySelector(".panel-toggle-symbol").textContent = minimized ? "+" : "−";
}

function initPanelMinimizing({ storage = window.localStorage, onChange = () => {} } = {}) {
  const panels = [...document.querySelectorAll(".panel")].filter((panel) => panel.querySelector("[data-panel-toggle]"));
  const availablePanels = new Set(panels.map((panel) => panel.localName));
  const minimizedPanels = readMinimizedPanels(storage, availablePanels);

  panels.forEach((panel) => {
    const button = panel.querySelector("[data-panel-toggle]");
    const minimized = minimizedPanels.has(panel.localName);
    panel.classList.toggle("is-minimized", minimized);
    updateButton(button, minimized);
    button.addEventListener("click", () => {
      const nextMinimized = panel.classList.toggle("is-minimized");
      updateButton(button, nextMinimized);
      writeMinimizedPanels(storage, panels);
      onChange();
    });
  });
}

export { MINIMIZED_STORAGE_KEY, initPanelMinimizing, readMinimizedPanels };
