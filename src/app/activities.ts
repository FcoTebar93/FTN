export type ActivityFn<TInput = unknown, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;

export interface ActivityRegistry {
    getActivity(name: string): ActivityFn | undefined;
}