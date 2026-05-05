type NotFoundPageProps = {
  title?: string;
  description?: string;
};

export function NotFoundPage({
  title = "404 — Recurso no disponible",
  description = "No existe o no tienes permisos para acceder a esta ruta."
}: NotFoundPageProps) {
  return (
    <div className="not-found-page">
      <div className="not-found-card">
        <p className="not-found-code">404</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="not-found-actions">
          <a className="landing-btn landing-btn-primary" href="/login">
            Iniciar sesion
          </a>
          <a className="landing-btn landing-btn-outline" href="/">
            Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
