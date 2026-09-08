import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUiStateStore } from "../lib/ui-state.js";

test("skill files can be enabled, disabled, and deleted from presets", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-office-skills-"));
  const store = createUiStateStore(path.join(directory, "state.sqlite"));
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const content = "---\nname: release-check\ndescription: Verify a release.\n---\n\n# Release check\n";
  const created = store.createSkill({ name: "release-check", content }).skill;
  assert.equal(created.selected, false);
  assert.equal(store.setSelectedSkills([created.id])[0].selected, true);
  const activeBeforeDelete = store.getRigConfigurations().configurations.find((configuration) => configuration.selected);
  assert.deepEqual(activeBeforeDelete.skillIds, [created.id]);
  store.deleteSkill(created.id);
  assert.equal(store.getSkills().length, 0);
  const activeAfterDelete = store.getRigConfigurations().configurations.find((configuration) => configuration.selected);
  assert.deepEqual(activeAfterDelete.skillIds, []);
});
