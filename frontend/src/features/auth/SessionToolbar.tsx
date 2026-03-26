import { logout } from "../../auth/session";

type SessionToolbarProps = {
  onLogout: () => void;
};

export function SessionToolbar({ onLogout }: SessionToolbarProps) {
  return (
    <div className="session-toolbar">
      <span className="session-toolbar-brand">FTN</span>
      <button type="button" className="session-toolbar-logout" onClick={() => { logout(); onLogout(); }}>
        Cerrar sesión
      </button>
    </div>
  );
}
