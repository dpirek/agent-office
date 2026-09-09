# Sequential task orchestration

The Office Manager treats multi-stage projects as dependency chains. It creates pending tasks in prerequisite order and records prerequisite task IDs in each task's `depends_on` field. Creating a task never assigns it.

During one review turn, the Office Manager may assign at most one ready task. A task is ready only when every task listed in `depends_on` has status `completed`; the server rejects any earlier assignment attempt.

When a dependent task is dispatched, the server automatically prepends the completed prerequisite chain to the worker prompt. That context contains each prerequisite's title, result text, and delivered-file paths. The worker therefore receives the prior research, design decisions, or implementation output along with its own instructions, even if the Office Manager does not repeat those details manually.

The server starts a new Office Manager review whenever delegated work becomes `completed`, `failed`, or `timed_out`. The review receives the settled result, delivered files, current queue, and recent central-office conversation. It must inspect that context before deciding whether to assign the next stage.

If a prerequisite fails, dependent work remains pending. The manager must inspect the failure and create a materially different corrective plan rather than retrying identical instructions. The corrective task must not depend on the failed task; replacement downstream tasks form a new dependency chain from the corrective work. Only the first ready corrective task is assigned during the failure review.

## Periodic progress checks

The office checks running tasks after `AI_HARNESS_TASK_PROGRESS_CHECK_INTERVAL_MS` and repeats at that interval while work remains active. The default is `300000` milliseconds (five minutes); accepted values range from `10000` milliseconds to 24 hours.

For every overdue task, the Office Manager sends the assigned worker a direct status request asking for completed progress, blockers, next step, and ETA. Only one status request can be outstanding for a task. The request and response are posted to Central Office and recorded in Memory. When the worker replies, the manager reviews the status and intervenes only when work is blocked or needs a different approach.

An operator can stop a running task from `/tasks`. The office sends `task_cancel` to the assigned worker, records the task as `cancelled`, publishes the cancellation to central chat and memory, and triggers an Office Manager review. Cancelled prerequisites do not unlock dependent tasks, and the manager does not recreate or reassign cancelled work unless the operator explicitly requests it.

Cancellation is idempotent and fail-safe. If the worker already reached a terminal state, the office reconciles that result instead of returning an error. If the worker record or socket is already gone, the stale running database record is closed locally as `cancelled`.

Non-running tasks can be deleted from `/tasks` with the trash icon. Running work must be stopped first. A task referenced by downstream dependencies cannot be deleted until those dependent tasks are removed, preventing an accidental orphaned or incorrectly unlocked chain. Deleting a task removes it from the queue but does not erase existing Central Office or Memory history.

Example:

1. Research data — no dependencies.
2. Design UI — depends on Research data.
3. Implement website — depends on Design UI.
4. Review logic and system prompts — depends on Implement website.

Only the first stage is assigned initially. Each terminal event triggers review of its output before the next stage can begin.
