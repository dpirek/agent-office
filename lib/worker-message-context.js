export function workerMessageContext(uiStateStore, message) {
  const project = uiStateStore.requireProject(message.projectId || 'central-office');
  const tasks = uiStateStore.getOfficeTasks({ projectId: project.id, limit: 500 });
  const task = tasks.find(task => message.officeTaskId ? task.id === message.officeTaskId : task.messageId === message.messageId);
  if (message.officeTaskId && !task) throw new Error('Message task does not belong to this project.');
  return {
    project: { id: project.id, name: project.name },
    task: task ? { id: task.id, title: task.title, workerTaskId: task.workerTaskId || message.taskId || null } : null,
  };
}

export function formatWorkerMessageContext(context, text) {
  return `# Office message context\nProject: ${context.project.name} (${context.project.id})\nTask: ${context.task ? `${context.task.title} (${context.task.id})` : 'General project conversation; no specific task assigned.'}\nInclude projectId=${context.project.id} in Office MCP tool arguments and Office context API requests. Do not use context from other projects.\n\n# Message\n${text}`;
}
