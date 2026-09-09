import assert from "node:assert/strict";
import test from "node:test";
import { TaskReviewTrigger } from "../lib/task-review-trigger.js";

test("terminal task events trigger serialized Office Manager reviews", async () => {
  const reviews = [];
  let releaseFirst;
  const firstReview = new Promise((resolve) => { releaseFirst = resolve; });
  const trigger = new TaskReviewTrigger({
    async review({ event, task }) {
      reviews.push(`${event}:${task.id}:start`);
      if (task.id === "one") await firstReview;
      reviews.push(`${event}:${task.id}:finish`);
    },
  });

  assert.equal(trigger.notify("working", { id: "ignored" }), false);
  assert.equal(trigger.notify("completed", { id: "one" }), true);
  assert.equal(trigger.notify("failed", { id: "two" }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reviews, ["completed:one:start"]);

  releaseFirst();
  await trigger.whenIdle();
  assert.deepEqual(reviews, [
    "completed:one:start",
    "completed:one:finish",
    "failed:two:start",
    "failed:two:finish",
  ]);
});
