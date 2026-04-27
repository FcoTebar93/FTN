import type http from "node:http";
import { sendError } from "./response";
import { readBodyCapped } from "./security";

export async function readJsonBodyCapped<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBodyBytes: number,
  options?: { emptyAs?: T; invalidJsonMessage?: string }
): Promise<{ ok: true; value: T } | { ok: false }> {
  const body = await readBodyCapped(req, res, maxBodyBytes);
  if (body === null) return { ok: false };
  const hasEmptyAs = options ? Object.prototype.hasOwnProperty.call(options, "emptyAs") : false;
  try {
    if (!body.trim() && hasEmptyAs) {
      return { ok: true, value: options.emptyAs as T };
    }
    return { ok: true, value: JSON.parse(body || "{}") as T };
  } catch {
    sendError(res, 400, options?.invalidJsonMessage ?? "Invalid JSON body");
    return { ok: false };
  }
}
