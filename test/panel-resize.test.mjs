import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PANEL_RATIO, STORAGE_KEY, clampPanelWidth, normalizePanelRatio, readPanelRatio } from "../public/lib/panel-resize.mjs";

test("panel width ratio restores from local storage", () => {
  const storage = {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      return JSON.stringify({ main: 0.7 });
    },
  };
  assert.equal(readPanelRatio(storage), 0.7);
});

test("invalid panel width ratios use the default", () => {
  assert.equal(normalizePanelRatio(2), DEFAULT_PANEL_RATIO);
  assert.equal(readPanelRatio({ getItem: () => "not-json" }), DEFAULT_PANEL_RATIO);
});

test("panel widths preserve a usable minimum for both columns", () => {
  assert.equal(clampPanelWidth(100, 1000), 360);
  assert.equal(clampPanelWidth(900, 1000), 680);
  assert.equal(clampPanelWidth(520, 1000), 520);
});
