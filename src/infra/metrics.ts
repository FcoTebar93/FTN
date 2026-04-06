let httpRequests = 0;
let httpUnauthorized = 0;
let httpForbidden = 0;
let httpRateLimited = 0;

export function incHttpRequest(): void {
  httpRequests += 1;
}

export function incHttpUnauthorized(): void {
  httpUnauthorized += 1;
}

export function incHttpForbidden(): void {
  httpForbidden += 1;
}

export function incHttpRateLimited(): void {
  httpRateLimited += 1;
}

export function renderPrometheusText(): string {
  const lines = [
    "# HELP ftn_http_requests_total Peticiones HTTP atendidas por el proceso.",
    "# TYPE ftn_http_requests_total counter",
    `ftn_http_requests_total ${httpRequests}`,
    "# HELP ftn_http_responses_unauthorized_total Respuestas 401 (antes de contar el cuerpo de la petición).",
    "# TYPE ftn_http_responses_unauthorized_total counter",
    `ftn_http_responses_unauthorized_total ${httpUnauthorized}`,
    "# HELP ftn_http_responses_forbidden_total Respuestas 403 por scope insuficiente.",
    "# TYPE ftn_http_responses_forbidden_total counter",
    `ftn_http_responses_forbidden_total ${httpForbidden}`,
    "# HELP ftn_http_responses_rate_limited_total Respuestas 429 por rate limit.",
    "# TYPE ftn_http_responses_rate_limited_total counter",
    `ftn_http_responses_rate_limited_total ${httpRateLimited}`,
    "",
  ];
  return lines.join("\n");
}
