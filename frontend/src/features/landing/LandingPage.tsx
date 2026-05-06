import heroFtnImage from "../../../../ftn.png";
import { useEffect } from "preact/hooks";

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
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".reveal-on-scroll"));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.classList.add("is-visible");
          observer.unobserve(el);
        }
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px"
      }
    );

    for (const node of nodes) observer.observe(node);

    return () => observer.disconnect();
  }, []);

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
              <p className="landing-kicker reveal-on-scroll reveal-from-left reveal-delay-1">
                Workflow engine de nueva generacion
              </p>
              <h1 className="reveal-on-scroll reveal-from-left reveal-delay-2">
                Automatiza procesos complejos con un motor FTN determinista y multi-worker.
              </h1>
              <p className="reveal-on-scroll reveal-from-left reveal-delay-3">
                FTN es una plataforma de orquestacion para construir flujos robustos con event sourcing, snapshots,
                ejecucion reproducible y un DSL diseñado para sistemas reales.
              </p>
            </div>
            <div className="landing-bolt reveal-on-scroll reveal-from-right reveal-delay-0" aria-hidden="true">
              <div className="landing-hero-image-frame">
                <img className="landing-hero-image" src={heroFtnImage} alt="FTN automatiza conecta transforma" />
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="landing-section reveal-on-scroll reveal-delay-1">
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

        <section id="use-cases" className="landing-section landing-section-panel reveal-on-scroll reveal-delay-1">
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

        <section id="integrations" className="landing-section reveal-on-scroll reveal-delay-2">
          <div className="landing-container">
            <h2>Integraciones listas para conectar</h2>
            <div className="landing-integrations-marquee" aria-label="Integraciones disponibles">
              <div className="landing-integrations-track">
                {integrations.map((name) => (
                  <span key={`a-${name}`} className="landing-integration-chip">
                    {name}
                  </span>
                ))}
                {integrations.map((name) => (
                  <span key={`b-${name}`} className="landing-integration-chip">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section reveal-on-scroll reveal-delay-2">
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
