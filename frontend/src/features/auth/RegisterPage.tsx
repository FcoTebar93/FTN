import { useState } from "preact/hooks";
import { registerUser } from "../../auth/session";
import { useUiText } from "../../i18n";

type RegisterPageProps = {
  onSuccess: () => void;
  onCancel: () => void;
};

export function RegisterPage({ onSuccess, onCancel }: RegisterPageProps) {
  const { t } = useUiText();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t.auth.passwordsNoMatch);
      return;
    }
    setSubmitting(true);
    try {
      await registerUser(username.trim(), password);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("already taken") || msg.includes("409")) {
        setError(t.auth.usernameTaken);
      } else if (msg.toLowerCase().includes("invalid")) {
        setError(t.auth.invalidUserOrPass);
      } else {
        setError(msg || t.auth.registerFailed);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <header className="login-header">
          <h1 className="login-title">{t.auth.createAccount}</h1>
          <p className="login-subtitle">{t.auth.registerSubtitle}</p>
        </header>
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
              autoComplete="new-password"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              disabled={submitting}
              required
              minLength={10}
            />
          </label>
          <label className="login-field">
            <span className="login-label">{t.auth.confirmPassword}</span>
            <input
              className="login-input"
              type="password"
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
              disabled={submitting}
              required
              minLength={10}
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? t.auth.creatingAccount : t.auth.register}
          </button>
          <p className="login-footer">
            <button type="button" className="login-link-button" onClick={onCancel} disabled={submitting}>
              {t.auth.backToLogin}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
