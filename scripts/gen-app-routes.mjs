import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
let s = fs.readFileSync(path.join(root, "src/infra/http/_extracted-routes.txt"), "utf8");

s = s
  .split("\n")
  .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
  .join("\n");

s = s.replace(/\bapiSecurity\b/g, "ctx.apiSecurity");
s = s.replace(/\bhasDbLogin\b/g, "ctx.hasDbLogin");
s = s.replace(/\brefreshTtlSeconds\b/g, "ctx.refreshTtlSeconds");
s = s.replace(/\brequestSubject\b/g, "ctx.requestSubject");
s = s.replace(/\benqueueWorkflowStart\b/g, "ctx.enqueueWorkflowStart");
s = s.replace(/\bgetIntegrationsStatusForSubject\b/g, "ctx.getIntegrationsStatusForSubject");
s = s.replace(/\bpool\b/g, "ctx.pool");
s = s.replace(/\bredis\b/g, "ctx.redis");
s = s.replace(/\bactivities\b/g, "ctx.activities");
s = s.replace(/\bruntime\b/g, "ctx.runtime");
s = s.replace(/\beventStore\b/g, "ctx.eventStore");
s = s.replace(/\btaskQueue\b/g, "ctx.taskQueue");

const header = `import type http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";

import type { WorkflowTask } from "../../shared/tasks";
import { getWorkflow, getWorkflowDescriptor } from "../../app/workflows";
import { matchHttpTrigger } from "../../app/triggers";
import { readBodyCapped, type ApiSecurityConfig } from "./security";
import {
  extractBearerOrApiKey,
  isLoginConfigured,
  issueAccessToken,
  issueAccessTokenForSubject,
  validateLoginCredentials,
  verifyJwtHs256,
} from "./auth";
import { normalizeAndValidateUsername, validatePlainPassword } from "./registration";
import { hashPassword, verifyPassword } from "../passwords";
import {
  consumeRefreshToken,
  deleteRefreshTokensForUser,
  getUserPasswordHash,
  getUserScopesText,
  insertAuditLog,
  insertUser,
  newRefreshTokenRaw,
  revokeAccessTokenJti,
  storeRefreshToken,
} from "../users";
import { validateJson } from "../../shared/json-schema-validate";
import type { StoredWorkflow } from "../../app/designer-types";
import {
  getDesignerRuntimeName,
  getStoredWorkflow,
  listStoredWorkflows,
  upsertStoredWorkflow,
} from "../../app/designer-store";
import { normalizeStoredWorkflow, validateSchedule } from "../../app/designer-schedule";
import { getCredential, listCredentials, upsertCredential } from "../../app/credentials";
import { DESIGNER_KINDS } from "../../app/designer-kinds";
import { SWAGGER_UI_HTML } from "../swagger-ui";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { InMemoryActivityRegistry } from "../../modules/activity-registry/inmemory-activity-registry";
import type { InMemoryWorkflowRuntime } from "../inmemory-workflow-runtime";
import type { EventStore } from "../../modules/event-store";
import type { TaskQueue } from "../../modules/task-queue";

export interface FtnAppRouteContext {
  pool: Pool | undefined;
  apiSecurity: ApiSecurityConfig;
  hasDbLogin: boolean;
  refreshTtlSeconds: number;
  requestSubject: string;
  activities: InMemoryActivityRegistry;
  runtime: InMemoryWorkflowRuntime;
  eventStore: EventStore;
  taskQueue: TaskQueue;
  redis: Redis | undefined;
  enqueueWorkflowStart: (
    name: string,
    input: unknown
  ) => Promise<{ workflowId: string; runId: string; version: number }>;
  getIntegrationsStatusForSubject: (subject: string) => Promise<
    Array<{
      key: string;
      label: string;
      configured: boolean;
      source: "credentials" | "env" | "none";
      details?: string;
    }>
  >;
}

export async function handleAppRoutes(
  ctx: FtnAppRouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
`;

const footer = `
}
`;

fs.writeFileSync(path.join(root, "src/infra/http/app-routes.ts"), header + s + footer);
console.log("wrote app-routes.ts");
