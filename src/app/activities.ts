import { SendWelcomeEmailInput, SendWelcomeEmailResult } from "./workflows";

export type ActivityFn<TInput = unknown, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;

export interface ActivityRegistry {
    getActivity(name: string): ActivityFn | undefined;
}

export class InMemoryActivityRegistry implements ActivityRegistry {
    private readonly activities = new Map<string, ActivityFn>();

    register<TInput, TResult>(name: string, activity: ActivityFn<TInput, TResult>): void {
        this.activities.set(name, activity as ActivityFn<unknown, unknown>);
    }

    getActivity(name: string): ActivityFn | undefined {
        return this.activities.get(name);
    }
}

export const sendWelcomeEmailActivity: ActivityFn<SendWelcomeEmailInput, SendWelcomeEmailResult> = async (input) => {
    console.log(`Sending welcome email to ${input.email}`);
    return { success: true };
}