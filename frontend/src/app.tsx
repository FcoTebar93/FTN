import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { WorkflowsPage } from "./features/workflows/WorkflowsPage";
import { PaymentModal } from "./PaymentModal";
import { DesignerPage } from "./features/designer/DesignerPage";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { SessionToolbar } from "./features/auth/SessionToolbar";
import { CredentialsPage } from "./features/credentials/CredentialsPage";
import { LandingPage } from "./features/landing/LandingPage";
import { fetchAuthStatus, getCurrentSessionSubject } from "./auth/session";
import type { AuthStatus } from "./auth/session";
import { API_BASE_URL, getAccessToken } from "./config";
import { onUnauthorized } from "./api/client";

export function App() {
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(() => !!getAccessToken());

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const s = await fetchAuthStatus();
        setAuthStatus(s);
        const needLogin = s.authRequired && s.loginConfigured && !getAccessToken();
        setShowLogin(needLogin);
        setStatusError(null);
      } catch (e) {
        setStatusError(e instanceof Error ? e.message : String(e));
        setAuthStatus(null);
        setShowLogin(false);
      } finally {
        setBoot("ready");
      }
    })();

    unsub = onUnauthorized(() => {
      fetchAuthStatus()
        .then((s) => {
          if (s.authRequired && s.loginConfigured) {
            setShowLogin(true);
            setHasSession(false);
          }
        })
        .catch(() => {});
    });

    return () => {
      unsub?.();
    };
  }, []);

  function handleLoginSuccess(): void {
    setShowLogin(false);
    setHasSession(true);
    if (window.location.pathname === "/register") {
      window.history.replaceState({}, "", "/runs");
    }
  }

  function handleLogout(): void {
    setShowLogin(true);
    setHasSession(false);
  }

  const url = new URL(window.location.href);
  const path = url.pathname;

  if (boot === "loading") {
    return (
      <div className="app app-boot">
        <p className="app-boot-text">Cargando…</p>
      </div>
    );
  }

  if (path === "/register") {
    if (!authStatus?.registrationEnabled) {
      return (
        <div className="login-screen">
          <div className="login-card">
            <header className="login-header">
              <h1 className="login-title">FTN</h1>
              <p className="login-subtitle">El registro no está habilitado en este entorno.</p>
            </header>
            <p className="login-footer">
              <a className="login-link" href="/">
                Volver al inicio
              </a>
            </p>
          </div>
        </div>
      );
    }
    if (getAccessToken()) {
      window.location.replace("/");
      return (
        <div className="app app-boot">
          <p className="app-boot-text">Redirigiendo…</p>
        </div>
      );
    }
    return (
      <RegisterPage
        onSuccess={handleLoginSuccess}
        onCancel={() => {
          window.location.href = "/";
        }}
      />
    );
  }

  if (path === "/login") {
    if (getAccessToken()) {
      window.location.replace("/runs");
      return (
        <div className="app app-boot">
          <p className="app-boot-text">Redirigiendo…</p>
        </div>
      );
    }
    return (
      <LoginPage
        onSuccess={handleLoginSuccess}
        registrationEnabled={Boolean(authStatus?.registrationEnabled)}
      />
    );
  }

  const isPublicLanding = path === "/";

  if (showLogin && !isPublicLanding) {
    return (
      <LoginPage
        onSuccess={handleLoginSuccess}
        registrationEnabled={Boolean(authStatus?.registrationEnabled)}
      />
    );
  }

  const wrapped = (children: ComponentChildren) => (
    <div className="app">
      {statusError ? (
        <p className="app-status-warning" role="status">
          No se pudo comprobar /auth/status: {statusError}
        </p>
      ) : null}
      {hasSession ? <SessionToolbar onLogout={handleLogout} userLabel={getCurrentSessionSubject()} /> : null}
      {children}
    </div>
  );

  if (path === "/pagar") {
    return wrapped(<PaymentModal backendBaseUrl={API_BASE_URL} />);
  }

  if (isPublicLanding) {
    return <LandingPage />;
  }

  if (path.startsWith("/designer")) {
    return wrapped(<DesignerPage />);
  }

  if (path.startsWith("/credentials")) {
    return wrapped(<CredentialsPage />);
  }

  if (path === "/runs" || path.startsWith("/workflows")) {
    return wrapped(<WorkflowsPage />);
  }

  return wrapped(<WorkflowsPage />);
}
