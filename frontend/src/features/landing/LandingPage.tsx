import heroFtnImage from "../../assets/ftn.png";
import { useEffect, useRef, useState } from "preact/hooks";
import { useUiText } from "../../i18n";
import { LanguageToggleButton } from "../../i18n/LanguageToggleButton";

const landingText = {
  es: {
    nav: { capabilities: "Capacidades", useCases: "Casos de uso", integrations: "Integraciones" },
    hero: {
      kicker: "Workflow engine de nueva generacion",
      title: "Automatiza procesos complejos con un motor FTN determinista y multi-worker.",
      body: "FTN es una plataforma de orquestacion para construir flujos robustos con event sourcing, snapshots, ejecucion reproducible y un DSL diseñado para sistemas reales.",
      alt: "FTN automatiza conecta transforma",
    },
    capabilities: {
      title: "Arquitectura pensada para produccion",
      intro: "No es solo un canvas bonito: FTN separa core, runtime e infraestructura para mantener escalabilidad y mantenibilidad a largo plazo.",
      items: [
        {
          title: "Motor determinista con replay",
          description:
            "Cada ejecución se reconstruye desde eventos para reproducibilidad total, depuración precisa y operación multi-worker segura.",
        },
        {
          title: "DSL FTN para orquestación real",
          description:
            "Define workflows con actividades, paralelismo, joins, retries, waits y señales sin perder control del estado.",
        },
        {
          title: "Event sourcing + snapshots",
          description:
            "Persistencia append-only con snapshots periódicos para escalar lectura, rehidratación y recovery.",
        },
      ],
    },
    useCases: {
      labels: ["Onboarding híbrido", "Cobros y checkout", "Alertas y notificaciones", "Operaciones logísticas"],
      title: "Del trigger al resultado, sin caos operacional",
      body: "Orquesta flujos de negocio con validaciones, pagos, notificaciones y acciones externas en un solo recorrido auditable. Si algo falla, puedes reintentar por actividad sin reiniciar todo el proceso.",
    },
    integrations: {
      title: "Integraciones listas para conectar",
      aria: "Integraciones disponibles",
      items: ["Stripe", "Slack", "Email", "CRM", "Storage", "Redis", "HTTP APIs", "Sistemas legacy"],
    },
    proof: [
      {
        label: "Determinismo",
        title: "100% replayable",
        body: "Tu estado se puede reconstruir de forma consistente para auditoria y debugging.",
      },
      {
        label: "Escalabilidad",
        title: "Multi-worker nativo",
        body: "Separa workers de workflow y actividades para distribuir carga sin romper invariantes.",
      },
      {
        label: "Productividad",
        title: "DSL orientado a dominio",
        body: "Modela procesos de negocio complejos en TypeScript con primitives claras y testeables.",
      },
    ],
  },
  en: {
    nav: { capabilities: "Capabilities", useCases: "Use Cases", integrations: "Integrations" },
    hero: {
      kicker: "Next-generation workflow engine",
      title: "Automate complex processes with a deterministic, multi-worker FTN engine.",
      body: "FTN is an orchestration platform to build robust flows with event sourcing, snapshots, reproducible execution, and a DSL designed for real systems.",
      alt: "FTN automate connect transform",
    },
    capabilities: {
      title: "Architecture designed for production",
      intro: "This is not just a pretty canvas: FTN separates core, runtime, and infrastructure to keep long-term scalability and maintainability.",
      items: [
        {
          title: "Deterministic engine with replay",
          description:
            "Every run is rebuilt from events for full reproducibility, precise debugging, and safe multi-worker operation.",
        },
        {
          title: "FTN DSL for real orchestration",
          description:
            "Define workflows with activities, parallelism, joins, retries, waits, and signals without losing state control.",
        },
        {
          title: "Event sourcing + snapshots",
          description:
            "Append-only persistence with periodic snapshots to scale reads, rehydration, and recovery.",
        },
      ],
    },
    useCases: {
      labels: ["Hybrid onboarding", "Billing and checkout", "Alerts and notifications", "Logistics operations"],
      title: "From trigger to outcome, without operational chaos",
      body: "Orchestrate business flows with validations, payments, notifications, and external actions in one auditable path. If something fails, retry per activity without restarting the whole process.",
    },
    integrations: {
      title: "Integrations ready to connect",
      aria: "Available integrations",
      items: ["Stripe", "Slack", "Email", "CRM", "Storage", "Redis", "HTTP APIs", "Legacy systems"],
    },
    proof: [
      {
        label: "Determinism",
        title: "100% replayable",
        body: "Your state can be reconstructed consistently for auditability and debugging.",
      },
      {
        label: "Scalability",
        title: "Native multi-worker",
        body: "Split workflow and activity workers to distribute load without breaking invariants.",
      },
      {
        label: "Productivity",
        title: "Domain-oriented DSL",
        body: "Model complex business processes in TypeScript with clear, testable primitives.",
      },
    ],
  },
} as const;

