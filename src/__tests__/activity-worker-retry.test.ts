import assert from "node:assert/strict";
import { test } from "node:test";

import { ActivityWorker } from "../workers/activity-worker";
import { InMemoryActivityRegistry } from "../modules/activity-registry/inmemory-activity-registry";
import type { ActivityResult, ActivityTask } from "../shared/activity-types";

test("ActivityWorker marca fallo como retryable cuando maxAttempts > 1", async () => {
  const registry = new InMemoryActivityRegistry();
  registry.register({
    name: "flaky",
    maxAttempts: 3,
    async execute() {
      throw new Error("fallo transitorio");
    },
  });

  const results: ActivityResult[] = [];
  const runtime = {
    deserializeTask: (raw: unknown) => raw as ActivityTask,
    handleResult: async (_task: ActivityTask, result: ActivityResult) => {
      results.push(result);
    },
  };

  const worker = new ActivityWorker(registry, runtime as never);
  const task: ActivityTask = {
    id: "task-1",
    activityId: "a1",
    activityName: "flaky",
    workflowId: "w",
    runId: "r",
    attempt: 1,
    input: {},
    scheduledAt: new Date().toISOString(),
  };

  await worker.handleTask(task);
  const lastResult = results[0];
  assert.equal(lastResult?.kind, "failure");
  if (lastResult?.kind === "failure") {
    assert.equal(lastResult.retryable, true);
  }
});

test("ActivityWorker marca ActivityNotFound como no retryable", async () => {
  const registry = new InMemoryActivityRegistry();
  const results: ActivityResult[] = [];
  const runtime = {
    deserializeTask: (raw: unknown) => raw as ActivityTask,
    handleResult: async (_task: ActivityTask, result: ActivityResult) => {
      results.push(result);
    },
  };

  const worker = new ActivityWorker(registry, runtime as never);
  const task: ActivityTask = {
    id: "task-2",
    activityId: "a1",
    activityName: "no-existe",
    workflowId: "w",
    runId: "r",
    attempt: 1,
    input: {},
    scheduledAt: new Date().toISOString(),
  };

  await worker.handleTask(task);
  const lastResult = results[0];
  assert.equal(lastResult?.kind, "failure");
  if (lastResult?.kind === "failure") {
    assert.equal(lastResult.retryable, false);
  }
});
