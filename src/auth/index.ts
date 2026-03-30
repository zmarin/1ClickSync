import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db';
import { z } from 'zod';

const SALT_ROUNDS = 12;

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
  company: z.string().max(255).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authPlugin(app: FastifyInstance) {
  // Register
  app.post('/api/auth/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(req.body);
    
    // Check if user exists
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [body.email.toLowerCase()]);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);
    const user = await queryOne(
      `INSERT INTO users (email, password_hash, name, company, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, email, name, company, plan, created_at`,
      [body.email.toLowerCase(), passwordHash, body.name, body.company || null]
    );

    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });

    return reply.status(201).send({ user, token });
  });

  // Login
  app.post('/api/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(req.body);
    
    const user = await queryOne(
      'SELECT id, email, name, company, plan, password_hash, created_at FROM users WHERE email = $1',
      [body.email.toLowerCase()]
    );
    
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    if (!user.password_hash) {
      return reply.status(401).send({ error: 'This account uses Google sign-in. Please use the Google button.' });
    }
    if (!(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const { password_hash, ...safeUser } = user;
    const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });

    return reply.send({ user: safeUser, token });
  });

  // Get current user
  app.get('/api/auth/me', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await queryOne(
      'SELECT id, email, name, company, plan, created_at, last_login_at FROM users WHERE id = $1',
      [(req as any).userId]
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user });
  });

  // Change password
  app.post('/api/auth/change-password', { preHandler: [authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(8).max(128),
    }).parse(req.body);

    const user = await queryOne('SELECT password_hash FROM users WHERE id = $1', [(req as any).userId]);
    if (!user || !(await bcrypt.compare(body.currentPassword, user.password_hash))) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, (req as any).userId]);

    return reply.send({ message: 'Password updated' });
  });
}

// Auth middleware — extracts and verifies JWT
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await req.jwtVerify<{ userId: string; email: string }>();
    (req as any).userId = decoded.userId;
    (req as any).userEmail = decoded.email;
  } catch (err) {
    return reply.status(401).send({ error: 'Authentication required' });
  }
}
