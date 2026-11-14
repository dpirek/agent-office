import crypto from 'node:crypto';
import { downloadArtifact } from './a2a-download.js';

export const A2A_VERSION = '1.0';
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
export class A2AError extends Error {
  constructor(message, { code, status, data } = {}) { super(message); this.name = 'A2AError'; Object.assign(this, { code, status, data }); }
}
export function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Use an HTTP(S) URL without credentials or a fragment.');
  return url;
}
export async function readBytes(response, limit = MAX_RESPONSE_BYTES) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw new Error('Agent response exceeds the size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(response) {
  const bytes = await readBytes(response);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new A2AError(`Agent returned invalid JSON (HTTP ${response.status}).`, { status: response.status }); }
  if (!response.ok) {
    const error = value.error || value;
    throw new A2AError(error.message || `Agent returned HTTP ${response.status}.`, { status: response.status, code: error.code, data: error.details || error.data });
  }
  return value;
}
export function validateCard(card) {
  if (!card || typeof card.name !== 'string' || !card.name.trim() || !card.version || !Array.isArray(card.skills) || !card.capabilities || !card.defaultInputModes?.length || !card.defaultOutputModes?.length) throw new Error('Invalid A2A v1.0 Agent Card.');
  const unsupported = card.capabilities.extensions?.find(extension => extension.required);
  if (unsupported) throw new Error(`Agent requires an unsupported extension: ${unsupported.uri}`);
  const iface = card.supportedInterfaces?.find(entry => /^1\.0(?:\.\d+)?$/.test(entry.protocolVersion) && ['JSONRPC', 'HTTP+JSON'].includes(entry.protocolBinding));
  if (!iface) throw new Error('Agent must advertise an A2A v1.0 JSONRPC or HTTP+JSON interface.');
  httpUrl(iface.url);
  return iface;
}
function credentialHeaders(config) {
  const headers = new Headers(config.headers || {});
  if (config.token) headers.set('Authorization', `Bearer ${config.token}`);
  for (const name of headers.keys()) {
    if (['host', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'a2a-version', 'content-type', 'accept'].includes(name)) throw new Error(`Credential header is not allowed: ${name}`);
  }
  return Object.fromEntries(headers);
}
export class A2AClient {
  constructor(config, card, { fetchImpl = fetch } = {}) {
    this.config = config; this.card = card; this.interface = validateCard(card); this.fetch = fetchImpl;
    this.credentials = credentialHeaders(config);
    this.credentialOrigin = httpUrl(config.url).origin;
    if (Object.keys(this.credentials).length && httpUrl(this.interface.url).origin !== this.credentialOrigin) throw new Error('Authenticated Agent Card and service must share an origin; credentials will not be forwarded to another host.');
  }
  static async discover(config, options = {}) {
    const url = httpUrl(config.url);
    const cardUrl = config.cardPath !== undefined ? new URL(config.cardPath, url) : url.pathname.endsWith('.json') ? url : new URL('/.well-known/agent-card.json', url);
    if (cardUrl.origin !== url.origin) throw new Error('Agent Card must share the configured origin.');
    const response = await (options.fetchImpl || fetch)(cardUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { ...credentialHeaders(config), 'A2A-Version': A2A_VERSION, Accept: 'application/a2a+json, application/json' } });
    const card = await readJson(response);
    return new A2AClient(config, card, options);
  }
  async request(method, params = {}, { signal, streaming = false } = {}) {
    const rpc = this.interface.protocolBinding === 'JSONRPC';
    const id = crypto.randomUUID();
    params = { ...params, ...(this.interface.tenant ? { tenant: this.interface.tenant } : {}) };
    let url = this.interface.url; let verb = 'POST'; let body;
    if (rpc) body = { jsonrpc: '2.0', id, method, params };
    else {
      const tenant = this.interface.tenant ? `/${encodeURIComponent(this.interface.tenant)}` : '';
      const task = `/tasks/${encodeURIComponent(params.id || '')}`;
      const paths = { SendMessage: '/message:send', SendStreamingMessage: '/message:stream', GetTask: task, CancelTask: `${task}:cancel`, SubscribeToTask: `${task}:subscribe`, ListTasks: '/tasks', GetExtendedAgentCard: '/extendedAgentCard' };
      if (!paths[method]) throw new Error(`Unsupported A2A operation: ${method}`);
      url = url.replace(/\/$/, '') + tenant + paths[method];
      if (['GetTask', 'ListTasks', 'GetExtendedAgentCard'].includes(method)) {
        verb = 'GET';
        const query = new URLSearchParams(Object.entries(params).filter(([key, value]) => !['id', 'tenant'].includes(key) && value !== undefined));
        if (query.size) url += `?${query}`;
      } else if (['SendMessage', 'SendStreamingMessage'].includes(method)) body = params;
    }
    const response = await this.fetch(url, {
      method: verb, redirect: 'error', signal: signal || AbortSignal.timeout(30_000),
      headers: { ...this.credentials, 'A2A-Version': A2A_VERSION, 'Content-Type': 'application/json', Accept: streaming ? 'text/event-stream' : 'application/a2a+json, application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const unwrap = envelope => {
      if (!rpc) return envelope;
      if (envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new A2AError('Invalid JSON-RPC response envelope.');
      if (envelope.error) throw new A2AError(envelope.error.message, envelope.error);
      if (!Object.hasOwn(envelope, 'result')) throw new A2AError('Missing JSON-RPC result.');
      return envelope.result;
    };
    if (!streaming || !response.ok) return unwrap(await readJson(response));
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      // JSON-RPC failures may be returned as a normal JSON response.
      const result = unwrap(await readJson(response));
      throw new A2AError('Agent did not return an event stream.', { data: result });
    }
    return parseEvents(response, unwrap);
  }
  sendMessage(params, options) { return this.request('SendMessage', params, options); }
  getTask(id, options) { return this.request('GetTask', { id }, options); }
  cancelTask(id, options) { return this.request('CancelTask', { id }, options); }
  async *sendMessageStream(params, options) { yield* await this.request('SendStreamingMessage', params, { ...options, streaming: true }); }
  async *subscribeToTask(id, options) { yield* await this.request('SubscribeToTask', { id }, { ...options, streaming: true }); }
  async download(url, signal) {
    const target = httpUrl(url);
    return downloadArtifact(target, { signal, allowPrivate: target.origin === this.credentialOrigin, headers: target.origin === this.credentialOrigin ? this.credentials : {} });
  }
}
async function* parseEvents(response, unwrap) {
  const decoder = new TextDecoder(); let buffer = ''; let data = []; let eventType = '';
  const dispatch = () => {
    if (!data.length) { eventType = ''; return null; }
    const value = JSON.parse(data.join('\n')); data = [];
    if (eventType === 'error') throw new A2AError(value.error?.message || value.message || 'Agent stream error.', value.error || value);
    eventType = ''; return unwrap(value);
  };
  function* drain(final = false) {
    let match;
    while ((match = /[\r\n]/.exec(buffer))) {
      const index = match.index;
      if (buffer[index] === '\r' && index === buffer.length - 1 && !final) break;
      const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      const line = buffer.slice(0, index); buffer = buffer.slice(index + width);
      if (!line) { const value = dispatch(); if (value) yield value; }
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) eventType = line.slice(6).trim();
    }
  }
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length + data.join('').length > MAX_RESPONSE_BYTES) throw new Error('Agent stream event exceeds the size limit.');
    yield* drain();
  }
  buffer += decoder.decode();
  yield* drain(true);
  if (buffer.trim() || data.length) throw new Error('Agent stream ended mid-event.');
}
