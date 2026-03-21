import { Worker } from 'bullmq';
import { redisConnection } from './queue/setup';
import { processSetupStep } from './queue/processors';
import { refreshExpiringTokens } from './zoho/oauth';

async function main() {
  console.log('[Worker] Starting setup worker...');

  // Main setup worker — processes Zoho API calls
  const setupWorker = new Worker(
    'zoho-setup',
    async (job) => {
      console.log(`[Worker] Processing: ${job.name} (attempt ${job.attemptsMade + 1})`);
      return processSetupStep(job.data);
    },
    {
      connection: redisConnection as any,
      concurrency: 5,
      limiter: {
        max: 15,
        duration: 10_000,
      },
    }
  );

  setupWorker.on('completed', (job) => {
    console.log(`[Worker] Completed: ${job.name}`);
  });

  setupWorker.on('failed', (job, err) => {
    console.error(`[Worker] Failed: ${job?.name}`, err.message);
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
      console.error(`[Worker] ${job.name} exhausted all retries`);
    }
  });

  // Maintenance worker — token refresh, health checks
  const maintenanceWorker = new Worker(
    'maintenance',
    async (job) => {
      switch (job.name) {
        case 'refresh-tokens':
          return refreshExpiringTokens();
        default:
          console.warn(`[Maintenance] Unknown job: ${job.name}`);
      }
    },
    {
      connection: redisConnection as any,
      concurrency: 1,
    }
  );

  maintenanceWorker.on('completed', (job) => {
    console.log(`[Maintenance] Completed: ${job.name}`);
  });

  maintenanceWorker.on('failed', (job, err) => {
    console.error(`[Maintenance] Failed: ${job?.name}`, err.message);
  });

  console.log('[Worker] Setup worker started (concurrency: 5, rate: 15/10s)');
  console.log('[Worker] Maintenance worker started');

  const shutdown = async () => {
    console.log('[Worker] Shutting down...');
    await setupWorker.close();
    await maintenanceWorker.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
