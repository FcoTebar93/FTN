import { useEffect, useState } from "preact/hooks";
import type { DesignerWorkflowSummary, DesignerStoredWorkflow, DesignerWorkflowStep, DesignerStepKind, ActivityCatalogItem, DesignerExecutionSchedule, DesignerWeekday } from "../../api/types";
import { getDesignerWorkflows, getDesignerWorkflow, createDesignerWorkflow, updateDesignerWorkflow, getActivitiesCatalog } from "../../api/designer";
import { startWorkflow } from "../../api/workflows";

const TIMEZONES = [
  "UTC",
  "Europe/Madrid",
  "Europe/London",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/New_York",
];

const WEEKDAY_LABELS: { value: DesignerWeekday; label: string }[] = [
  { value: 0, label: "Lun" },
  { value: 1, label: "Mar" },
  { value: 2, label: "Mié" },
  { value: 3, label: "Jue" },
  { value: 4, label: "Vie" },
  { value: 5, label: "Sáb" },
  { value: 6, label: "Dom" },
];

function formatHM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseHM(s: string): { hour: number; minute: number } {
  const [a, b] = s.split(":");
  const hour = Number(a);
  const minute = Number(b);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { hour: 9, minute: 0 };
  return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
}

function scheduleSummary(s?: DesignerExecutionSchedule): string {
  if (!s || s.type === "instant") return "Instantánea";
  if (s.type === "daily") return `Diaria ${formatHM(s.hour, s.minute)} (${s.timezone ?? "UTC"})`;
  return `Semanal ${formatHM(s.hour, s.minute)} · ${s.weekdays.length} día(s)`;
}

const EMPTY_WORKFLOW: DesignerStoredWorkflow = {
  id: "",
  version: "v1",
  displayName: "",
  description: "",
  tags: [],
  schedule: { type: "instant" },
  scheduledInput: {},
  inputSchema: undefined,
  resultSchema: undefined,
  steps: [],
  entryStepId: "",
};

