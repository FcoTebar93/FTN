## Invariantes clave

### 1. El historial de eventos es la fuente de verdad
- Ningun run depende de memoria local para reconstruir estado.
- La definicion del workflow debe poder recuperarse desde el catalogo usando `WorkflowStarted.payload.name`.
- Un worker nuevo debe poder continuar un run aunque no haya iniciado ese proceso.

### 2. Snapshot + replay deben producir el mismo estado
- `loadCurrentState()` y `runWorkflowTick()` deben rehidratar usando `snapshot.version` como frontera.
- Aplicar `snapshot.state + eventos posteriores` debe coincidir con replay del historial completo.
- Los eventos introducidos en P4 (`ChildWorkflow*`, loops, cancelacion) deben conservar este comportamiento.

### 3. El append concurrente debe ser explicito
- Dos workers no deben cerrar el mismo run silenciosamente.
- `appendEvents(... expectedVersion ...)` debe fallar con `ConcurrencyError` cuando hay carrera.
- El conflicto debe ser observable en logs y metricas para poder depurarlo.

### 4. Los estados terminales deben ser monotonos
- Un run terminal (`completed`, `failed`, `cancelled`) no debe volver a `running`.
- La cancelacion limpia pendientes (`pendingActivities`, `pendingTimers`, `pendingSignalWaits`).
- La duracion del run debe medirse cuando el motor entra en un estado terminal.

### 5. La observabilidad debe seguir el flujo real
- Registrar al menos: inicio de workflow, carga/creacion de snapshot, append de eventos, dequeue de tasks y conflictos de concurrencia.
- Exponer metricas basicas para latencia de rehidratacion, duracion del run y volumen de eventos.

## Riesgos que siguen abiertos
- El catalogo actual resuelve workflows por nombre; el versionado duro de definiciones sigue siendo una evolucion pendiente.
- La cuota por tenant sigue validandose por escaneo de runs; es correcta para esta fase, pero no es la estrategia mas eficiente a largo plazo.
