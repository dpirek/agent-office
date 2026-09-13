import { PROJECT_LAYOUT, PROJECT_LAYOUT_POLICY } from "./project-layout.js";
import fs from "node:fs/promises";
import path from "node:path";
import { projectWorkspace } from "./projects.js";
import { workspaceFileUrl } from "../public/lib/file-url.mjs";

const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description) => ({ type: "string", description });
export const PROJECT_MCP_TOOLS = [
  { name: "project_get_context", description: "Read this project's description, status, and task queue.", inputSchema: schema() },
  { name: "project_list_files", description: "List current project files with download URLs and completed-task provenance. Paths are relative to this project.", inputSchema: schema({ path: string("Project-relative folder; defaults to the project root.") }) },
  { name: "project_read_file", description: "Read a UTF-8 project file in chunks of up to 64000 characters. Binary files have download URLs in project_list_files.", inputSchema: schema({ path: string("Project-relative file path."), offset: { type: "integer", minimum: 0 } }, ["path"]) },
  { name: "project_list_agents", description: "Find connected workers and their specialized skills and availability. Does not reveal other projects' tasks or conversations.", inputSchema: schema({ skill: string("Optional skill, tool, or specialization to match.") }) },
  { name: "project_conversation_summary", description: "Get an extractive summary of this project's recent conversation and task outcomes, including latest user requests and manager updates.", inputSchema: schema() },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));

async function resolveProjectPath(root, requested = "") {
  if (typeof requested !== "string" || path.isAbsolute(requested) || requested.includes("\\") || requested.includes("\0") || requested.split("/").some((part) => part.startsWith("."))) throw new Error("Use a project-relative path without hidden or parent segments.");
  const file = await fs.realpath(path.join(root, requested));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("File is outside this project.");
  return file;
}

export async function callProjectTool({ uiStateStore, sharedWorkspaceRoot, subAgentManager }, projectId, name, args = {}) {
  const tool = PROJECT_MCP_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error("Unknown project tool.");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !Object.hasOwn(tool.inputSchema.properties, key))) throw new Error("Invalid tool arguments.");
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(args, key)) throw new Error(`Missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const field = tool.inputSchema.properties[key];
    if (field.type === "string" ? typeof value !== "string" : !Number.isInteger(value) || value < 0) throw new Error(`Invalid argument: ${key}`);
  }
  const project = uiStateStore.requireProject(projectId);
  const tasks = uiStateStore.getOfficeTasks({ projectId, limit: 500 });
  if (name === "project_get_context") return { project, workspaceLayout: PROJECT_LAYOUT, deliveryInstructions: PROJECT_LAYOUT_POLICY, tasks: tasks.map(({ id, title, description, status, agent, dependsOn, deliveredWork }) => ({ id, title, description, status, agent, dependsOn, deliveredWork })) };
  if (name === "project_list_agents") {
    const active = subAgentManager.listTasks().filter((task) => ["assigned", "working", "running"].includes(task.state));
    const workers = subAgentManager.listWorkers().map((worker) => ({
      name: worker.name, description: worker.description,
      skills: worker.capabilities?.skills || [], tools: worker.capabilities?.tools || [],
      available: !active.some((task) => task.agent === worker.name),
    }));
    const query = String(args.skill || "").toLowerCase();
    return { workers: workers.filter((worker) => !query || JSON.stringify(worker).toLowerCase().includes(query)) };
  }
  if (name === "project_conversation_summary") {
    const messages = uiStateStore.getOfficeChatMessages({ projectId, limit: 100 });
    const excerpt = (message) => ({ author: message.author, createdAt: message.createdAt, text: message.text.slice(0, 1500), truncated: message.text.length > 1500 });
    return {
      project, summaryType: "extractive", scope: "Latest 100 project messages; excerpts may be truncated.",
      messagesConsidered: messages.length,
      latestUserRequests: messages.filter((message) => message.kind === "user").slice(-5).map(excerpt),
      latestManagerUpdates: messages.filter((message) => message.kind === "manager").slice(-5).map(excerpt),
      recentDiscussion: messages.slice(-10).map(excerpt),
      taskOutcomes: tasks.slice(0, 20).map((task) => ({ title: task.title, status: task.status, agent: task.agent, result: String(task.result || task.error || "").slice(0, 1500), files: task.deliveredWork })),
    };
  }
  const root = await projectWorkspace(sharedWorkspaceRoot, projectId);
  const target = await resolveProjectPath(root, args.path);
  if (name === "project_read_file") {
    const handle = await fs.open(target, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("Select a file.");
      if (stat.size > 2_000_000) throw new Error("File exceeds the 2 MB text preview limit; use its download URL.");
      const buffer = await handle.readFile();
      if (buffer.includes(0)) throw new Error("Binary file; use its download URL.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      const offset = args.offset || 0;
      const text = content.slice(offset, offset + 64_000);
      return { path: args.path, text, nextOffset: offset + text.length < content.length ? offset + text.length : null, totalCharacters: content.length };
    } finally { await handle.close(); }
  }
  const files = [];
  let truncated = false;
  async function walk(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (files.length >= 500) { truncated = true; return; }
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(root, file).split(path.sep).join("/");
        const stored = `${projectId}/${relative}`;
        const stat = await fs.stat(file);
        files.push({ path: relative, size: stat.size, url: workspaceFileUrl(stored), completedBy: tasks.filter((task) => task.status === "completed" && task.deliveredWork?.some((artifact) => artifact.workspacePath === stored)).map((task) => ({ taskId: task.id, title: task.title, agent: task.agent })) });
      }
    }
  }
  if (!(await fs.stat(target)).isDirectory()) throw new Error("Select a folder.");
  await walk(target);
  return { projectId, files, truncated };
}
