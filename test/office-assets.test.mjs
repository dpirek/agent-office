import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDirectory = path.join(root, "public", "assets", "office");
const spriteNames = [
  "manager", "researcher", "developer", "designer",
  "qa-tester", "deployment-engineer", "analyst", "support-agent",
];

test("agent office has an opaque background and eight RGBA worker desk sprites", () => {
  const background = fs.readFileSync(path.join(assetDirectory, "background.png"));
  assert.equal(background.toString("ascii", 1, 4), "PNG");
  assert.equal(background[25], 2, "office background should be RGB");
  for (const name of spriteNames) {
    const sprite = fs.readFileSync(path.join(assetDirectory, `${name}.png`));
    assert.equal(sprite.toString("ascii", 1, 4), "PNG");
    assert.equal(sprite[25], 6, `${name} should have an alpha channel`);
  }
});
