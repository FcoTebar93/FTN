import type { DefaultWorkflowEngine } from "../../core/default-engine";
import type { EventStore } from "../../modules/event-store";
import type { SnapshotStore } from "../../modules/snapshot-store";
import type { TaskQueue } from "../../modules/task-queue";
import type { ActivityRegistry } from "../../core/activity-registry";
import { DefaultActivityRuntime } from "../../modules/activity-runtime";
import { ActivityWorker } from "../../workers/activity-worker";
import { InMemoryActivityQueueWorker } from "../inmemory-activity-queue-worker";
import { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import { InMemoryWorkflowWorker } from "../inmemory-workflow-worker";
import { InMemoryTimerWorker } from "../inmemory-timer-worker";
import type { Logger } from "../logger";
import type { DeadLetterEntry, DeadLetterInput, DeadLetterStatus } from "../../shared/dead-letter";

export interface WorkersBootstrapResult {
  runtime: InMemoryWorkflowRuntime;
  cancellation: { aborted: boolean };
  listDeadLetters: (query?: {
    limit?: number;
    queueName?: string;
    taskType?: string;
    status?: DeadLetterStatus;
  }) => DeadLetterEntry[];
  requeueDeadLetter: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  acknowledgeDeadLetter: (id: string) => { ok: true } | { ok: false; error: string };
}

interface BootstrapWorkersInput {
  engine: DefaultWorkflowEngine;
  eventStore: EventStore;
  snapshotStore: SnapshotStore;
  taskQueue: TaskQueue;
  activities: ActivityRegistry;
  log: Logger;
}

export function bootstrapWorkers(input: BootstrapWorkersInput): WorkersBootstrapResult {
  const { engine, eventStore, snapshotStore, taskQueue, activities, log } = input;
  const activityRuntime = new DefaultActivityRuntime({ eventStore, snapshotStore, engine });
  const activityWorkerCore = new ActivityWorker(activities, activityRuntime);
  const deadLetterMaxItems = Math.max(
    100,
    Number.parseInt(process.env.FTN_DEAD_LETTER_MAX_ITEMS ?? "1000", 10) || 1000
  );
  const deadLetters: DeadLetterEntry[] = [];
  const addDeadLetter = (deadLetterInput: DeadLetterInput): void => {
    const entry: DeadLetterEntry = {
      id: `dlq-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      occurredAt: new Date().toISOString(),
      ...deadLetterInput,
    };
    deadLetters.unshift(entry);
    if (deadLetters.length > deadLetterMaxItems) {
      deadLetters.length = deadLetterMaxItems;
    }
  };
  const listDeadLetterStatus = (item: DeadLetterEntry): DeadLetterStatus => {
    if (item.acknowledgedAt) return "acknowledged";
    if (item.requeuedAt) return "requeued";
    return "pending";
  };
  const listDeadLetters = (query?: {
    limit?: number;
    queueName?: string;
    taskType?: string;
    status?: DeadLetterStatus;
  }): DeadLetterEntry[] => {
    const limit = Math.max(1, Math.min(500, query?.limit ?? 100));
    return deadLetters
      .filter((d) => (query?.queueName ? d.queueName === query.queueName : true))
      .filter((d) => (query?.taskType ? d.taskType === query.taskType : true))
      .filter((d) => (query?.status ? listDeadLetterStatus(d) === query.status : true))
      .slice(0, limit);
  };
  const requeueDeadLetter = async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const item = deadLetters.find((d) => d.id === id);
    if (!item) {
      return { ok: false, error: "Dead letter not found" };
    }
    if (item.requeuedAt) {
      return { ok: false, error: "Dead letter already requeued" };
    }
    if (!item.task) {
      return { ok: false, error: "Dead letter has no task payload to requeue" };
    }
    await taskQueue.enqueue(item.task);
    item.requeuedAt = new Date().toISOString();
    return { ok: true };
  };
  const acknowledgeDeadLetter = (id: string): { ok: true } | { ok: false; error: string } => {
    const item = deadLetters.find((d) => d.id === id);
    if (!item) {
      return { ok: false, error: "Dead letter not found" };
    }
    if (item.acknowledgedAt) {
      return { ok: false, error: "Dead letter already acknowledged" };
    }
    item.acknowledgedAt = new Date().toISOString();
    return { ok: true };
  };

  const activityQueueWorker = new InMemoryActivityQueueWorker({
    taskQueue,
    worker: activityWorkerCore,
    queueName: "activities",
    workerId: "activity-worker-1",
    leaseTimeoutMs: 10_000,
    pollIntervalMs: 100,
    log,
    onDeadLetter: addDeadLetter,
  });

  const runtime = new InMemoryWorkflowRuntime({
    engine,
    eventStore,
    snapshotStore,
    taskQueue,
    config: { snapshotInterval: 50 },
  });

  const workflowWorker = new InMemoryWorkflowWorker({
    workerId: "workflow-worker-1",
    taskQueue,
    runtime,
    log,
    onDeadLetter: addDeadLetter,
    config: {
      queueName: "workflows",
      leaseTimeoutMs: 10_000,
      pollIntervalMs: 100,
      concurrencyRetryMaxAttempts: Math.max(
        1,
        Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_ATTEMPTS ?? "8", 10) || 8
      ),
      concurrencyRetryBaseDelayMs: Math.max(
        0,
        Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_BASE_DELAY_MS ?? "25", 10) || 25
      ),
      concurrencyRetryMaxDelayMs: Math.max(
        1,
        Number.parseInt(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_MAX_DELAY_MS ?? "1000", 10) || 1000
      ),
      concurrencyRetryJitterRatio: Math.max(
        0,
        Number.parseFloat(process.env.FTN_WORKFLOW_CONCURRENCY_RETRY_JITTER_RATIO ?? "0.2") || 0.2
      ),
    },
  });

  const timerWorker = new InMemoryTimerWorker({
    taskQueue,
    queueName: "timers",
    workflowQueueName: "workflows",
    pollIntervalMs: 500,
    log,
    onDeadLetter: addDeadLetter,
  });

  const cancellation = { aborted: false };
  workflowWorker.runForever(cancellation).catch((err) => log.error("workflowWorker.runForever", { err: String(err) }));
  timerWorker.runForever(cancellation).catch((err) => log.error("timerWorker.runForever", { err: String(err) }));
  activityQueueWorker.runForever(cancellation).catch((err) => log.error("activityQueueWorker.runForever", { err: String(err) }));

  return {
    runtime,
    cancellation,
    listDeadLetters,
    requeueDeadLetter,
    acknowledgeDeadLetter,
  };
}
