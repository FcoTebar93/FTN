import type { ActivityId, WorkflowId, RunId } from "../shared/types";

export interface ActivityHandle<_TResult> {
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

export interface ForEachOptions {
    maxIterations?: number;
}

export interface FTNApi {
    activity<TInput, TResult>(name: string, input: TInput, attempt?: number): ActivityHandle<TResult>;
    parallel<TResult>(branches: Array<() => ActivityHandle<TResult>>): ActivityHandle<TResult>[];

    join<TResult>(handles: ActivityHandle<TResult>[]): Promise<TResult[]>;

    conditional<TResult>(
        condition: () => boolean,
        thenBranch: () => Promise<TResult>,
        elseBranch?: () => Promise<TResult>
    ): Promise<TResult>;

    retry<TResult>(options: RetryOptions, operation: (attempt: number) => Promise<TResult>): Promise<TResult>;

    sleep(ms: number): Promise<void>;

    signal<TData = unknown>(name: string): Promise<TData>;

    forEach<TItem, TResult = void>(
        items: TItem[],
        iteratee: (item: TItem, index: number) => Promise<TResult>,
        options?: ForEachOptions
    ): Promise<TResult[]>;

    child<TInput, TResult>(workflowName: string, input: TInput): Promise<TResult>;

    workflowId(): WorkflowId;
    runId(): RunId;
}

export type WorkflowDefinition<TInput, TResult> = (ftn: FTNApi, input: TInput) => Promise<TResult> | TResult;