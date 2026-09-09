# Sequential task orchestration

The Office Manager treats multi-stage projects as dependency chains. It creates pending tasks in prerequisite order and records prerequisite task IDs in each task's `depends_on` field. Creating a task never assigns it.

During one review turn, the Office Manager may assign at most one ready task. A task is ready only when every task listed in `depends_on` has status `completed`; the server rejects any earlier assignment attempt.

When a dependent task is dispatched, the server automatically prepends the completed prerequisite chain to the worker prompt. That context contains each prerequisite's title, result text, and delivered-file paths. The worker therefore receives the prior research, design decisions, or implementation output along with its own instructions, even if the Office Manager does not repeat those details manually.

The server starts a new Office Manager review whenever delegated work becomes `completed`, `failed`, or `timed_out`. The review receives the settled result, delivered files, current queue, and recent central-office conversation. It must inspect that context before deciding whether to assign the next stage.

If a prerequisite fails, dependent work remains pending. The manager can create and assign one corrective task, or report that the sequence is blocked. It must not dispatch the blocked downstream tasks.

An operator can stop a running task from `/tasks`. The office sends `task_cancel` to the assigned worker, records the task as `cancelled`, publishes the cancellation to central chat and memory, and triggers an Office Manager review. Cancelled prerequisites do not unlock dependent tasks, and the manager does not recreate or reassign cancelled work unless the operator explicitly requests it.

Example:

1. Research data — no dependencies.
2. Design UI — depends on Research data.
3. Implement website — depends on Design UI.
4. Review logic and system prompts — depends on Implement website.

Only the first stage is assigned initially. Each terminal event triggers review of its output before the next stage can begin.
