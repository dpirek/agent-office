const TERMINAL_TASK_EVENTS = new Set(["completed", "failed", "timed_out", "cancelled"]);

const SEQUENTIAL_ORCHESTRATION_POLICY = `Sequential orchestration policy:
- For multi-stage work, create a dependency chain of pending tasks using depends_on task IDs.
- Assign only one ready task during this review turn. Never dispatch dependent stages together.
- A task is ready only when every depends_on task is completed.
- After a task settles, review its result, delivered files, failures, or cancellation before deciding what comes next.
- If a prerequisite fails, keep downstream work pending and either create one corrective task or explain why the sequence is blocked.
- If a task is cancelled, do not recreate or reassign it unless the operator explicitly asks; keep its downstream work blocked.`;

const FAILURE_RECOVERY_POLICY = `Failure recovery policy:
- When a task fails, inspect its error, progress, prior results, and dependencies before acting.
- Do not retry the same instructions unchanged.
- Create a materially different execution plan that addresses the failure cause. The corrective task must not depend on the failed task. Create replacement downstream tasks with dependencies on the corrective task instead of trying to unlock the failed chain.
- Assign only the first ready corrective task during this review. Explain the changed approach in central office.`;

class TaskReviewTrigger {
  constructor({ review, onError = () => {} } = {}) {
    if (typeof review !== "function") throw new TypeError("Task review callback is required.");
    this.review = review;
    this.onError = onError;
    this.tail = Promise.resolve();
  }

  notify(event, task) {
    if (!TERMINAL_TASK_EVENTS.has(event)) return false;
    const run = () => this.review({ event, task: { ...task } });
    const result = this.tail.then(run, run);
    this.tail = result.catch((error) => this.onError(error, { event, task })).then(() => undefined);
    return true;
  }

  whenIdle() {
    return this.tail;
  }
}

export { FAILURE_RECOVERY_POLICY, SEQUENTIAL_ORCHESTRATION_POLICY, TERMINAL_TASK_EVENTS, TaskReviewTrigger };
