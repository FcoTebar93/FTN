# FTN Workflow Engine (TypeScript)  
  
FTN is a deterministic workflow engine built in TypeScript, using event sourcing and designed from day one for multi‑worker execution (workflow workers and activity workers). The goal is to provide a clean, strongly‑typed core + DSL foundation that can grow into a production‑grade orchestration platform.  
  
## Requirements  
  
- Node.js >= 20  
- npm >= 9  
  
## Install & Run  
  
```bash  
# Install dependencies  
npm install  
  
# Compile TypeScript into dist/  
npm run build  
  
# Run tests (builds first, then runs node:test on dist/__tests__)  
npm test

## Project Layout

```text
src/
  core/           # Pure deterministic core: events, state, engine, FTN DSL
  modules/        # Interfaces: EventStore, SnapshotStore, TaskQueue, WorkflowRuntime
  infra/          # In-memory implementations of persistence, runtime and workers
  workers/        # Worker contracts (workflow-worker, activity-worker)
  app/            # User activities registry (ActivityRegistry)
  shared/         # Shared types, IDs, task models
  __tests__/      # Integration tests (node:test)
```

---

## Core Concepts

### Events (`src/core/events.ts`)

The engine is fully event‑sourced. Main event types:

- `WorkflowStarted`
- `ActivityScheduled`, `ActivityCompleted`, `ActivityFailed`
- `WorkflowCompleted`, `WorkflowFailed`
- `TimerScheduled` (DSL `ftn.sleep`)
- `SignalReceived` (DSL `ftn.signal`)
- `SnapshotCreated` (for future auditing / metadata)

Each event is a discriminated union member of `WorkflowEvent`, tagged by `type`.

### Workflow State (`src/core/workflow-state.ts`)

In‑memory representation of workflow state:

- Identity and status:
  - `id: WorkflowId`
  - `runId: RunId`
  - `status: "running" | "completed" | "failed"`
  - `version: Version`
  - `startedAt`, `completedAt`, `failedAt`, `failureReason`
- Activities:
  - `pendingActivities: PendingActivity[]`
  - `completedActivities: CompletedActivity[]`
- Timers:
  - `pendingTimers: { wakeAt: string }[]`
- Result:
  - `result?: unknown` — logical result of the workflow when completed
- DSL internal state:
  - `stepState: unknown` — future hook for richer step graphs / state machines

### Engine (`src/core/engine.ts`, `src/core/default-engine.ts`)

- `WorkflowEngine` interface:
  - `initializeFromStartEvent(event: WorkflowEvent): WorkflowState`
  - `applyEvent(state, event): WorkflowState`
  - `replay(workflowId, runId, events, baseState?): RehydratedWorkflow`
- `DefaultWorkflowEngine`:
  - Applies each concrete event type to `WorkflowState`.
  - Rebuilds state from snapshots + remaining events (pure, no IO).

### FTN DSL (`src/core/ftn.ts`)

Public programming model for workflows:

```ts
export interface ActivityHandle<TResult> {
  id: ActivityId;
  name: string;
}

export interface FTNApi {
  activity<TInput, TResult>(name: string, input: TInput): ActivityHandle<TResult>;

  parallel<TResult>(
    branches: Array<() => ActivityHandle<TResult>>
  ): ActivityHandle<TResult>[];

  join<TResult>(handles: ActivityHandle<TResult>[]): Promise<TResult[]>;

  retry<TResult>(options: RetryOptions, operation: () => Promise<TResult>): Promise<TResult>;

  sleep(ms: number): Promise<void>;

  signal<TData = unknown>(name: string): Promise<TData>;

  // conditional: to be refined later
}

export type WorkflowDefinition<TInput, TResult> =
  (ftn: FTNApi, input: TInput) => Promise<TResult> | TResult;
