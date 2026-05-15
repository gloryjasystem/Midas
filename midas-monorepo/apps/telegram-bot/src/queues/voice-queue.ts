/**
 * BullMQ voice-parse queue producer — Phase 2.1
 *
 * Used by webhook.route.ts to enqueue voice message processing jobs.
 * This service is a PRODUCER only; worker lives in apps/background-workers/.
 *
 * Redis prefix: 'bull' (ADR-014 — must match background-workers prefix)
 */

import { Queue } from 'bullmq';
import { QUEUE_NAMES, type VoiceParseJobPayload } from '@midas/shared';
import { redisConnection } from './redis.js';

export const voiceParseQueue = new Queue<VoiceParseJobPayload>(
  QUEUE_NAMES.VOICE_PARSE,
  {
    connection: redisConnection,
    prefix: 'bull',
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { age: 86_400 },
    },
  },
);
