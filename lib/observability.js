import { sanitizeActivity } from './system-activity.js';

export function normalizeObservabilityProvider(input) {
  if (input.type !== 'loki') throw new Error('Choose Grafana Loki as the provider.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 100) throw new Error('Enter a provider name (up to 100 characters).');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('Enter a valid Loki URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) Loki URL without credentials, query parameters, or fragments.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/loki/api/v1/push')) url.pathname += '/loki/api/v1/push';
  const auth = input.auth || 'none';
  if (!['none', 'basic', 'bearer'].includes(auth)) throw new Error('Invalid authentication method.');
  const username = auth === 'basic' ? String(input.username || '').trim() : '';
  const secret = auth === 'none' ? '' : String(input.secret || '');
  const tenantId = String(input.tenantId || '').trim();
  if (auth === 'basic' && (!username || username.includes(':'))) throw new Error('Enter a Basic authentication username without a colon.');
  if (auth !== 'none' && !secret) throw new Error('Enter a password or API token.');
  if ([username, secret, tenantId].some(value => /[\r\n]/.test(value)) || secret.length > 4096 || username.length > 200 || tenantId.length > 200) throw new Error('Authentication or tenant value is invalid.');
  return { name, type: 'loki', url: url.href, auth, username, secret, tenantId, enabled: input.enabled !== false };
}

export function publicObservabilityProvider(provider) {
  const { secret, ...safe } = provider;
  return { ...safe, hasSecret: Boolean(secret) };
}

export function lokiPayload(entries) {
  const streams = new Map();
  for (const entry of entries) {
    const stream = { app: 'agent-office', category: entry.category || 'system', level: entry.tone === 'error' ? 'error' : 'info' };
    const key = JSON.stringify(stream);
    if (!streams.has(key)) streams.set(key, { stream, values: [] });
    streams.get(key).values.push([(BigInt(Math.trunc(entry.createdAt)) * 1_000_000n).toString(), JSON.stringify(sanitizeActivity(entry))]);
  }
  for (const stream of streams.values()) stream.values.sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0);
  return { streams: [...streams.values()] };
}

export async function pushLoki(provider, entries, { fetchImpl = fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.auth === 'basic') headers.Authorization = `Basic ${Buffer.from(`${provider.username}:${provider.secret}`).toString('base64')}`;
  if (provider.auth === 'bearer') headers.Authorization = `Bearer ${provider.secret}`;
  if (provider.tenantId) headers['X-Scope-OrgID'] = provider.tenantId;
  let response;
  try {
    response = await fetchImpl(provider.url, { method: 'POST', headers, body: JSON.stringify(lokiPayload(entries)), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { throw new Error('Unable to reach Loki. Check the URL, network, and TLS configuration.'); }
  // Loki can use 260 to indicate blocked ingestion even though it is a 2xx status.
  await response.body?.cancel();
  if (![200, 204].includes(response.status)) throw new Error(`Loki rejected the logs (HTTP ${response.status}). Check authentication, tenant, and ingestion limits.`);
}

export function createObservabilityExporter({ store, fetchImpl = fetch, intervalMs = 2000, now = Date.now }) {
  let timer, running = false;
  const retries = new Map();
  async function flush() {
    if (running) return;
    running = true;
    try {
      await Promise.all(store.getObservabilityProviders().filter(provider => provider.enabled).map(async provider => {
        const retry = retries.get(provider.id);
        if (retry?.nextAt > now()) return;
        const batch = store.getObservabilityBatch(provider.cursor, 100);
        if (!batch.length) return;
        try {
          await pushLoki(provider, batch.map(({ sequence, ...entry }) => entry), { fetchImpl });
          store.updateObservabilityDelivery(provider.id, { cursor: batch.at(-1).sequence, lastSentAt: now(), error: '' });
          retries.delete(provider.id);
        } catch (error) {
          const attempts = (retry?.attempts || 0) + 1;
          retries.set(provider.id, { attempts, nextAt: now() + Math.min(60_000, 2000 * 2 ** Math.min(attempts - 1, 5)) });
          store.updateObservabilityDelivery(provider.id, { error: error.message });
        }
      }));
    } finally { running = false; }
  }
  return {
    flush,
    start() { if (!timer) { timer = setInterval(() => { void flush().catch(() => {}); }, intervalMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}
