import type http from "node:http";
import type { FtnAppRouteContext } from "../route-context";
import { getPathname } from "../url";

export async function tryActivitiesRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _rawPath: string
): Promise<boolean> {
  const url = req.url ?? "";

  if (req.method === "GET" && (url === "/activities" || url.startsWith("/activities?"))) {
    const [, queryString] = url.split("?");
    const params = new URLSearchParams(queryString ?? "");
    const tag = params.get("tag");
    const module = params.get("module");
    const q = params.get("q")?.toLowerCase();

    const defs = tag ? ctx.activities.listByTag(tag) : ctx.activities.list();

    const filtered = defs.filter((def) => {
      const mod = def.name.split(".")[0];
      if (module && mod !== module) return false;
      if (q && !def.name.toLowerCase().includes(q)) return false;
      return true;
    });

    const out = filtered.map((def) => ({
      name: def.name,
      module: def.name.split(".")[0],
      version: def.version,
      tags: def.tags ?? [],
      timeoutMs: def.timeoutMs ?? null,
      maxAttempts: def.maxAttempts ?? null,
    }));

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out));
    return true;
  }

  if (req.method === "GET" && url.startsWith("/activities/")) {
    const pathOnlyAct = getPathname(url);
    const parts = pathOnlyAct.split("/");
    if (parts.length !== 3) {
      res.statusCode = 400;
      res.end("Expected /activities/:name");
      return true;
    }

    const name = decodeURIComponent(parts[2]);
    const def = ctx.activities.get(name);
    if (!def) {
      res.statusCode = 404;
      res.end("Activity not found");
      return true;
    }

    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: def.name,
        module: def.name.split(".")[0],
        version: def.version,
        tags: def.tags ?? [],
        timeoutMs: def.timeoutMs ?? null,
        maxAttempts: def.maxAttempts ?? null,
      })
    );
    return true;
  }

  return false;
}
