import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueMention } from "../public/lib/mentions.mjs";

test("chat member mentions are only added once per user", () => {
  assert.equal(appendUniqueMention("", "office-manager"), "@office-manager ");
  assert.equal(
    appendUniqueMention("@office-manager Please review", "office-manager"),
    "@office-manager Please review",
  );
  assert.equal(
    appendUniqueMention("Ask @builder, then", "builder"),
    "Ask @builder, then",
  );
  assert.equal(
    appendUniqueMention("@office-managerial", "office-manager"),
    "@office-managerial @office-manager ",
  );
  assert.equal(
    appendUniqueMention("@office-manager ", "builder"),
    "@office-manager @builder ",
  );
});
