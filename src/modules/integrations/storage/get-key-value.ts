import { Pool } from "pg";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { GetKeyValueInput, GetKeyValueResult } from "./types";
import type { StorageConfig } from "./index";

export function getKeyValueActivityDefinition(
  config: StorageConfig
): ActivityDefinition<GetKeyValueInput, GetKeyValueResult> {
  const { databaseUrl } = config;

  if (!databaseUrl) {
    throw new Error("Config inválida para storage.getKeyValue: falta databaseUrl");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  return {
    name: "storage.getKeyValue:v1",
    maxAttempts: 3,
    timeoutMs: 5_000,
    tags: ["storage", "kv"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["namespace", "key"],
      properties: {
        namespace: { type: "string", description: "Espacio de nombres" },
        key: { type: "string", description: "Clave a leer" },
      },
      additionalProperties: false,
    },
    async execute(input: GetKeyValueInput, ctx: ActivityExecutionContext): Promise<GetKeyValueResult> {
      ctx.log("Leyendo valor de kv_store", {
        namespace: input.namespace,
        key: input.key,
      });

      const res = await pool.query(
        `select value from kv_store where namespace = $1 and key = $2`,
        [input.namespace, input.key]
      );

      if (res.rowCount && res.rowCount > 0) {
        return { found: true, value: res.rows[0].value };
      }

      return { found: false };
    },
  };
}