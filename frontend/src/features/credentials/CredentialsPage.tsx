import { useEffect, useMemo, useState } from "preact/hooks";
import { getCredential, listCredentials, saveCredential } from "../../api/credentials";
import type { CredentialSummary } from "../../api/types";

const PROVIDERS = ["stripe", "notifications", "crm", "twilio", "kyc"] as const;

export function CredentialsPage() {
  const [items, setItems] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("stripe");
  const [configDraft, setConfigDraft] = useState("{}");
  const [secretsDraft, setSecretsDraft] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const current = useMemo(() => items.find((x) => x.provider === provider), [items, provider]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listCredentials();
      setItems(rows);
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
    getCredential(provider)
      .then((cred) => {
        setConfigDraft(JSON.stringify(cred.config ?? {}, null, 2));
        setSecretsDraft(JSON.stringify(cred.secrets ?? {}, null, 2));
      })
      .catch(() => {
        setConfigDraft("{}");
        setSecretsDraft("{}");
      });
  }, [provider]);

  async function handleSave() {
    setSaveMsg(null);
    let config: Record<string, unknown>;
    let secrets: Record<string, unknown>;
    try {
      config = JSON.parse(configDraft || "{}") as Record<string, unknown>;
      secrets = JSON.parse(secretsDraft || "{}") as Record<string, unknown>;
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("config debe ser un objeto JSON");
      }
      if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
        throw new Error("secrets debe ser un objeto JSON");
      }
    } catch (e) {
      setSaveMsg(`JSON inválido: ${(e as Error).message}`);
      return;
    }

    setSaving(true);
    try {
      await saveCredential(provider, { config, secrets });
      await refresh();
      setSaveMsg("Credenciales guardadas.");
    } catch (e) {
      setSaveMsg(`Error al guardar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="credentials-page">
      <header className="credentials-header">
        <h1>Credenciales de integraciones</h1>
        <p>Guarda configuración y secretos cifrados para Stripe, CRM, Twilio y KYC.</p>
      </header>

      {error ? <p className="credentials-error">Error: {error}</p> : null}

      <section className="credentials-grid">
        <aside className="credentials-list">
          <h2>Providers</h2>
          {loading ? <p>Cargando...</p> : null}
          {PROVIDERS.map((p) => {
            const item = items.find((x) => x.provider === p);
            return (
              <button
                type="button"
                key={p}
                className={`credentials-provider ${provider === p ? "is-active" : ""}`}
                onClick={() => setProvider(p)}
              >
                <span>{p}</span>
                <span>{item?.hasSecrets ? "secrets: ok" : "sin secrets"}</span>
              </button>
            );
          })}
        </aside>

        <section className="credentials-editor">
          <h2>{provider}</h2>
          <p>Última actualización: {current?.updatedAt ? new Date(current.updatedAt).toLocaleString() : "nunca"}</p>
          <label>
            Config (JSON)
            <textarea value={configDraft} onInput={(e) => setConfigDraft((e.target as HTMLTextAreaElement).value)} rows={10} />
          </label>
          <label>
            Secrets (JSON cifrado en backend)
            <textarea value={secretsDraft} onInput={(e) => setSecretsDraft((e.target as HTMLTextAreaElement).value)} rows={10} />
          </label>
          <div className="credentials-actions">
            <button type="button" onClick={() => refresh()} disabled={loading}>
              Recargar
            </button>
            <button type="button" onClick={() => handleSave()} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
          {saveMsg ? <p>{saveMsg}</p> : null}
        </section>
      </section>
    </main>
  );
}
