import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../db';
import { sendEmail } from '../email';
import { env } from '../config';
import { z } from 'zod';

const SALT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_HOURS = 2;

export async function passwordResetPlugin(app: FastifyInstance) {
  // Request password reset
  app.post('/api/auth/forgot-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const user = await queryOne('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()]);

    // Always return success to prevent email enumeration
    if (!user) {
      return reply.send({ message: 'If that email exists, a reset link has been sent.' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Invalidate any existing tokens for this user
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

    // Store new token
    await query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, crypto.createHash('sha256').update(token).digest('hex'), expiresAt]
    );

    // Send email
    const resetUrl = `${env.APP_URL}/app?reset_token=${token}`;
    await sendEmail({
      to: email,
      subject: '1ClickSync — Reset your password',
      html: `
        <h2>Password Reset</h2>
        <p>Hi ${user.name},</p>
        <p>Click below to reset your password. This link expires in ${RESET_TOKEN_EXPIRY_HOURS} hours.</p>
        <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <p>— 1ClickSync</p>
      `,
    });

    return reply.send({ message: 'If that email exists, a reset link has been sent.' });
  });

  // Reset password with token
  app.post('/api/auth/reset-password', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = z.object({
      token: z.string(),
      newPassword: z.string().min(8).max(128),
    }).parse(req.body);

    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
    const resetRecord = await queryOne(
      `SELECT user_id, expires_at FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );

    if (!resetRecord) {
      return reply.status(400).send({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRecord.user_id]);
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [resetRecord.user_id]);

    return reply.send({ message: 'Password has been reset. Please log in.' });
  });
}
