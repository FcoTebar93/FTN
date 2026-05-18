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
import { NotFoundPage } from "./features/errors/NotFoundPage";
import { WorkflowsCatalogPage } from "./features/catalog/WorkflowsCatalogPage";
import { fetchAuthStatus, getCurrentSessionSubject } from "./auth/session";
import type { AuthStatus } from "./auth/session";
import { API_BASE_URL, getAccessToken } from "./config";
import { onUnauthorized } from "./api/client";
import { useUiText } from "./i18n";

export function App() {
  const { t } = useUiText();
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
    // Evita mostrar 404 en rutas protegidas tras logout.
    setShowLogin(false);
    setHasSession(false);
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }

  const url = new URL(window.location.href);
  const path = url.pathname;
  const knownProtectedPath =
    path === "/pagar" ||
    path === "/runs" ||
    path === "/catalog" ||
    path.startsWith("/workflows") ||
    path.startsWith("/designer") ||
    path.startsWith("/credentials");

  if (boot === "loading") {
    return (
      <div className="app app-boot">
        <p className="app-boot-text">{t.common.loading}</p>
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
              <p className="login-subtitle">{t.app.registrationDisabled}</p>
            </header>
            <p className="login-footer">
              <a className="login-link" href="/">
                {t.errors.backHome}
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
          <p className="app-boot-text">{t.common.redirecting}</p>
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
          <p className="app-boot-text">{t.common.redirecting}</p>
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

  if (showLogin && knownProtectedPath) {
    return <NotFoundPage description={t.app.protectedNotFound} />;
  }

  const wrapped = (children: ComponentChildren) => (
    <div className="app">
      {statusError ? (
        <p className="app-status-warning" role="status">
          {t.app.authStatusFailed} {statusError}
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

  if (path === "/catalog") {
    return wrapped(<WorkflowsCatalogPage />);
  }

  if (path === "/runs" || path.startsWith("/workflows")) {
    return wrapped(<WorkflowsPage />);
  }

  return <NotFoundPage />;
}
