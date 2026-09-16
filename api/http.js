export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readRequestBuffer(req, limit = 250_000) {
  if (req.cachedBody) {
    if (req.cachedBody.length > limit) throw new Error('Request body is too large.');
    return req.cachedBody;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  req.cachedBody = Buffer.concat(chunks);
  return req.cachedBody;
}

export async function readRequestBody(req, limit = 250_000) {
  return (await readRequestBuffer(req, limit)).toString("utf8");
}

export function methodNotAllowed(res, allow) {
  res.writeHead(405, { allow });
  res.end();
}
