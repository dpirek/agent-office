import assert from "node:assert/strict";
import test from "node:test";
import { MINIMIZED_STORAGE_KEY, readMinimizedPanels } from "../public/lib/panel-minimize.mjs";

test("collapsed panel state restores only known stable panel ids", () => {
  const storage = {
    getItem(key) {
      assert.equal(key, MINIMIZED_STORAGE_KEY);
      return JSON.stringify(["office-panel", "unknown-panel", "task-panel"]);
    },
  };
  const restored = readMinimizedPanels(storage, new Set(["office-panel", "task-panel"]));
  assert.deepEqual([...restored], ["office-panel", "task-panel"]);
});

test("invalid collapsed panel state is ignored", () => {
  const storage = { getItem: () => "not-json" };
  assert.deepEqual([...readMinimizedPanels(storage, new Set(["office-panel"]))], []);
});
