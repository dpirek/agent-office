import { json, methodNotAllowed, readRequestBody } from './http.js';
import { normalizeObservabilityProvider, publicObservabilityProvider, pushLoki } from '../lib/observability.js';

export function createObservabilityApiHandlers({ uiStateStore, observabilityFetch = fetch }) {
  const handle = async (req, res, url) => {
    if (req.user?.role !== 'admin') return json(res, 403, { ok: false, error: 'Administrator access required.' });
    const test = url.pathname.endsWith('/test');
    if (req.method === 'GET' && !test) return json(res, 200, { ok: true, providers: uiStateStore.getObservabilityProviders().map(publicObservabilityProvider) });
    if (!(test ? ['POST'] : ['POST', 'PATCH', 'DELETE']).includes(req.method)) return methodNotAllowed(res, test ? 'POST' : 'GET, POST, PATCH, DELETE');
    try {
      const body = JSON.parse(await readRequestBody(req, 20_000) || '{}');
      if (test) {
        const provider = normalizeObservabilityProvider(body);
        await pushLoki(provider, [{ id: 'connection-test', category: 'observability', source: 'Agent Office', message: 'Observability connection test', createdAt: Date.now() }], { fetchImpl: observabilityFetch });
        return json(res, 200, { ok: true, message: 'Connected. Loki accepted the test log.' });
      }
      if (req.method === 'POST') {
        if (uiStateStore.getObservabilityProviders().length >= 10) throw new Error('You can add up to 10 observability providers.');
        const provider = uiStateStore.addObservabilityProvider(normalizeObservabilityProvider(body));
        return json(res, 201, { ok: true, provider: publicObservabilityProvider(provider) });
      }
      if (!uiStateStore.getObservabilityProviders().some(provider => provider.id === body.id)) return json(res, 404, { ok: false, error: 'Provider not found.' });
      if (req.method === 'DELETE') uiStateStore.deleteObservabilityProvider(body.id);
      else {
        if (typeof body.enabled !== 'boolean') throw new Error('Enabled must be true or false.');
        uiStateStore.setObservabilityEnabled(body.id, body.enabled);
      }
      return json(res, 200, { ok: true });
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  };
  return { '/api/observability': handle, '/api/observability/test': handle };
}
