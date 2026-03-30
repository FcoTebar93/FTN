import type { IntegrationModuleConfig } from "../types";

export interface MessagingConfig extends IntegrationModuleConfig {
  redisUrl?: string;
}

export interface RedisPublishInput {
  channel: string;
  message: string;
}

export interface RedisPublishResult {
  receivers: number;
}
