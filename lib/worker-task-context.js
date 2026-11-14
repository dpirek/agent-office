import { PROJECT_LAYOUT_POLICY } from "./project-layout.js";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_ID, projectWorkspace } from "./projects.js";
import { workspaceFileUrl } from "../public/lib/file-url.mjs";

export async function prepareWorkerTask({ uiStateStore, sharedWorkspaceRoot }, assignment) {
  const projectId = assignment.projectId || DEFAULT_PROJECT_ID;
  const project = uiStateStore.requireProject(projectId);
  const root = await projectWorkspace(sharedWorkspaceRoot, projectId);
  const files = [];
  let truncated = false;
  async function walk(directory, prefix = "") {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (files.length >= 500) { truncated = true; return; }
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + "/");
      else if (entry.isFile()) files.push(relative);
    }
  }
  await walk(root);
  const tasks = uiStateStore.getOfficeTasks({ projectId, limit: 500 });
  const current = tasks.find((task) => assignment.officeTaskId ? task.id === assignment.officeTaskId : task.messageId === assignment.messageId);
  const prerequisites = new Set();
  const visit = (id) => {
    if (prerequisites.has(id)) return;
    prerequisites.add(id);
    for (const parent of tasks.find((task) => task.id === id)?.dependsOn || []) visit(parent);
  };
  for (const id of current?.dependsOn || []) visit(id);
  const completed = tasks.filter((task) => task.status === "completed");
  const lines = files.map((file) => {
    const storedPath = `${projectId}/${file}`;
    const producers = completed.filter((task) => (task.deliveredWork || []).some((artifact) => artifact.workspacePath === storedPath));
    const prerequisite = producers.some((task) => prerequisites.has(task.id));
    const mentioned = assignment.task.includes(file) || assignment.task.includes(workspaceFileUrl(storedPath));
    const label = prerequisite ? "PREREQUISITE" : mentioned ? "REFERENCED IN TASK" : "AVAILABLE";
    const origin = producers.length ? ` — completed work: ${producers.map((task) => `${task.title} by ${task.agent || "worker"}`).join("; ")}` : "";
    return { rank: prerequisite ? 0 : mentioned ? 1 : 2, text: `- [${label}] ${file} — ${workspaceFileUrl(storedPath)}${origin}` };
  }).sort((a, b) => a.rank - b.rank);
  const header = `# Project context
Project: ${project.name} (${project.id})
Task: ${current?.title || assignment.title || "Assigned work"}
Office task ID: ${current?.id || "Not available"}
Worker task ID: ${assignment.taskId || "Not available"}
Status: ${project.status}
Description: ${project.description || "No project description provided."}
Project workspace: ${projectId}/
File paths below describe existing Office project files. They are not paths on your own machine. Ask for any input you cannot access; do not assume access to Office APIs or MCP tools.
Reuse existing work and inspect prerequisite inputs first.

${PROJECT_LAYOUT_POLICY}

# Delivering completed work
Return results through standard A2A messages and artifacts. Use text or data parts for written or structured output, and raw (base64) or URL parts for files. Include a filename and mediaType for files. ZIP artifacts can preserve project-relative directories. No Office upload endpoint, credential, or custom message format is required. Existing project inputs are attached as standard message parts.

# Current project files
`;
  const footer = "\n\n# Assignment\n" + assignment.task;
  const omission = "\nFile inventory truncated; additional files are available from /api/shared-workspace?projectId=" + encodeURIComponent(projectId);
  let remaining = 100_000 - header.length - footer.length - omission.length;
  if (remaining < 0) throw new Error("Task instructions leave insufficient room for required project context.");
  const selected = [];
  for (const line of lines) {
    if (line.text.length + 1 > remaining) { truncated = true; continue; }
    selected.push(line.text);
    remaining -= line.text.length + 1;
  }
  return header + (selected.join("\n") || (files.length ? "See the project file listing." : "No files delivered yet.")) + (truncated ? omission : "") + footer;
}

// A2A file parts carry the actual project inputs. No worker-specific MCP or
// access to private Office HTTP endpoints is assumed.
export async function prepareWorkerParts({ sharedWorkspaceRoot }, assignment, inputModes = []) {
  const root = await projectWorkspace(sharedWorkspaceRoot, assignment.projectId || DEFAULT_PROJECT_ID);
  const parts = []; let bytes = 0;
  async function walk(directory, prefix = '') {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.name === 'node_modules') continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) {
        const file = path.join(directory, entry.name);
        const stat = await fs.stat(file);
        if (parts.length >= 100 || bytes + stat.size > 20 * 1024 * 1024) {
          throw new Error('Project inputs exceed 100 files or 20 MB. Reduce the project inputs before assigning this task.');
        }
        const content = await fs.readFile(file);
        bytes += content.length;
        const text = content.toString('utf8');
        if (!content.includes(0) && Buffer.from(text).equals(content)) parts.push({ text: `# Input file: ${name}\n${text}` });
        else if (inputModes.some(mode => ['*/*', 'application/octet-stream'].includes(mode))) parts.push({ raw: content.toString('base64'), filename: name, mediaType: 'application/octet-stream' });
        else throw new Error(`Agent does not advertise binary input support for ${name}.`);
      }
    }
  }
  await walk(root); return parts;
}
