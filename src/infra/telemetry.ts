import { context, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let providerRegistered = false;

/** Registra un tracer global (exportador no configurado: trazas listas para enganchar OTLP en despliegue). */
export function initFtnTelemetry(): void {
  if (providerRegistered || process.env.FTN_OTEL_DISABLED === "1" || process.env.FTN_OTEL_DISABLED === "true") {
    return;
  }
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "ftn-workflow-engine";
  const provider = new NodeTracerProvider({
    resource: new Resource({ "service.name": serviceName }),
  });
  provider.register();
  providerRegistered = true;
}

/** Ejecuta el manejador HTTP dentro de un span raíz (no-op si OTEL desactivado). */
export async function runWithHttpSpan(req: { method?: string; url?: string }, fn: () => Promise<void>): Promise<void> {
  if (process.env.FTN_OTEL_DISABLED === "1" || process.env.FTN_OTEL_DISABLED === "true") {
    await fn();
    return;
  }
  const tracer = trace.getTracer("ftn-http");
  const pathOnly = (req.url ?? "").split("?")[0] ?? "";
  const span = tracer.startSpan("http.server", {
    attributes: {
      "http.request.method": req.method ?? "GET",
      "url.path": pathOnly,
    },
  });
  try {
    await context.with(trace.setSpan(context.active(), span), fn);
  } finally {
    span.end();
  }
}
