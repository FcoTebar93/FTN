# Go-to-Market técnico — Templates demo

Esta guía entrega 3 verticales listas para demo comercial/técnica:

1. `payment-signup` (payments onboarding)
2. `order-processing` (order orchestration)
3. `approval-flow` (approval flow)

## Requisitos rápidos

```bash
npm run build
npm start
```

Servidor por defecto: `http://localhost:4000`

Opcional autenticación:
- API key: `X-API-Key: <FTN_API_KEY>`
- JWT: `Authorization: Bearer <token>`

Si multi-tenant está activo (`FTN_MULTI_TENANT_ENABLED=1|true`), añade:
- `X-Tenant-Id: demo-tenant`

---

## 1) Payments onboarding (`payment-signup`)

### Arrancar run

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

### Completar run enviando señal de pago

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

Valor demo:
- muestra QR/email + espera de señal + cierre consistente.

---

## 2) Order orchestration (`order-processing`)

### Arrancar run

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

### Consultar estado y eventos

```bash
curl "http://localhost:4000/workflows/<workflowId>/<runId>"
curl "http://localhost:4000/workflows/<workflowId>/<runId>/events"
```

Valor demo:
- retry + validación + paralelismo (payments/logistics) en una sola orquestación.

---

## 3) Approval flow (`approval-flow`)

### Arrancar run

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

### Aprobar

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

### Rechazar

```bash
curl -X POST "http://localhost:4000/workflows/<workflowId>/<runId>/signals" \
  -H "Content-Type: application/json" \
  -d '{
    "signalName": "approval-decision",
    "data": {
      "approved": false,
      "reviewer": "manager@acme.com",
      "comment": "Supera presupuesto aprobado"
    }
  }'
```

Valor demo:
- human-in-the-loop real: notificación, espera de decisión y auditoría final.

---

## Script de pitch técnico (2 min)

1. Lanzar `payment-signup` y mostrar estado `running`.
2. Lanzar señal `payment-completed` y enseñar transición a `completed`.
3. Lanzar `order-processing` para enseñar orquestación robusta (retry + paralelo).
4. Lanzar `approval-flow`, pausar en espera de señal, aprobar/rechazar en directo.
5. Cerrar en vista de eventos para destacar trazabilidad (event sourcing).
