import assert from "node:assert/strict";
import test from "node:test";
import { createOfficeWebSocketUrl, normalizeOfficeWebSocketUrl } from "../public/lib/websocket-url.mjs";
import { createSettingsApiHandlers } from "../api/settings.js";

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

test("separate endpoint overrides the page host and legacy protocol setting", () => {
  const location = { protocol: "https:", host: "office.yourdomain.com" };
  for (const [configuredUrl, expected] of [
    [" http://office-server.yourdomain.com ", "ws://office-server.yourdomain.com/ws"],
    ["https://office-server.yourdomain.com/", "wss://office-server.yourdomain.com/ws"],
    ["ws://localhost:8005", "ws://localhost:8005/ws"],
    ["wss://socket.example.com/custom/ws?tenant=office", "wss://socket.example.com/custom/ws?tenant=office"],
    ["http://[::1]:8005/ws", "ws://[::1]:8005/ws"],
  ]) {
    assert.equal(createOfficeWebSocketUrl(location, { configuredUrl, allowInsecure: true }), expected);
  }
  assert.equal(createOfficeWebSocketUrl(location, { configuredUrl: "  " }), "wss://office.yourdomain.com/ws");
});

test("invalid endpoint settings fail without exposing configured credentials", () => {
  for (const value of ["socket.example.com", "/ws", "ftp://socket.example.com", "ws://user:secret@socket.example.com", "ws://socket.example.com/ws#fragment"]) {
    assert.throws(() => normalizeOfficeWebSocketUrl(value), (error) => {
      assert.match(error.message, /AI_HARNESS_WEBSOCKET_URL/);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
});

test("health endpoint delivers the configured URL to the dashboard resolver", async () => {
  const webSocketUrl = normalizeOfficeWebSocketUrl("http://office-server.yourdomain.com");
  const handlers = createSettingsApiHandlers({
    uiStateStore: { getSelectedProvider: () => ({}) }, webSocketUrl,
  });
  const res = {
    status: null, body: "",
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  await handlers["/api/health"]({ method: "GET" }, res);
  assert.equal(res.status, 200);
  const health = JSON.parse(res.body);
  assert.equal(createOfficeWebSocketUrl({ protocol: "https:", host: "office.yourdomain.com" }, {
    configuredUrl: health.webSocketUrl,
  }), "ws://office-server.yourdomain.com/ws");
});
