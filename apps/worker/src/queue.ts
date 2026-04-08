import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@jobradar/shared";
import { createRedisConnection } from "./redis.js";

const QUEUE_JOB_RETENTION_SECONDS = Math.max(
  60,
  parseInt(process.env.REDIS_JOB_RETENTION_SECONDS || "21600", 10)
);

export const jobQueue = new Queue(QUEUE_NAMES.NEW_JOBS, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    // Keep only recent queue history to avoid Redis growth on free tiers.
    removeOnComplete: { age: QUEUE_JOB_RETENTION_SECONDS, count: 200 },
    removeOnFail: { age: QUEUE_JOB_RETENTION_SECONDS, count: 500 },
  },
});
