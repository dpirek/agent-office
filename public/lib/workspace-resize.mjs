const STORAGE_KEY = "agent-office.workspace-tree-width.v1";

export function initWorkspaceResizing() {
  const container = document.querySelector(".workspace-explorer");
  const divider = document.querySelector("#workspace-tree-resizer");
  if (!container || !divider) return;
  let preferredWidth = null;
  let pointer = null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= 180) preferredWidth = saved;
  } catch { /* Keep the default width when storage is unavailable. */ }

  function limits() {
    const available = container.clientWidth - divider.offsetWidth;
    return { minimum: Math.min(180, available / 2), maximum: Math.max(180, available - 260) };
  }
  function apply() {
    const compact = window.matchMedia("(max-width: 700px)").matches;
    divider.setAttribute("aria-disabled", String(compact));
    divider.tabIndex = compact ? -1 : 0;
    if (compact || !container.clientWidth) return;
    const { minimum, maximum } = limits();
    const width = Math.round(Math.max(minimum, Math.min(maximum, preferredWidth ?? container.clientWidth * .26)));
    container.style.setProperty("--workspace-tree-width", `${width}px`);
    divider.setAttribute("aria-valuemin", String(Math.round(minimum)));
    divider.setAttribute("aria-valuemax", String(Math.round(maximum)));
    divider.setAttribute("aria-valuenow", String(width));
    divider.setAttribute("aria-valuetext", `${width} pixels`);
  }
  function save() {
    try {
      if (preferredWidth === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferredWidth));
    } catch { /* Dragging still works when storage is unavailable. */ }
  }
  function setWidth(width) {
    const { minimum, maximum } = limits();
    preferredWidth = Math.round(Math.max(minimum, Math.min(maximum, width)));
    apply();
  }
  function finish() {
    if (pointer === null) return;
    const id = pointer;
    pointer = null;
    if (divider.hasPointerCapture(id)) divider.releasePointerCapture(id);
    container.classList.remove("is-resizing-workspace");
    save();
  }
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || divider.getAttribute("aria-disabled") === "true") return;
    pointer = event.pointerId;
    divider.setPointerCapture(pointer);
    container.classList.add("is-resizing-workspace");
    divider.focus();
    event.preventDefault();
  });
  divider.addEventListener("pointermove", (event) => {
    if (pointer !== event.pointerId) return;
    setWidth(event.clientX - container.getBoundingClientRect().left - divider.offsetWidth / 2);
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) divider.addEventListener(event, finish);
  divider.addEventListener("keydown", (event) => {
    if (divider.getAttribute("aria-disabled") === "true") return;
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!direction) return;
    setWidth(Number(divider.getAttribute("aria-valuenow")) + direction * (event.shiftKey ? 48 : 16));
    save();
    event.preventDefault();
  });
  divider.addEventListener("dblclick", () => { preferredWidth = null; apply(); save(); });
  new ResizeObserver(() => {
    if (pointer !== null && (window.matchMedia("(max-width: 700px)").matches || !container.clientWidth)) finish();
    apply();
  }).observe(container);
  apply();
}
