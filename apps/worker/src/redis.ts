import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const tlsOptions = REDIS_URL.startsWith("rediss://") ? { tls: {} } : {};

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...tlsOptions,
});

export const createRedisConnection = () =>
  new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...tlsOptions,
  });
