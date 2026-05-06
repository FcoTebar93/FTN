import { useEffect, useMemo, useState } from "preact/hooks";
import { getCredential, getIntegrationsStatus, listCredentials, saveCredential } from "../../api/credentials";
import type { CredentialSummary, IntegrationStatusItem } from "../../api/types";
import { useUiText } from "../../i18n";
import {
  PROVIDERS_ORDER,
  getProviderSchemas,
  countMissingRequiredFields,
  getFieldErrors,
  type CredentialProvider,
} from "./providerSchemas";

type FieldValues = Record<string, string>;
type FieldChecklistItem = { key: string; label: string; status: "ok" | "error" | "pending"; message: string };

export function CredentialsPage() {
  const { t, locale } = useUiText();
  const [items, setItems] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<CredentialProvider>("stripe");
  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [advancedMode, setAdvancedMode] = useState(false);
  const [advancedConfigDraft, setAdvancedConfigDraft] = useState("{}");
  const [advancedSecretsDraft, setAdvancedSecretsDraft] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, IntegrationStatusItem>>({});

  const providerSchemas = useMemo(() => getProviderSchemas(locale), [locale]);
  const current = useMemo(() => items.find((x) => x.provider === provider), [items, provider]);
  const schema = providerSchemas[provider];

  const fieldErrors = useMemo(() => getFieldErrors(schema, fieldValues, locale), [fieldValues, schema, locale]);
  const missingRequiredCount = useMemo(() => countMissingRequiredFields(schema, fieldValues), [fieldValues, schema]);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const fieldChecklist = useMemo<FieldChecklistItem[]>(() => {
    return schema.fields.map((field) => {
      const raw = fieldValues[field.key] ?? "";
      const value = raw.trim();
      const err = fieldErrors[field.key];
      if (!value) {
        if (field.required) {
          return {
            key: field.key,
            label: field.label,
            status: "pending",
            message: t.credentials.pendingRequired,
          };
        }
        return {
          key: field.key,
          label: field.label,
          status: "pending",
          message: t.credentials.optional,
        };
      }
      if (err) {
        return {
          key: field.key,
          label: field.label,
          status: "error",
          message: err,
        };
      }
      return {
        key: field.key,
        label: field.label,
        status: "ok",
        message: t.credentials.ok,
      };
    });
  }, [fieldErrors, fieldValues, schema.fields]);
  const draftExpectedSource = useMemo(() => {
    if (advancedMode) return "none";
    const hasAnyValue = schema.fields.some((field) => (fieldValues[field.key] ?? "").trim() !== "");
    return hasAnyValue ? "credentials" : "none";
  }, [advancedMode, fieldValues, schema.fields]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listCredentials();
      setItems(rows);
      const statuses = await getIntegrationsStatus();
      const mapped: Record<string, IntegrationStatusItem> = {};
      for (const s of statuses) {
        mapped[s.key] = s;
      }
      setStatusMap(mapped);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  useEffect(() => {
    setSaveMsg(null);
    setAdvancedMode(false);
    setShowSecrets({});
    getCredential(provider)
      .then((cred) => {
        const config = (cred.config ?? {}) as Record<string, unknown>;
        const secrets = (cred.secrets ?? {}) as Record<string, unknown>;
        const next: FieldValues = {};
        for (const field of schema.fields) {
          const fromConfig = typeof config[field.key] === "string" ? (config[field.key] as string) : undefined;
          const fromSecrets = typeof secrets[field.key] === "string" ? (secrets[field.key] as string) : undefined;
          let fallback: string | undefined;
          for (const alias of field.aliases ?? []) {
            const source = field.location === "config" ? config : secrets;
            if (typeof source[alias] === "string") {
              fallback = source[alias] as string;
              break;
            }
          }
          next[field.key] = (field.location === "config" ? fromConfig : fromSecrets) ?? fallback ?? "";
        }
        setFieldValues(next);
        setAdvancedConfigDraft(JSON.stringify(config, null, 2));
        setAdvancedSecretsDraft(JSON.stringify(secrets, null, 2));
      })
      .catch(() => {
        const empty: FieldValues = {};
        for (const field of schema.fields) {
          empty[field.key] = "";
        }
        setFieldValues(empty);
        setAdvancedConfigDraft("{}");
        setAdvancedSecretsDraft("{}");
      });
  }, [provider, schema.fields]);

  async function handleSave() {
    setSaveMsg(null);
    let config: Record<string, unknown> = {};
    let secrets: Record<string, unknown> = {};

    if (advancedMode) {
      try {
        config = JSON.parse(advancedConfigDraft || "{}") as Record<string, unknown>;
        secrets = JSON.parse(advancedSecretsDraft || "{}") as Record<string, unknown>;
        if (!config || typeof config !== "object" || Array.isArray(config)) {
          throw new Error("config debe ser un objeto JSON");
        }
        if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
          throw new Error("secrets debe ser un objeto JSON");
        }
      } catch (e) {
        setSaveMsg(`${t.credentials.jsonInvalidPrefix} ${(e as Error).message}`);
        return;
      }
    } else {
      if (hasFieldErrors) {
        setSaveMsg(t.credentials.hasFormErrors);
        return;
      }
      for (const field of schema.fields) {
        const value = (fieldValues[field.key] ?? "").trim();
        if (!value) continue;
        if (field.location === "config") {
          config[field.key] = value;
        } else {
          secrets[field.key] = value;
        }
      }
    }

    setSaving(true);
    try {
      await saveCredential(provider, { config, secrets });
      await refresh();
      setSaveMsg(t.credentials.saved);
    } catch (e) {
      setSaveMsg(`${t.credentials.saveErrorPrefix} ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="credentials-page">
      <header className="credentials-header">
        <h1>{t.credentials.title}</h1>
        <p>{t.credentials.subtitle}</p>
      </header>

      {error ? <p className="credentials-error">Error: {error}</p> : null}

      <section className="credentials-grid">
        <aside className="credentials-list">
          <h2>{t.credentials.providers}</h2>
          {loading ? <p>{t.credentials.loading}</p> : null}
          {PROVIDERS_ORDER.map((p) => {
            const item = items.find((x) => x.provider === p);
            const st = statusMap[p];
            return (
              <button
                type="button"
                key={p}
                className={`credentials-provider ${provider === p ? "is-active" : ""}`}
                onClick={() => setProvider(p)}
              >
                <span>{p}</span>
                <span>{st ? (st.configured ? `ok (${st.source})` : "error") : item?.hasSecrets ? "secrets: ok" : "sin secrets"}</span>
              </button>
            );
          })}
        </aside>

        <section className="credentials-editor">
          <h2>{schema.title}</h2>
          <p>{schema.description}</p>
          {schema.requirements?.length ? (
            <ul className="credentials-requirements">
              {schema.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p>
            {t.credentials.lastUpdated}:{" "}
            {current?.updatedAt ? new Date(current.updatedAt).toLocaleString() : t.credentials.never}
          </p>
          {!advancedMode && missingRequiredCount > 0 ? (
            <p className="credentials-warning">
              {t.credentials.missingRequired(missingRequiredCount)}
            </p>
          ) : null}
          {statusMap[provider] && !statusMap[provider].configured ? (
            <p className="credentials-error">
              {t.credentials.validation}: {statusMap[provider].details ?? t.credentials.incompleteConfig}
            </p>
          ) : null}
          {!advancedMode && missingRequiredCount === 0 ? (
            <p className="credentials-draft-source">
              {t.credentials.expectedSource}: {draftExpectedSource}
            </p>
          ) : null}
          {!advancedMode && missingRequiredCount === 0 && fieldChecklist.length > 0 ? (
            <ul className="credentials-checklist">
              {fieldChecklist.map((item) => (
                <li key={item.key} className={`credentials-checklist-item ${item.status}`}>
                  <span className="credentials-checklist-mark">
                    {item.status === "ok" ? "✓" : item.status === "error" ? "✖" : "•"}
                  </span>
                  <span className="credentials-checklist-label">{item.label}</span>
                  <span className="credentials-checklist-msg">{item.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {!advancedMode && schema.fields.length > 0 ? (
            <div className="credentials-form-grid">
              {schema.fields.map((field) => {
                const isSecret = field.location === "secrets";
                const inputType =
                  isSecret && !showSecrets[field.key] ? "password" : field.type === "password" ? "text" : field.type;
                return (
                  <label key={field.key} className="credentials-field">
                    <span className="credentials-field-label">
                      {field.label}
                      {field.required ? <em className="credentials-required-mark">*</em> : null}
                      {field.description ? (
                        <span className="credentials-help-icon" title={field.description} aria-label={`Ayuda ${field.label}`}>
                          i
                        </span>
                      ) : null}
                    </span>
                    <div className="credentials-field-input-wrap">
                      <input
                        type={inputType}
                        value={fieldValues[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onInput={(e) =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [field.key]: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                      {isSecret ? (
                        <button
                          type="button"
                          className="credentials-toggle-secret"
                          onClick={() =>
                            setShowSecrets((prev) => ({
                              ...prev,
                              [field.key]: !prev[field.key],
                            }))
                          }
                        >
                          {showSecrets[field.key] ? t.credentials.hide : t.credentials.show}
                        </button>
                      ) : null}
                    </div>
                    {field.description ? <small>{field.description}</small> : null}
                    {fieldErrors[field.key] ? <small className="credentials-error">{fieldErrors[field.key]}</small> : null}
                  </label>
                );
              })}
            </div>
          ) : null}
          {!advancedMode && schema.fields.length === 0 ? (
            <p className="detail-muted-box">
              {t.credentials.noGuidedForm}
            </p>
          ) : null}
          <label className="credentials-advanced-toggle">
            <input
              type="checkbox"
              checked={advancedMode}
              onChange={(e) => setAdvancedMode((e.target as HTMLInputElement).checked)}
            />
            {t.credentials.advancedMode}
          </label>
          {advancedMode ? (
            <>
              <label>
                {t.credentials.configJson}
                <textarea value={advancedConfigDraft} onInput={(e) => setAdvancedConfigDraft((e.target as HTMLTextAreaElement).value)} rows={8} />
              </label>
              <label>
                {t.credentials.secretsJson}
                <textarea value={advancedSecretsDraft} onInput={(e) => setAdvancedSecretsDraft((e.target as HTMLTextAreaElement).value)} rows={8} />
              </label>
            </>
          ) : null}
          <div className="credentials-actions">
            <button type="button" onClick={() => refresh()} disabled={loading}>
              {t.credentials.reload}
            </button>
            <button type="button" onClick={() => handleSave()} disabled={saving || (!advancedMode && hasFieldErrors)}>
              {saving ? t.credentials.saving : t.credentials.save}
            </button>
          </div>
          {saveMsg ? <p>{saveMsg}</p> : null}
        </section>
      </section>
    </main>
  );
}
