import type { Pool } from "pg";

export async function insertUser(pool: Pool, username: string, passwordHash: string): Promise<"ok" | "duplicate"> {
  try {
    await pool.query(`INSERT INTO ftn_users (username, password_hash) VALUES ($1, $2)`, [username, passwordHash]);
    return "ok";
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      return "duplicate";
    }
    throw e;
  }
}

export async function getUserPasswordHash(pool: Pool, username: string): Promise<string | null> {
  const r = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM ftn_users WHERE username = $1`,
    [username]
  );
  return r.rows[0]?.password_hash ?? null;
}
