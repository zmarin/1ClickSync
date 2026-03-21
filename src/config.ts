import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_REDIRECT_URI: z.string(),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 hex chars'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  JWT_SECRET: z.string().min(16).optional(),
  APP_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  // Email (optional)
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Reverse proxy
  TRUST_PROXY: z.coerce.boolean().default(false),
});

// Validate early — crash with clear messages if config is wrong
let parsedEnv: z.infer<typeof envSchema>;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err) {
  if (err instanceof z.ZodError) {
    console.error('[Config] Invalid environment:');
    for (const issue of err.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
  }
  process.exit(1);
}

export const env = parsedEnv;

// JWT secret: use dedicated JWT_SECRET or fall back to SESSION_SECRET
export const jwtSecret = env.JWT_SECRET || env.SESSION_SECRET;

// Zoho datacenter endpoints
export const ZOHO_DC = {
  com: {
    accounts: 'https://accounts.zoho.com',
    crm: 'https://www.zohoapis.com',
    forms: 'https://forms.zoho.com',
    salesiq: 'https://salesiq.zoho.com',
  },
  eu: {
    accounts: 'https://accounts.zoho.eu',
    crm: 'https://www.zohoapis.eu',
    forms: 'https://forms.zoho.eu',
    salesiq: 'https://salesiq.zoho.eu',
  },
  in: {
    accounts: 'https://accounts.zoho.in',
    crm: 'https://www.zohoapis.in',
    forms: 'https://forms.zoho.in',
    salesiq: 'https://salesiq.zoho.in',
  },
  'com.au': {
    accounts: 'https://accounts.zoho.com.au',
    crm: 'https://www.zohoapis.com.au',
    forms: 'https://forms.zoho.com.au',
    salesiq: 'https://salesiq.zoho.com.au',
  },
  jp: {
    accounts: 'https://accounts.zoho.jp',
    crm: 'https://www.zohoapis.jp',
    forms: 'https://forms.zoho.jp',
    salesiq: 'https://salesiq.zoho.jp',
  },
} as const;

export type ZohoDC = keyof typeof ZOHO_DC;

// Scopes we need per Zoho app
export const ZOHO_SCOPES = [
  'ZohoCRM.modules.ALL',
  'ZohoCRM.settings.ALL',
  'ZohoCRM.settings.fields.ALL',
  'ZohoCRM.settings.layouts.ALL',
  'ZohoCRM.settings.pipeline.ALL',
  'ZohoCRM.org.READ',
  'ZohoCRM.notifications.ALL',
] as const;
