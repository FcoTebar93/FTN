# FTN Workflow Engine

Motor de workflows determinista en TypeScript con event sourcing, snapshots y ejecución por workers. Incluye API HTTP, persistencia opcional en Postgres/Redis y frontend para catálogo, runs, designer y credenciales.

## Estado actual del proyecto

Implementaciones en el repo a día de hoy:

- Core determinista (`src/core`): eventos, estado, replay, DSL `ftn` (`activity`, `join`, `parallel`, `retry`, `sleep`, `signal`, `workflowId`, `runId`).
- Runtime + workers (`src/infra`, `src/workers`): worker de workflows, worker de activities, worker de timers.
- Persistencia dual:
  - In-memory (`inmemory-*`) para desarrollo rápido.
  - Postgres (`postgres-event-store`, `postgres-snapshot-store`) + migraciones.
- Cola dual:
  - In-memory queue.
  - Redis queue (`redis-task-queue`) con recuperación de leases huérfanos.
- Integraciones modulares (`src/modules/integrations`): `payments`, `notifications`, `identity`, `http`, `storage`, `messaging`, `documents`, `logistics`, `crm`.
- API HTTP en `src/infra/main.ts` con:
  - Auth (`/auth/login`, `/auth/register`, `/auth/status`, `/auth/refresh`, `/auth/logout`, `POST /auth/forgot-password` stub 501)
  - Métricas Prometheus texto en `GET /metrics`
  - Auditoría (`GET /audit/logs?limit=`) y tabla `ftn_audit_log` (Postgres)
  - Workflows/runs (`/workflows`, detalle, eventos, señales)
  - Designer (`/designer/workflows`, `/designer/kinds`)
  - Credenciales por usuario (`/credentials/*`)
  - Catálogo (`/activities`, endpoints de catálogo)
  - Salud y docs (`/health`, `/ready`, `/openapi.json`, `/docs`)
- Frontend con páginas de login, workflows, catálogo, designer y credenciales.
- OpenAPI disponible en `docs/api/openapi.json` (validación rápida: `npm run check:openapi`).
- Documentación adicional: `docs/integrations/INTEGRATIONS.md`, `docs/WORKFLOW_VERSIONING.md`, `docs/PRODUCTION.md`.
- Suite de tests unitarios + integración en `src/__tests__`.

## Requisitos

- Node.js `>= 20`
- npm `>= 9`

## Configuración rápida

1. Instala dependencias del backend:

```bash
npm install
```

1. (Opcional) configura entorno copiando `deploy/.env.example` a `.env` y ajustando variables.
2. Compila y ejecuta backend:

```bash
npm run build
npm start
```

1. Frontend (opcional, en otra terminal):

```bash
cd frontend
npm install
npm run dev
```

## Scripts útiles

Backend (`package.json` raíz):

- `npm run build`: compila TypeScript a `dist`.
- `npm test`: tests principales.
- `npm run test:integration`: batería de integración (Postgres/Redis).
- `npm run lint`: lint sobre `src`.
- `npm start`: arranca API + workers desde `dist/infra/main.js`.

Frontend (`frontend/package.json`):

- `npm run dev`
- `npm run build`
- `npm run preview`

## Deploy reproducible (Docker Compose)

`docker-compose.yml` levanta stack completo en local:

- Backend FTN (`http://localhost:8000` por defecto)
- Frontend (`http://localhost:5173` por defecto)
- Postgres (`localhost:55432` por defecto)
- Redis (`localhost:56379` por defecto)

### Arranque

```bash
docker compose up --build
```

### Validación rápida

1. Abre `http://localhost:8000/health`.
2. Abre `http://localhost:8000/ready` y verifica `status: "ready"`.
3. Abre frontend en `http://localhost:5173`.
4. Swagger UI en `http://localhost:8000/docs`.
5. Login demo:
   - usuario: `demo`
   - contraseña: `demo-password-123`

### Operación

```bash
docker compose ps
docker compose logs -f
docker compose logs -f backend
docker compose restart backend
docker compose down
docker compose down -v
```

### Troubleshooting rápido

- Si aparece `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`, inicia Docker Desktop (engine Linux) y reintenta.
- Valida que Docker esté operativo:

```bash
docker version
docker compose ps
```

### Puertos configurables

Puedes sobreescribir sin tocar el compose:

- `FTN_BACKEND_PORT` (por defecto `8000`, mapea a `container:4000`)
- `FTN_FRONTEND_PORT` (por defecto `5173`, mapea a `container:80`)
- `FTN_POSTGRES_PORT` (por defecto `55432`, mapea a `container:5432`)
- `FTN_REDIS_PORT` (por defecto `56379`, mapea a `container:6379`)

Ejemplo:

```bash
FTN_BACKEND_PORT=8010 FTN_FRONTEND_PORT=5174 FTN_POSTGRES_PORT=55433 FTN_REDIS_PORT=56380 docker compose up --build
```

## Estructura principal

```text
src/
  core/                # Engine, eventos, estado, DSL FTN
  modules/             # Contratos + activity runtime + integraciones
  infra/               # HTTP server, stores/queues concretos, workers infra
  workers/             # Worker de activities (core)
  app/                 # Catálogo de workflows, designer store/runtime, triggers
  shared/              # Tipos y utilidades compartidas
  __tests__/           # Tests unitarios e integración
frontend/              # UI en Preact (designer, catálogo, runs, auth, credentials)
docs/api/openapi.json  # Especificación OpenAPI
deploy/.env.example    # Variables de entorno de referencia
```

## Endpoints destacados

- `GET /health`
- `GET /ready`
- `GET /docs`
- `GET /openapi.json`
- `POST /auth/login`
- `POST /auth/register`
- `GET /workflows`
- `POST /workflows`
- `POST /workflows/:workflowId/:runId/signals`
- `GET|POST|PUT /designer/workflows...`
- `GET|PUT /credentials/:provider`

## Roadmap / mejoras siguientes

1. **Documentación funcional**: ampliar `docs/integrations/INTEGRATIONS.md` con payloads alineados al catálogo OpenAPI por actividad.
2. **Cobertura de tests**: E2E API + frontend; más escenarios multi-worker; propiedades de cola bajo carga.
3. **Observabilidad**: trazas distribuidas (OpenTelemetry) además de `GET /metrics` y el logger.
4. **Recuperación de contraseña**: sustituir el stub `501` en `POST /auth/forgot-password` por flujo con email seguro.
5. **OpenAPI**: regenerar o sincronizar automáticamente `docs/api/openapi.json` con los endpoints nuevos (`/metrics`, `/auth/*`, `/audit/logs`).

