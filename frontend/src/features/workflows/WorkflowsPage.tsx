import { useEffect, useState, useRef } from "preact/hooks";
import { getWorkflows, getWorkflowState, getWorkflowEvents, getWorkflowSteps } from "../../api/workflows";
import type { WorkflowSummary, WorkflowState, WorkflowEvent, StepRecord, WorkflowStatus } from "../../api/types";import { WorkflowsList } from "./WorkflowsList";
import { WorkflowDetail } from "./WorkflowsDetails";

const POLL_INTERVAL_MS = 4000;
const PAGE_SIZE = 20;

interface SelectedRun {
  workflowId: string;
  runId: string;
}

function fetchDetail(workflowId: string, runId: string) {
  return Promise.all([
    getWorkflowState(workflowId, runId),
    getWorkflowEvents(workflowId, runId),
    getWorkflowSteps(workflowId, runId),
  ]);
}

function readSelectedFromUrl(): SelectedRun | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const workflowId = params.get("workflowId");
  const runId = params.get("runId");
  return workflowId && runId ? { workflowId, runId } : null;
}

function writeSelectedToUrl(sel: SelectedRun | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (sel) {
    url.searchParams.set("workflowId", sel.workflowId);
    url.searchParams.set("runId", sel.runId);
  } else {
    url.searchParams.delete("workflowId");
    url.searchParams.delete("runId");
  }
  window.history.replaceState({}, "", url.toString());
}

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<Error | null>(null);
  const [selected, setSelected] = useState<SelectedRun | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  const [state, setState] = useState<WorkflowState | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail, setErrorDetail] = useState<Error | null>(null);

  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoadingList(true);
    getWorkflows(
      statusFilter ? { status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE } : { limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((ws) => {
        setWorkflows(ws);
        if (!selected && ws.length > 0) {
          const first = { workflowId: ws[0].workflowId, runId: ws[0].runId };
          setSelected(first);
          writeSelectedToUrl(first);
        } else if (selected && !ws.some((w) => w.workflowId === selected.workflowId && w.runId === selected.runId)) {
          const next = ws.length > 0 ? { workflowId: ws[0].workflowId, runId: ws[0].runId } : null;
          setSelected(next);
          writeSelectedToUrl(next);
        }
      })
      .catch((err) => setErrorList(err as Error))
      .finally(() => setLoadingList(false));
  }, [statusFilter, page]);

  useEffect(() => {
    if (!selected) return;

    setLoadingDetail(true);
    setErrorDetail(null);
    fetchDetail(selected.workflowId, selected.runId)
      .then(([st, evs, s]) => {
        setState(st);
        setEvents(evs);
        setSteps(s);
      })
      .catch((err) => setErrorDetail(err as Error))
      .finally(() => setLoadingDetail(false));
  }, [selected?.workflowId, selected?.runId]);

  useEffect(() => {
    if (!selected || state?.status !== "running") return;

    const id = setInterval(() => {
      fetchDetail(selected.workflowId, selected.runId)
        .then(([st, evs, s]) => {
          setState(st);
          setEvents(evs);
          setSteps(s);
        })
        .catch((err) => setErrorDetail(err as Error));
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [selected?.workflowId, selected?.runId, state?.status]);

  return (
    <div class="app-layout">
      <div class="sidebar">
        <WorkflowsList
          workflows={workflows}
          loading={loadingList}
          error={errorList}
          selected={selected}
          onSelect={(sel) => { setSelected(sel); writeSelectedToUrl(sel); }}
          statusFilter={statusFilter}
          onStatusFilterChange={(value) => { setPage(0); setStatusFilter(value); }}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          page={page}
          onPageChange={setPage}
        />
      </div>
      <div class="content">
        <WorkflowDetail
          selected={selected}
          state={state}
          events={events}
          steps={steps}
          loading={loadingDetail}
          error={errorDetail}
        />
      </div>
    </div>
  );
}