import { logout } from "../../auth/session";

type SessionToolbarProps = {
  onLogout: () => void;
};

export function SessionToolbar({ onLogout }: SessionToolbarProps) {
  return (
    <div className="session-toolbar">
      <div className="session-toolbar-left">
        <span className="session-toolbar-brand">FTN</span>
        <a className="session-toolbar-link" href="/">
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
