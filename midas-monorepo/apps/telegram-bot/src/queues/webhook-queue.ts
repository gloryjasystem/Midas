/**
 * BullMQ Queue producer for the telegram-bot service.
 *
 * This service is a PRODUCER only — it enqueues jobs for background-workers.
 * It DOES NOT run workers. Workers live in apps/background-workers/.
 *
 * Only the webhook-ingestion queue is produced here.
 * ai-parse and notifications are produced by background-workers internally.
 *
 * Redis prefix: 'bull' (ADR-014 — must match background-workers prefix)
 */

import { Queue } from 'bullmq';
import { QUEUE_NAMES, type WebhookIngestionJobPayload } from '@midas/shared';
import { redisConnection } from './redis.js';

export const webhookIngestionQueue = new Queue<WebhookIngestionJobPayload>(
  QUEUE_NAMES.WEBHOOK_INGESTION,
  {
    connection: redisConnection,
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    },
  },
);

export async function closeQueues(): Promise<void> {
  await webhookIngestionQueue.close();
}
