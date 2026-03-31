import type { IntegrationModuleConfig } from "../types";

export interface HttpConfig extends IntegrationModuleConfig {
  allowPrivateUrls?: boolean;
  maxResponseBodyBytes?: number;
}

export type HttpRequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface HttpRequestInput {
  url: string;
  method?: HttpRequestMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpRequestResult {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  bodyText?: string;
  bodyJson?: unknown;
  truncated?: boolean;
}