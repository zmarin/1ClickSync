import { Queue, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config';

// Shared Redis connection for all queues
export const redisConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// Main setup queue - processes individual setup steps
export const setupQueue = new Queue('zoho-setup', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000, // 5s, 10s, 20s
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Maintenance queue - token refresh, health checks
export const maintenanceQueue = new Queue('maintenance', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 100 },
  },
});

// Flow producer for creating dependent job chains
export const flowProducer = new FlowProducer({
  connection: redisConnection as any,
});

/**
 * Enqueue a full setup job: creates individual step jobs with dependencies.
 */
export async function enqueueSetupJob(
  jobId: string,
  appId: string,
  steps: Array<{
    stepId: string;
    action: string;
    targetApp: string;
    config: any;
    dependsOn?: string[];
    idempotencyKey: string;
  }>
): Promise<void> {
  // Group steps into waves based on dependencies
  const waves = buildExecutionWaves(steps);

  for (const wave of waves) {
    for (const step of wave) {
      await setupQueue.add(
        `setup-step:${step.stepId}`,
        {
          jobId,
          customerId: appId,  // backward compat field name for processor
          step,
        },
        {
          jobId: `${jobId}:${step.stepId}`, // dedup key
        }
      );
    }
  }
}

/**
 * Organize steps into execution waves based on dependencies.
 */
function buildExecutionWaves(steps: Array<{ stepId: string; dependsOn?: string[] }>) {
  const waves: typeof steps[] = [];
  const placed = new Set<string>();
  const remaining = [...steps];

  while (remaining.length > 0) {
    const wave = remaining.filter(step => {
      if (!step.dependsOn || step.dependsOn.length === 0) return true;
      return step.dependsOn.every(dep => placed.has(dep));
    });

    if (wave.length === 0) {
      console.warn('[Queue] Circular/missing dependency detected, forcing remaining steps');
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    wave.forEach(s => placed.add(s.stepId));
    remaining.splice(0, remaining.length, ...remaining.filter(s => !placed.has(s.stepId)));
  }

  return waves;
}

/**
 * Schedule recurring maintenance jobs
 */
export async function scheduleMaintenanceJobs(): Promise<void> {
  await maintenanceQueue.add(
    'refresh-tokens',
    {},
    {
      repeat: {
        every: 45 * 60 * 1000, // 45 minutes
      },
      jobId: 'refresh-tokens-repeatable',
    }
  );

  console.log('[Queue] Maintenance jobs scheduled');
}
