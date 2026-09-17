import { emitKeypressEvents } from 'node:readline';
import { format, stripVTControlCharacters } from 'node:util';

const VIEWS = ['Overview', 'Workers', 'Tasks', 'Logs'];
const ACTIVE = new Set(['pending', 'assigned', 'running', 'working', 'submitting']);
const clean = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function tuiRequested(argv = process.argv.slice(2), env = process.env) {
  return argv.includes('--tui') || ['true', '1'].includes(env.npm_config_tui);
}

// Keep wide names inside the terminal and remove terminal control sequences.
function fit(value, width) {
  let result = '', used = 0;
  for (const char of clean(value)) {
    const code = char.codePointAt(0);
    const size = /\p{Mark}/u.test(char) ? 0 : (code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7af || code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60 || code >= 0x1f000)) ? 2 : 1;
    if (used + size > width) break;
    result += char;
    used += size;
  }
  return result + ' '.repeat(Math.max(0, width - used));
}

function time(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('en-GB', { hour12: false });
}

export function renderOfficeTui(snapshot, { columns = 100, rows = 30, view = 0, offset = 0, paused = false, now = Date.now() } = {}) {
  const width = Math.max(1, columns - 1), height = Math.max(1, rows);
  const workers = snapshot.workers || [], tasks = snapshot.tasks || [], logs = snapshot.logs || [];
  const uptime = Math.max(0, Math.floor((now - snapshot.startedAt) / 1000)) || 0;
  const content = [];
  const workerLines = workers.map(worker => `${fit(worker.status === 'connected' ? 'ONLINE' : 'OFFLINE', 8)} ${fit(worker.name, 25)} ${clean(typeof worker.model === 'string' ? worker.model : worker.model?.model || worker.model?.name || '')}`);
  const taskLines = tasks.map(task => `${fit(task.status?.toUpperCase() || 'UNKNOWN', 11)} ${fit(task.agent || 'Unassigned', 20)} ${fit(task.projectId || 'central-office', 20)} ${clean(task.title)}`);
  const logLines = logs.slice().reverse().map(log => `${time(log.createdAt)} ${fit(log.tone === 'error' ? 'ERROR' : log.category || 'info', 9)} ${clean(log.source)}  ${clean(log.message)}`);
  if (view === 1) content.push('STATUS   WORKER                    MODEL', ...workerLines.length ? workerLines : ['No workers registered.']);
  else if (view === 2) content.push('STATUS      AGENT                PROJECT              TASK', ...taskLines.length ? taskLines : ['No tasks yet.']);
  else if (view === 3) content.push('Recent activity (newest first)', ...logLines.length ? logLines : ['No activity yet.']);
  else {
    content.push(`MANAGER  ${snapshot.managerBusy ? 'WORKING' : 'IDLE'}     PROJECTS  ${snapshot.projectCount || 0}     PEOPLE  ${snapshot.peopleCount || 0}`, '',
      `WORKERS  ${workers.filter(worker => worker.status === 'connected').length} online / ${workers.length} registered`,
      ...workerLines.length ? workerLines.slice(0, 5) : ['No workers registered.'], '',
      `TASKS  ${tasks.filter(task => ACTIVE.has(task.status)).length} active / ${tasks.length} recent`,
      ...taskLines.length ? taskLines.slice(0, 5) : ['No tasks yet.'], '', 'RECENT ACTIVITY',
      ...logLines.length ? logLines : ['No activity yet.']);
  }
  const bodyHeight = Math.max(0, height - 5);
  const maxOffset = Math.max(0, content.length - bodyHeight);
  const scroll = Math.min(Math.max(0, offset), maxOffset);
  const lines = [
    `AGENT OFFICE  |  ${snapshot.url || ''}  |  UP ${Math.floor(uptime / 3600)}h ${Math.floor(uptime / 60) % 60}m ${uptime % 60}s`,
    VIEWS.map((name, index) => `${index === view ? '[' : ' '}${index + 1} ${name}${index === view ? ']' : ' '}`).join('  ') + (paused ? '  PAUSED' : '  LIVE'),
    '-'.repeat(width),
    ...content.slice(scroll, scroll + bodyHeight),
  ];
  while (lines.length < height - 2) lines.push('');
  lines.push('-'.repeat(width), `1-4 views | Up/Down PgUp/PgDn scroll | Space pause | q hide | Ctrl+C stop  ${scroll + 1}/${Math.max(1, maxOffset + 1)}`);
  return { lines: lines.slice(0, height).map(line => fit(line, width)), maxOffset };
}

