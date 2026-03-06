import { fetchJson } from "./client";
import type { WorkflowSummary, WorkflowState, WorkflowEvent, WorkflowStatus, StepRecord } from "./types";

export async function getWorkflows (params?: { status?: WorkflowStatus; limit?: number; offset?: number }): Promise<WorkflowSummary[]> {
    const search = new URLSearchParams();
    if (params?.status) {
        search.set("status", params.status);
    }
    if (params?.limit) {
        search.set("limit", params.limit.toString());
    }
    if (params?.offset) {
        search.set("offset", params.offset.toString());
    }
    const url = `/workflows?${search.toString()}`;
    return fetchJson<WorkflowSummary[]>(url);
}

export function getWorkflowState(workflowId: string, runId: string): Promise<WorkflowState> {
    return fetchJson<WorkflowState>(`/workflows/${workflowId}/${runId}`);
}

export function getWorkflowEvents (workflowId: string, runId: string): Promise<WorkflowEvent[]> {
    return fetchJson<WorkflowEvent[]>(`/workflows/${workflowId}/${runId}/events`);
}

export function getWorkflowSteps (workflowId: string, runId: string): Promise<StepRecord[]> {
    return fetchJson<StepRecord[]>(`/workflows/${workflowId}/${runId}/steps`);
}