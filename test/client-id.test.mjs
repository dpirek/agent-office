import assert from "node:assert/strict";
import test from "node:test";
import { createClientId } from "../public/lib/client-id.mjs";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("client ids use native randomUUID when available", () => {
  const expected = "11111111-1111-4111-8111-111111111111";
  assert.equal(createClientId({ randomUUID: () => expected }), expected);
});

test("client ids work on HTTP when randomUUID is unavailable", () => {
  const cryptoWithoutRandomUUID = {
    getRandomValues(bytes) {
      bytes.forEach((_value, index) => { bytes[index] = index; });
      return bytes;
    },
  };
  assert.match(createClientId(cryptoWithoutRandomUUID), UUID_V4);
});

test("client ids retain a legacy-browser fallback", () => {
  assert.match(createClientId(null, () => 0.5), UUID_V4);
});