export function startOfficeTui({ getSnapshot, input = process.stdin, output = process.stdout, intervalMs = 1000, consoleTarget = console, signals = process, interrupt = () => process.kill(process.pid, 'SIGINT') }) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    output.write('Office TUI requires an interactive terminal; continuing with standard server output.\n');
    return { stop() {}, active: false };
  }
  let active = true, view = 0, offset = 0, paused = false, snapshot, maxOffset = 0;
  const wasRaw = Boolean(input.isRaw), wasPaused = input.isPaused();
  const diagnostics = [], original = new Map();
  function draw() {
    if (!active) return;
    try {
      if (!paused || !snapshot) snapshot = getSnapshot();
      const frame = renderOfficeTui({ ...snapshot, logs: [...(snapshot.logs || []), ...diagnostics].sort((a, b) => a.createdAt - b.createdAt) }, {
        columns: output.columns, rows: output.rows, view, offset, paused,
      });
      maxOffset = frame.maxOffset;
      offset = Math.min(offset, maxOffset);
      output.write('\x1b[H' + frame.lines.join('\r\n') + '\x1b[J');
    } catch (error) {
      stop();
      consoleTarget.error('Office TUI stopped:', error.message);
    }
  }
  function keypress(text, key = {}) {
    if (key.ctrl && key.name === 'c') { stop(); interrupt(); return; }
    if (text === 'q' || key.name === 'escape') { stop(); return; }
    if (/^[1-4]$/.test(text || '')) { view = Number(text) - 1; offset = 0; }
    else if (key.name === 'up') offset = Math.max(0, offset - 1);
    else if (key.name === 'down') offset = Math.min(maxOffset, offset + 1);
    else if (key.name === 'pageup') offset = Math.max(0, offset - Math.max(1, (output.rows || 30) - 5));
    else if (key.name === 'pagedown') offset = Math.min(maxOffset, offset + Math.max(1, (output.rows || 30) - 5));
    else if (key.name === 'home') offset = 0;
    else if (key.name === 'end') offset = maxOffset;
    else if (text === ' ') paused = !paused;
    draw();
  }
  function stop() {
    if (!active) return;
    active = false;
    clearInterval(timer);
    input.off('keypress', keypress);
    output.off('resize', draw);
    signals.off('exit', stop);
    signals.off('SIGINT', onInterrupt);
    signals.off('SIGTERM', onTerminate);
    for (const [name, method] of original) consoleTarget[name] = method;
    input.setRawMode(wasRaw);
    if (wasPaused) input.pause();
    output.write('\x1b[?25h\x1b[?1049l');
  }
  const onInterrupt = () => { stop(); interrupt(); };
  const onTerminate = () => { stop(); process.kill(process.pid, 'SIGTERM'); };
  const timer = setInterval(draw, intervalMs);
  timer.unref?.();
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    original.set(name, consoleTarget[name]);
    consoleTarget[name] = (...args) => {
      diagnostics.push({ createdAt: Date.now(), category: 'server', source: name, tone: name === 'error' ? 'error' : '', message: clean(format(...args)) });
      if (diagnostics.length > 100) diagnostics.shift();
    };
  }
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  input.on('keypress', keypress);
  output.on('resize', draw);
  signals.once('exit', stop);
  signals.once('SIGINT', onInterrupt);
  signals.once('SIGTERM', onTerminate);
  output.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  draw();
  return { stop, get active() { return active; } };
}
