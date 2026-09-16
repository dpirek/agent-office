import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWebSocketHandler } from '../lib/ws.js';

class Socket extends EventEmitter {
  frames = [];
  write(data) { this.frames.push(data); return true; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
}
function setup(t) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const socket = new Socket();
  const events = [];
  createWebSocketHandler({ normalizeToolPermissions: () => ({}), heartbeatIntervalMs: 100, onConnectionEvent: state => events.push(state) })(socket, { headers: { 'sec-websocket-key': 'test' } });
  t.after(() => socket.destroy());
  return { socket, events };
}
test('browser websocket heartbeat removes a connection after a missed pong', t => {
  const { socket, events } = setup(t);
  t.mock.timers.tick(100);
  assert.deepEqual(socket.frames.at(-1), Buffer.from([0x89, 0]));
  t.mock.timers.tick(100);
  assert.equal(socket.destroyed, true);
  assert.deepEqual(events, ['connected', 'disconnected']);
});
test('browser pong keeps a tab online, and stream end immediately disconnects it', t => {
  const { socket, events } = setup(t);
  t.mock.timers.tick(100);
  socket.emit('data', Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));
  t.mock.timers.tick(100);
  assert.notEqual(socket.destroyed, true);
  socket.emit('end');
  assert.equal(socket.destroyed, true);
  assert.deepEqual(events, ['connected', 'disconnected']);
  const frameCount = socket.frames.length;
  t.mock.timers.tick(500);
  assert.equal(socket.frames.length, frameCount);
});
