import type { WorkflowDefinition } from "../core/ftn";
import type { ActivityStep, ConditionalStep, ParallelStep, RetryStep, StoredWorkflow, WorkflowStep } from "./designer-types";
import {
  evalCondition,
  resolveTemplatesInValue,
  type DesignerExecutionContext,
} from "./designer-expression";

type ExecutionContext = DesignerExecutionContext;

function findStep(stored: StoredWorkflow, id: string): WorkflowStep {
  const step = stored.steps.find((s) => s.id === id);
  if (!step) {
    throw new Error(`Step "${id}" not found in workflow "${stored.id}"`);
  }
  return step;
}

export function buildWorkflowDefinitionFromStored(
  stored: StoredWorkflow
): WorkflowDefinition<unknown, unknown> {
  return async (ftn, input) => {
    const ctx: ExecutionContext = {
      input,
      stepResults: {},
    };

    let currentId: string | null = stored.entryStepId;

    while (currentId) {
      const step = findStep(stored, currentId);

      if (step.kind === "activity") {
        const resolvedInput = resolveTemplatesInValue(step.input, ctx);
        const handle = ftn.activity<unknown, unknown>(step.activityName, resolvedInput);
        const [result] = await ftn.join([handle]);
        ctx.stepResults[step.id] = result;
      } else if (step.kind === "sleep") {
        await ftn.sleep(step.milliseconds);
        ctx.stepResults[step.id] = true;
      } else if (step.kind === "signal") {
        const signalData = await ftn.signal<unknown>(step.signalName);
        ctx.stepResults[step.id] = signalData;
      } else if (step.kind === "conditional") {
        const cond = (step as ConditionalStep);
        const ok = evalCondition(cond.expression, ctx);
        currentId = ok ? cond.thenNext ?? null : cond.elseNext ?? null;
        continue;
      } else if (step.kind === "retry") {
        const r = step as RetryStep;
        const target = findStep(stored, r.targetStepId);
        if (target.kind !== "activity") {
          throw new Error(`Retry step "${step.id}" target "${r.targetStepId}" must be an activity step`);
        }
        const act = target as ActivityStep;
        const resolvedInput = resolveTemplatesInValue(act.input, ctx);
        const result = await ftn.retry(
          { maxAttempts: Math.max(1, r.maxAttempts), backOffMs: r.backOffMs },
          async () => {
            const h = ftn.activity<unknown, unknown>(act.activityName, resolvedInput);
            const [out] = await ftn.join([h]);
            return out;
          }
        );
        ctx.stepResults[step.id] = result;
        ctx.stepResults[r.targetStepId] = result;
      } else if (step.kind === "parallel") {
        const p = step as ParallelStep;
      
        const branchActivityHandles: Promise<void>[] = [];
      
        for (const branch of p.branches) {
          for (const stepId of branch) {
            const targetStep = findStep(stored, stepId);
            if (targetStep.kind !== "activity") continue;
            const resolvedBranchInput = resolveTemplatesInValue((targetStep as ActivityStep).input ?? {}, ctx);
            const handle = ftn.activity<unknown, unknown>((targetStep as ActivityStep).activityName, resolvedBranchInput);
            branchActivityHandles.push(ftn.join([handle]).then(([r]) => {
              ctx.stepResults[stepId] = r;
            }));
          }
        }
      
        if (branchActivityHandles.length > 0) {
          await Promise.all(branchActivityHandles);
        }
      
        currentId = step.next ?? null;
        continue;
      }

      currentId = step.next ?? null;
    }

    return {
      input,
      steps: ctx.stepResults,
    };
  };
}
