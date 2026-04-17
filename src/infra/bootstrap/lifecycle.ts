import type http from "node:http";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { runScheduledWorkflowTick } from "../../app/designer-scheduler";
import type { RedisTaskQueue } from "../redis-task-queue";
import type { Logger } from "../logger";

interface StartLifecycleInput {
  cancellation: { aborted: boolean };
  redisTaskQueue?: RedisTaskQueue;
  recoverIntervalMs: number;
  staleLeaseMs: number;
  designerSchedulerIntervalMs: number;
  listSchedulerRows: Parameters<typeof runScheduledWorkflowTick>[0]["listSchedulerRows"];
  recordScheduledRun: Parameters<typeof runScheduledWorkflowTick>[0]["recordScheduledRun"];
  recordScheduledFailure: Parameters<typeof runScheduledWorkflowTick>[0]["recordScheduledFailure"];
  startWorkflow: Parameters<typeof runScheduledWorkflowTick>[0]["startWorkflow"];
  log: Logger;
}

export interface LifecycleHandle {
  stop(): Promise<void>;
}

interface ShutdownResources {
  pool?: Pool;
  redis?: Redis;
  server: http.Server;
}

export function startLifecycle(input: StartLifecycleInput): LifecycleHandle {
  const {
    cancellation,
    redisTaskQueue,
    recoverIntervalMs,
    staleLeaseMs,
    designerSchedulerIntervalMs,
    listSchedulerRows,
    recordScheduledRun,
    recordScheduledFailure,
    startWorkflow,
    log,
  } = input;
  let recoverTimer: ReturnType<typeof setInterval> | undefined;
  if (redisTaskQueue && recoverIntervalMs > 0) {
    const queues = ["workflows", "activities", "timers"] as const;
    recoverTimer = setInterval(() => {
      if (cancellation.aborted) {
        return;
      }
      void (async () => {
        for (const q of queues) {
          try {
            const n = await redisTaskQueue.recoverStaleProcessing(q, staleLeaseMs);
            if (n > 0) {
              log.info("ftn.taskQueue.recovered", { queue: q, count: n });
            }
          } catch (e) {
            log.error("ftn.taskQueue.recoverFailed", { queue: q, err: String(e) });
          }
        }
      })();
    }, recoverIntervalMs);
  }

  const designerSchedulerTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (cancellation.aborted) {
      return;
    }
    void runScheduledWorkflowTick({
      listSchedulerRows,
      recordScheduledRun,
      recordScheduledFailure,
      startWorkflow,
      log,
    });
  }, designerSchedulerIntervalMs);

  return {
    async stop(): Promise<void> {
      cancellation.aborted = true;
      if (recoverTimer) {
        clearInterval(recoverTimer);
      }
      clearInterval(designerSchedulerTimer);
    },
  };
}

export function registerShutdownHooks(lifecycle: LifecycleHandle, resources: ShutdownResources): void {
  const shutdown = async () => {
    await lifecycle.stop();
    if (resources.pool) {
      await resources.pool.end();
    }
    if (resources.redis) {
      await resources.redis.quit();
    }
    resources.server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
