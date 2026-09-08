import { selectAutoAssignedWorker } from "./task-assignment.js";

const UNIT_MILLISECONDS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export class PeriodicOperationScheduler {
  constructor({ uiStateStore, subAgentManager, intervalMs = 5_000, now = () => Date.now() }) {
    this.uiStateStore = uiStateStore;
    this.subAgentManager = subAgentManager;
    this.intervalMs = intervalMs;
    this.now = now;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.now();
      const due = this.uiStateStore.getPeriodicOperations().filter((operation) => (
        operation.enabled && operation.nextRunAt !== null && operation.nextRunAt <= now
      ));
      for (const operation of due) this.dispatch(operation, now);
    } finally {
      this.running = false;
    }
  }

  dispatch(operation, now = this.now()) {
    const interval = operation.intervalValue * UNIT_MILLISECONDS[operation.intervalUnit];
    const nextRunAt = now + interval;
    try {
      const workers = this.subAgentManager.listWorkers();
      const worker = operation.agent === "auto"
        ? selectAutoAssignedWorker(workers, this.subAgentManager.listTasks())
        : workers.find((entry) => entry.name === operation.agent);
      if (!worker) throw new Error(`Assigned agent “${operation.agent}” is not registered.`);
      const queued = this.subAgentManager.queue({
        agent: worker.name,
        task: operation.task,
        priority: operation.priority,
      });
      this.uiStateStore.recordPeriodicOperationRun(operation.id, {
        lastRunAt: now,
        nextRunAt,
        status: `queued:${worker.name}`,
      });
      void queued.completion.then((result) => {
        const status = result.ok ? "completed" : result.status || "failed";
        this.uiStateStore.recordPeriodicOperationResult(operation.id, {
          status,
          error: result.ok ? null : result.error,
        });
        this.uiStateStore.recordOfficeMemory({
          kind: "operation",
          status,
          title: operation.name,
          summary: String(result.text || result.error || "Periodic task completed.").slice(0, 20_000),
          agent: worker.name,
          sourceId: operation.id,
          artifacts: result.deliveredWork || [],
          details: { task: operation.task, priority: operation.priority, scheduledAt: now, nextRunAt },
        });
      }).catch((error) => {
        this.uiStateStore.recordPeriodicOperationResult(operation.id, { status: "failed", error: error.message });
        this.uiStateStore.recordOfficeMemory({
          kind: "operation", status: "failed", title: operation.name, summary: error.message,
          agent: worker.name, sourceId: operation.id,
          details: { task: operation.task, priority: operation.priority, scheduledAt: now, nextRunAt },
        });
      });
    } catch (error) {
      this.uiStateStore.recordPeriodicOperationRun(operation.id, {
        lastRunAt: now,
        nextRunAt,
        status: "failed",
        error: error.message,
      });
      this.uiStateStore.recordOfficeMemory({
        kind: "operation", status: "failed", title: operation.name, summary: error.message,
        agent: operation.agent, sourceId: operation.id,
        details: { task: operation.task, priority: operation.priority, scheduledAt: now, nextRunAt },
      });
    }
  }
}