export function DesignerPage() {
  type Mode = "list" | "edit";

  const [activities, setActivities] = useState<ActivityCatalogItem[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activitiesError, setActivitiesError] = useState<Error | null>(null);

  const [mode, setMode] = useState<Mode>("list");
  const [workflows, setWorkflows] = useState<DesignerWorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<Error | null>(null);

  const [current, setCurrent] = useState<DesignerStoredWorkflow | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [errorCurrent, setErrorCurrent] = useState<Error | null>(null);
  const [testRunJson, setTestRunJson] = useState("{}");
  const [testRunResult, setTestRunResult] = useState<string | null>(null);
  const [testRunLoading, setTestRunLoading] = useState(false);
  const [schedInputDraft, setSchedInputDraft] = useState("{}");

  useEffect(() => {
    setLoadingActivities(true);
    getActivitiesCatalog()
      .then(setActivities)
      .catch((e) => setActivitiesError(e as Error))
      .finally(() => setLoadingActivities(false));
  }, []);

  useEffect(() => {
    setLoadingList(true);
    setErrorList(null);
    getDesignerWorkflows()
      .then(setWorkflows)
      .catch((e) => setErrorList(e as Error))
      .finally(() => setLoadingList(false));
  }, []);

  function handleNew() {
    setCurrent(structuredClone(EMPTY_WORKFLOW));
    setErrorCurrent(null);
    setTestRunJson("{}");
    setSchedInputDraft("{}");
    setTestRunResult(null);
    setMode("edit");
  }

  async function handleTestRun() {
    if (!current?.id?.trim()) return;
    setTestRunLoading(true);
    setTestRunResult(null);
    try {
      let input: unknown = {};
      if (testRunJson.trim()) {
        input = JSON.parse(testRunJson);
      }
      const res = await startWorkflow(current.id, input);
      setTestRunResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setTestRunResult(`Error: ${(e as Error).message}`);
    } finally {
      setTestRunLoading(false);
    }
  }

  function handleEdit(id: string) {
    setLoadingCurrent(true);
    setErrorCurrent(null);
    getDesignerWorkflow(id)
      .then((wf) => {
        const normalized: DesignerStoredWorkflow = {
          ...wf,
          schedule: wf.schedule ?? { type: "instant" },
          scheduledInput: wf.scheduledInput ?? {},
        };
        setCurrent(normalized);
        try {
          const inj = JSON.stringify(normalized.scheduledInput ?? {}, null, 2);
          setTestRunJson(inj);
          setSchedInputDraft(inj);
        } catch {
          setTestRunJson("{}");
          setSchedInputDraft("{}");
        }
        setTestRunResult(null);
        setMode("edit");
      })
      .catch((e) => setErrorCurrent(e as Error))
      .finally(() => setLoadingCurrent(false));
  }

  async function handleSave() {
    if (!current){
        return;
    }
    
    try {
      setErrorCurrent(null);
      if (!current.id) {
        throw new Error("El campo 'id' es obligatorio");
      }
      if (!current.displayName) {
        throw new Error("El campo 'displayName' es obligatorio");
      }
      if (!current.version) {
        throw new Error("El campo 'version' es obligatorio");
      }
      if (!current.steps.length) {
        throw new Error("Debe haber al menos un step");
      }
      if (!current.entryStepId || !current.steps.some((s) => s.id === current.entryStepId)) {
        throw new Error("entryStepId debe ser el id de un step existente");
      }

      const sched = current.schedule ?? { type: "instant" as const };
      if (sched.type === "weekly" && (!sched.weekdays || sched.weekdays.length === 0)) {
        throw new Error("En ejecución semanal elige al menos un día");
      }

      let scheduledInput: unknown = {};
      try {
        scheduledInput = schedInputDraft.trim() === "" ? {} : JSON.parse(schedInputDraft);
      } catch {
        throw new Error("Input programado: JSON inválido");
      }

      const toSave: DesignerStoredWorkflow = {
        ...current,
        schedule: sched,
        scheduledInput,
      };

      if (workflows.some((w) => w.id === current.id)) {
        await updateDesignerWorkflow(current.id, toSave);
      } else {
        await createDesignerWorkflow(toSave);
      }

      const updatedList = await getDesignerWorkflows();
      setWorkflows(updatedList);
      setMode("list");
      setCurrent(null);
    } catch (e) {
      setErrorCurrent(e as Error);
    }
  }

  function updateCurrent(updater: (prev: DesignerStoredWorkflow) => DesignerStoredWorkflow) {
    setCurrent((prev) => (prev ? updater(prev) : prev));
  }

  function handleAddStep() {
    if (!current) return;
    const newId = `step-${current.steps.length + 1}`;
    const newStep: DesignerWorkflowStep = {
      id: newId,
      kind: "activity",
      activityName: "",
      input: {},
      next: null,
    } as any;
    updateCurrent((prev) => ({
      ...prev,
      steps: [...prev.steps, newStep],
      entryStepId: prev.entryStepId || newId,
    }));
  }

  function handleRemoveStep(id: string) {
    if (!current) return;
    updateCurrent((prev) => {
      const steps = prev.steps.filter((s) => s.id !== id);
      const entryStepId = prev.entryStepId === id ? (steps[0]?.id ?? "") : prev.entryStepId;
      const fixedSteps = steps.map((s) => ({
        ...s,
        next: s.next === id ? null : s.next,
      }));
      return { ...prev, steps: fixedSteps, entryStepId };
    });
  }

  function handleStepFieldChange(id: string, field: string, value: any) {
    if (!current) return;
    updateCurrent((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    }));
  }

  return (
    <div class="app-layout">
      <div class="sidebar">
        <div class="panel">
          <h2 class="panel-title">Designer · Workflows JSON</h2>
          {loadingActivities && <p class="detail-muted">Cargando catálogo de activities…</p>}
          {activitiesError && <p class="panel panel-error">Activities: {activitiesError.message}</p>}
          <button type="button" class="workflow-filter-btn" onClick={handleNew}>
            + Nuevo workflow
          </button>
          {loadingList ? (
            <p class="detail-muted">Cargando…</p>
          ) : errorList ? (
            <p class="panel panel-error">Error: {errorList.message}</p>
          ) : workflows.length === 0 ? (
            <p class="workflow-list-empty">No hay workflows definidos aún.</p>
          ) : (
            <ul class="workflow-list">
              {workflows.map((w) => (
                <li
                  key={w.id}
                  class="workflow-list-item"
                  onClick={() => handleEdit(w.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div class="workflow-name">{w.displayName || w.id}</div>
                  <div class="workflow-meta">
                    <span>{w.id}</span> · <span>v{w.version}</span>
                  </div>
                  <div class="detail-muted" style={{ fontSize: "11px", marginTop: "4px" }}>
                    {scheduleSummary(w.schedule)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div class="content">
        {mode === "edit" ? (
          <div class="panel">
            <h2 class="panel-title">Editar workflow</h2>
            {loadingCurrent && <p class="detail-muted">Cargando…</p>}
            {errorCurrent && <p class="panel panel-error">Error: {errorCurrent.message}</p>}
            {current && (
              <>
                <section class="workflow-section workflow-section--meta">
                  <h3>Meta</h3>
                  <div class="form-row">
                    <label>Id</label>
                    <input
                      type="text"
                      value={current.id}
                      onInput={(e) =>
                        updateCurrent((prev) => ({ ...prev, id: (e.target as HTMLInputElement).value }))
                      }
                      disabled={workflows.some((w) => w.id === current.id)}
                    />
                  </div>
                  <div class="form-row">
                    <label>Display name</label>
                    <input
                      type="text"
                      value={current.displayName}
                      onInput={(e) =>
                        updateCurrent((prev) => ({
                          ...prev,
                          displayName: (e.target as HTMLInputElement).value,
                        }))
                      }
                    />
                  </div>
                  <div class="form-row">
                    <label>Version</label>
                    <input
                      type="text"
                      value={current.version}
                      onInput={(e) =>
                        updateCurrent((prev) => ({ ...prev, version: (e.target as HTMLInputElement).value }))
                      }
                    />
                  </div>
                  <div class="form-row">
                    <label>Descripción</label>
                    <textarea
                      value={current.description ?? ""}
                      onInput={(e) =>
                        updateCurrent((prev) => ({
                          ...prev,
                          description: (e.target as HTMLTextAreaElement).value,
                        }))
                      }
                    />
                  </div>
                  <div class="form-row">
                    <label>Tags (coma separadas)</label>
                    <input
                      type="text"
                      value={(current.tags ?? []).join(", ")}
                      onInput={(e) => {
                        const raw = (e.target as HTMLInputElement).value;
                        const tags = raw
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean);
                        updateCurrent((prev) => ({ ...prev, tags }));
                      }}
                    />
                  </div>
                </section>

                <section class="workflow-section workflow-section--meta">
                  <h3>Ejecución</h3>
                  <p class="detail-muted">
                    Instantánea: se lanza al guardar por primera vez. Diaria / semanal: el servidor comprueba cada
                    minuto (intervalo configurable) la hora en la zona indicada.
                  </p>
                  <div class="form-row">
                    <label>Modo</label>
                    <select
                      value={current.schedule?.type ?? "instant"}
                      onInput={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        updateCurrent((prev) => {
                          if (v === "instant") {
                            return { ...prev, schedule: { type: "instant" } };
                          }
                          if (v === "daily") {
                            return {
                              ...prev,
                              schedule: {
                                type: "daily",
                                hour: 9,
                                minute: 0,
                                timezone: "Europe/Madrid",
                              },
                            };
                          }
                          return {
                            ...prev,
                            schedule: {
                              type: "weekly",
                              weekdays: [0, 1, 2, 3, 4],
                              hour: 9,
                              minute: 0,
                              timezone: "Europe/Madrid",
                            },
                          };
                        });
                      }}
                    >
                      <option value="instant">Instantánea (al crear)</option>
                      <option value="daily">Diaria</option>
                      <option value="weekly">Semanal (días concretos)</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Zona horaria (IANA)</label>
                    <select
                      value={
                        current.schedule?.type === "instant"
                          ? "UTC"
                          : (current.schedule?.timezone ?? "UTC")
                      }
                      disabled={current.schedule?.type === "instant"}
                      onInput={(e) => {
                        const tz = (e.target as HTMLSelectElement).value;
                        updateCurrent((prev) => {
                          const s = prev.schedule;
                          if (!s || s.type === "instant") return prev;
                          return { ...prev, schedule: { ...s, timezone: tz } };
                        });
                      }}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                  {current.schedule?.type === "daily" && (
                    <div class="form-row">
                      <label>Hora (en la zona elegida)</label>
                      <input
                        type="time"
                        value={formatHM(current.schedule.hour, current.schedule.minute)}
                        onInput={(e) => {
                          const { hour, minute } = parseHM((e.target as HTMLInputElement).value);
                          updateCurrent((prev) => ({
                            ...prev,
                            schedule:
                              prev.schedule?.type === "daily"
                                ? { ...prev.schedule, hour, minute }
                                : prev.schedule,
                          }));
                        }}
                      />
                    </div>
                  )}
                  {current.schedule?.type === "weekly" && (
                    <>
                      <div class="form-row">
                        <label>Días</label>
                        <div class="weekday-chips">
                          {WEEKDAY_LABELS.map(({ value, label }) => {
                            const sel = (current.schedule?.type === "weekly" ? current.schedule.weekdays : []).includes(
                              value
                            );
                            return (
                              <label key={value} class="weekday-chip">
                                <input
                                  type="checkbox"
                                  checked={sel}
                                  onChange={() => {
                                    updateCurrent((prev) => {
                                      if (prev.schedule?.type !== "weekly") return prev;
                                      const set = new Set(prev.schedule.weekdays);
                                      if (set.has(value)) set.delete(value);
                                      else set.add(value);
                                      return {
                                        ...prev,
                                        schedule: {
                                          ...prev.schedule,
                                          weekdays: [...set].sort() as DesignerWeekday[],
                                        },
                                      };
                                    });
                                  }}
                                />
                                {label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div class="form-row">
                        <label>Hora (en la zona elegida)</label>
                        <input
                          type="time"
                          value={
                            current.schedule?.type === "weekly"
                              ? formatHM(current.schedule.hour, current.schedule.minute)
                              : "09:00"
                          }
                          onInput={(e) => {
                            const { hour, minute } = parseHM((e.target as HTMLInputElement).value);
                            updateCurrent((prev) => ({
                              ...prev,
                              schedule:
                                prev.schedule?.type === "weekly"
                                  ? { ...prev.schedule, hour, minute }
                                  : prev.schedule,
                            }));
                          }}
                        />
                      </div>
                    </>
                  )}
                  <div class="form-row">
                    <label>Input programado / prueba (JSON)</label>
                    <textarea
                      rows={4}
                      style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
                      value={schedInputDraft}
                      onInput={(e) => setSchedInputDraft((e.target as HTMLTextAreaElement).value)}
                    />
                    <p class="detail-muted">Se usa en la ejecución instantánea al crear y en cada run programado.</p>
                  </div>
                </section>

                <section class="workflow-section">
                  <h3>Steps</h3>
                  <button type="button" class="workflow-filter-btn" onClick={handleAddStep}>
                    + Añadir step
                  </button>
                  {current.steps.length === 0 ? (
                    <p class="detail-muted">Añade al menos un step para este workflow.</p>
                  ) : (
                    <>
                      <div class="form-row">
                        <label>Entry step</label>
                        <select
                          value={current.entryStepId}
                          onInput={(e) =>
                            updateCurrent((prev) => ({
                              ...prev,
                              entryStepId: (e.target as HTMLSelectElement).value,
                            }))
                          }
                        >
                          <option value="">(elige)</option>
                          {current.steps.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <ul class="detail-list">
                        {current.steps.map((step) => {
                          const selectedActivity = activities.find(
                            (a) => a.name === (step as any).activityName
                          );
                          const schema = selectedActivity?.inputSchema;

                          return (
                          <li key={step.id} class="workflow-step-editor">
                            <div class="form-row">
                              <label>Id</label>
                              <input
                                type="text"
                                value={step.id}
                                onInput={(e) =>
                                  handleStepFieldChange(step.id, "id", (e.target as HTMLInputElement).value)
                                }
                              />
                              <button type="button" onClick={() => handleRemoveStep(step.id)}>
                                Eliminar
                              </button>
                            </div>
                            <div class="form-row">
                              <label>Kind</label>
                              <select
                                value={step.kind}
                                onInput={(e) => handleStepFieldChange(step.id, "kind", (e.target as HTMLSelectElement).value as DesignerStepKind)}
                              >
                                <option value="activity">activity</option>
                                <option value="sleep">sleep</option>
                                <option value="signal">signal</option>
                              </select>
                            </div>
                            {step.kind === "activity" && (
                            <>
                              <div class="form-row">
                                <label>Integración</label>
                                <select
                                  value={(step as any).integrationModule ?? ""}
                                  onInput={(e) =>
                                    handleStepFieldChange(
                                      step.id,
                                      "integrationModule",
                                      (e.target as HTMLSelectElement).value || undefined,
                                    )
                                  }
                                >
                                  <option value="">(todas)</option>
                                  {Array.from(new Set(activities.map((a) => a.module))).map((mod) => (
                                    <option key={mod} value={mod}>
                                      {mod}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div class="form-row">
                                <label>Activity</label>
                                <select
                                  value={(step as any).activityName ?? ""}
                                  onInput={(e) =>
                                    handleStepFieldChange(
                                      step.id,
                                      "activityName",
                                      (e.target as HTMLSelectElement).value,
                                    )
                                  }
                                >
                                  <option value="">(elige una activity)</option>
                                  {Object.entries(
                                    activities
                                      .filter((act) =>
                                        (step as any).integrationModule
                                          ? act.module === (step as any).integrationModule
                                          : true,
                                      )
                                      .reduce<Record<string, ActivityCatalogItem[]>>((acc, act) => {
                                        (acc[act.module] ||= []).push(act);
                                        return acc;
                                      }, {}),
                                  ).map(([module, items]) => (
                                    <optgroup key={module} label={module}>
                                      {items.map((act) => (
                                        <option key={act.name} value={act.name}>
                                          {act.name} {act.version ? `(v${act.version})` : ""}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              </div>

                              <div class="form-row">
                                <label>Parámetros</label>
                                {schema && schema.type === "object" && (schema as any).properties ? (
                                  <div class="dynamic-fields">
                                    {Object.entries((schema as any).properties).map(
                                      ([propName, propSchema]: [string, any]
                                    ) => {
                                      const required = schema.required?.includes(propName) ?? false;
                                      const value = (step as any).input?.[propName];
                                      const fieldType =
                                        propSchema.type === "number" || propSchema.type === "integer"
                                          ? "number"
                                          : propSchema.type === "boolean"
                                          ? "checkbox"
                                          : "text";

                                      return (
                                        <div class="form-row" key={propName}>
                                          <label>
                                            {propName}
                                            {required ? " *" : ""}
                                          </label>
                                          {fieldType === "checkbox" ? (
                                            <input
                                              type="checkbox"
                                              checked={Boolean(value)}
                                              onInput={(e) =>
                                                handleStepFieldChange(step.id, "input", {
                                                  ...(step as any).input,
                                                  [propName]: (e.target as HTMLInputElement).checked,
                                                })
                                              }
                                            />
                                          ) : (
                                            <input
                                              type={fieldType}
                                              value={value ?? ""}
                                              onInput={(e) => {
                                                const raw = (e.target as HTMLInputElement).value;
                                                let parsed: unknown = raw;
                                              
                                                const trimmed = raw.trim();
                                                const isPlaceholder =
                                                  trimmed.startsWith("{{") && trimmed.endsWith("}}");
                                              
                                                if (!isPlaceholder && fieldType === "number") {
                                                  parsed = raw === "" ? undefined : Number(raw);
                                                }
                                              
                                                handleStepFieldChange(step.id, "input", {
                                                  ...(step as any).input,
                                                  [propName]: parsed,
                                                });
                                              }}
                                            />
                                          )}
                                          {propSchema.description && (
                                            <p class="detail-muted">{propSchema.description}</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <textarea
                                    value={JSON.stringify((step as any).input ?? {}, null, 2)}
                                    onInput={(e) => {
                                      const text = (e.target as HTMLTextAreaElement).value;
                                      try {
                                        const parsed = text ? JSON.parse(text) : {};
                                        handleStepFieldChange(step.id, "input", parsed);
                                      } catch {
                                      }
                                    }}
                                  />
                                )}
                              </div>
                            </>
                          )}
                          {step.kind === "conditional" && (
                          <>
                            <div class="form-row">
                              <label>Path</label>
                              <input
                                type="text"
                                placeholder="input.amount o steps.step-1.result.status"
                                value={(step as any).path ?? ""}
                                onInput={(e) => {
                                  const path = (e.target as HTMLInputElement).value;
                                  const op = (step as any).operator ?? "===";
                                  const right = (step as any).right ?? "";
                                  const expression = path && right ? `${path} ${op} ${right}` : "";
                                  handleStepFieldChange(step.id, "path", path);
                                  handleStepFieldChange(step.id, "expression", expression);
                                }}
                              />
                            </div>

                            <div class="form-row">
                              <label>Operador</label>
                              <select
                                value={(step as any).operator ?? "==="}
                                onInput={(e) => {
                                  const op = (e.target as HTMLSelectElement).value;
                                  const path = (step as any).path ?? "";
                                  const right = (step as any).right ?? "";
                                  const expression = path && right ? `${path} ${op} ${right}` : "";
                                  handleStepFieldChange(step.id, "operator", op);
                                  handleStepFieldChange(step.id, "expression", expression);
                                }}
                              >
                                <option value="===">===</option>
                                <option value="!==">!==</option>
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                                <option value=">=">&gt;=</option>
                                <option value="<=">&lt;=</option>
                              </select>
                            </div>

                            <div class="form-row">
                              <label>Valor</label>
                              <input
                                type="text"
                                placeholder="1000, 'completed', true..."
                                value={(step as any).right ?? ""}
                                onInput={(e) => {
                                  const right = (e.target as HTMLInputElement).value;
                                  const path = (step as any).path ?? "";
                                  const op = (step as any).operator ?? "===";
                                  const expression = path && right ? `${path} ${op} ${right}` : "";
                                  handleStepFieldChange(step.id, "right", right);
                                  handleStepFieldChange(step.id, "expression", expression);
                                }}
                              />
                            </div>

                            <div class="form-row">
                              <label>Then step id</label>
                              <select
                                value={(step as any).thenNext ?? ""}
                                onInput={(e) =>
                                  handleStepFieldChange(
                                    step.id,
                                    "thenNext",
                                    (e.target as HTMLSelectElement).value || null,
                                  )
                                }
                              >
                                <option value="">(fin)</option>
                                {current.steps
                                  .filter((s) => s.id !== step.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.id}
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div class="form-row">
                              <label>Else step id</label>
                              <select
                                value={(step as any).elseNext ?? ""}
                                onInput={(e) =>
                                  handleStepFieldChange(
                                    step.id,
                                    "elseNext",
                                    (e.target as HTMLSelectElement).value || null,
                                  )
                                }
                              >
                                <option value="">(fin)</option>
                                {current.steps
                                  .filter((s) => s.id !== step.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.id}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </>
                        )}
                        {step.kind === "sleep" && (
                              <div class="form-row">
                                <label>Milliseconds</label>
                                <input
                                  type="number"
                                  value={(step as any).milliseconds ?? 0}
                                  onInput={(e) =>
                                    handleStepFieldChange(
                                      step.id,
                                      "milliseconds",
                                      Number((e.target as HTMLInputElement).value) || 0,
                                    )
                                  }
                                />
                              </div>
                        )}
                        {step.kind === "signal" && (
                              <div class="form-row">
                                <label>Signal name</label>
                                <input
                                  type="text"
                                  value={(step as any).signalName ?? ""}
                                  onInput={(e) =>
                                    handleStepFieldChange(
                                      step.id,
                                      "signalName",
                                      (e.target as HTMLInputElement).value,
                                    )
                                  }
                                />
                              </div>
                        )}
                        {step.kind === "parallel" && (
                        <>
                          {Array.isArray((step as any).branches) &&
                            (step as any).branches.map((_branch: string[], idx: number) => (
                              <div class="form-row" key={idx}>
                                <label>Rama {idx + 1}</label>
                                <select
                                  multiple
                                  onChange={(e) => {
                                    const selected = Array.from(
                                      (e.target as HTMLSelectElement).selectedOptions
                                    ).map((o) => o.value);
                                    const allBranches = [...(((step as any).branches as string[][]) ?? [])];
                                    allBranches[idx] = selected;
                                    handleStepFieldChange(step.id, "branches", allBranches);
                                  }}
                                >
                                  {current.steps
                                    .filter((s) => s.id !== step.id && s.kind === "activity")
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.id}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            ))}

                          <div class="form-row">
                            <button
                              type="button"
                              class="workflow-filter-btn"
                              onClick={() => {
                                const existing = ((step as any).branches as string[][]) ?? [];
                                const updated = [...existing, []];
                                handleStepFieldChange(step.id, "branches", updated);
                              }}
                            >
                              + Añadir rama
                            </button>
                          </div>
                        </>
                      )}
                            <div class="form-row">
                              <label>Next step</label>
                              <select
                                value={step.next ?? ""}
                                onInput={(e) =>
                                  handleStepFieldChange(
                                    step.id,
                                    "next",
                                    (e.target as HTMLSelectElement).value || null,
                                  )
                                }
                              >
                                <option value="">(fin)</option>
                                {current.steps
                                  .filter((s) => s.id !== step.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.id}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </section>

                <section class="workflow-section">
                  <h3>Probar ejecución</h3>
                  <p class="detail-muted">
                    Lanza <code>POST /workflows</code> con el id de este workflow (debe estar guardado). Input JSON
                    independiente del bloque anterior si quieres probar otro payload.
                  </p>
                  <div class="form-row">
                    <label>Input (JSON)</label>
                    <textarea
                      rows={5}
                      style={{ width: "100%", fontFamily: "monospace", fontSize: "12px" }}
                      value={testRunJson}
                      onInput={(e) => setTestRunJson((e.target as HTMLTextAreaElement).value)}
                    />
                  </div>
                  <div class="form-row">
                    <button
                      type="button"
                      class="workflow-filter-btn"
                      disabled={!current.id?.trim() || testRunLoading}
                      onClick={() => void handleTestRun()}
                    >
                      {testRunLoading ? "Lanzando…" : "Ejecutar ahora"}
                    </button>
                  </div>
                  {testRunResult && (
                    <pre
                      class="detail-muted"
                      style={{
                        whiteSpace: "pre-wrap",
                        fontSize: "12px",
                        maxHeight: "160px",
                        overflow: "auto",
                        padding: "8px",
                        background: "var(--panel-bg, #1a1a1e)",
                        borderRadius: "6px",
                      }}
                    >
                      {testRunResult}
                    </pre>
                  )}
                </section>

                <section class="workflow-section">
                  <h3>Vista previa JSON</h3>
                  <p class="detail-muted">Payload que se enviará al guardar (revisión rápida).</p>
                  <pre
                    class="detail-muted"
                    style={{
                      whiteSpace: "pre-wrap",
                      fontSize: "12px",
                      maxHeight: "240px",
                      overflow: "auto",
                      padding: "8px",
                      background: "var(--panel-bg, #1a1a1e)",
                      borderRadius: "6px",
                    }}
                  >
                    {current ? JSON.stringify(current, null, 2) : ""}
                  </pre>
                </section>

                <section class="workflow-section">
                  <button type="button" class="workflow-filter-btn" onClick={handleSave}>
                    Guardar workflow
                  </button>
                  <button
                    type="button"
                    class="workflow-filter-btn"
                    onClick={() => {
                      setMode("list");
                      setCurrent(null);
                    }}
                  >
                    Cancelar
                  </button>
                </section>
              </>
            )}
          </div>
        ) : (
          <div class="panel">
            <p class="detail-muted">
              Elige un workflow a la izquierda o crea uno nuevo para editar su definición JSON.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}