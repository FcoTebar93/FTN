import type { ActivityId, WorkflowId, RunId } from "../shared/types";

export interface ActivityHandle<TResult> {
    id: ActivityId;
    name: string;
}

export interface RetryOptions {
    maxAttempts: number;
    backOffMs?: number;
}

export interface ParallelOptions {
    maxConcurrency?: number;
}

export interface FTNApi {
    activity<TInput, TResult>(name: string, input: TInput, options?: { retry?: RetryOptions; timeoutMs?: number }): Promise<TResult>;

    parallel<TResult>(branches: Array<() => void>): ActivityHandle<TResult>[];

    join<TResult>(handles: ActivityHandle<TResult>[]): Promise<TResult[]>;

    conditional<TResult>(
        condition: () => boolean,
        thenBranch: () => Promise<TResult>,
        elseBranch?: () => Promise<TResult>
    ): Promise<TResult>;

    retry<TResult>(options: RetryOptions, operation: (attempt: number) => Promise<TResult>): Promise<TResult>;

    sleep(ms: number): Promise<void>;

    signal<TData = unknown>(name: string): Promise<TData>;

    workflowId(): WorkflowId;
    runId(): RunId;
}

export type WorkflowDefinition<TInput, TResult> = (ftn: FTNApi, input: TInput) => Promise<TResult> | TResult;