import type { ActivityId } from "../shared/types";

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
    activity<TInput, TResult>(name: string, input: TInput): ActivityHandle<TResult>;

    parallel<TResult>(branches: Array<() => void>): ActivityHandle<TResult>[];

    join<TResult>(handles: ActivityHandle<TResult>[]): Promise<TResult[]>;

    conditional<TResult>(condition: boolean, then: () => Promise<TResult>, ifBranch: () => Promise<TResult>, elseBranch: () => Promise<TResult>): Promise<TResult>;

    retry<TResult>(options: RetryOptions, operation: () => Promise<TResult>): Promise<TResult>;

    sleep(ms: number): Promise<void>;

    signal<TData = unknown>(name: string): Promise<TData>;
}

export type WorkflowDefinition<TInput, TResult> = (ftn: FTNApi, input: TInput) => Promise<TResult> | TResult;