import { assignOfficeTask, cancelOfficeTask, createOfficeTask, readOfficeTasks } from "../office-tasks.js";
import { objectSchema } from "./shared.js";

function createOfficeTasksTool({ uiStateStore, subAgentManager }) {
  let assignmentMade = false;
  return {
    name: "manage_office_tasks",
    description: "Read the office task queue, create an unassigned task with optional dependencies, explicitly assign one ready pending task, or cancel a running task. Creating never dispatches automatically. Assign at most one task per review turn; later tasks are assigned after completion triggers another review.",
    parameters: objectSchema({
      action: { type: "string", enum: ["read", "create", "assign", "cancel"], description: "Task operation to perform." },
      task_id: { type: ["string", "null"], description: "Task id required for assign or cancel." },
      title: { type: ["string", "null"], description: "Task instructions required for create." },
      priority: { type: ["string", "null"], enum: ["low", "medium", "high", null], description: "Priority for create." },
      depends_on: { type: ["array", "null"], items: { type: "string" }, description: "Task IDs that must all complete before this task can be assigned." },
      agent: { type: ["string", "null"], description: "Registered agent name required for assign." },
      status: { type: ["string", "null"], description: "Optional status filter for read." },
      reason: { type: ["string", "null"], description: "Optional reason when cancelling a running task." },
    }, ["action"]),
    async execute({ action, task_id: taskId, title, priority, depends_on: dependsOn, agent, status, reason }) {
      if (!uiStateStore) return { ok: false, error: "Office tasks are unavailable." };
      try {
        if (action === "read") return { ok: true, ...readOfficeTasks(uiStateStore, subAgentManager, { status: status || undefined }) };
        if (action === "create") return { ok: true, task: createOfficeTask(uiStateStore, { title, priority: priority || "medium", dependsOn: dependsOn || [] }) };
        if (action === "assign") {
          if (assignmentMade) return { ok: false, error: "Only one task may be assigned per Office Manager review turn. Wait for its completion trigger before assigning the next task." };
          const task = assignOfficeTask(uiStateStore, subAgentManager, { id: taskId, agent });
          assignmentMade = true;
          return { ok: true, task };
        }
        if (action === "cancel") return { ok: true, task: cancelOfficeTask(uiStateStore, subAgentManager, { id: taskId, reason }) };
        return { ok: false, error: `Unsupported task action: ${action}` };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
}

export { createOfficeTasksTool };
