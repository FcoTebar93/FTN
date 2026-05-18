import { logout } from "../../auth/session";
import { useUiText } from "../../i18n";
import { LanguageToggleButton } from "../../i18n/LanguageToggleButton";

type SessionToolbarProps = {
  onLogout: () => void;
  userLabel?: string | null;
};

export function SessionToolbar({ onLogout, userLabel }: SessionToolbarProps) {
  const { t } = useUiText();
  return (
    <div className="session-toolbar">
      <div className="session-toolbar-left">
        <span className="session-toolbar-brand">FTN</span>
        {userLabel ? <span className="session-toolbar-user">@{userLabel}</span> : null}
        <a className="session-toolbar-link" href="/runs">
          {t.nav.runs}
        </a>
        <a className="session-toolbar-link" href="/catalog">
          {t.nav.catalog}
        </a>
        <a className="session-toolbar-link" href="/designer">
          {t.nav.designer}
        </a>
        <a className="session-toolbar-link" href="/credentials">
          {t.nav.credentials}
        </a>
        <LanguageToggleButton className="session-lang-toggle" />
      </div>
      <button type="button" className="session-toolbar-logout" onClick={() => { logout(); onLogout(); }}>
        {t.nav.logout}
      </button>
    </div>
  );
}
