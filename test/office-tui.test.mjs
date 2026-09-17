import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { stripVTControlCharacters } from 'node:util';
import { officePixels } from '../lib/office-tui-art.js';
import { renderOfficeTui, startOfficeTui, tuiRequested } from '../lib/office-tui.js';

const snapshot = {
  url: 'http://localhost:8010', startedAt: 1000, projectCount: 2, peopleCount: 1, managerBusy: true,
  workers: [{ name: 'Builder', status: 'connected', model: { name: 'Local model' } }, { name: 'Reviewer', status: 'offline' }],
  tasks: [{ title: 'Deliver app', status: 'running', agent: 'Builder', projectId: 'alpha' }],
  logs: [{ createdAt: 2000, source: 'HTTP', category: 'network', message: 'POST /api/tasks 201' }],
};

test('TUI flag supports direct CLI and npm forwarding without changing default startup', () => {
  assert.equal(tuiRequested([], {}), false);
  assert.equal(tuiRequested(['--tui'], {}), true);
  assert.equal(tuiRequested([], { npm_config_tui: 'true' }), true);
  assert.equal(tuiRequested([], { npm_config_tui: 'false' }), false);
});

test('views show office data, scroll, fit small terminals and strip injected terminal controls', () => {
  const overview = renderOfficeTui(snapshot, { columns: 110, rows: 30, now: 61_000 }).lines.join('\n');
  for (const text of ['WORKING', '1 online / 2', 'Deliver app', 'POST /api/tasks', '1m 0s']) assert.ok(overview.includes(text));
  assert.match(renderOfficeTui(snapshot, { view: 1 }).lines.join('\n'), /Local model/);
  const logs = Array.from({ length: 50 }, (_, i) => ({ createdAt: i, source: 'HTTP', message: `entry-${i}` }));
  const last = renderOfficeTui({ ...snapshot, logs }, { view: 3, rows: 12, offset: 999 });
  assert.ok(last.maxOffset > 0);
  assert.match(last.lines.join('\n'), /entry-0 /);
  const injected = { ...snapshot, logs: [{ source: 'remote', message: '\x1b[2J\x1b]52;c;secret\x07hello\rINJECT' }] };
  for (const [columns, rows] of [[100, 30], [32, 8], [10, 2]]) {
    const frame = renderOfficeTui(injected, { columns, rows, view: 3 });
    assert.equal(frame.lines.length, rows);
    assert.ok(frame.lines.every(line => line.length <= columns - 1));
    assert.doesNotMatch(frame.lines.join(''), /[\x00-\x1f\x7f]/);
  }
});

test('pixel office fits the terminal, reflects live desk status and falls back on small screens', () => {
  for (const [columns, rows] of [[120, 40], [80, 24], [39, 20], [32, 8], [10, 2]]) {
    const frame = renderOfficeTui(snapshot, { view: 4, columns, rows });
    assert.equal(frame.lines.length, rows);
    assert.ok(frame.lines.every(line => stripVTControlCharacters(line).length === columns - 1));
    if (columns >= 39 && rows >= 20) {
      assert.match(frame.lines.join(''), /\x1b\[38;2;/);
      assert.match(frame.lines.join(''), /▀/);
      assert.equal(frame.maxOffset, 0);
    } else assert.doesNotMatch(frame.lines.join(''), /\x1b/);
  }
  const busy = officePixels(snapshot, 80, 32).pixels;
  const idle = officePixels({ ...snapshot, managerBusy: false, tasks: [] }, 80, 32).pixels;
  assert.notDeepEqual(busy, idle);
  assert.ok(busy.flat().includes('#ecb657'));
  assert.ok(idle.flat().includes('#68c69c'));
  assert.ok(busy.flat().includes('#596360'));
});

function terminal() {
  const input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  output.columns = 100; output.rows = 24;
  let written = '';
  output.on('data', data => { written += data.toString(); });
  const consoleTarget = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(name => [name, () => {}]));
  return { input, output, signals, consoleTarget, text: () => written };
}

test('monitor switches views, pauses, captures diagnostics, and restores terminal on hide', () => {
  const term = terminal();
  const original = term.consoleTarget.error;
  let reads = 0;
  const monitor = startOfficeTui({ ...term, getSnapshot: () => { reads++; return snapshot; } });
  try {
    assert.equal(term.input.isRaw, true);
    assert.match(term.text(), /\[5 Office\]/);
    assert.match(term.text(), /▀/);
    term.input.emit('keypress', '3', { name: '3' });
    assert.match(term.text(), /\[3 Tasks\]/);
    term.input.emit('keypress', ' ', { name: 'space' });
    const before = reads;
    term.output.emit('resize');
    assert.equal(reads, before);
    term.consoleTarget.error('Worker disconnected');
    term.input.emit('keypress', '4', { name: '4' });
    assert.match(term.text(), /Worker disconnected/);
    term.input.emit('keypress', 'q', { name: 'q' });
    assert.equal(monitor.active, false);
    assert.equal(term.input.isRaw, false);
    assert.equal(term.consoleTarget.error, original);
    assert.equal(term.signals.listenerCount('SIGINT'), 0);
    assert.match(term.text(), /\x1b\[\?25h\x1b\[\?1049l/);
  } finally { monitor.stop(); }
});

test('Ctrl+C restores terminal before requesting shutdown', () => {
  const term = terminal();
  let interrupted = false;
  const monitor = startOfficeTui({ ...term, getSnapshot: () => snapshot, interrupt: () => { assert.equal(term.input.isRaw, false); interrupted = true; } });
  term.input.emit('keypress', '\x03', { name: 'c', ctrl: true });
  assert.equal(interrupted, true);
  assert.equal(monitor.active, false);
});

test('redirected output never switches modes or captures console output', () => {
  const term = terminal(); term.output.isTTY = false;
  const original = term.consoleTarget.log;
  const monitor = startOfficeTui({ ...term, getSnapshot: () => { throw new Error('must not read'); } });
  assert.equal(monitor.active, false);
  assert.equal(term.consoleTarget.log, original);
  assert.doesNotMatch(term.text(), /\x1b/);
});
