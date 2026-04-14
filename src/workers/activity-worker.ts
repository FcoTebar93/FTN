// src/workers/activity-worker.ts
import type { ActivityRegistry } from "../core/activity-registry";
import type { ActivityExecutionContext } from "../core/activities";
import type { ActivityTask, ActivityResult } from "../shared/activity-types";
import type { ActivityRuntime } from "../modules/activity-runtime";

function isRetryableError(_err: unknown, def: { maxAttempts?: number } | undefined): boolean {
  return (def?.maxAttempts ?? 1) > 1;
}

export class ActivityWorker {
  constructor(
    private readonly registry: ActivityRegistry,
    private readonly runtime: ActivityRuntime
  ) {}

  async handleTask(rawMessage: unknown): Promise<void> {
    const task: ActivityTask = this.runtime.deserializeTask(rawMessage);
    const def = this.registry.get(task.activityName);

    if (!def) {
      const res: ActivityResult = {
        kind: "failure",
        activityId: task.activityId,
        errorType: "ActivityNotFound",
        errorMessage: `Activity ${task.activityName} not registered`,
        retryable: false,
      };
      await this.runtime.handleResult(task, res);
      return;
    }

    const ctx: ActivityExecutionContext = {
      workflowId: task.workflowId,
      runId: task.runId,
      activityId: task.activityId,
      attempt: task.attempt,
      scheduledAt: new Date(task.scheduledAt),
      ...(task.correlationId ? { correlationId: task.correlationId } : {}),
      log: (msg: string, meta?: Record<string, unknown>) => {
        console.log(`[activity:${def.name}] ${msg}`, {
          ...meta,
          workflowId: task.workflowId,
          runId: task.runId,
          ...(task.correlationId ? { correlationId: task.correlationId } : {}),
        });
      },
    };

    try {
      const result = await def.execute(task.input, ctx);
      const res: ActivityResult = {
        kind: "success",
        activityId: task.activityId,
        result,
      };
      await this.runtime.handleResult(task, res);
    } catch (err: any) {
      const retryable = isRetryableError(err, def);

      const res: ActivityResult = {
        kind: "failure",
        activityId: task.activityId,
        errorType: err?.name ?? "Error",
        errorMessage: err?.message ?? String(err),
        retryable,
      };

      await this.runtime.handleResult(task, res);
    }
  }
}