const epics = [
  { id: "p4-child-workflows", title: "Workflows hijos / sub-workflows (motor + API + designer)" },
  { id: "p4-loops", title: "Bucles controlados con límites y métricas" },
  { id: "p4-cancel-compensation", title: "Cancelación explícita y/o compensación (Saga)" },
  { id: "p4-tenancy", title: "Cuotas por tenant, webhooks entrantes, retención de eventos" },
];

console.log(JSON.stringify(epics, null, 2));