const sectionFlow = [
  { id: "hero", selector: ".landing-hero", label: "Inicio", icon: "hero" },
  { id: "capabilities", selector: "#capabilities", label: "Capacidades", icon: "capabilities" },
  { id: "use-cases", selector: "#use-cases", label: "Casos", icon: "useCases" },
  { id: "integrations", selector: "#integrations", label: "Integraciones", icon: "integrations" },
  { id: "proof", selector: ".landing-proof-grid", label: "Valor", icon: "proof" },
] as const;

type FlowIconName = (typeof sectionFlow)[number]["icon"];

const flowIconPaths: Record<FlowIconName, string> = {
  hero: "M4 12h10M14 8l6 4-6 4",
  capabilities: "M4 6h16M4 12h16M4 18h10",
  useCases: "M5 7h14v10H5zM9 11h6",
  integrations: "M6 8h12M6 16h12M12 8v8",
  proof: "M6 12l4 4 8-8",
};

function FlowNode({ label, icon, top }: { label: string; icon: FlowIconName; top: number }) {
  return (
    <span className="landing-flow-point" style={{ top: `${top}px` }}>
      <span className="landing-flow-node-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" focusable="false">
          <path d={flowIconPaths[icon]} />
        </svg>
      </span>
      <span className="landing-flow-node-label">{label}</span>
    </span>
  );
}

