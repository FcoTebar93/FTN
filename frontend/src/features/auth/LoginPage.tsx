import { useState } from "preact/hooks";
import { loginWithPassword } from "../../auth/session";
import { useUiText } from "../../i18n";

type LoginPageProps = {
  onSuccess: () => void;
  registrationEnabled?: boolean;
};

export function LoginPage({ onSuccess, registrationEnabled }: LoginPageProps) {
  const { t } = useUiText();
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
        setError(t.auth.badCredentials);
      } else {
        setError(msg || t.auth.loginFailed);
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
          <p className="login-subtitle">{t.auth.signInToContinue}</p>
        </header>
        <p className="login-back-wrap">
          <a className="login-back-link" href="/">
            {t.common.back}
          </a>
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-field">
            <span className="login-label">{t.auth.username}</span>
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
            <span className="login-label">{t.auth.password}</span>
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
            {submitting ? t.auth.entering : t.auth.enter}
          </button>
          {registrationEnabled ? (
            <p className="login-footer">
              <a className="login-link" href="/register">
                {t.auth.createAccount}
              </a>
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
