# Demo Day Runbook (10 minutos)

Objetivo: enseñar valor de producto + solidez técnica de FTN en una demo corta y repetible.

## Preparación previa (2-3 min antes)

1. Arranca backend:

```bash
npm run build
npm start
```

2. Arranca frontend (otra terminal):

```bash
cd frontend
npm run dev
```

3. URLs listas:
- UI: `http://localhost:5173`
- API docs: `http://localhost:4000/docs`
- Health: `http://localhost:4000/health`

4. Si tienes auth activa, prepara token/API key para `curl`.

---

## Agenda minuto a minuto

## Min 0-1 — Contexto y problema

Narrativa:
- “FTN orquesta procesos largos con trazabilidad total.”
- “Cada transición queda como evento (event sourcing), así que puedo reanudar, auditar y depurar.”

Pantalla:
- `http://localhost:5173` (Workflows)

---

## Min 1-3 — Caso 1: Payments onboarding (`payment-signup`)

Comando (arranque):

```bash
curl -X POST "http://localhost:4000/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "payment-signup",
    "input": {
      "email": "user@acme.com",
      "planName": "Pro",
      "priceCents": 9900
    }
  }'
```

Acción UI:
- Abre el run en la lista.
- Muestra que está `running` y que espera señal.

Comando (señal):

```bash
curl -X POST "http://localhost:4000/workflows/<workflowId>/<runId>/signals" \
  -H "Content-Type: application/json" \
  -d '{
    "signalName": "payment-completed",
    "data": {
      "sessionId": "cs_demo_123",
      "amountTotal": 9900,
      "currency": "eur",
      "customerEmail": "user@acme.com"
    }
  }'
```

Narrativa:
- “Este patrón human/external-in-the-loop es clave para pagos y onboarding real.”

---

## Min 3-5 — Caso 2: Order orchestration (`order-processing`)

Comando:

```bash
curl -X POST "http://localhost:4000/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "order-processing",
    "input": {
      "orderId": "ord-demo-1",
      "userId": "user-42",
      "amount": 49.99
    }
  }'
```

Acción UI:
- Abre detalle del run.
- Enseña eventos y steps (retry + paralelo).

Narrativa:
- “Aquí se ve orquestación multi-integración con reintentos y pasos paralelos.”

---

## Min 5-7 — Caso 3: Approval flow (`approval-flow`)

Comando (arranque):

```bash
curl -X POST "http://localhost:4000/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "approval-flow",
    "input": {
      "requestId": "apr-2026-0001",
      "requesterEmail": "requester@acme.com",
      "approverEmail": "manager@acme.com",
      "subject": "Compra extraordinaria",
      "amount": 1250
    }
  }'
```

Comando (aprobar):

```bash
curl -X POST "http://localhost:4000/workflows/<workflowId>/<runId>/signals" \
  -H "Content-Type: application/json" \
  -d '{
    "signalName": "approval-decision",
    "data": {
      "approved": true,
      "reviewer": "manager@acme.com",
      "comment": "OK para esta excepción"
    }
  }'
```

Narrativa:
- “Es un flujo de aprobación real: notifica, espera decisión y deja traza auditable.”

---

## Min 7-8.5 — Reliability + operación

Acción UI (detalles run):
- Botón `Refrescar`
- Botón `Cancelar run` (si está en running)
- Diagnóstico visible: pendientes, retries, último evento

Narrativa:
- “No es solo ejecutar: está pensado para operar y depurar en producción.”

---

## Min 8.5-10 — Cierre técnico

Checklist verbal:
- Event sourcing + replay
- Workers + cola
- Persistencia Postgres / cola Redis
- Observabilidad (`requestId`/`correlationId`, métricas)
- Multi-tenant base + cuotas por tenant (si activado)

Frase final:
- “FTN ya resuelve flujos reales de negocio y está preparado para evolucionar a producto.”

---

## Plan B (si algo falla en vivo)

- Si falla una integración externa, muestra el run `failed` y el `failureReason`.
- Si no quieres depender de sistemas externos, usa solo señales manuales (`/signals`) para cerrar runs.
- Si la UI va lenta, enseña trazabilidad con:

```bash
curl "http://localhost:4000/workflows/<workflowId>/<runId>/events"
```
