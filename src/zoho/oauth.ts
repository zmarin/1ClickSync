import {
  env,
  ZOHO_DC,
  ZOHO_SCOPES,
  ZOHO_SERVICE_SCOPES,
  type ZohoApp,
  type ZohoDC,
} from '../config';
import { query, queryOne } from '../db';
import { decrypt, encrypt } from './encryption';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  api_domain: string;
  token_type: string;
  error?: string;
}

interface LegacyStoredTokens {
  app_id: string;
  customer_id: string;
  zoho_dc: ZohoDC;
  zoho_org_id: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date;
  scopes: unknown;
  is_valid: boolean;
  refresh_failures: number;
}

interface ServiceStoredTokens {
  id: string;
  app_id: string;
  service: ZohoApp;
  zoho_dc: ZohoDC;
  zoho_org_id: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: Date;
  scopes: unknown;
  is_valid: boolean;
  refresh_failures: number;
}

function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((scope) => String(scope));
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((scope) => String(scope));
    } catch {
      return raw.split(',').map((scope) => scope.trim()).filter(Boolean);
    }
  }
  if (typeof raw === 'object') {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.every((value) => typeof value === 'string')) {
      return values.map((value) => String(value));
    }
  }
  return [];
}

function prefixesForService(service: ZohoApp): string[] {
  return Array.from(
    new Set(
      (ZOHO_SERVICE_SCOPES[service] || [])
        .map((scope) => {
          const [prefix] = scope.split('.');
          return prefix ? `${prefix}.` : '';
        })
        .filter(Boolean)
    )
  );
}

function supportsService(scopesRaw: unknown, service: ZohoApp): boolean {
  const requiredScopes = ZOHO_SERVICE_SCOPES[service] || [];
  if (requiredScopes.length === 0) return true;

  const scopes = normalizeScopes(scopesRaw);
  if (!scopes.length) return false;

  const prefixes = prefixesForService(service);
  return prefixes.some((prefix) => scopes.some((scope) => scope.startsWith(prefix)));
}

/**
 * Generate a Zoho OAuth authorization URL.
 */
export function getAuthorizationUrl(
  state: string,
  dc: ZohoDC = 'com',
  scopes: readonly string[] = ZOHO_SCOPES
): string {
  const base = ZOHO_DC[dc].accounts;
  const params = new URLSearchParams({
    scope: scopes.join(','),
    client_id: env.ZOHO_CLIENT_ID,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: env.ZOHO_REDIRECT_URI,
    state,
    prompt: 'consent',
  });

  return `${base}/oauth/v2/auth?${params.toString()}`;
}

export function getServiceAuthorizationUrl(state: string, service: ZohoApp, dc: ZohoDC = 'com'): string {
  return getAuthorizationUrl(state, dc, ZOHO_SERVICE_SCOPES[service]);
}

function detectDC(apiDomain: string): ZohoDC {
  if (apiDomain.includes('.eu')) return 'eu';
  if (apiDomain.includes('.in')) return 'in';
  if (apiDomain.includes('.com.au')) return 'com.au';
  if (apiDomain.includes('.jp')) return 'jp';
  return 'com';
}

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

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    dc: detectDC(data.api_domain),
    expiresIn: data.expires_in,
  };
}

