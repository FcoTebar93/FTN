import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkflowDefinitionFromStored } from "../app/designer-runtime";
import type { FTNApi } from "../core/ftn";
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
    retry() {
      throw new Error("unexpected retry");
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
