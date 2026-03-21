import { env, ZOHO_DC, ZOHO_SCOPES, type ZohoDC } from '../config';
import { query, queryOne } from '../db';
import { encrypt, decrypt } from './encryption';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  api_domain: string;
  token_type: string;
  error?: string;
}

interface StoredTokens {
  customer_id: string;
  zoho_dc: ZohoDC;
  zoho_org_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date;
  is_valid: boolean;
}

/**
 * Generate the Zoho OAuth authorization URL.
 * Zoho detects the user's DC automatically, but we default to .com
 * and detect the actual DC from the token response's api_domain.
 */
export function getAuthorizationUrl(state: string, dc: ZohoDC = 'com'): string {
  const base = ZOHO_DC[dc].accounts;
  const scopes = ZOHO_SCOPES.join(',');

  const params = new URLSearchParams({
    scope: scopes,
    client_id: env.ZOHO_CLIENT_ID,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: env.ZOHO_REDIRECT_URI,
    state,
    prompt: 'consent', // always show consent screen so we get refresh_token
  });

  return `${base}/oauth/v2/auth?${params.toString()}`;
}

/**
 * Detect which Zoho datacenter from the api_domain in token response.
 * api_domain looks like "https://www.zohoapis.eu" or "https://www.zohoapis.com"
 */
function detectDC(apiDomain: string): ZohoDC {
  if (apiDomain.includes('.eu')) return 'eu';
  if (apiDomain.includes('.in')) return 'in';
  if (apiDomain.includes('.com.au')) return 'com.au';
  if (apiDomain.includes('.jp')) return 'jp';
  return 'com';
}

/**
 * Exchange authorization code for access + refresh tokens.
 * Called from the OAuth callback route.
 */
export async function exchangeCodeForTokens(
  code: string,
  dc: ZohoDC = 'com'
): Promise<{ accessToken: string; refreshToken: string; dc: ZohoDC; expiresIn: number }> {
  const endpoint = `${ZOHO_DC[dc].accounts}/oauth/v2/token`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      redirect_uri: env.ZOHO_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const data = await response.json() as TokenResponse;

  if (data.error || !data.access_token || !data.refresh_token) {
    throw new Error(`Zoho token exchange failed: ${data.error || 'no tokens returned'}`);
  }

  const actualDC = detectDC(data.api_domain);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    dc: actualDC,
    expiresIn: data.expires_in,
  };
}

/**
 * Store tokens for a customer. Encrypts before saving.
 */
export async function storeTokens(
  customerId: string,
  accessToken: string,
  refreshToken: string,
  dc: ZohoDC,
  orgId: string,
  expiresIn: number,
  scopes: string[]
): Promise<void> {
  await query(
    `INSERT INTO zoho_tokens 
       (customer_id, zoho_dc, zoho_org_id, access_token_enc, refresh_token_enc, 
        token_expires_at, scopes)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 second' * $6, $7)
     ON CONFLICT (customer_id) DO UPDATE SET
       zoho_dc = $2,
       zoho_org_id = $3,
       access_token_enc = $4,
       refresh_token_enc = $5,
       token_expires_at = NOW() + INTERVAL '1 second' * $6,
       scopes = $7,
       connected_at = NOW(),
       last_refreshed_at = NOW(),
       refresh_failures = 0,
       is_valid = TRUE`,
    [customerId, dc, orgId, encrypt(accessToken), encrypt(refreshToken), expiresIn, scopes]
  );
}

/**
 * Get a valid access token for a customer.
 * Returns decrypted token if still valid, or refreshes first.
 */
export async function getAccessToken(customerId: string): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  const stored = await queryOne<StoredTokens>(
    'SELECT * FROM zoho_tokens WHERE customer_id = $1 AND is_valid = TRUE',
    [customerId]
  );

  if (!stored) {
    throw new Error(`No valid Zoho connection for customer ${customerId}`);
  }

  // If token expires in less than 5 minutes, refresh it
  const expiresAt = new Date(stored.token_expires_at);
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() < fiveMinutes) {
    return await refreshAndReturn(stored);
  }

  return {
    token: decrypt(stored.access_token_enc),
    dc: stored.zoho_dc,
    orgId: stored.zoho_org_id,
  };
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshAndReturn(stored: StoredTokens): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  const endpoint = `${ZOHO_DC[stored.zoho_dc].accounts}/oauth/v2/token`;
  const refreshToken = decrypt(stored.refresh_token_enc);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: env.ZOHO_CLIENT_ID,
        client_secret: env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json() as TokenResponse;

    if (data.error || !data.access_token) {
      throw new Error(`Refresh failed: ${data.error}`);
    }

    // Update stored token
    await query(
      `UPDATE zoho_tokens SET 
         access_token_enc = $1, 
         token_expires_at = NOW() + INTERVAL '1 second' * $2,
         last_refreshed_at = NOW(),
         refresh_failures = 0
       WHERE customer_id = $3`,
      [encrypt(data.access_token), data.expires_in, stored.customer_id]
    );

    return {
      token: data.access_token,
      dc: stored.zoho_dc,
      orgId: stored.zoho_org_id,
    };
  } catch (err) {
    // Track failures — after 5 consecutive, mark as invalid
    await query(
      `UPDATE zoho_tokens SET 
         refresh_failures = refresh_failures + 1,
         is_valid = CASE WHEN refresh_failures >= 4 THEN FALSE ELSE TRUE END
       WHERE customer_id = $1`,
      [stored.customer_id]
    );
    throw err;
  }
}

/**
 * Background job: refresh tokens expiring soon.
 * Run this every 45 minutes via a BullMQ repeatable job.
 */
export async function refreshExpiringTokens(): Promise<number> {
  const expiring = await query<StoredTokens>(
    `SELECT * FROM zoho_tokens 
     WHERE is_valid = TRUE 
       AND token_expires_at < NOW() + INTERVAL '20 minutes'`
  );

  let refreshed = 0;
  for (const tokens of expiring) {
    try {
      await refreshAndReturn(tokens);
      refreshed++;
    } catch (err: any) {
      console.error(`[Token Refresh] Failed for ${tokens.customer_id}:`, err.message);
    }
  }

  console.log(`[Token Refresh] Refreshed ${refreshed}/${expiring.length} tokens`);
  return refreshed;
}
