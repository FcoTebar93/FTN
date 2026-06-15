import type { DesignerStepKind } from "../../api/types";

export type StepBlockOption = {
  kind: DesignerStepKind;
  labelKey: keyof typeof STEP_BLOCK_LABEL_KEYS;
};

export const STEP_BLOCK_LABEL_KEYS = {
  activity: "stepBlockActivity",
  sleep: "stepBlockSleep",
  signal: "stepBlockSignal",
  conditional: "stepBlockConditional",
  parallel: "stepBlockParallel",
  retry: "stepBlockRetry",
} as const;

export const STEP_BLOCK_OPTIONS: StepBlockOption[] = [
  { kind: "activity", labelKey: "stepBlockActivity" },
  { kind: "sleep", labelKey: "stepBlockSleep" },
  { kind: "signal", labelKey: "stepBlockSignal" },
  { kind: "conditional", labelKey: "stepBlockConditional" },
  { kind: "parallel", labelKey: "stepBlockParallel" },
  { kind: "retry", labelKey: "stepBlockRetry" },
];

export function stepDisplayLabel(step: { id: string; name?: string }): string {
  return step.name?.trim() || step.id;
}

export function statusLabelKey(status: string): string {
  switch (status) {
    case "running":
      return "statusRunning";
    case "completed":
      return "statusCompleted";
    case "failed":
      return "statusFailed";
    case "cancelled":
      return "statusCancelled";
    case "pending":
      return "statusPending";
    case "waiting":
      return "statusWaiting";
    case "idle":
      return "statusIdle";
    default:
      return status;
  }
}
