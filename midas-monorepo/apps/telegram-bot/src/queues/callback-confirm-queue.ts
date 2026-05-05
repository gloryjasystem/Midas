/**
 * BullMQ Queue producer — callback-confirm queue (Phase 1.6-B).
 *
 * telegram-bot is a PRODUCER only for this queue.
 * The consumer (confirmation.worker.ts) lives in apps/background-workers/.
 *
 * Redis prefix: 'bull' (ADR-014 — must match background-workers prefix)
 * No PII in payload (draftId + action only) — removeOnFail: false is acceptable.
 */

import { Queue } from 'bullmq';
import { QUEUE_NAMES, type CallbackConfirmJobPayload } from '@midas/shared';
import { redisConnection } from './redis.js';

export const callbackConfirmQueue = new Queue<CallbackConfirmJobPayload>(
  QUEUE_NAMES.CALLBACK_CONFIRM,
  {
    connection: redisConnection,
    prefix: 'bull', // Must match background-workers prefix (ADR-014)
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 2_000, // 2s — DB operation is idempotent
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    },
  },
);
