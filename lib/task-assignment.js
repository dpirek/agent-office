const ACTIVE_TASK_STATES = new Set(["submitting", "working", "running", "pending"]);

export function selectAutoAssignedWorker(workers, tasks) {
  if (!workers.length) throw new Error("Register at least one HTTP agent before assigning a task.");
  const workload = new Map(workers.map((worker) => [worker.name, { active: 0, total: 0 }]));
  for (const task of tasks) {
    const count = workload.get(task.agent);
    if (!count) continue;
    count.total += 1;
    if (ACTIVE_TASK_STATES.has(task.state)) count.active += 1;
  }
  return [...workers].sort((left, right) => {
    const a = workload.get(left.name);
    const b = workload.get(right.name);
    return a.active - b.active || a.total - b.total || left.name.localeCompare(right.name);
  })[0];
}
