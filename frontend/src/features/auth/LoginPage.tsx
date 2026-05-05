import { useState } from "preact/hooks";
import { loginWithPassword } from "../../auth/session";

type LoginPageProps = {
  onSuccess: () => void;
  registrationEnabled?: boolean;
};

export function LoginPage({ onSuccess, registrationEnabled }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.toLowerCase().includes("invalid")) {
        setError("Usuario o contraseña incorrectos.");
      } else {
        setError(msg || "No se pudo iniciar sesión.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <header className="login-header">
          <h1 className="login-title">FTN</h1>
          <p className="login-subtitle">Inicia sesión para continuar</p>
        </header>
        <p className="login-back-wrap">
          <a className="login-back-link" href="/">
            Volver
          </a>
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span className="login-label">Usuario</span>
            <input
              className="login-input"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
              disabled={submitting}
              required
            />
          </label>
          <label className="login-field">
            <span className="login-label">Contraseña</span>
            <input
              className="login-input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              disabled={submitting}
              required
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? "Entrando…" : "Entrar"}
          </button>
          {registrationEnabled ? (
            <p className="login-footer">
              <a className="login-link" href="/register">
                Crear cuenta
              </a>
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
