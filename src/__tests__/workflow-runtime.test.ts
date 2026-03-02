import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DefaultWorkflowEngine } from "../core/default-engine";
import { InMemoryEventStore } from "../infra/inmemory-event-store";
import { InMemorySnapshotStore } from "../infra/inmemory-snapshot-store";
import { InMemoryWorkflowRuntime } from "../infra/inmemory-workflow-runtime";

describe("InMemoryWorkflowRuntime", () => {
  it("inicia un workflow y reconstruye el estado básico", async () => {
    const engine = new DefaultWorkflowEngine();
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new InMemorySnapshotStore();

    const runtime = new InMemoryWorkflowRuntime({
      engine,
      eventStore,
      snapshotStore,
      config: { snapshotInterval: 50 },
    });

    const { workflowId, runId, version } = await runtime.startWorkflow({
      workflowName: "example",
      input: { foo: "bar" },
      definition: async () => ({ ok: true }), // de momento no se usa en runWorkflowTick
    });

    assert.equal(version, 1);

    const tick = await runtime.runWorkflowTick(workflowId, runId);
    const state = await runtime.loadCurrentState(workflowId, runId);

    assert.equal(tick.state.id, workflowId);
    assert.equal(tick.state.runId, runId);
    assert.equal(tick.state.status, "running");
    assert.ok(state);
    assert.ok(state?.startedAt);
  });
});