import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config';

async function securityPluginInner(app: FastifyInstance) {
  // Global rate limiting
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'production' ? 100 : 1000,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests. Please try again later.',
      statusCode: 429,
    }),
  });

  // Security headers
  app.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0'); // Modern browsers: use CSP instead
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
  });

  // Request performance monitoring
  app.addHook('onRequest', async (req: FastifyRequest) => {
    (req as any).startTime = Date.now();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const duration = Date.now() - ((req as any).startTime || Date.now());
    if (duration > 5000) {
      req.log.warn({ method: req.method, url: req.url, duration }, 'Slow request');
    }
  });
}

// Use fastify-plugin to break encapsulation so hooks apply globally
export const securityPlugin = fp(securityPluginInner, { name: 'security' });
