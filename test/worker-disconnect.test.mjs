import { Writable } from "node:stream";
import { closeSocket, sendJson, writeSocket } from "../lib/ws.js";
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


class HalfClosedSocket extends Writable {
  constructor() {
    super({ autoDestroy: false });
    this.writes = [];
  }
  _write(chunk, _encoding, callback) { this.writes.push(Buffer.from(chunk)); callback(); }
}

const clientCloseFrame = Buffer.from([0x88, 0x80, 1, 2, 3, 4]);
const clientPingFrame = Buffer.from([0x89, 0x80, 1, 2, 3, 4]);

test("closeSocket is idempotent while writableEnded is true and destroyed is false", async () => {
  const socket = new HalfClosedSocket();
  const errors = [];
  socket.on("error", (error) => errors.push(error));
  closeSocket(socket);
  assert.equal(socket.writableEnded, true);
  assert.equal(socket.destroyed, false);
  closeSocket(socket);
  sendJson(socket, { type: "late" });
  writeSocket(socket, Buffer.from([0x89, 0]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.writes.length, 1);
  assert.equal(socket.writes[0][0], 0x88);
  assert.deepEqual(errors, []);
  socket.destroy();
});

test("repeated worker close frames and late pings never write after end", async () => {
  const manager = new SubAgentManager();
  const socket = new HalfClosedSocket();
  const errors = [];
  socket.on("error", (error) => errors.push(error));
  register(socket, createWorkerWebSocketHandler({ subAgentManager: manager, getToken: () => "a".repeat(32) }));
  socket.emit("data", clientCloseFrame);
  const count = socket.writes.length;
  socket.emit("data", clientCloseFrame);
  socket.emit("data", clientPingFrame);
  socket.emit("data", clientTextFrame({ type: "ping" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.writes.length, count);
  assert.deepEqual(errors, []);
  assert.equal(manager.listWorkers().length, 0);
  socket.destroy();
});

test("a task update finishing after worker closure does not send an acknowledgement", async () => {
  const manager = new SubAgentManager();
  let finish;
  manager.receiveUpdate = () => new Promise((resolve) => { finish = resolve; });
  const socket = new HalfClosedSocket();
  const errors = [];
  socket.on("error", (error) => errors.push(error));
  register(socket, createWorkerWebSocketHandler({ subAgentManager: manager, getToken: () => "a".repeat(32) }));
  socket.emit("data", clientTextFrame({ type: "task_update" }));
  assert.equal(typeof finish, "function");
  socket.emit("data", clientCloseFrame);
  const count = socket.writes.length;
  finish({ taskId: "task-1", state: "completed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.writes.length, count);
  assert.deepEqual(errors, []);
  socket.destroy();
});
