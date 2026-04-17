import type http from "node:http";
import { getPathname } from "./url";
import { sendError } from "./response";

export type { FtnAppRouteContext } from "./route-context";

import { tryAuthAndAuditRoutes } from "./routes/auth";
import { trySystemRoutes } from "./routes/system";
import { tryDesignerReadRoutes, tryDesignerWriteRoutes } from "./routes/designer";
import { tryCredentialsRoutes } from "./routes/credentials";
import { tryWorkflowsRoutes } from "./routes/workflows";
import { tryPaymentsRoutes } from "./routes/payments";
import type { FtnAppRouteContext } from "./route-context";

export async function handleAppRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!req.url || !req.method) {
    sendError(res, 400, "Bad request");
    return;
  }

  const rawPath = getPathname(req.url);

  if (await tryAuthAndAuditRoutes(ctx, req, res, rawPath)) return;
  if (await trySystemRoutes(ctx, req, res, rawPath)) return;
  if (await tryDesignerReadRoutes(ctx, req, res, rawPath)) return;
  if (await tryCredentialsRoutes(ctx, req, res, rawPath)) return;
  if (await tryDesignerWriteRoutes(ctx, req, res, rawPath)) return;
  if (await tryWorkflowsRoutes(ctx, req, res, rawPath)) return;
  if (await tryPaymentsRoutes(ctx, req, res, rawPath)) return;

  sendError(res, 404, "Not found");
}
