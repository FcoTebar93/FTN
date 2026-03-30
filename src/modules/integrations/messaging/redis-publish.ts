import Redis from "ioredis";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { RedisPublishInput, RedisPublishResult } from "./types";
import type { MessagingConfig } from "./types";

const MAX_MESSAGE_BYTES = 512_000;

let shared: Redis | null = null;

function client(redisUrl: string): Redis {
  if (!shared) {
    shared = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  }
  return shared;
}

export function redisPublishActivityDefinition(config: MessagingConfig): ActivityDefinition<RedisPublishInput, RedisPublishResult> {
  const url = config.redisUrl;
  if (!url) {
    throw new Error("Config inválida para messaging.redisPublish: falta redisUrl");
  }

  return {
    name: "messaging.redisPublish:v1",
    maxAttempts: 3,
    timeoutMs: 10_000,
    tags: ["messaging", "redis", "workflow"],
    version: "v1",
    inputSchema: {
      type: "object",
      required: ["channel", "message"],
      properties: {
        channel: { type: "string", description: "Canal Redis (Pub/Sub)" },
        message: { type: "string", description: "Contenido del mensaje (texto o JSON serializado)" },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: "object",
      required: ["receivers"],
      properties: {
        receivers: { type: "integer", description: "Número de clientes que recibieron el mensaje (según Redis PUBLISH)" },
      },
      additionalProperties: false,
    },

    async execute(input: RedisPublishInput, ctx: ActivityExecutionContext): Promise<RedisPublishResult> {
      const channel = input.channel?.trim();
      if (!channel) {
        throw new Error("channel es obligatorio");
      }
      const enc = new TextEncoder();
      if (enc.encode(input.message).length > MAX_MESSAGE_BYTES) {
        throw new Error(`message demasiado largo (máx ${MAX_MESSAGE_BYTES} bytes)`);
      }

      ctx.log("messaging.redisPublish", { channel, bytes: enc.encode(input.message).length });

      const redis = client(url);
      const receivers = await redis.publish(channel, input.message);
      return { receivers };
    },
  };
}
