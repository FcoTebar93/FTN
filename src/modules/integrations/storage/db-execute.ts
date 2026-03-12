import { Pool } from "pg";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { DbExecuteInput, DbExecuteResult } from "./types";
import type { StorageConfig } from "./index";
import { config } from "process";

export function dbExecuteActivityDefinition(config: StorageConfig): ActivityDefinition<DbExecuteInput, DbExecuteResult> {
    const { databaseUrl } = config;

    if (!databaseUrl) {
        throw new Error("DATABASE_URL no está configurada");
    }

    const pool = new Pool({ connectionString: databaseUrl });

    return {
        name: "db-execute",
        maxAttempts: 3,
        timeoutMs: 30_000,
        tags: ["storage", "db"],
        version: "1.0.0",
        inputSchema: {
            type: "object",
            required: ["sql"],
            properties: {
              sql: { type: "string", description: "Sentencia SQL parametrizada" },
              params: {
                type: "array",
                items: {},
                description: "Parámetros para el SQL (opcional)",
              },
            },
        },
        
        async execute(input: DbExecuteInput, ctx: ActivityExecutionContext): Promise<DbExecuteResult> {
            ctx.log("Ejecutando consulta en la base de datos", { sql: input.sql, params: input.params });

            try {
                const res = await pool.query(input.sql, input.params ?? []);
                return { rowCount: res.rowCount ?? 0, rows: res.rows ?? [] };
            } catch (error: unknown) {
                ctx.log("Error ejecutando consulta en la base de datos", { error: error });
                throw error;
            }
        }
    }
}