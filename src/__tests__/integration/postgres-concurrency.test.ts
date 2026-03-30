import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { runPostgresMigrations } from "../../infra/postgres-migrations";
import { PostgresEventStore } from "../../infra/postgres-event-store";
import { ConcurrencyError } from "../../modules/event-store";

const engineUrl = process.env.FTN_ENGINE_DATABASE_URL ?? process.env.DATABASE_URL;
const describePg = engineUrl ? describe : describe.skip;

describePg("PostgresEventStore concurrencia (optimistic locking)", () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: engineUrl! });
    await runPostgresMigrations(pool);
    await pool.query("TRUNCATE ftn_workflow_events, ftn_workflow_snapshots CASCADE");
  });

  after(async () => {
    await pool.end();
  });

  it("solo un append concurrente gana con el mismo expectedVersion; el resto ConcurrencyError", async () => {
    const workflowId = `wf-conc-${Date.now()}`;
    const runId = `run-conc-${Date.now()}`;
    const store = new PostgresEventStore(pool);

    await store.appendEvents(workflowId, runId, 0, [
      {
        type: "WorkflowStarted",
        workflowId,
        runId,
        payload: { name: "c", input: {} },
      },
    ]);

    const parallel = 32;
    const results = await Promise.allSettled(
      Array.from({ length: parallel }, () =>
        store.appendEvents(workflowId, runId, 1, [
          {
            type: "WorkflowCompleted",
            workflowId,
            runId,
            payload: { result: { ok: true } },
          },
        ])
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactamente un append debe tener éxito");
    assert.equal(rejected.length, parallel - 1);

    for (const r of rejected) {
      assert.equal(r.status, "rejected");
      if (r.status === "rejected") {
        assert.ok(r.reason instanceof ConcurrencyError, "rechazos deben ser ConcurrencyError");
      }
    }

    const { rows } = await pool.query<{ max_v: string }>(
      `SELECT MAX(version)::text AS max_v FROM ftn_workflow_events WHERE workflow_id = $1 AND run_id = $2`,
      [workflowId, runId]
    );
    assert.equal(rows[0]?.max_v, "2");
  });

  it("reintento con backoff: leer versión actual y volver a append", async () => {
    const workflowId = `wf-retry-${Date.now()}`;
    const runId = `run-retry-${Date.now()}`;
    const store = new PostgresEventStore(pool);

    await store.appendEvents(workflowId, runId, 0, [
      {
        type: "WorkflowStarted",
        workflowId,
        runId,
        payload: { name: "r", input: {} },
      },
    ]);

    const append = async (label: string) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const { rows } = await pool.query<{ v: string }>(
          `SELECT COALESCE(MAX(version), 0)::text AS v FROM ftn_workflow_events
           WHERE workflow_id = $1 AND run_id = $2`,
          [workflowId, runId]
        );
        const v = Number.parseInt(rows[0]?.v ?? "0", 10);
        try {
          return await store.appendEvents(workflowId, runId, v, [
            {
              type: "WorkflowCompleted",
              workflowId,
              runId,
              payload: { result: { label } },
            },
          ]);
        } catch (e) {
          if (!(e instanceof ConcurrencyError)) {
            throw e;
          }
        }
      }
      throw new Error("expected append after retries");
    };

    const [a, b] = await Promise.all([append("a"), append("b")]);

    assert.ok(a.length >= 1);
    assert.ok(b.length >= 1);
    assert.notEqual(a[0].version, b[0].version);

    const { rows } = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ftn_workflow_events WHERE workflow_id = $1 AND run_id = $2`,
      [workflowId, runId]
    );
    assert.equal(rows[0]?.c, "3");
  });
});