export async function storeTokens(
  appId: string,
  accessToken: string,
  refreshToken: string,
  dc: ZohoDC,
  orgId: string,
  expiresIn: number,
  scopes: readonly string[]
): Promise<void> {
  await query(
    `INSERT INTO zoho_tokens
       (app_id, customer_id, zoho_dc, zoho_org_id, access_token_enc, refresh_token_enc,
        token_expires_at, scopes)
     VALUES ($1, $1, $2, $3, $4, $5, NOW() + INTERVAL '1 second' * $6, $7)
     ON CONFLICT (app_id) DO UPDATE SET
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
    [appId, dc, orgId, encrypt(accessToken), encrypt(refreshToken), expiresIn, JSON.stringify(scopes)]
  );
}

export async function storeServiceTokens(
  appId: string,
  service: ZohoApp,
  accessToken: string,
  refreshToken: string,
  dc: ZohoDC,
  orgId: string | null,
  expiresIn: number,
  scopes: readonly string[]
): Promise<void> {
  await query(
    `INSERT INTO zoho_service_tokens
       (app_id, service, zoho_dc, zoho_org_id, access_token_enc, refresh_token_enc,
        token_expires_at, scopes, connected_at, last_refreshed_at, refresh_failures, is_valid, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 second' * $7, $8::jsonb, NOW(), NOW(), 0, TRUE, NOW())
     ON CONFLICT (app_id, service) DO UPDATE SET
       zoho_dc = EXCLUDED.zoho_dc,
       zoho_org_id = EXCLUDED.zoho_org_id,
       access_token_enc = EXCLUDED.access_token_enc,
       refresh_token_enc = EXCLUDED.refresh_token_enc,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       connected_at = NOW(),
       last_refreshed_at = NOW(),
       refresh_failures = 0,
       is_valid = TRUE,
       updated_at = NOW()`,
    [appId, service, dc, orgId, encrypt(accessToken), encrypt(refreshToken), expiresIn, JSON.stringify(scopes)]
  );
}

export async function revokeServiceTokens(appId: string, service: ZohoApp): Promise<void> {
  await query(
    `UPDATE zoho_service_tokens
        SET is_valid = FALSE,
            updated_at = NOW()
      WHERE app_id = $1 AND service = $2`,
    [appId, service]
  );
}

export async function getAccessToken(appId: string, service: ZohoApp): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  const storedService = await queryOne<ServiceStoredTokens>(
    'SELECT * FROM zoho_service_tokens WHERE app_id = $1 AND service = $2 AND is_valid = TRUE',
    [appId, service]
  );

  if (storedService) {
    return maybeRefreshServiceToken(storedService);
  }

  const storedLegacy = await queryOne<LegacyStoredTokens>(
    'SELECT * FROM zoho_tokens WHERE (app_id = $1 OR customer_id = $1) AND is_valid = TRUE',
    [appId]
  );

  if (storedLegacy && supportsService(storedLegacy.scopes, service)) {
    return maybeRefreshLegacyToken(storedLegacy);
  }

  throw new Error(`No valid Zoho ${service} connection for app ${appId}`);
}

function isExpiringSoon(value: Date): boolean {
  return new Date(value).getTime() - Date.now() < 5 * 60 * 1000;
}

async function maybeRefreshLegacyToken(stored: LegacyStoredTokens): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  if (isExpiringSoon(stored.token_expires_at)) {
    return refreshLegacyToken(stored);
  }

  return {
    token: decrypt(stored.access_token_enc),
    dc: stored.zoho_dc,
    orgId: stored.zoho_org_id || '',
  };
}

async function maybeRefreshServiceToken(stored: ServiceStoredTokens): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  if (isExpiringSoon(stored.token_expires_at)) {
    return refreshServiceToken(stored);
  }

  return {
    token: decrypt(stored.access_token_enc),
    dc: stored.zoho_dc,
    orgId: stored.zoho_org_id || '',
  };
}

async function refreshLegacyToken(stored: LegacyStoredTokens): Promise<{
  token: string;
  dc: ZohoDC;
  orgId: string;
}> {
  const endpoint = `${ZOHO_DC[stored.zoho_dc].accounts}/oauth/v2/token`;
  const refreshToken = decrypt(stored.refresh_token_enc);
  const appId = stored.app_id || stored.customer_id;

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

    await query(
      `UPDATE zoho_tokens SET
         access_token_enc = $1,
         token_expires_at = NOW() + INTERVAL '1 second' * $2,
         last_refreshed_at = NOW(),
         refresh_failures = 0
       WHERE COALESCE(app_id, customer_id) = $3`,
      [encrypt(data.access_token), data.expires_in, appId]
    );

    return {
      token: data.access_token,
      dc: stored.zoho_dc,
      orgId: stored.zoho_org_id || '',
    };
  } catch (error) {
    await query(
      `UPDATE zoho_tokens SET
         refresh_failures = refresh_failures + 1,
         is_valid = CASE WHEN refresh_failures >= 4 THEN FALSE ELSE TRUE END
       WHERE COALESCE(app_id, customer_id) = $1`,
      [appId]
    );
    throw error;
  }
}

async function refreshServiceToken(stored: ServiceStoredTokens): Promise<{
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

    await query(
      `UPDATE zoho_service_tokens SET
         access_token_enc = $1,
         token_expires_at = NOW() + INTERVAL '1 second' * $2,
         last_refreshed_at = NOW(),
         refresh_failures = 0,
         updated_at = NOW()
       WHERE id = $3`,
      [encrypt(data.access_token), data.expires_in, stored.id]
    );

    return {
      token: data.access_token,
      dc: stored.zoho_dc,
      orgId: stored.zoho_org_id || '',
    };
  } catch (error) {
    await query(
      `UPDATE zoho_service_tokens SET
         refresh_failures = refresh_failures + 1,
         is_valid = CASE WHEN refresh_failures >= 4 THEN FALSE ELSE TRUE END,
         updated_at = NOW()
       WHERE id = $1`,
      [stored.id]
    );
    throw error;
  }
}

export async function refreshExpiringTokens(): Promise<number> {
  const legacyExpiring = await query<LegacyStoredTokens>(
    `SELECT * FROM zoho_tokens
      WHERE is_valid = TRUE
        AND token_expires_at < NOW() + INTERVAL '20 minutes'`
  );
  const serviceExpiring = await query<ServiceStoredTokens>(
    `SELECT * FROM zoho_service_tokens
      WHERE is_valid = TRUE
        AND token_expires_at < NOW() + INTERVAL '20 minutes'`
  );

  let refreshed = 0;

  for (const tokens of legacyExpiring) {
    try {
      await refreshLegacyToken(tokens);
      refreshed++;
    } catch (error: any) {
      const appId = tokens.app_id || tokens.customer_id;
      console.error(`[Token Refresh] Failed for legacy token ${appId}:`, error.message);
    }
  }

  for (const tokens of serviceExpiring) {
    try {
      await refreshServiceToken(tokens);
      refreshed++;
    } catch (error: any) {
      console.error(`[Token Refresh] Failed for ${tokens.service} token ${tokens.app_id}:`, error.message);
    }
  }

  console.log(`[Token Refresh] Refreshed ${refreshed}/${legacyExpiring.length + serviceExpiring.length} tokens`);
  return refreshed;
}
