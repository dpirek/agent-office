import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";
import { createOfficeMemoryTool } from "../lib/tools/office-memory.js";

test("office memory persists outcomes and is readable by the manager tool", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-memory-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  store.recordOfficeMemory({
    kind: "task",
    status: "failed",
    title: "Deploy preview",
    summary: "Deployment credentials were unavailable.",
    agent: "Release Worker",
    sourceId: "task-123",
    details: { retryable: true },
  });
  store.recordOfficeMemory({
    kind: "task",
    status: "completed",
    title: "Build report",
    summary: "Report generated.",
    artifacts: [{ name: "report.zip", uri: "https://worker.example/report.zip" }],
  });
  const failed = store.getOfficeMemory({ status: "failed", query: "credentials" });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].details.retryable, true);
  const tool = createOfficeMemoryTool({ uiStateStore: store });
  const result = await tool.execute({ query: "report", limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.records[0].artifacts[0].name, "report.zip");
});
