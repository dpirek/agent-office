import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROJECT_ID = "central-office";

export async function projectWorkspace(root, projectId) {
  if (!/^[a-zA-Z0-9-]+$/.test(projectId)) throw new Error("Invalid project ID.");
  await fs.mkdir(root, { recursive: true });
  const base = await fs.realpath(root);
  const directory = path.join(base, projectId);
  await fs.mkdir(directory, { recursive: true });
  if (await fs.realpath(directory) !== directory) throw new Error("Project workspace cannot be a symbolic link.");
  return directory;
}

// Bind scope to each manager session, never to mutable global selection.
export function projectStore(store, projectId) {
  store.requireProject(projectId);
  const assertTask = (id) => {
    if (!store.getOfficeTasks({ projectId, id, limit: 500 }).some((task) => task.id === id)) throw new Error("Task is outside the current project.");
  };
  return new Proxy(store, {
    get(target, key) {
      if (key === "getOfficeTasks" || key === "getOfficeChatMessages") return (filters = {}) => target[key]({ ...filters, projectId });
      if (key === "createOfficeTask" || key === "createOfficeChatMessage") return (value) => target[key]({ ...value, projectId });
      if (key === "getOfficeMemory") return (filters = {}) => {
        const tasks = target.getOfficeTasks({ projectId, limit: 500 });
        const ids = new Set(tasks.flatMap((task) => [task.id, task.messageId, task.workerTaskId]).filter(Boolean));
        return target.getOfficeMemory({ ...filters, limit: 500 }).filter((entry) => ids.has(entry.sourceId)).slice(0, filters.limit || 25);
      };
      if (["assignOfficeTask", "completeOfficeTask", "cancelOfficeTask", "deleteOfficeTask", "getOfficeTaskDependents"].includes(key)) return (id, ...args) => { assertTask(id); return target[key](id, ...args); };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function prepareProjectContext(store, workspaceRoot, projectId, request) {
  const project = store.requireProject(projectId);
  const root = await projectWorkspace(workspaceRoot, projectId);
  const files = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  const tasks = store.getOfficeTasks({ projectId, limit: 200 });
  const context = `Current project: ${project.name} (${project.id})\nProject status: ${project.status}\nProject description: ${project.description}\nWorkspace: ${root}\nProject files (top level; use file tools to explore):\n${files.join("\n") || "No files yet."}\nProject tasks:\n${JSON.stringify(tasks)}\nWork only within this project. Task tools and conversation history are scoped to it.`;
  return { project, root, request: `${context}\n\n${request}` };
}
