import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeWebSocketUrl } from "../public/lib/websocket-url.mjs";

test("office websocket follows the page security by default", () => {
  assert.equal(
    createOfficeWebSocketUrl({ protocol: "https:", host: "office.example.com" }),
    "wss://office.example.com/ws",
  );
  assert.equal(
    createOfficeWebSocketUrl({ protocol: "http:", host: "127.0.0.1:8005" }),
    "ws://127.0.0.1:8005/ws",
  );
});

test("office websocket permits an explicit insecure connection", () => {
  assert.equal(
    createOfficeWebSocketUrl(
      { protocol: "https:", host: "office.example.com" },
      { allowInsecure: true },
    ),
    "ws://office.example.com/ws",
  );
});
