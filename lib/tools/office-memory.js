import { objectSchema } from "./shared.js";

function createOfficeMemoryTool({ uiStateStore }) {
  return {
    name: "read_office_memory",
    description: "Read durable office memory containing completed and failed delegated work, delivered artifacts, and periodic operation outcomes. Use it to recover relevant prior context before planning or delegating related work.",
    parameters: objectSchema({
      query: { type: ["string", "null"], description: "Optional case-insensitive search across title, summary, and agent." },
      kind: { type: ["string", "null"], enum: ["task", "operation", "system", null], description: "Optional memory record type." },
      status: { type: ["string", "null"], description: "Optional exact status such as completed, failed, timed_out, or cancelled." },
      limit: { type: ["integer", "null"], minimum: 1, maximum: 100, description: "Maximum records to return; defaults to 25." },
    }, []),
    async execute({ query = null, kind = null, status = null, limit = 25 } = {}) {
      if (!uiStateStore) return { ok: false, error: "Office memory is unavailable." };
      const records = uiStateStore.getOfficeMemory({
        query: query || undefined,
        kind: kind || undefined,
        status: status || undefined,
        limit: limit || 25,
      });
      return { ok: true, records };
    },
  };
}

export { createOfficeMemoryTool };
