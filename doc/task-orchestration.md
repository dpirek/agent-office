# Sequential task orchestration

The Office Manager treats multi-stage projects as dependency chains. It creates pending tasks in prerequisite order and records prerequisite task IDs in each task's `depends_on` field. Creating a task never assigns it.

During one review turn, the Office Manager may assign at most one ready task. A task is ready only when every task listed in `depends_on` has status `completed`; the server rejects any earlier assignment attempt.

When a dependent task is dispatched, the server automatically prepends the completed prerequisite chain to the worker prompt. That context contains each prerequisite's title, result text, and delivered-file paths. The worker therefore receives the prior research, design decisions, or implementation output along with its own instructions, even if the Office Manager does not repeat those details manually.

The server starts a new Office Manager review whenever delegated work becomes `completed`, `failed`, or `timed_out`. The review receives the settled result, delivered files, current queue, and recent central-office conversation. It must inspect that context before deciding whether to assign the next stage.

If a prerequisite fails, dependent work remains pending. The manager must inspect the failure and create a materially different corrective plan rather than retrying identical instructions. The corrective task must not depend on the failed task; replacement downstream tasks form a new dependency chain from the corrective work. Only the first ready corrective task is assigned during the failure review.

## A2A progress and interruption

Office consumes standard A2A status/artifact streams when advertised and polls `GetTask` for nonstreaming agents or interrupted streams. It does not create separate model requests to ask workers for progress.

Input-required and auth-required tasks remain active. Use the task row's Reply action or `manage_office_tasks` action `continue` to resume the same remote task and context. Update agent credentials before resuming an auth-required task.

Stopping a running task calls standard `CancelTask`. Office records the returned remote state; an unavailable agent or rejected cancellation does not falsely mark it cancelled. Tasks still in local preparation can be cancelled without submission. A local timeout means Office stopped waiting, not that remote execution ended.

Non-running tasks can be deleted from `/tasks` with the trash icon. Running work must be stopped first. A task referenced by downstream dependencies cannot be deleted until those dependent tasks are removed, preventing an accidental orphaned or incorrectly unlocked chain. Deleting a task removes it from the queue but does not erase existing Central Office or Memory history.

Example:

1. Research data — no dependencies.
2. Design UI — depends on Research data.
3. Implement website — depends on Design UI.
4. Review logic and system prompts — depends on Implement website.

Only the first stage is assigned initially. Each terminal event triggers review of its output before the next stage can begin.
