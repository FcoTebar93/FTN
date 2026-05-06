import { useUiText } from "../../i18n";

type NotFoundPageProps = {
  title?: string;
  description?: string;
};

export function NotFoundPage({
  title,
  description
}: NotFoundPageProps) {
  const { t } = useUiText();
  const finalTitle = title ?? t.errors.notFoundTitle;
  const finalDesc = description ?? t.errors.notFoundDesc;
  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <p className="not-found-code">404</p>
        <h1>{finalTitle}</h1>
        <p>{finalDesc}</p>
        <div className="not-found-actions">
          <a className="landing-btn landing-btn-primary" href="/login">
            {t.auth.signIn}
          </a>
          <a className="landing-btn landing-btn-outline" href="/">
            {t.errors.backHome}
          </a>
        </div>
      </div>
    </div>
  );
}
