import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { UpsertUserInput, UpsertUserResult } from "./types";
import type { CrmConfig } from "./index";

interface UserIdRow {
  id: string;
}

export function upsertUserActivityDefinition(config: CrmConfig): ActivityDefinition<UpsertUserInput, UpsertUserResult> {
  const pool = config.pool;
  if (!pool) {
    throw new Error("crm: falta pool");
  }

  return {
    name: "crm.upsertUser:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["crm", "users"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["email"],
      properties: {
        userId: { type: "string", description: "ID interno de usuario (opcional)" },
        email: { type: "string", format: "email" },
        name: { type: "string" },
        planName: { type: "string", description: "Nombre del plan contratado" },
        metadata: {
          type: "object",
          description: "Datos adicionales",
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    
    async execute(input: UpsertUserInput, ctx: ActivityExecutionContext): Promise<UpsertUserResult> {
      ctx.log("Upsert de usuario en CRM", {
        userId: input.userId,
        email: input.email,
        planName: input.planName,
      });

      if (input.userId) {
        const res = await pool.query<UserIdRow>(
          `
          update users
          set email = $2,
              name = $3,
              plan_name = $4,
              metadata = $5,
              updated_at = now()
          where id = $1
          returning id
          `,
          [
            input.userId,
            input.email,
            input.name ?? null,
            input.planName ?? null,
            input.metadata ? JSON.stringify(input.metadata) : null,
          ]
        );

        if (res.rowCount && res.rowCount > 0) {
          return { userId: res.rows[0].id };
        }
        // Si no existe, caemos al flujo de insert por email
      }

      // Upsert por email: si ya existe, actualiza; si no, crea nuevo
      const res = await pool.query<UserIdRow>(
        `
        insert into users (email, name, plan_name, metadata)
        values ($1, $2, $3, $4)
        on conflict (email)
        do update set
          name = excluded.name,
          plan_name = excluded.plan_name,
          metadata = excluded.metadata,
          updated_at = now()
        returning id
        `,
        [
          input.email,
          input.name ?? null,
          input.planName ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ]
      );

      return { userId: res.rows[0].id };
    },
  };
}