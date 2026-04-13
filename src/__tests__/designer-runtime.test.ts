import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkflowDefinitionFromStored } from "../app/designer-runtime";
import type { FTNApi, RetryOptions } from "../core/ftn";
import type { StoredWorkflow } from "../app/designer-types";
import type { ActivityId } from "../shared/types";

function createRecordingFtn(): { ftn: FTNApi; activityInputs: unknown[] } {
  const activityInputs: unknown[] = [];
  let actCounter = 0;
  const ftn = {
    activity<TInput, _TResult>(name: string, input: TInput) {
      activityInputs.push(input);
      actCounter += 1;
      return { id: `aid-${actCounter}` as ActivityId, name };
    },
    parallel() {
      throw new Error("unexpected parallel");
    },
    join<TResult>(handles: import("../core/ftn").ActivityHandle<TResult>[]) {
      return Promise.resolve(handles.map(() => ({ ok: true } as TResult)));
    },
    conditional() {
      throw new Error("unexpected conditional");
    },
    async retry<TResult>(options: RetryOptions, operation: (attempt: number) => Promise<TResult>): Promise<TResult> {
      let lastErr: unknown;
      for (let a = 1; a <= options.maxAttempts; a++) {
        try {
          return await operation(a);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
    sleep() {
      return Promise.resolve();
    },
    signal() {
      return Promise.resolve({} as never);
    },
    workflowId() {
      return "wf-mock";
    },
    runId() {
      return "run-mock";
    },
  } as FTNApi;
  return { ftn, activityInputs };
}

test("parallel branch activities resuelven plantillas en input como el flujo secuencial", async () => {
  const stored: StoredWorkflow = {
    id: "wf-par",
    version: "v1",
    displayName: "p",
    steps: [
      {
        id: "p1",
        kind: "parallel",
        branches: [["a1"]],
        next: null,
      },
      {
        id: "a1",
        kind: "activity",
        activityName: "echo",
        input: { msg: "{{input.x}}" },
      },
    ],
    entryStepId: "p1",
  };

  const { ftn, activityInputs } = createRecordingFtn();
  const def = buildWorkflowDefinitionFromStored(stored);
  await def(ftn, { x: "hello" });

  assert.equal(activityInputs.length, 1);
  assert.deepEqual(activityInputs[0], { msg: "hello" });
});

test("retry step ejecuta el activity referenciado vía ftn.retry", async () => {
  const stored: StoredWorkflow = {
    id: "wf-retry",
    version: "v1",
    displayName: "r",
    steps: [
      { id: "a1", kind: "activity", activityName: "echo", input: { x: 1 } },
      { id: "r1", kind: "retry", maxAttempts: 2, targetStepId: "a1", next: null },
    ],
    entryStepId: "r1",
  };

  const { ftn, activityInputs } = createRecordingFtn();
  const def = buildWorkflowDefinitionFromStored(stored);
  const out = await def(ftn, {});

  assert.equal(activityInputs.length, 1);
  assert.deepEqual(activityInputs[0], { x: 1 });
  assert.deepEqual((out as { steps: Record<string, unknown> }).steps.a1, { ok: true });
  assert.deepEqual((out as { steps: Record<string, unknown> }).steps.r1, { ok: true });
});
