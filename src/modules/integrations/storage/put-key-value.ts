import { Pool } from "pg";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { PutKeyValueInput, PutKeyValueResult } from "./types";
import type { StorageConfig } from "./index";

export function putKeyValueActivityDefinition(config: StorageConfig): ActivityDefinition<PutKeyValueInput, PutKeyValueResult> {
  const { databaseUrl } = config;

  if (!databaseUrl) {
    throw new Error("Config inválida para storage.putKeyValue: falta databaseUrl");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  return {
    name: "storage.putKeyValue:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["storage", "kv"],
    version: "v1",
    inputSchema: {
    type: "object",
    required: ["namespace", "key", "value"],
    properties: {
      namespace: { type: "string", description: "Espacio de nombres" },
      key: { type: "string", description: "Clave" },
      value: { description: "Valor a almacenar (cualquier JSON)" },
    },
    additionalProperties: false,
    },
    
    async execute(input: PutKeyValueInput, ctx: ActivityExecutionContext): Promise<PutKeyValueResult> {
      ctx.log("Guardando valor en kv_store", {
        namespace: input.namespace,
        key: input.key,
      });

      await pool.query(
        `
        insert into kv_store (namespace, key, value)
        values ($1, $2, $3)
        on conflict (namespace, key)
        do update set value = excluded.value, created_at = now()
        `,
        [input.namespace, input.key, JSON.stringify(input.value)]
      );

      return { ok: true };
    },
  };
}