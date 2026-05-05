import { Pool } from "pg";
import type { ActivityRegistry } from "../../core/activity-registry";
import type { AnyActivityDefinition } from "../../core/activities";

export function registerDefinitions(
  registry: ActivityRegistry,
  definitions: readonly AnyActivityDefinition[]
): void {
  for (const definition of definitions) {
    registry.register(definition);
  }
}

export interface ConfigWithPool {
  pool?: Pool;
  databaseUrl?: string;
}

export function resolvePool<T extends ConfigWithPool>(config: T): T | undefined {
  const pool = config.pool ?? (config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : undefined);
  return pool ? { ...config, pool } : undefined;
}
