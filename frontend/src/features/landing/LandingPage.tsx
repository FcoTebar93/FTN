const capabilities = [
  {
    title: "Motor determinista con replay",
    description:
      "Cada ejecución se reconstruye desde eventos para reproducibilidad total, depuración precisa y operación multi-worker segura."
  },
  {
    title: "DSL FTN para orquestación real",
    description:
      "Define workflows con actividades, paralelismo, joins, retries, waits y señales sin perder control del estado."
  },
  {
    title: "Event sourcing + snapshots",
    description:
      "Persistencia append-only con snapshots periódicos para escalar lectura, rehidratación y recovery."
  }
];

const useCases = ["Onboarding híbrido", "Cobros y checkout", "Alertas y notificaciones", "Operaciones logísticas"];

const integrations = [
  "Stripe",
  "Slack",
  "Email",
  "CRM",
  "Storage",
  "Redis",
  "HTTP APIs",
  "Sistemas legacy"
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="landing-brand" href="/">
            FTN
          </a>
          <nav className="landing-links" aria-label="Navegacion principal">
            <a href="#capabilities">Capacidades</a>
            <a href="#use-cases">Casos de uso</a>
            <a href="#integrations">Integraciones</a>
          </nav>
          <div className="landing-nav-actions">
            <a className="landing-btn landing-btn-primary" href="/login">
              Iniciar sesion
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-kicker">Workflow engine de nueva generacion</p>
              <h1>Automatiza procesos complejos con un motor FTN determinista y multi-worker.</h1>
              <p>
                FTN es una plataforma de orquestacion para construir flujos robustos con event sourcing, snapshots,
                ejecucion reproducible y un DSL diseñado para sistemas reales.
              </p>
            </div>
            <div className="landing-bolt" aria-hidden="true">
              <div className="landing-bolt-core" />
            </div>
          </div>
        </section>

        <section className="landing-social-proof">
          <div className="landing-container landing-logos">
            <span>Pagos</span>
            <span>Retail</span>
            <span>SaaS</span>
            <span>Logistica</span>
            <span>HealthTech</span>
            <span>FinOps</span>
          </div>
        </section>

        <section id="capabilities" className="landing-section">
          <div className="landing-container">
            <h2>Arquitectura pensada para produccion</h2>
            <p className="landing-section-intro">
              No es solo un canvas bonito: FTN separa core, runtime e infraestructura para mantener escalabilidad y
              mantenibilidad a largo plazo.
            </p>
            <div className="landing-card-grid">
              {capabilities.map((item) => (
                <article key={item.title} className="landing-feature-card">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="use-cases" className="landing-section landing-section-panel">
          <div className="landing-container landing-split">
            <aside className="landing-pill-list" aria-label="Categorias de casos de uso">
              {useCases.map((label) => (
                <span key={label} className="landing-pill">
                  {label}
                </span>
              ))}
            </aside>
            <div className="landing-panel">
              <h2>Del trigger al resultado, sin caos operacional</h2>
              <p>
                Orquesta flujos de negocio con validaciones, pagos, notificaciones y acciones externas en un solo
                recorrido auditable. Si algo falla, puedes reintentar por actividad sin reiniciar todo el proceso.
              </p>
            </div>
          </div>
        </section>

        <section id="integrations" className="landing-section">
          <div className="landing-container">
            <h2>Integraciones listas para conectar</h2>
            <div className="landing-integration-grid">
              {integrations.map((name) => (
                <span key={name} className="landing-integration-chip">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-container landing-proof-grid">
            <article className="landing-proof-card">
              <p className="landing-proof-label">Determinismo</p>
              <strong>100% replayable</strong>
              <p>Tu estado se puede reconstruir de forma consistente para auditoria y debugging.</p>
            </article>
            <article className="landing-proof-card">
              <p className="landing-proof-label">Escalabilidad</p>
              <strong>Multi-worker nativo</strong>
              <p>Separa workers de workflow y actividades para distribuir carga sin romper invariantes.</p>
            </article>
            <article className="landing-proof-card">
              <p className="landing-proof-label">Productividad</p>
              <strong>DSL orientado a dominio</strong>
              <p>Modela procesos de negocio complejos en TypeScript con primitives claras y testeables.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
