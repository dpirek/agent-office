const TERMINAL_TASK_EVENTS = new Set(["completed", "failed", "timed_out"]);

const SEQUENTIAL_ORCHESTRATION_POLICY = `Sequential orchestration policy:
- For multi-stage work, create a dependency chain of pending tasks using depends_on task IDs.
- Assign only one ready task during this review turn. Never dispatch dependent stages together.
- A task is ready only when every depends_on task is completed.
- After a task settles, review its result, delivered files, and failures before deciding what comes next.
- If a prerequisite fails, keep downstream work pending and either create one corrective task or explain why the sequence is blocked.`;

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

export { SEQUENTIAL_ORCHESTRATION_POLICY, TERMINAL_TASK_EVENTS, TaskReviewTrigger };
