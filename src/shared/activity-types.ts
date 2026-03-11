export interface ActivityTask {
    id: string;
    workflowId: string;
    runId: string;
    activityId: string;
    activityName: string;
    input: unknown;
    attempt: number;
    scheduledAt: string;
  }
  
  export interface ActivityResultSuccess {
    kind: "success";
    activityId: string;
    result: unknown;
  }
  
  export interface ActivityResultFailure {
    kind: "failure";
    activityId: string;
    errorType: string;
    errorMessage: string;
    retryable: boolean;
  }
  
  export type ActivityResult = ActivityResultSuccess | ActivityResultFailure;