import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { env } from '../config';
import { query, queryOne } from '../db';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export async function googleAuthPlugin(app: FastifyInstance) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    app.log.info('Google OAuth not configured — skipping');
    return;
  }

  const redirectUri = env.GOOGLE_REDIRECT_URI || `${env.APP_URL}/api/auth/google/callback`;

  // Step 1: Redirect to Google consent screen
  app.get('/api/auth/google', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      state,
      prompt: 'select_account',
    });

    // Store state in a short-lived cookie for CSRF protection
    reply.setCookie('google_oauth_state', state, {
      path: '/',
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300, // 5 minutes
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // Step 2: Handle callback from Google
  app.get('/api/auth/google/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      app.log.warn({ error }, 'Google OAuth denied');
      return reply.redirect('/app?error=google_denied');
    }

    // Verify CSRF state
    const savedState = (req.cookies as any).google_oauth_state;
    if (!state || state !== savedState) {
      return reply.redirect('/app?error=invalid_state');
    }
    reply.clearCookie('google_oauth_state', { path: '/' });

    if (!code) {
      return reply.redirect('/app?error=no_code');
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        app.log.error({ status: tokenRes.status, body: err }, 'Google token exchange failed');
        return reply.redirect('/app?error=token_exchange');
      }

      const tokens = await tokenRes.json() as { access_token: string };

      // Get user profile
      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!profileRes.ok) {
        return reply.redirect('/app?error=profile_fetch');
      }

      const profile = await profileRes.json() as {
        id: string;
        email: string;
        name: string;
        picture?: string;
      };

      // Find or create user
      let user = await queryOne(
        'SELECT id, email, name, company, plan, created_at FROM users WHERE google_id = $1',
        [profile.id]
      );

      if (!user) {
        // Check if email already exists (registered with password)
        user = await queryOne(
          'SELECT id, email, name, company, plan, created_at FROM users WHERE email = $1',
          [profile.email.toLowerCase()]
        );

        if (user) {
          // Link Google ID to existing account
          await query('UPDATE users SET google_id = $1 WHERE id = $2', [profile.id, user.id]);
        } else {
          // Create new user (no password)
          user = await queryOne(
            `INSERT INTO users (email, name, google_id, email_verified, created_at)
             VALUES ($1, $2, $3, TRUE, NOW())
             RETURNING id, email, name, company, plan, created_at`,
            [profile.email.toLowerCase(), profile.name, profile.id]
          );
        }
      }

      // Update last login
      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      // Issue JWT
      const token = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: '7d' });

      // Redirect to app with token
      return reply.redirect(`/app?token=${token}`);
    } catch (err) {
      app.log.error(err, 'Google OAuth callback error');
      return reply.redirect('/app?error=google_error');
    }
  });
}