export function LandingPage() {
  const { locale, setLocale, t } = useUiText();
  const lt = landingText[locale];
  const landingRef = useRef<HTMLDivElement>(null);
  const [pointPositions, setPointPositions] = useState<number[]>([]);

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

  useEffect(() => {
    const landing = landingRef.current;
    if (!landing) return;

    const updateScrollProgress = () => {
      const start = landing.offsetTop;
      const maxScrollable = Math.max(landing.offsetHeight - window.innerHeight, 1);
      const progress = (window.scrollY - start) / maxScrollable;
      const clamped = Math.min(1, Math.max(0, progress));
      landing.style.setProperty("--landing-progress", clamped.toFixed(4));
    };

    updateScrollProgress();
    window.addEventListener("scroll", updateScrollProgress, { passive: true });
    window.addEventListener("resize", updateScrollProgress);

    const nodes = Array.from(landing.querySelectorAll<HTMLElement>(".landing-flow-point"));
    const targets = sectionFlow
      .map(({ selector }, index) => ({ target: landing.querySelector(selector), node: nodes[index] }))
      .filter((item): item is { target: Element; node: HTMLElement } => Boolean(item.target && item.node));

    const markerObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const matched = targets.find((item) => item.target === entry.target);
          if (!matched) continue;
          if (entry.isIntersecting) matched.node.classList.add("is-revealed");
          matched.node.classList.toggle("is-active", entry.isIntersecting);
        }
      },
      { threshold: 0.45, rootMargin: "-18% 0px -40% 0px" }
    );

    for (const pair of targets) markerObserver.observe(pair.target);

    return () => {
      window.removeEventListener("scroll", updateScrollProgress);
      window.removeEventListener("resize", updateScrollProgress);
      markerObserver.disconnect();
      landing.style.removeProperty("--landing-progress");
    };
  }, []);

  useEffect(() => {
    const landing = landingRef.current;
    if (!landing) return;

    const measurePoints = () => {
      const next = sectionFlow.map(({ selector }) => {
        const target = landing.querySelector<HTMLElement>(selector);
        if (!target) return 0;
        return target.offsetTop + target.offsetHeight * 0.5;
      });
      setPointPositions(next);
    };

    measurePoints();
    window.addEventListener("resize", measurePoints);
    return () => window.removeEventListener("resize", measurePoints);
  }, []);

  return (
    <div className="landing" ref={landingRef}>
      <div className="landing-flow-progress" aria-hidden="true">
        <div className="landing-flow-progress-rail">
          <div className="landing-flow-progress-line" />
          <div className="landing-flow-progress-fill" />
          <div className="landing-flow-points">
            {sectionFlow.map((section, index) => (
              <FlowNode
                key={section.id}
                label={section.label}
                icon={section.icon}
                top={pointPositions[index] ?? 0}
              />
            ))}
          </div>
        </div>
      </div>
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand-wrap">
            <a className="landing-brand" href="/">
              FTN
            </a>
            <LanguageToggleButton className="landing-btn landing-btn-ghost landing-lang-toggle" />
          </div>
          <nav className="landing-links" aria-label="Navegacion principal">
            <a href="#capabilities">{lt.nav.capabilities}</a>
            <a href="#use-cases">{lt.nav.useCases}</a>
            <a href="#integrations">{lt.nav.integrations}</a>
          </nav>
          <div className="landing-nav-actions">
            <a className="landing-btn landing-btn-primary" href="/login">
              {t.auth.signIn}
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-kicker reveal-on-scroll reveal-from-left reveal-delay-1">
                {lt.hero.kicker}
              </p>
              <h1 className="reveal-on-scroll reveal-from-left reveal-delay-2">
                {lt.hero.title}
              </h1>
              <p className="reveal-on-scroll reveal-from-left reveal-delay-3">
                {lt.hero.body}
              </p>
            </div>
            <div className="landing-bolt reveal-on-scroll reveal-from-right reveal-delay-0" aria-hidden="true">
              <div className="landing-hero-image-frame">
                <img className="landing-hero-image" src={heroFtnImage} alt={lt.hero.alt} />
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="landing-section reveal-on-scroll reveal-delay-1">
          <div className="landing-container">
            <h2>{lt.capabilities.title}</h2>
            <p className="landing-section-intro">{lt.capabilities.intro}</p>
            <div className="landing-card-grid">
              {lt.capabilities.items.map((item) => (
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
            <aside className="landing-pill-list" aria-label="Use case categories">
              {lt.useCases.labels.map((label) => (
                <span key={label} className="landing-pill">
                  {label}
                </span>
              ))}
            </aside>
            <div className="landing-panel">
              <h2>{lt.useCases.title}</h2>
              <p>{lt.useCases.body}</p>
            </div>
          </div>
        </section>

        <section id="integrations" className="landing-section reveal-on-scroll reveal-delay-2">
          <div className="landing-container">
            <h2>{lt.integrations.title}</h2>
            <div className="landing-integrations-marquee" aria-label={lt.integrations.aria}>
              <div className="landing-integrations-track">
                {lt.integrations.items.map((name) => (
                  <span key={`a-${name}`} className="landing-integration-chip">
                    {name}
                  </span>
                ))}
                {lt.integrations.items.map((name) => (
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
            {lt.proof.map((item) => (
              <article key={item.label} className="landing-proof-card">
                <p className="landing-proof-label">{item.label}</p>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
