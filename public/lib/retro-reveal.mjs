const HEADING_STEP_MS = 72;
const TEXT_STEP_MS = 9;
const START_DELAY_MS = 100;
const PHASE_GAP_MS = 160;
const LINE_GAP_MS = 24;
const LANE_SELECTOR = "agent-console-header, testing-repl, recent-tasks-panel, agent-info-panel, worker-logs-panel";

function isInsideVisibleArea(element) {
  const rect = element.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const ancestorRect = ancestor.getBoundingClientRect();
    if (clipsX && (rect.right <= ancestorRect.left || rect.left >= ancestorRect.right)) return false;
    if (clipsY && (rect.bottom <= ancestorRect.top || rect.top >= ancestorRect.bottom)) return false;
  }
  return true;
}

function visibleTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.data.trim() || !parent || parent.closest("script, style, textarea, button, .panel-head, #health-text, [hidden], dialog:not([open])")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.offsetParent === null || !isInsideVisibleArea(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function wrapTextNode(node) {
  const slow = Boolean(node.parentElement.closest("h1"));
  const lane = node.parentElement.closest(LANE_SELECTOR) || document.body;
  const wrapper = document.createElement("span");
  wrapper.className = `retro-text${slow ? " retro-text-slow" : ""}`;
  const characters = [];

  [...node.data].forEach((character) => {
    const letter = document.createElement("span");
    letter.className = "retro-char";
    letter.textContent = character;
    wrapper.append(letter);
    characters.push(letter);
  });
  node.replaceWith(wrapper);
  return { wrapper, characters, lane, slow };
}

function scheduleTitle(items) {
  const characters = items.filter((item) => item.slow).flatMap((item) => item.characters);
  characters.forEach((letter, index) => letter.style.setProperty("--retro-delay", `${START_DELAY_MS + index * HEADING_STEP_MS}ms`));
  return characters.length ? START_DELAY_MS + (characters.length - 1) * HEADING_STEP_MS : START_DELAY_MS - PHASE_GAP_MS;
}

function visualLines(items) {
  const lines = new Map();
  items.flatMap((item) => item.characters).forEach((letter, order) => {
    const rect = letter.getBoundingClientRect();
    const top = Math.round(rect.top);
    if (!lines.has(top)) lines.set(top, []);
    lines.get(top).push({ letter, left: rect.left, order });
  });
  return [...lines.entries()]
    .sort(([topA], [topB]) => topA - topB)
    .map(([, characters]) => characters.sort((a, b) => a.left - b.left || a.order - b.order).map(({ letter }) => letter));
}

function scheduleLane(items, startDelay) {
  let lineStart = startDelay;
  visualLines(items).forEach((line) => {
    line.forEach((letter, index) => letter.style.setProperty("--retro-delay", `${lineStart + index * TEXT_STEP_MS}ms`));
    lineStart += Math.max(line.length - 1, 0) * TEXT_STEP_MS + LINE_GAP_MS;
  });
  return lineStart;
}

function scheduleReveal(items) {
  const restStart = scheduleTitle(items) + PHASE_GAP_MS;
  const lanes = new Map();
  items.filter((item) => !item.slow).forEach((item) => {
    if (!lanes.has(item.lane)) lanes.set(item.lane, []);
    lanes.get(item.lane).push(item);
  });
  return [...lanes.values()].reduce((finalDelay, laneItems) => Math.max(finalDelay, scheduleLane(laneItems, restStart)), restStart);
}

async function revealInitialText(root = document.body) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.body.classList.remove("retro-pending");
    return;
  }

  const wrapped = visibleTextNodes(root).map(wrapTextNode);
  const finalDelay = scheduleReveal(wrapped);
  document.body.classList.add("is-retro-loading");
  document.body.classList.remove("retro-pending");

  await new Promise((resolve) => setTimeout(resolve, finalDelay + 80));
  wrapped.forEach(({ wrapper }) => {
    if (wrapper.isConnected) wrapper.replaceWith(document.createTextNode(wrapper.textContent));
  });
  document.body.classList.remove("is-retro-loading");
}

export { HEADING_STEP_MS, LINE_GAP_MS, PHASE_GAP_MS, TEXT_STEP_MS, revealInitialText, visibleTextNodes };
