let httpRequests = 0;
let httpUnauthorized = 0;
let httpForbidden = 0;
let httpRateLimited = 0;
let workflowStarts = 0;
let workflowCompletions = 0;
let workflowFailures = 0;
let workflowCancellations = 0;
let workflowTaskDequeues = 0;
let activityTaskDequeues = 0;
let timerTaskDequeues = 0;
let snapshotsLoaded = 0;
let snapshotsCreated = 0;
let eventAppends = 0;
let concurrencyConflicts = 0;
let activityFailures = 0;
let activityRetries = 0;
let workflowRehydrations = 0;
let workflowRehydrationEvents = 0;
let workflowRehydrationDurationMsSum = 0;
let workflowRunsCompletedWithDuration = 0;
let workflowRunDurationMsSum = 0;

export function incHttpRequest(): void {
  httpRequests += 1;
}

export function incHttpUnauthorized(): void {
  httpUnauthorized += 1;
}

export function incHttpForbidden(): void {
  httpForbidden += 1;
}

export function incHttpRateLimited(): void {
  httpRateLimited += 1;
}

export function incWorkflowStart(): void {
  workflowStarts += 1;
}

export function incWorkflowCompletion(): void {
  workflowCompletions += 1;
}

export function incWorkflowFailure(): void {
  workflowFailures += 1;
}

export function incWorkflowCancellation(): void {
  workflowCancellations += 1;
}

export function incWorkflowTaskDequeue(): void {
  workflowTaskDequeues += 1;
}

export function incActivityTaskDequeue(): void {
  activityTaskDequeues += 1;
}

export function incTimerTaskDequeue(): void {
  timerTaskDequeues += 1;
}

export function incSnapshotLoaded(): void {
  snapshotsLoaded += 1;
}

export function incSnapshotCreated(): void {
  snapshotsCreated += 1;
}

export function addEventAppends(count: number): void {
  eventAppends += Math.max(0, count);
}

export function incConcurrencyConflict(): void {
  concurrencyConflicts += 1;
}

export function incActivityFailure(): void {
  activityFailures += 1;
}

export function incActivityRetry(): void {
  activityRetries += 1;
}

export function observeWorkflowRehydration(durationMs: number, replayEventCount: number): void {
  workflowRehydrations += 1;
  workflowRehydrationDurationMsSum += Math.max(0, durationMs);
  workflowRehydrationEvents += Math.max(0, replayEventCount);
}

export function observeWorkflowRunDuration(durationMs: number): void {
  workflowRunsCompletedWithDuration += 1;
  workflowRunDurationMsSum += Math.max(0, durationMs);
}

