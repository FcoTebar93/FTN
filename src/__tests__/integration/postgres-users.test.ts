import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { runPostgresMigrations } from "../../infra/postgres-migrations";
import { hashPassword, verifyPassword } from "../../infra/passwords";
import { getUserPasswordHash, insertUser } from "../../infra/postgres-users";

const engineUrl = process.env.FTN_ENGINE_DATABASE_URL ?? process.env.DATABASE_URL;
const describePg = engineUrl ? describe : describe.skip;

describePg("ftn_users (Postgres)", () => {
  let pool: Pool;

  before(async () => {
    pool = new Pool({ connectionString: engineUrl! });
    await runPostgresMigrations(pool);
    await pool.query("TRUNCATE ftn_users");
  });

  after(async () => {
    await pool.end();
  });

  it("inserta usuario y verifica contraseña", async () => {
    const h = await hashPassword("clave-muy-larga-10");
    assert.equal(await insertUser(pool, "testuser", h), "ok");
    const stored = await getUserPasswordHash(pool, "testuser");
    assert.ok(stored);
    assert.equal(await verifyPassword("clave-muy-larga-10", stored!), true);
    assert.equal(await verifyPassword("otra", stored!), false);
  });

  it("rechaza username duplicado (mismo lower)", async () => {
    await pool.query("TRUNCATE ftn_users");
    const h = await hashPassword("clave-muy-larga-10");
    assert.equal(await insertUser(pool, "alice", h), "ok");
    assert.equal(await insertUser(pool, "Alice", h), "duplicate");
  });
});