```

Rules:

- **All side effects go through `ftn`** (no direct IO inside workflows).
- Workflows are **deterministic and replay‑safe**, driven solely by event history.

---

## Modules (Interfaces) – `src/modules/`

These decouple the core from concrete infra:

- `event-store.ts`
  - `EventStore`:
    - `loadEvents(workflowId, runId, fromVersion)`
    - `appendEvents(workflowId, runId, expectedVersion, events)`
  - `ConcurrencyError` for optimistic locking violations.
- `snapshot-store.ts`
  - `SnapshotStore` and `WorkflowSnapshot` (version + state + timestamp).
- `task-queue.ts`
  - `TaskQueue`:
    - `enqueue(task)`
    - `leaseNextTask(workerId, queueName, leaseTimeoutMs)`
    - `completeTask(leaseId)`
    - `requeueTask(taskId)`
- `workflow-runtime.ts`
  - `WorkflowRuntimeConfig` (e.g. `snapshotInterval`).
  - `WorkflowRuntime`:
    - `startWorkflow`
    - `runWorkflowTick`
    - `loadCurrentState`

---

## In-Memory Infra – `src/infra/`

### Event Store (`inmemory-event-store.ts`)

- In‑memory map `streamKey (workflowId:runId) -> WorkflowEvent[]`.
- `appendEvents`:
  - Computes current stream version.
  - Checks `expectedVersion` (optimistic locking).
  - Assigns `id`, `version`, `startedAt` to new events.

### Snapshot Store (`inmemory-snapshot-store.ts`)

- Map `workflowId:runId -> WorkflowSnapshot`.
- `saveSnapshot` / `loadLatestSnapshot`.

### Task Queue (`inmemory-task-queue.ts`)

- Queues keyed by `targetQueue: Task[]`.
- Leases tracked in a map `leaseId -> TaskLease`.
- Operations:
  - `enqueue`
  - `leaseNextTask`
  - `completeTask`
  - `requeueTask`

### Workflow Runtime (`inmemory-workflow-runtime.ts`)

Implements `WorkflowRuntime` using the engine and infra:

- `**startWorkflow`**:
  - Generates IDs (`workflowId`, `runId`).
  - Stores the `WorkflowDefinition` and input in an internal map.
  - Appends `WorkflowStarted`.
- `**runWorkflowTick**`:
  1. Load latest snapshot (if any).
  2. Load events from `snapshot.version` onward.
  3. `replay(...)` in `DefaultWorkflowEngine`:
    - Rehydrates `currentState` and `lastEventVersion`.
  4. Construct `ftn: FTNApi` bound to this workflow/run:
    - `activity` → pushes `ActivityScheduled` into `newDomainEvents`.
    - `parallel` → calls multiple `activity(...)` branches and returns handles.
    - `join` → looks up results in `currentState.completedActivities`.
    - `sleep` → pushes `TimerScheduled`.
    - `signal` → loads all events and returns the last matching `SignalReceived`.
  5. Execute workflow definition once at the appropriate moment (current heuristic: first tick, or when needed).
  6. Persist `newDomainEvents`:
    - Append to event store.
    - Apply each new event to `currentState`.
    - For each `ActivityScheduled`, enqueue an `ActivityTask` in the `"activities"` queue.
  7. If `currentState.status === "running"` and there are no pending activities or timers:
    - Append `WorkflowCompleted` with the definition’s return value.
    - Apply it to `currentState`.
  8. Snapshot:
    - Compute `eventsSinceSnapshot = lastEventVersion - snapshotBaseVersion`.
    - If `eventsSinceSnapshot >= snapshotInterval`, save snapshot at `lastEventVersion`.
  9. Return `WorkflowTickResult`:
    - `state`, `newEvents`, `snapshotCreated`.
- `**loadCurrentState**`:
  - Load snapshot + events since snapshot.
  - `replay(...)` via engine.
  - Return current `WorkflowState` (or `null` if no events).

### Activity Worker (`inmemory-activity-worker.ts`)

- `runOnce`:
  - Lease `ActivityTask` from `"activities"` queue.
  - Load workflow state (snapshot + events, replay).
  - Retrieve pending activity (by `activityId`).
  - Resolve user function from `ActivityRegistry`.
  - Execute activity and capture result.
  - Append `ActivityCompleted` and apply to `WorkflowState`.
  - Mark lease completed.

### Workflow Worker (`inmemory-workflow-worker.ts`)

- `runOnce`:
  - Lease `WorkflowTask` from `"workflows"` queue.
  - Call `runtime.runWorkflowTick(workflowId, runId)`.
  - Mark lease completed.

---

## App & Shared

### Activities (`src/app/activities.ts`)

- `ActivityFn`, `ActivityRegistry`, `InMemoryActivityRegistry`.
- Example registration:

```ts
const activities = new InMemoryActivityRegistry();
activities.register("echo", async (input: { value: number }) => input.value);
```

### Shared Types & Tasks (`src/shared/`)

- `types.ts`:
  - ID types: `WorkflowId`, `RunId`, `ActivityId`, `WorkerId`, `EventId`, `Version`.
  - `CancellationSignal` (light abstraction used by workers).
- `tasks.ts`:
  - `BaseTask`, `WorkflowTask`, `ActivityTask`, `TaskLease`.

---

## Tests (`src/__tests__/`)

Using `node:test` + `node:assert/strict`, compiled to `dist/__tests__`.

### `workflow-runtime.test.ts`

Covers:

- Starting and rehydrating a workflow.
- `ftn.activity`:
  - Appends `ActivityScheduled`.
  - Updates `pendingActivities`.
  - Enqueues `ActivityTask`.
- Activity execution:
  - `InMemoryActivityWorker`:
    - Consumes `ActivityTask`, executes user activity, appends `ActivityCompleted`.
    - Moves activity from `pending` to `completed`.
- `ftn.sleep`:
  - Emits `TimerScheduled`.
  - Adds `pendingTimers`.
- `parallel` and `join`:
  - `parallel` schedules multiple activities in one tick.
  - After workers complete them, `completedActivities` holds results.
- `ftn.signal`:
  - Reads `SignalReceived` from the event log.
- `WorkflowCompleted`:
  - Simple workflow returning a value:
    - Emits `WorkflowCompleted`.
    - `WorkflowState.status === "completed"`.
    - `WorkflowState.result` set.
- Snapshots:
  - `snapshotInterval` low (e.g. 2).
  - After enough events, a snapshot is created.
  - Latest snapshot’s version matches the expected event version.

### `workflow-worker.test.ts`

- Asserts that:
  - `InMemoryWorkflowWorker` consumes a `WorkflowTask` and triggers a tick that schedules an activity.
  - `InMemoryActivityWorker` consumes the resulting `ActivityTask` and completes the activity, updating state.

---

## How to Define a New Workflow

Example:

```ts
import type { WorkflowDefinition } from "../core/ftn";

