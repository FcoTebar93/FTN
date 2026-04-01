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
  - Auth (`/auth/login`, `/auth/register`, `/auth/status`)
  - Workflows/runs (`/workflows`, detalle, eventos, señales)
  - Designer (`/designer/workflows`, `/designer/kinds`)
  - Credenciales por usuario (`/credentials/*`)
  - Catálogo (`/activities`, endpoints de catálogo)
  - Salud y docs (`/health`, `/ready`, `/openapi.json`, `/docs`)
- Frontend con páginas de login, workflows, catálogo, designer y credenciales.
- OpenAPI disponible en `docs/api/openapi.json`.
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

## Qué falta por tocar (Aún en construcción)

1. **Deploy reproducible**: agregar `docker-compose.yml` y guía operativa (arranque backend + frontend + Postgres + Redis).
2. **Documentación funcional**: ejemplos end-to-end por integración (payloads reales y respuestas esperadas).
3. **Cobertura de tests**:
  - casos de fallo/reintento en workers,
  - casos de seguridad (auth/scope/rate limit),
  - pruebas E2E API + frontend.
4. **Observabilidad**: métricas y trazas (profundizar sobre el logger actual).
5. **Versionado de workflows**: estrategia explícita de compatibilidad entre versiones y migración de estado/eventos.
6. **Hardening de producción**: límites, timeouts, política de errores y secretos por entorno.

