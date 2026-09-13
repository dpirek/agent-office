import { json, readRequestBody, methodNotAllowed } from "./http.js";
import { PROJECT_MCP_TOOLS, callProjectTool } from "../lib/project-mcp.js";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
export function createProjectMcpHandlers(options) {
  return { "/mcp/projects/": async (req, res, url) => {
    const match = /^\/mcp\/projects\/([a-zA-Z0-9-]+)\/tasks\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
    if (!match) return json(res, 404, { error: "Unknown project MCP endpoint." });
    const [, projectId, taskId] = match;
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!["http:", "https:"].includes(origin.protocol) || origin.host !== req.headers.host) throw new Error();
      } catch { return json(res, 403, { error: "Origin rejected." }); }
    }
    try {
      const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1] || "";
      const task = options.workerArtifactStore.authorize(taskId, token);
      if ((task.projectId || "central-office") !== projectId) return json(res, 403, { error: "Task cannot access this project." });
      options.uiStateStore.requireProject(projectId);
    } catch { return json(res, 401, { error: "Task credentials rejected or expired." }); }
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    if (req.headers["mcp-protocol-version"] && !VERSIONS.includes(req.headers["mcp-protocol-version"])) return json(res, 400, { error: "Unsupported MCP protocol version." });
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { error: "Expected application/json." });
    let request;
    try { request = JSON.parse(await readRequestBody(req, 100_000)); }
    catch { return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON request." } }); }
    const error = (code, message) => json(res, 200, { jsonrpc: "2.0", id: request?.id ?? null, error: { code, message } });
    if (!request || Array.isArray(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string" || (Object.hasOwn(request, "id") && !["string", "number"].includes(typeof request.id))) return error(-32600, "Invalid JSON-RPC request.");
    if (!Object.hasOwn(request, "id")) { res.writeHead(202); res.end(); return; }
    let result;
    if (request.method === "initialize") {
      result = { protocolVersion: VERSIONS.includes(request.params?.protocolVersion) ? request.params.protocolVersion : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: "office-project", version: "1.0.0" }, instructions: "Read-only access to the assigned project. File paths are relative to the project root. Use project_list_agents to discover specialists; ask the Office Manager to coordinate them." };
    } else if (request.method === "ping") result = {};
    else if (request.method === "tools/list") result = { tools: PROJECT_MCP_TOOLS };
    else if (request.method === "tools/call") {
      if (!PROJECT_MCP_TOOLS.some((tool) => tool.name === request.params?.name)) return error(-32602, "Unknown tool.");
      try {
        const data = await callProjectTool(options, projectId, request.params.name, request.params.arguments ?? {});
        result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
      } catch (failure) {
        result = { isError: true, content: [{ type: "text", text: ["ENOENT", "ENOTDIR", "EACCES"].includes(failure.code) ? "Project file is unavailable." : failure.message }] };
      }
    } else return error(-32601, "Method not found.");
    json(res, 200, { jsonrpc: "2.0", id: request.id, result });
  } };
}
