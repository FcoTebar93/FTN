import { useEffect, useState } from "preact/hooks";
import type {DesignerWorkflowSummary, DesignerStoredWorkflow, DesignerWorkflowStep, DesignerStepKind, DesignerKind, ActivityCatalogItem } from "../../api/types";
import {getDesignerWorkflows, getDesignerWorkflow, createDesignerWorkflow, updateDesignerWorkflow, getActivitiesCatalog, getDesignerKinds } from "../../api/designer";

const EMPTY_WORKFLOW: DesignerStoredWorkflow = {
  id: "",
  version: "v1",
  displayName: "",
  description: "",
  tags: [],
  inputSchema: undefined,
  resultSchema: undefined,
  steps: [],
  entryStepId: "",
};

export function DesignerPage() {
  type Mode = "list" | "edit";

  const [kinds, setKinds] = useState<DesignerKind[]>([]);
  const [activities, setActivities] = useState<ActivityCatalogItem[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [errorMeta, setErrorMeta] = useState<Error | null>(null);
  
  const [mode, setMode] = useState<Mode>("list");
  const [workflows, setWorkflows] = useState<DesignerWorkflowSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<Error | null>(null);

  const [current, setCurrent] = useState<DesignerStoredWorkflow | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [errorCurrent, setErrorCurrent] = useState<Error | null>(null);

  useEffect(() => {
    setLoadingMeta(true);
    Promise.all([getDesignerKinds(), getActivitiesCatalog()])
      .then(([k, a]) => {
        setKinds(k);
        setActivities(a);
      })
      .catch((e) => setErrorMeta(e as Error))
      .finally(() => setLoadingMeta(false));

    getDesignerKinds()
      .then(setKinds)
      .catch((e) => setErrorMeta(e as Error));
  }, []);

  function handleNew() {
    setCurrent(structuredClone(EMPTY_WORKFLOW));
    setErrorCurrent(null);
    setMode("edit");
  }

  function handleEdit(id: string) {
    setLoadingCurrent(true);
    setErrorCurrent(null);
    getDesignerWorkflow(id)
      .then((wf) => {
        setCurrent(wf);
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

      if (workflows.some((w) => w.id === current.id)) {
        await updateDesignerWorkflow(current.id, current);
      } else {
        await createDesignerWorkflow(current);
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
                <section class="workflow-section">
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
                                                if (fieldType === "number") {
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