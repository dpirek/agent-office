import { assignOfficeTask, createOfficeTask, readOfficeTasks } from "../office-tasks.js";
import { objectSchema } from "./shared.js";

function createOfficeTasksTool({ uiStateStore, subAgentManager }) {
  return {
    name: "manage_office_tasks",
    description: "Read the office task queue, create an unassigned task, or explicitly assign a pending task to a registered agent. Creating never assigns or dispatches automatically. Read the queue and available workers before choosing an assignment.",
    parameters: objectSchema({
      action: { type: "string", enum: ["read", "create", "assign"], description: "Task operation to perform." },
      task_id: { type: ["string", "null"], description: "Pending task id required for assign." },
      title: { type: ["string", "null"], description: "Task instructions required for create." },
      priority: { type: ["string", "null"], enum: ["low", "medium", "high", null], description: "Priority for create." },
      agent: { type: ["string", "null"], description: "Registered agent name required for assign." },
      status: { type: ["string", "null"], description: "Optional status filter for read." },
    }, ["action"]),
    async execute({ action, task_id: taskId, title, priority, agent, status }) {
      if (!uiStateStore) return { ok: false, error: "Office tasks are unavailable." };
      try {
        if (action === "read") return { ok: true, ...readOfficeTasks(uiStateStore, subAgentManager, { status: status || undefined }) };
        if (action === "create") return { ok: true, task: createOfficeTask(uiStateStore, { title, priority: priority || "medium" }) };
        if (action === "assign") return { ok: true, task: assignOfficeTask(uiStateStore, subAgentManager, { id: taskId, agent }) };
        return { ok: false, error: `Unsupported task action: ${action}` };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
}

export { createOfficeTasksTool };
