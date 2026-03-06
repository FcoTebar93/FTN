import { useEffect, useState } from "preact/hooks";
import { getWorkflows, getWorkflowState, getWorkflowEvents, getWorkflowSteps } from "../../api/workflows";
import type { WorkflowSummary, WorkflowState, WorkflowEvent, StepRecord } from "../../api/types";
import { WorkflowsList } from "./WorkflowsList";
import { WorkflowDetail } from "./WorkflowsDetails";

interface SelectedRun {
  workflowId: string;
  runId: string;
}

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<Error | null>(null);
  const [selected, setSelected] = useState<SelectedRun | null>(null);

  const [state, setState] = useState<WorkflowState | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail, setErrorDetail] = useState<Error | null>(null);

  useEffect(() => {
    setLoadingList(true);
    getWorkflows()
      .then((ws) => {
        setWorkflows(ws);
        if (!selected && ws.length > 0) {
          setSelected({ workflowId: ws[0].workflowId, runId: ws[0].runId });
        }
      })
      .catch((err) => setErrorList(err as Error))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selected) return;

    setLoadingDetail(true);
    Promise.all([
      getWorkflowState(selected.workflowId, selected.runId),
      getWorkflowEvents(selected.workflowId, selected.runId),
      getWorkflowSteps(selected.workflowId, selected.runId),
    ])
      .then(([st, evs, s]) => {
        setState(st);
        setEvents(evs);
        setSteps(s);
      })
      .catch((err) => setErrorDetail(err as Error))
      .finally(() => setLoadingDetail(false));
  }, [selected?.workflowId, selected?.runId]);

  return (
    <div class="app-layout">
      <div class="sidebar">
        <WorkflowsList
          workflows={workflows}
          loading={loadingList}
          error={errorList}
          selected={selected}
          onSelect={setSelected}
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