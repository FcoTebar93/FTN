import type { WorkflowDefinition } from "../core/ftn";
import type { StoredWorkflow, WorkflowStep } from "./designer-types";

interface ExecutionContext {
  input: any;
  stepResults: Record<string, unknown>;
}

function findStep(stored: StoredWorkflow, id: string): WorkflowStep {
  const step = stored.steps.find((s) => s.id === id);
  if (!step) {
    throw new Error(`Step "${id}" not found in workflow "${stored.id}"`);
  }
  return step;
}

export function buildWorkflowDefinitionFromStored(
  stored: StoredWorkflow
): WorkflowDefinition<any, any> {
  return async (ftn, input) => {
    const ctx: ExecutionContext = {
      input,
      stepResults: {},
    };

    let currentId: string | null = stored.entryStepId;

    while (currentId) {
      const step = findStep(stored, currentId);

      if (step.kind === "activity") {
        const handle = ftn.activity<any, any>(step.activityName, step.input);
        const [result] = await ftn.join([handle]);
        ctx.stepResults[step.id] = result;
      } else if (step.kind === "sleep") {
        await ftn.sleep(step.milliseconds);
        ctx.stepResults[step.id] = true;
      } else if (step.kind === "signal") {
        const signalData = await ftn.signal<any>(step.signalName);
        ctx.stepResults[step.id] = signalData;
      }

      currentId = step.next ?? null;
    }

    return {
      input,
      steps: ctx.stepResults,
    };
  };
}