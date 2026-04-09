import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { env, jwtSecret } from './config';
import { registerRoutes } from './api/core-routes';
import { appRoutesPlugin } from './api/app-routes';
import { zohoCapabilitiesPlugin } from './api/zoho-capabilities';
import { loadTemplates } from './templates/loader';
import { scheduleMaintenanceJobs } from './queue/setup';
import { authPlugin } from './auth';
import { passwordResetPlugin } from './auth/password-reset';
import { googleAuthPlugin } from './auth/google';
import { securityPlugin } from './security';
import { billingPlugin } from './billing';
import { formsPlugin } from './api/forms';
import { mailRoutesPlugin } from './api/mail-routes';
import { pool } from './db';

interface BuildServerOptions {
  scheduleMaintenance?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    trustProxy: env.TRUST_PROXY,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Validation error',
        details: (error as any).issues?.map((issue: any) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    if ((error as any).validation) {
      return reply.status(400).send({
        error: 'Validation error',
        details: (error as any).validation,
      });
    }

    if ((error as any).statusCode && (error as any).statusCode < 500) {
      return reply.status((error as any).statusCode).send({ error: error.message });
    }

    request.log.error(error, 'Unhandled error');
    return reply.status(500).send({
      error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  });

  app.get('/app', (_request, reply) => {
    return reply.sendFile('index.html');
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    if (request.url.startsWith('/app')) {
      return reply.sendFile('index.html');
    }
    return reply.sendFile('landing.html');
  });

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.APP_URL : true,
    credentials: true,
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(jwt, { secret: jwtSecret });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });

  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(passwordResetPlugin);
  await app.register(googleAuthPlugin);

  if (env.STRIPE_SECRET_KEY) {
    await app.register(billingPlugin);
    app.log.info('Stripe billing enabled');
  }

  await app.register(formsPlugin);
  await app.register(appRoutesPlugin);
  await app.register(zohoCapabilitiesPlugin);
  await app.register(mailRoutesPlugin);
  app.log.info('Workspace routes (projects + prompts + capabilities) enabled');

  loadTemplates();
  await registerRoutes(app);
  if (options.scheduleMaintenance !== false) {
    await scheduleMaintenanceJobs();
  }

  return app;
}

async function main() {
  const app = await buildServer();
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`1ClickSync running at ${address} [${env.NODE_ENV}]`);

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    app.log.info('HTTP server closed');
    await pool.end();
    app.log.info('Database pool closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled rejection');
    if (env.NODE_ENV === 'production') {
      shutdown('unhandledRejection');
    }
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[1ClickSync] Fatal startup error:', err);
    process.exit(1);
  });
}
