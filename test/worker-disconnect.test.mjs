import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { SubAgentManager } from "../lib/sub-agents.js";
import { createWorkerWebSocketHandler } from "../lib/worker-ws.js";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writes = [];
  }

  write(value) {
    this.writes.push(value);
    return true;
  }

  end() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }

  destroy() {
    this.end();
  }
}

function clientTextFrame(value) {
  const data = Buffer.from(JSON.stringify(value));
  const mask = Buffer.from([1, 2, 3, 4]);
  const length = data.length < 126
    ? Buffer.from([0x81, 0x80 | data.length])
    : Buffer.from([0x81, 0xfe, data.length >> 8, data.length & 0xff]);
  const masked = Buffer.from(data.map((byte, index) => byte ^ mask[index % 4]));
  return Buffer.concat([length, mask, masked]);
}

function register(socket, handler) {
  handler(socket, {
    headers: {
      authorization: `Bearer ${"a".repeat(32)}`,
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  });
  socket.emit("data", clientTextFrame({
    type: "register",
    credentials: { token: "a".repeat(32) },
    worker: {
      name: "Disconnect Test Worker",
      url: "ws://127.0.0.1:8099/ws/workers",
      capabilities: { skills: [], tools: [], mcp: false, workspaceArtifacts: false },
    },
  }));
}

test("socket end immediately removes a connected worker", () => {
  const disconnected = [];
  const manager = new SubAgentManager({ onWorkerDisconnected: (worker) => disconnected.push(worker) });
  const handler = createWorkerWebSocketHandler({ subAgentManager: manager, getToken: () => "a".repeat(32) });
  const socket = new FakeSocket();
  register(socket, handler);
  assert.equal(manager.listWorkers().length, 1);

  socket.emit("end");
  assert.equal(manager.listWorkers().length, 0);
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].status, "offline");
});

test("an unresponsive worker is removed after a missed heartbeat", async () => {
  const manager = new SubAgentManager();
  const handler = createWorkerWebSocketHandler({
    subAgentManager: manager,
    getToken: () => "a".repeat(32),
    heartbeatIntervalMs: 10,
  });
  const socket = new FakeSocket();
  register(socket, handler);
  assert.equal(manager.listWorkers().length, 1);

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(manager.listWorkers().length, 0);
  assert.equal(socket.destroyed, true);
});
