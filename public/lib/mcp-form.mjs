export function readMcpForm(content) {
  const config = content.trim() ? JSON.parse(content) : { mcp: { servers: [] } };
  if (!config || typeof config !== 'object') throw new Error('The saved MCP configuration is not an object.');
  const servers = Array.isArray(config) ? config : config.mcp?.servers ?? config.servers ?? [];
  if (!Array.isArray(servers)) throw new Error('The saved MCP servers must be a list.');
  return { config, servers: structuredClone(servers) };
}

export function writeMcpForm(config, servers) {
  const result = structuredClone(config);
  if (Array.isArray(result)) return JSON.stringify(servers, null, 2);
  if (result.mcp?.servers !== undefined || result.servers === undefined) result.mcp = { ...result.mcp, servers };
  else result.servers = servers;
  return JSON.stringify(result, null, 2);
}

export function validateMcpServer(server) {
  if (!/^[A-Za-z0-9_-]+$/.test(server.server_label || '')) throw new Error('Server name must contain only letters, numbers, underscores, or hyphens.');
  let url;
  try { url = new URL(server.server_url); } catch { throw new Error('Enter a valid server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS URL without embedded credentials.');
  if (server.headers != null && (typeof server.headers !== 'object' || Array.isArray(server.headers))) throw new Error('Headers must be name/value pairs.');
  for (const [name, value] of Object.entries(server.headers || {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('Enter valid header names and single-line values.');
  }
  return server;
}
