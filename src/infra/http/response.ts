import type http from "node:http";

export function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function sendError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  detail?: unknown
): void {
  const body =
    detail === undefined
      ? { error }
      : { error, detail };
  sendJson(res, statusCode, body);
}
