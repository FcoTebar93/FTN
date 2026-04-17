import { context, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let providerRegistered = false;
let telemetryDisabled = false;

interface TelemetryOptions {
  disabled?: boolean;
  serviceName?: string;
}

/** Registra un tracer global (exportador no configurado: trazas listas para enganchar OTLP en despliegue). */
export function initFtnTelemetry(options: TelemetryOptions = {}): void {
  telemetryDisabled = options.disabled ?? false;
  if (providerRegistered || telemetryDisabled) {
    return;
  }
  const serviceName = options.serviceName?.trim() || "ftn-workflow-engine";
  const provider = new NodeTracerProvider({
    resource: new Resource({ "service.name": serviceName }),
  });
  provider.register();
  providerRegistered = true;
}

/** Ejecuta el manejador HTTP dentro de un span raíz (no-op si OTEL desactivado). */
export async function runWithHttpSpan(
  req: { method?: string; url?: string },
  fn: () => Promise<void>,
  opts?: { correlationId?: string; requestId?: string }
): Promise<void> {
  if (telemetryDisabled) {
    await fn();
    return;
  }
  const tracer = trace.getTracer("ftn-http");
  const pathOnly = (req.url ?? "").split("?")[0] ?? "";
  const span = tracer.startSpan("http.server", {
    attributes: {
      "http.request.method": req.method ?? "GET",
      "url.path": pathOnly,
      ...(opts?.correlationId ? { "ftn.correlation_id": opts.correlationId } : {}),
      ...(opts?.requestId ? { "ftn.request_id": opts.requestId } : {}),
    },
  });
  try {
    await context.with(trace.setSpan(context.active(), span), fn);
  } finally {
    span.end();
  }
}
