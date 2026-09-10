export function revealCreatedTask(officeTasks, task, taskFilter) {
  return {
    officeTasks: [task, ...officeTasks.filter((entry) => entry.id !== task.id)],
    taskFilter: ["all", "pending"].includes(taskFilter) ? taskFilter : "pending",
  };
}
