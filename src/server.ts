import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { env, jwtSecret } from './config';
import { registerRoutes } from './api/core-routes';
import { appRoutesPlugin } from './api/app-routes';
import { loadTemplates } from './templates/loader';
import { scheduleMaintenanceJobs } from './queue/setup';
import { authPlugin } from './auth';
import { passwordResetPlugin } from './auth/password-reset';
import { securityPlugin } from './security';
import { billingPlugin } from './billing';
import { formsPlugin } from './api/forms';
import { pool } from './db';

async function main() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    trustProxy: env.TRUST_PROXY,
  });

  // ── Global error handler ──────────────────────────
  app.setErrorHandler((error, request, reply) => {
    // Zod validation errors → 400
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Validation error',
        details: (error as any).issues?.map((i: any) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.validation,
      });
    }

    // Known HTTP errors
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    // Unexpected errors — log full details, return generic message
    request.log.error(error, 'Unhandled error');
    return reply.status(500).send({
      error: env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message,
    });
  });

  // ── Explicit /app route → dashboard SPA ──────────
  app.get('/app', (_request, reply) => {
    return reply.sendFile('index.html');
  });

  // ── Not found handler ─────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    // /app routes → dashboard SPA, everything else → landing page
    if (request.url.startsWith('/app')) {
      return reply.sendFile('index.html');
    }
    return reply.sendFile('landing.html');
  });

  // ── Core plugins ──────────────────────────────────
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.APP_URL : true,
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(jwt, { secret: jwtSecret });

  // Static files (dashboard)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // ── Security ──────────────────────────────────────
  await app.register(securityPlugin);

  // ── Auth ──────────────────────────────────────────
  await app.register(authPlugin);
  await app.register(passwordResetPlugin);

  // ── Billing ───────────────────────────────────────
  if (env.STRIPE_SECRET_KEY) {
    await app.register(billingPlugin);
    app.log.info('Stripe billing enabled');
  }

  // ── Forms (webform generator) ──────────────────────
  await app.register(formsPlugin);

  // ── Apps (multi-app cockpit) ──────────────────────
  await app.register(appRoutesPlugin);
  app.log.info('App routes (manifest + prompt) enabled');

  // ── Zoho setup ────────────────────────────────────
  loadTemplates();
  await registerRoutes(app);
  await scheduleMaintenanceJobs();

  // ── Start ─────────────────────────────────────────
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`1ClickSync running at ${address} [${env.NODE_ENV}]`);

  // ── Graceful shutdown ─────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new requests (30s timeout)
    await app.close();
    app.log.info('HTTP server closed');

    // Close database pool
    await pool.end();
    app.log.info('Database pool closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled rejections in production
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled rejection');
    if (env.NODE_ENV === 'production') {
      shutdown('unhandledRejection');
    }
  });
}

main().catch((err) => {
  console.error('[1ClickSync] Fatal startup error:', err);
  process.exit(1);
});
