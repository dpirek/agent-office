import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  isPathWithin,
  resolveOfficeWorkspaceRoot,
  resolveSharedWorkspaceRoot,
} from "../lib/workspace-roots.js";

test("office files default to the app .workspace directory", () => {
  const appRoot = path.resolve("/srv/agent-office");
  const workspace = resolveOfficeWorkspaceRoot({ cwd: appRoot, configuredWorkspace: "" });

  assert.equal(workspace, path.join(appRoot, ".workspace"));
  assert.equal(
    resolveSharedWorkspaceRoot({ officeWorkspaceRoot: workspace, configuredSharedWorkspace: "" }),
    path.join(appRoot, ".workspace", "deliverables"),
  );
});

test("explicit workspace locations remain supported", () => {
  const workspace = resolveOfficeWorkspaceRoot({
    cwd: "/srv/agent-office",
    configuredWorkspace: " /data/office-work ",
  });

  assert.equal(workspace, path.resolve("/data/office-work"));
  assert.equal(resolveSharedWorkspaceRoot({
    officeWorkspaceRoot: workspace,
    configuredSharedWorkspace: " /data/deliveries ",
  }), path.resolve("/data/deliveries"));
});

test("workspace containment rejects parent and sibling paths", () => {
  const root = path.resolve("/srv/agent-office/.workspace");

  assert.equal(isPathWithin(root, root), true);
  assert.equal(isPathWithin(root, path.join(root, "project-a")), true);
  assert.equal(isPathWithin(root, path.resolve(root, "..")), false);
  assert.equal(isPathWithin(root, `${root}-other`), false);
});
