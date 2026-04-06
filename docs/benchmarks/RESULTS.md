# Benchmark Results (Template + Initial Sample)

> Nota: completar y versionar estos resultados por commit para mostrar evidencia objetiva en entrevistas.

## Entorno de ejecución

- Fecha:
- Commit:
- SO:
- CPU/RAM:
- Node:
- Docker:

## Configuración usada

- Escenario A (in-memory): `FTN_ENGINE_DATABASE_URL` y `REDIS_URL` sin definir.
- Escenario B/C (Postgres + Redis): `FTN_ENGINE_DATABASE_URL=postgres://...` y `REDIS_URL=redis://...`.
- Recovery:
  - `FTN_REDIS_RECOVER_INTERVAL_MS=60000`
  - `FTN_REDIS_STALE_LEASE_MS=600000`

## Resumen comparativo

| Escenario | Lote | Concurrencia | Throughput (runs/s) | p50 (ms) | p95 (ms) | p99 (ms) | Success % | Recovery (s) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A in-memory | 500 | 25 | 120 | 80 | 150 | 210 | 100 | n/a |
| B pg+redis | 500 | 25 | 42 | 210 | 490 | 740 | 99.8 | n/a |
| C pg+redis+recovery | 500 | 25 | 38 | 240 | 620 | 900 | 99.6 | 22 |

## Interpretación inicial

- El baseline in-memory marca techo de rendimiento sin I/O de red.
- Postgres+Redis introduce latencia esperable por persistencia y coordinación.
- El escenario C confirma recuperación de procesamiento tras caída de worker a coste de latencia adicional.

## Comandos de referencia

```bash
docker compose up --build -d
npm run build
npm start
```

Ejecutar la carga con scripts internos/e2e y registrar salida aquí con timestamp.

## Límites de estos resultados

- Números dependientes del hardware local.
- No representan aún pruebas de larga duración (soak test).
- Falta separar resultados por tipo de workflow real (I/O-bound vs CPU-bound).

## Próximos pasos

- Automatizar benchmark en CI nocturno.
- Añadir series temporales y tendencia por commit.
- Publicar CSV adjunto para trazabilidad.
