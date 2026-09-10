import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

test("relative configured paths resolve from the supplied application root", () => {
  const workspace = resolveOfficeWorkspaceRoot({
    cwd: "/srv/agent-office", configuredWorkspace: " work ",
  });
  assert.equal(workspace, "/srv/agent-office/work");
  assert.equal(resolveSharedWorkspaceRoot({
    cwd: "/srv/agent-office", officeWorkspaceRoot: workspace,
    configuredSharedWorkspace: " deliveries ",
  }), "/srv/agent-office/deliveries");
});

test("launching Node outside the source directory does not change workspace roots", () => {
  const moduleUrl = new URL("../lib/workspace-roots.js", import.meta.url).href;
  const appRoot = fileURLToPath(new URL("../", import.meta.url));
  const script = `
    import { resolveOfficeWorkspaceRoot, resolveSharedWorkspaceRoot } from ${JSON.stringify(moduleUrl)};
    const workspace = resolveOfficeWorkspaceRoot({ configuredWorkspace: '' });
    console.log(JSON.stringify({
      workspace,
      shared: resolveSharedWorkspaceRoot({ officeWorkspaceRoot: workspace, configuredSharedWorkspace: '' }),
      configured: resolveOfficeWorkspaceRoot({ configuredWorkspace: './custom' }),
      configuredShared: resolveSharedWorkspaceRoot({ officeWorkspaceRoot: workspace, configuredSharedWorkspace: './deliveries' }),
    }));
  `;
  const expected = {
    workspace: path.join(appRoot, ".workspace"),
    shared: path.join(appRoot, ".workspace/deliverables"),
    configured: path.join(appRoot, "custom"),
    configuredShared: path.join(appRoot, "deliveries"),
  };
  for (const cwd of [appRoot, path.dirname(appRoot), path.parse(appRoot).root]) {
    assert.deepEqual(JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd, encoding: "utf8",
    })), expected);
  }
});

test("workspace containment rejects parent and sibling paths", () => {
  const root = path.resolve("/srv/agent-office/.workspace");

  assert.equal(isPathWithin(root, root), true);
  assert.equal(isPathWithin(root, path.join(root, "project-a")), true);
  assert.equal(isPathWithin(root, path.resolve(root, "..")), false);
  assert.equal(isPathWithin(root, `${root}-other`), false);
});
