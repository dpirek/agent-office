import { createProjectApiHandlers } from "./projects.js";
import { createSettingsApiHandlers } from "./settings.js";
import { createSubAgentApiHandlers } from "./sub-agents.js";
import { createTaskApiHandlers } from "./tasks.js";
import { createOperationsApiHandlers } from "./operations.js";
import { createMemoryApiHandlers } from "./memory.js";
import { createWorkspaceApiHandlers } from "./workspace.js";
import { createChatApiHandlers } from "./chat.js";
import { createSharedWorkspaceApiHandlers } from "./shared-workspace.js";
import { createSystemLogApiHandlers } from "./system-logs.js";
import { createWorkerArtifactApiHandlers } from "./worker-artifacts.js";

export function createApiRouter(options) {
  const routes = new Map(Object.entries({
    ...createProjectApiHandlers(options),
    ...createSettingsApiHandlers(options),
    ...createSubAgentApiHandlers(options),
    ...createTaskApiHandlers(options),
    ...createOperationsApiHandlers(options),
    ...createMemoryApiHandlers(options),
    ...createWorkspaceApiHandlers(options),
    ...createChatApiHandlers(options),
    ...createSharedWorkspaceApiHandlers(options),
    ...createSystemLogApiHandlers(options),
    ...createWorkerArtifactApiHandlers(options),
  }));

  return async function handleApiRequest(req, res, url) {
    const handler = routes.get(url.pathname);
    if (!handler) return false;
    await handler(req, res, url);
    return true;
  };
}
