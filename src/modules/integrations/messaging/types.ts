import type Redis from "ioredis";
import type { IntegrationModuleConfig } from "../types";

export interface MessagingConfig extends IntegrationModuleConfig {
  redis?: Redis;
  redisUrl?: string;
}

export interface RedisPublishInput {
  channel: string;
  message: string;
}

export interface RedisPublishResult {
  receivers: number;
}
