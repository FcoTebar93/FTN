import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { WorkflowsPage } from "./features/workflows/WorkflowsPage";
import { PaymentModal } from "./PaymentModal";
import { DesignerPage } from "./features/designer/DesignerPage";
import { LoginPage } from "./features/auth/LoginPage";
import { SessionToolbar } from "./features/auth/SessionToolbar";
import { fetchAuthStatus } from "./auth/session";
import { API_BASE_URL, getAccessToken } from "./config";
import { onUnauthorized } from "./api/client";

export function App() {
  const [boot, setBoot] = useState<"loading" | "ready">("loading");
  const [showLogin, setShowLogin] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(() => !!getAccessToken());

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const s = await fetchAuthStatus();
        const needLogin = s.authRequired && s.loginConfigured && !getAccessToken();
        setShowLogin(needLogin);
        setStatusError(null);
      } catch (e) {
        setStatusError(e instanceof Error ? e.message : String(e));
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

  if (showLogin) {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }

  const wrapped = (children: ComponentChildren) => (
    <div className="app">
      {statusError ? (
        <p className="app-status-warning" role="status">
          No se pudo comprobar /auth/status: {statusError}
        </p>
      ) : null}
      {hasSession ? <SessionToolbar onLogout={handleLogout} /> : null}
      {children}
    </div>
  );

  if (path === "/pagar") {
    return wrapped(<PaymentModal backendBaseUrl={API_BASE_URL} />);
  }

  if (path.startsWith("/designer")) {
    return wrapped(<DesignerPage />);
  }

  return wrapped(<WorkflowsPage />);
}
