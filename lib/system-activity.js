import crypto from 'node:crypto';
const SECRET_KEY = /authorization|cookie|password|secret|api[_-]?key|credential|access[_-]?token|refresh[_-]?token|^token$/i;
export function sanitizeActivity(value, depth = 0) {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return value.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]').replace(/([?&](?:token|key|api_key|invite)=)[^&\s]+/gi, '$1[redacted]').slice(0, 8000);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeActivity(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[redacted]' : sanitizeActivity(item, depth + 1)]));
  return value;
}

export function instrumentModelClient(client, record, context) {
  const createResponse = client.createResponse.bind(client);
  const write = entry => { try { record(entry); } catch { /* Logging must not interrupt execution. */ } };
  client.createResponse = async (body, options) => {
    const started = Date.now();
    const callId = crypto.randomUUID();
    const metadata = { ...context, callId, model: body.model, inputItems: Array.isArray(body.input) ? body.input.length : 1, tools: body.tools?.length || 0 };
    write({ category: 'model', source: context.agent || 'Office Manager', message: `Model call started · ${body.model}`, metadata });
    try {
      const response = await createResponse(body, options);
      write({ category: 'model', source: context.agent || 'Office Manager', message: `Model call completed · ${body.model} · ${Date.now() - started} ms`, tone: 'success', metadata: { ...metadata, durationMs: Date.now() - started, responseId: response.id, usage: response.usage, outputItems: response.output?.length || 0 } });
      return response;
    } catch (error) {
      write({ category: 'model', source: context.agent || 'Office Manager', message: `Model call failed · ${body.model}`, tone: 'error', metadata: { ...metadata, durationMs: Date.now() - started, error: error.message } });
      throw error;
    }
  };
  return client;
}
