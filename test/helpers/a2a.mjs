import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
export const message = (text, contextId = 'context-1') => ({ messageId: crypto.randomUUID(), contextId, role: 'ROLE_AGENT', parts: [{ text }] });
export const task = (state = 'WORKING', text, extra = {}) => ({ id: 'remote-task', contextId: 'context-1', status: { state: `TASK_STATE_${state}`, ...(text ? { message: message(text) } : {}) }, artifacts: [], ...extra });
export const card = (url, binding = 'JSONRPC', streaming = false) => ({ name: 'Builder', description: 'A standard agent', version: '1', supportedInterfaces: [{ url, protocolBinding: binding, protocolVersion: '1.0' }], capabilities: { streaming }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain', 'application/octet-stream'], skills: [{ id: 'build', name: 'Build', description: 'Build things', tags: ['build'] }] });
export async function agentServer(t, { binding = 'JSONRPC', streaming = false, respond = () => ({ message: message('Done') }), token, tenant } = {}) {
  const calls = []; let origin;
  const server = http.createServer(async (req, res) => {
    try {
      if (token) assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (req.url === '/.well-known/agent-card.json') {
        const agentCard = card(`${origin}/agent`, binding, streaming);
        if (tenant) agentCard.supportedInterfaces[0].tenant = tenant;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(agentCard)); return;
      }
      assert.equal(req.headers['a2a-version'], '1.0');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
      let method = body.method; let params = body.params;
      if (binding === 'JSONRPC') { assert.equal(body.jsonrpc, '2.0'); assert.ok(body.id); }
      else {
        const url = new URL(req.url, origin);
        const route = url.pathname.replace('/agent' + (tenant ? `/${encodeURIComponent(tenant)}` : ''), '');
        method = route === '/message:send' ? 'SendMessage' : route === '/message:stream' ? 'SendStreamingMessage' : route.endsWith(':cancel') ? 'CancelTask' : route.endsWith(':subscribe') ? 'SubscribeToTask' : 'GetTask';
        params = method.startsWith('Send') ? body : { id: decodeURIComponent(route.split('/')[2]?.split(':')[0] || '') };
      }
      calls.push({ method, params, headers: req.headers, url: req.url });
      const result = await respond(method, params, calls);
      if (result?.events) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of result.events) {
          const value = binding === 'JSONRPC' ? { jsonrpc: '2.0', id: body.id, result: event } : event;
          const data = `: heartbeat\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
          // Intentionally split across arbitrary network chunks.
          res.write(data.slice(0, 17)); res.write(data.slice(17));
        }
        if (result.truncated) res.write('data: {');
        res.end(); return;
      }
      const response = binding === 'JSONRPC' ? { jsonrpc: '2.0', id: body.id, ...(result?.error ? { error: result.error } : { result }) } : result;
      res.writeHead(result?.httpStatus || 200, { 'content-type': 'application/a2a+json' }); res.end(JSON.stringify(response));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: origin, calls };
}
export async function until(predicate) { for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(5); } throw new Error('Timed out waiting for condition.'); }
export function fakeClient({ sent = [], response = { task: task() }, get = () => task(), cancel = () => task('CANCELED') } = {}) {
  return { card: card('http://agent.test'), interface: { protocolBinding: 'JSONRPC' }, async sendMessage(params) { sent.push(params); return typeof response === 'function' ? response(params) : response; }, async getTask(id) { return get(id); }, async cancelTask(id) { return cancel(id); } };
}
