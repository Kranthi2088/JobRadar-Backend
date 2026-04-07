import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@jobradar/shared";
import { createRedisConnection } from "./redis.js";

export const jobQueue = new Queue(QUEUE_NAMES.NEW_JOBS, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});
