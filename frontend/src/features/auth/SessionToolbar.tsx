import { logout } from "../../auth/session";

type SessionToolbarProps = {
  onLogout: () => void;
  userLabel?: string | null;
};

export function SessionToolbar({ onLogout, userLabel }: SessionToolbarProps) {
  return (
    <div className="session-toolbar">
      <div className="session-toolbar-left">
        <span className="session-toolbar-brand">FTN</span>
        {userLabel ? <span className="session-toolbar-user">@{userLabel}</span> : null}
        <a className="session-toolbar-link" href="/runs">
          Runs
        </a>
        <a className="session-toolbar-link" href="/designer">
          Designer
        </a>
        <a className="session-toolbar-link" href="/credentials">
          Credenciales
        </a>
      </div>
      <button type="button" className="session-toolbar-logout" onClick={() => { logout(); onLogout(); }}>
        Cerrar sesión
      </button>
    </div>
  );
}
