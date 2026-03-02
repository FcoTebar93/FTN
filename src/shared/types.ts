export type WorkflowId = string;
export type RunId = string;
export type ActivityId = string;
export type WorkerId = string;
export type EventId = string;
export type Version = number;

export type CancellationSignal = {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
};

export interface Timestamped {
    timestamp: string;
}