export function renderPrometheusText(): string {
  const lines = [
    "# HELP ftn_http_requests_total Peticiones HTTP atendidas por el proceso.",
    "# TYPE ftn_http_requests_total counter",
    `ftn_http_requests_total ${httpRequests}`,
    "# HELP ftn_http_responses_unauthorized_total Respuestas 401 (antes de contar el cuerpo de la petición).",
    "# TYPE ftn_http_responses_unauthorized_total counter",
    `ftn_http_responses_unauthorized_total ${httpUnauthorized}`,
    "# HELP ftn_http_responses_forbidden_total Respuestas 403 por scope insuficiente.",
    "# TYPE ftn_http_responses_forbidden_total counter",
    `ftn_http_responses_forbidden_total ${httpForbidden}`,
    "# HELP ftn_http_responses_rate_limited_total Respuestas 429 por rate limit.",
    "# TYPE ftn_http_responses_rate_limited_total counter",
    `ftn_http_responses_rate_limited_total ${httpRateLimited}`,
    "# HELP ftn_workflow_starts_total Workflows iniciados.",
    "# TYPE ftn_workflow_starts_total counter",
    `ftn_workflow_starts_total ${workflowStarts}`,
    "# HELP ftn_workflow_completions_total Workflows completados.",
    "# TYPE ftn_workflow_completions_total counter",
    `ftn_workflow_completions_total ${workflowCompletions}`,
    "# HELP ftn_workflow_failures_total Workflows fallidos.",
    "# TYPE ftn_workflow_failures_total counter",
    `ftn_workflow_failures_total ${workflowFailures}`,
    "# HELP ftn_workflow_cancellations_total Workflows cancelados.",
    "# TYPE ftn_workflow_cancellations_total counter",
    `ftn_workflow_cancellations_total ${workflowCancellations}`,
    "# HELP ftn_workflow_task_dequeues_total Workflow tasks consumidas.",
    "# TYPE ftn_workflow_task_dequeues_total counter",
    `ftn_workflow_task_dequeues_total ${workflowTaskDequeues}`,
    "# HELP ftn_activity_task_dequeues_total Activity tasks consumidas.",
    "# TYPE ftn_activity_task_dequeues_total counter",
    `ftn_activity_task_dequeues_total ${activityTaskDequeues}`,
    "# HELP ftn_timer_task_dequeues_total Timer tasks consumidas.",
    "# TYPE ftn_timer_task_dequeues_total counter",
    `ftn_timer_task_dequeues_total ${timerTaskDequeues}`,
    "# HELP ftn_snapshots_loaded_total Snapshots cargados para rehidratacion.",
    "# TYPE ftn_snapshots_loaded_total counter",
    `ftn_snapshots_loaded_total ${snapshotsLoaded}`,
    "# HELP ftn_snapshots_created_total Snapshots generados.",
    "# TYPE ftn_snapshots_created_total counter",
    `ftn_snapshots_created_total ${snapshotsCreated}`,
    "# HELP ftn_event_appends_total Eventos persistidos en append.",
    "# TYPE ftn_event_appends_total counter",
    `ftn_event_appends_total ${eventAppends}`,
    "# HELP ftn_concurrency_conflicts_total Conflictos de optimistic locking.",
    "# TYPE ftn_concurrency_conflicts_total counter",
    `ftn_concurrency_conflicts_total ${concurrencyConflicts}`,
    "# HELP ftn_activity_failures_total Activities fallidas.",
    "# TYPE ftn_activity_failures_total counter",
    `ftn_activity_failures_total ${activityFailures}`,
    "# HELP ftn_activity_retries_total Reintentos de activities o workflow tasks por concurrencia.",
    "# TYPE ftn_activity_retries_total counter",
    `ftn_activity_retries_total ${activityRetries}`,
    "# HELP ftn_workflow_rehydrations_total Rehidrataciones de workflow ejecutadas.",
    "# TYPE ftn_workflow_rehydrations_total counter",
    `ftn_workflow_rehydrations_total ${workflowRehydrations}`,
    "# HELP ftn_workflow_rehydration_events_total Eventos aplicados en replays de rehidratacion.",
    "# TYPE ftn_workflow_rehydration_events_total counter",
    `ftn_workflow_rehydration_events_total ${workflowRehydrationEvents}`,
    "# HELP ftn_workflow_rehydration_duration_ms_sum Suma de ms dedicados a rehidratacion.",
    "# TYPE ftn_workflow_rehydration_duration_ms_sum counter",
    `ftn_workflow_rehydration_duration_ms_sum ${workflowRehydrationDurationMsSum}`,
    "# HELP ftn_workflow_runs_with_duration_total Workflows completados/cancelados/fallidos con duracion medida.",
    "# TYPE ftn_workflow_runs_with_duration_total counter",
    `ftn_workflow_runs_with_duration_total ${workflowRunsCompletedWithDuration}`,
    "# HELP ftn_workflow_run_duration_ms_sum Suma de duraciones de runs terminales.",
    "# TYPE ftn_workflow_run_duration_ms_sum counter",
    `ftn_workflow_run_duration_ms_sum ${workflowRunDurationMsSum}`,
    "",
  ];
  return lines.join("\n");
}