export interface EmailInput {
  userId: string;
  email: string;
}

export interface EmailResult {
  success: boolean;
}

export const sendWelcomeEmailWorkflow: WorkflowDefinition<
  EmailInput,
  EmailResult
> = async (ftn, input) => {
  const handle = ftn.activity<EmailInput, void>("send-welcome-email", input);

  // Could sleep or wait for other events here
  await ftn.sleep(1000);

  // In a later tick, after ActivityCompleted, join([handle]) could be used

  return { success: true };
};
```

You then wire this into `InMemoryWorkflowRuntime.startWorkflow` by passing the definition and its input (the runtime already stores the definition by workflow/run IDs internally).

---

## Next Steps

Some concrete directions to take this engine further:

1. **HTTP API / CLI**
  - Add `src/main.ts` to:
    - Build `InMemoryWorkflowRuntime`, workers and `ActivityRegistry`.
    - Start one workflow worker and one activity worker.
    - Expose:
      - `POST /workflows` to start workflows.
      - `GET /workflows/:workflowId/:runId` to inspect state.
      - `POST /workflows/:workflowId/:runId/signals` to append `SignalReceived`.
2. **Real persistence**
  - Implement `EventStore` and `SnapshotStore` on top of Postgres:
    - `events` table (append‑only, versioned, optimistic locking).
    - `snapshots` table.
  - Implement `TaskQueue` on top of Redis (lists or streams).
  - Add integration tests using Docker Compose.
3. **Richer DSL**
  - Proper `conditional` and `retry` semantics.
  - Higher‑level combinators for sub‑workflows and child runs.
  - Strongly‑typed `stepState` representing the workflow graph.
4. **Observability & Operations**
  - Logging hooks around event append, replay, and worker execution.
  - Metrics for queue depth, event throughput, and worker health.
5. **Workflow Versioning**
  - Strategy for evolving workflow definitions without breaking existing runs.
  - Event upcasting / state migration patterns.

