const STORAGE_KEY = "agent-office.panel-widths.v1";
const DEFAULT_PANEL_RATIO = 0.627;
const MIN_LEFT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 320;

function normalizePanelRatio(value, fallback = DEFAULT_PANEL_RATIO) {
  return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
}

function readPanelRatio(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return normalizePanelRatio(saved?.main);
  } catch {
    return DEFAULT_PANEL_RATIO;
  }
}

function writePanelRatio(storage, ratio) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ main: ratio }));
  } catch {
    // Resizing should continue when storage is unavailable or full.
  }
}

function clampPanelWidth(width, availableWidth, minLeft = MIN_LEFT_WIDTH, minRight = MIN_RIGHT_WIDTH) {
  const safeAvailable = Math.max(1, availableWidth);
  const safeMinimum = Math.min(minLeft, Math.max(0, safeAvailable - minRight));
  const safeMaximum = Math.max(safeMinimum, safeAvailable - Math.min(minRight, safeAvailable / 2));
  return Math.max(safeMinimum, Math.min(safeMaximum, width));
}

function initPanelResizing({
  storage = window.localStorage,
  container = document.querySelector(".main-content"),
  resizer = document.querySelector("#main-panel-resizer"),
} = {}) {
  if (!container || !resizer) return null;

  let ratio = readPanelRatio(storage);
  let dragging = false;

  function dimensions() {
    const handleWidth = resizer.getBoundingClientRect().width || 10;
    return { bounds: container.getBoundingClientRect(), available: Math.max(1, container.clientWidth - handleWidth) };
  }

  function apply(nextRatio = ratio) {
    ratio = normalizePanelRatio(nextRatio, ratio);
    const compact = window.matchMedia("(max-width: 1100px)").matches;
    resizer.setAttribute("aria-disabled", String(compact));
    if (compact) {
      container.style.removeProperty("--main-left-width");
      return;
    }
    const { available } = dimensions();
    const width = clampPanelWidth(available * ratio, available);
    ratio = width / available;
    container.style.setProperty("--main-left-width", `${Math.round(width)}px`);
    resizer.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }

  function resizeAt(clientX) {
    const { bounds, available } = dimensions();
    const width = clampPanelWidth(clientX - bounds.left, available);
    apply(width / available);
  }

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || resizer.getAttribute("aria-disabled") === "true") return;
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("is-dragging");
    document.body.classList.add("is-resizing-panels");
    resizeAt(event.clientX);
    event.preventDefault();
  });
  resizer.addEventListener("pointermove", (event) => {
    if (!dragging || !resizer.hasPointerCapture(event.pointerId)) return;
    resizeAt(event.clientX);
  });
  function finish(event) {
    if (!dragging) return;
    if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    dragging = false;
    resizer.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing-panels");
    writePanelRatio(storage, ratio);
  }
  resizer.addEventListener("pointerup", finish);
  resizer.addEventListener("pointercancel", finish);
  resizer.addEventListener("keydown", (event) => {
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!direction || resizer.getAttribute("aria-disabled") === "true") return;
    const { available } = dimensions();
    const step = event.shiftKey ? 48 : 16;
    apply((available * ratio + direction * step) / available);
    writePanelRatio(storage, ratio);
    event.preventDefault();
  });
  resizer.addEventListener("dblclick", () => {
    ratio = DEFAULT_PANEL_RATIO;
    apply();
    writePanelRatio(storage, ratio);
  });
  window.addEventListener("resize", () => apply());
  apply();
  return { refresh: apply };
}

export { DEFAULT_PANEL_RATIO, MIN_LEFT_WIDTH, MIN_RIGHT_WIDTH, STORAGE_KEY, clampPanelWidth, initPanelResizing, normalizePanelRatio, readPanelRatio };
