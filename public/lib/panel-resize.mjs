const STORAGE_KEY = "agent-worker.panel-layout.v1";
const DEFAULT_LAYOUT = Object.freeze({
  dashboard: Object.freeze([0.573, 0.427]),
  rightRail: Object.freeze([0.3725, 0.345, 0.2825]),
});

function normalizedShares(value, length, fallback) {
  if (!Array.isArray(value) || value.length !== length || value.some((part) => !Number.isFinite(part) || part <= 0)) {
    return [...fallback];
  }
  const total = value.reduce((sum, part) => sum + part, 0);
  return value.map((part) => part / total);
}

function readLayout(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return {
      dashboard: normalizedShares(saved?.dashboard, 2, DEFAULT_LAYOUT.dashboard),
      rightRail: normalizedShares(saved?.rightRail, 3, DEFAULT_LAYOUT.rightRail),
    };
  } catch {
    return {
      dashboard: [...DEFAULT_LAYOUT.dashboard],
      rightRail: [...DEFAULT_LAYOUT.rightRail],
    };
  }
}

function writeLayout(storage, layout) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Resizing should continue when storage is unavailable or full.
  }
}

function setTrackShares(layout) {
  const vertical = layout.axis() === "y";
  const minimized = layout.panels.map((panel) => vertical && panel.classList.contains("is-minimized"));
  const activeTotal = layout.shares.reduce((total, share, index) => total + (minimized[index] ? 0 : share), 0);
  layout.shares.forEach((share, index) => {
    const panel = layout.panels[index];
    const panelStyle = getComputedStyle(panel);
    const headerHeight = panel.querySelector(".panel-head")?.getBoundingClientRect().height || 58;
    const borderHeight = Number.parseFloat(panelStyle.borderTopWidth) + Number.parseFloat(panelStyle.borderBottomWidth);
    const trackSize = minimized[index] ? `${headerHeight + borderHeight}px` : `${share / activeTotal}fr`;
    layout.container.style.setProperty(`--${layout.prefix}-${index + 1}`, trackSize);
  });
}

function initPanelResizing({ storage = window.localStorage } = {}) {
  const dashboard = document.querySelector(".dashboard");
  const rightRail = document.querySelector(".right-rail");
  if (!dashboard || !rightRail) return;

  const layouts = {
    dashboard: {
      container: dashboard,
      panels: [dashboard.querySelector("testing-repl"), rightRail],
      prefix: "dashboard-track",
      shares: null,
      defaults: DEFAULT_LAYOUT.dashboard,
      axis: () => window.innerWidth <= 760 ? "y" : "x",
      minSize: 180,
    },
    "right-rail": {
      container: rightRail,
      panels: [
        rightRail.querySelector("recent-tasks-panel"),
        rightRail.querySelector("agent-info-panel"),
        rightRail.querySelector("worker-logs-panel"),
      ],
      prefix: "right-track",
      shares: null,
      defaults: DEFAULT_LAYOUT.rightRail,
      axis: () => window.innerWidth > 640 && window.innerWidth <= 760 ? "x" : "y",
      minSize: 72,
    },
  };
  const saved = readLayout(storage);
  layouts.dashboard.shares = saved.dashboard;
  layouts["right-rail"].shares = saved.rightRail;

  function applyLayout(layout) {
    setTrackShares(layout);
  }

  function save() {
    writeLayout(storage, {
      dashboard: layouts.dashboard.shares,
      rightRail: layouts["right-rail"].shares,
    });
  }

  function updateSeparator(resizer, layout) {
    const axis = layout.axis();
    const boundary = Number(resizer.dataset.index);
    const position = layout.shares.slice(0, boundary + 1).reduce((sum, share) => sum + share, 0);
    const disabled = layout.panels[boundary].classList.contains("is-minimized")
      || layout.panels[boundary + 1].classList.contains("is-minimized");
    resizer.dataset.axis = axis;
    resizer.classList.toggle("is-disabled", disabled);
    resizer.setAttribute("aria-disabled", String(disabled));
    resizer.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
    resizer.setAttribute("aria-valuenow", String(Math.round(position * 100)));
  }

  function updateSeparators() {
    document.querySelectorAll("layout-resizer").forEach((resizer) => {
      const layout = layouts[resizer.dataset.layout];
      if (layout) updateSeparator(resizer, layout);
    });
  }

  function refresh() {
    for (const layout of Object.values(layouts)) applyLayout(layout);
    updateSeparators();
  }

  refresh();

  document.querySelectorAll("layout-resizer").forEach((resizer) => {
    const layout = layouts[resizer.dataset.layout];
    const boundary = Number(resizer.dataset.index);
    if (!layout || !Number.isInteger(boundary)) return;
    let drag = null;

    function resizePair(delta) {
      const combinedSize = drag.sizes[boundary] + drag.sizes[boundary + 1];
      const minimum = Math.min(layout.minSize, combinedSize / 3);
      const firstSize = Math.max(minimum, Math.min(combinedSize - minimum, drag.sizes[boundary] + delta));
      const nextShares = [...drag.shares];
      const combinedShare = drag.shares[boundary] + drag.shares[boundary + 1];
      nextShares[boundary] = combinedShare * firstSize / combinedSize;
      nextShares[boundary + 1] = combinedShare - nextShares[boundary];
      layout.shares = nextShares;
      applyLayout(layout);
      updateSeparator(resizer, layout);
    }

    resizer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || resizer.classList.contains("is-disabled")) return;
      const axis = layout.axis();
      drag = {
        axis,
        coordinate: axis === "x" ? event.clientX : event.clientY,
        shares: [...layout.shares],
        sizes: layout.panels.map((panel) => axis === "x" ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height),
      };
      resizer.setPointerCapture(event.pointerId);
      resizer.classList.add("is-dragging");
      document.body.classList.add("is-resizing");
      event.preventDefault();
    });

    resizer.addEventListener("pointermove", (event) => {
      if (!drag || !resizer.hasPointerCapture(event.pointerId)) return;
      const coordinate = drag.axis === "x" ? event.clientX : event.clientY;
      resizePair(coordinate - drag.coordinate);
    });

    function finishDrag(event) {
      if (!drag) return;
      if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      drag = null;
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      save();
    }

    resizer.addEventListener("pointerup", finishDrag);
    resizer.addEventListener("pointercancel", finishDrag);
    resizer.addEventListener("keydown", (event) => {
      if (resizer.classList.contains("is-disabled")) return;
      const axis = layout.axis();
      const direction = axis === "x"
        ? { ArrowLeft: -1, ArrowRight: 1 }[event.key]
        : { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!direction) return;
      const sizes = layout.panels.map((panel) => axis === "x" ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height);
      drag = { axis, coordinate: 0, shares: [...layout.shares], sizes };
      resizePair(direction * (event.shiftKey ? 48 : 16));
      drag = null;
      save();
      event.preventDefault();
    });
    resizer.addEventListener("dblclick", () => {
      if (resizer.classList.contains("is-disabled")) return;
      layout.shares = [...layout.defaults];
      applyLayout(layout);
      updateSeparators();
      save();
    });
  });

  window.addEventListener("resize", refresh);
  return { refresh };
}

export { DEFAULT_LAYOUT, STORAGE_KEY, initPanelResizing, normalizedShares };
