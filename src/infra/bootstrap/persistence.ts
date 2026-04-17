import { Pool } from "pg";
import { InMemoryEventStore } from "../inmemory-event-store";
import { InMemorySnapshotStore } from "../inmemory-snapshot-store";
import { runPostgresMigrations } from "../postgres-migrations";
import { PostgresEventStore } from "../postgres-event-store";
import { PostgresSnapshotStore } from "../postgres-snapshot-store";
import type { Logger } from "../logger";

export interface PersistenceBootstrapResult {
  pool: Pool | undefined;
  eventStore: PostgresEventStore | InMemoryEventStore;
  snapshotStore: PostgresSnapshotStore | InMemorySnapshotStore;
}

interface BootstrapPersistenceInput {
  log: Logger;
  engineDatabaseUrl?: string;
}

export async function bootstrapPersistence(input: BootstrapPersistenceInput): Promise<PersistenceBootstrapResult> {
  const { log, engineDatabaseUrl } = input;
  const engineDsUrl = engineDatabaseUrl;
  let pool: Pool | undefined;
  if (engineDsUrl) {
    pool = new Pool({ connectionString: engineDsUrl });
    await runPostgresMigrations(pool);
    log.info("ftn.engine.persistence", { backend: "postgres" });
  } else {
    log.info("ftn.engine.persistence", { backend: "memory" });
  }

  return {
    pool,
    eventStore: pool ? new PostgresEventStore(pool) : new InMemoryEventStore(),
    snapshotStore: pool ? new PostgresSnapshotStore(pool) : new InMemorySnapshotStore(),
  };
}
