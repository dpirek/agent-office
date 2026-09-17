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
File URLs below resolve against the Office server's HTTP origin (use the worker's Office WebSocket host and port, changing ws/wss to http/https). Fetch needed files before beginning; these paths refer to Office storage, not your local disk.
Reuse existing work and inspect prerequisite files first. Matching paths update existing files.

${PROJECT_LAYOUT_POLICY}

Include projectId=${projectId} in every Office MCP tool payload and Office context API request.
Use the office_project MCP server supplied in mcpServers for current files, file contents, specialist availability, and the project conversation summary.

# Delivering completed work
Upload every output file as raw bytes to the assignment's artifactUpload.url (resolved against the Office HTTP origin), with Authorization: Bearer <artifactUpload.token> and Content-Type: application/octet-stream. Replace <filename> with the URL-encoded filename. Keep each returned artifactId and include it in uploadedArtifactIds in your completed task_update. Upload ZIP bundles to preserve project-relative folder paths. Complete only after all uploads succeed. Office does not fetch worker-hosted URLs; do not return an artifacts URL array. For text-only results, uploadedArtifactIds may be empty.

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
