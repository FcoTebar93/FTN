# Hardening y despliegue

## Secretos y entorno

- **`FTN_JWT_SECRET`** / **`FTN_API_KEY`**: longitud adecuada; nunca commitear valores reales (usar `deploy/.env.example` como plantilla).
- **Postgres y Redis**: URLs solo por variables de entorno o secret manager; TLS en red productiva.
- **CORS**: `FTN_CORS_ORIGINS` explícito; evitar `*` con credenciales.

## Límites ya presentes en el servidor

- **`FTN_HTTP_MAX_BODY_BYTES`**: tamaño máximo del cuerpo HTTP.
- **`FTN_HTTP_RATE_LIMIT_PER_MINUTE`**: por IP (tras `FTN_TRUST_PROXY` si hay balanceador).
- Timeouts de actividades HTTP integradas (p. ej. `http.request` con techo de 120s).
- **`FTN_TENANT_MAX_CONCURRENT_RUNS`**: tope de runs en estado `running` por tenant (default 100).

## Multi-tenant (P4)

- **`FTN_MULTI_TENANT_ENABLED=1|true`**: exige cabecera `X-Tenant-Id` en requests HTTP.
- Cuando el modo multi-tenant está activo y falta `X-Tenant-Id`, la API responde `400`.
- El `tenantId` queda persistido en `WorkflowStarted.payload.tenantId`.
- El subject de acceso se scopea por tenant (`tenantId:subject`) para separar datos de designer/credentials.
- Arranques de run (`POST /workflows`, trigger HTTP, designer test-run/instant) aplican cuota por tenant usando `FTN_TENANT_MAX_CONCURRENT_RUNS`.

## Política de errores

- La API devuelve JSON con `error` y, a veces, `detail`.
- Errores de integración externa deben loguearse sin volcar secretos (el logger estructurado usa metadatos controlados).

## Observabilidad

- Logger estructurado en proceso; métricas Prometheus en **`GET /metrics`** (cuando el servidor está compilado con el recolector incluido).
- Añadir en producción: recolección de logs, alertas sobre `429`, `5xx` y latencia de workers.

## Autenticación

- Activar **`FTN_ENABLE_RBAC`** cuando los tokens deban estar acotados por scope.
- Asignar scopes por usuario en base de datos (`ftn_users.scopes`) o mantener `FTN_AUTH_LOGIN_SCOPES` para cuentas sin columna.
- Revocación de sesión: `POST /auth/logout` invalida el JWT actual por `jti`; refresh tokens rotan con `POST /auth/refresh`.

## Arranque

Al iniciar, el proceso puede registrar advertencias si faltan variables críticas en entornos no de desarrollo (véase `logProductionEnvWarnings` en `src/infra/main.ts`).
