import type http from "node:http";
import type { ActivityRegistry } from "../../core/activity-registry";

export interface ActivityDescriptor {
  name: string;
  module: string;
  version?: string;
  tags: string[];
  timeoutMs: number | null;
  maxAttempts: number | null;
}

function toDescriptor(def: any): ActivityDescriptor {
  const name: string = def.name;
  const module = String(name.split(".")[0] ?? "unknown");

  return {
    name,
    module,
    version: def.version,
    tags: Array.isArray(def.tags) ? def.tags : [],
    timeoutMs: typeof def.timeoutMs === "number" ? def.timeoutMs : null,
    maxAttempts: typeof def.maxAttempts === "number" ? def.maxAttempts : null,
  };
}

export async function handleCatalogRoutes(req: http.IncomingMessage, res: http.ServerResponse, registry: ActivityRegistry): Promise<boolean> {
  if (!req.url || !req.method) return false;

  if (req.method === "GET" && (req.url === "/activities" || req.url.startsWith("/activities?"))) {
    const [, queryString] = req.url.split("?");
    const params = new URLSearchParams(queryString ?? "");

    const tag = params.get("tag");
    const module = params.get("module");
    const q = params.get("q")?.toLowerCase();

    const limit = Math.min(500, Math.max(1, parseInt(params.get("limit") ?? "200", 10)));
    const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10));

    const defs = tag ? registry.listByTag(tag) : registry.list();

    const filtered = defs.filter((def: any) => {
      const mod = String(def.name?.split(".")[0] ?? "");
      if (module && mod !== module) return false;
      if (q && !String(def.name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });

    const slice = filtered.slice(offset, offset + limit);
    const out = slice.map(toDescriptor);

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ items: out, total: filtered.length, limit, offset }));
    return true;
  }

  if (req.method === "GET" && req.url.startsWith("/activities/")) {
    const pathOnly = req.url.split("?")[0];
    const parts = pathOnly.split("/");

    if (parts.length !== 3) {
      res.statusCode = 400;
      res.end("Expected /activities/:name");
      return true;
    }

    const name = decodeURIComponent(parts[2]);
    const def = registry.get(name as any);

    if (!def) {
      res.statusCode = 404;
      res.end("Activity not found");
      return true;
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(toDescriptor(def)));
    return true;
  }

  return false;
}