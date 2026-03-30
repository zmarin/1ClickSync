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
  // Google OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
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

// Zoho datacenter endpoints — all supported tools
export const ZOHO_DC = {
  com: {
    accounts: 'https://accounts.zoho.com',
    crm: 'https://www.zohoapis.com',
    desk: 'https://desk.zoho.com',
    bookings: 'https://www.zohoapis.com',
    salesiq: 'https://salesiq.zoho.com',
    books: 'https://www.zohoapis.com',
    projects: 'https://projectsapi.zoho.com',
    forms: 'https://forms.zoho.com',
  },
  eu: {
    accounts: 'https://accounts.zoho.eu',
    crm: 'https://www.zohoapis.eu',
    desk: 'https://desk.zoho.eu',
    bookings: 'https://www.zohoapis.eu',
    salesiq: 'https://salesiq.zoho.eu',
    books: 'https://www.zohoapis.eu',
    projects: 'https://projectsapi.zoho.eu',
    forms: 'https://forms.zoho.eu',
  },
  in: {
    accounts: 'https://accounts.zoho.in',
    crm: 'https://www.zohoapis.in',
    desk: 'https://desk.zoho.in',
    bookings: 'https://www.zohoapis.in',
    salesiq: 'https://salesiq.zoho.in',
    books: 'https://www.zohoapis.in',
    projects: 'https://projectsapi.zoho.in',
    forms: 'https://forms.zoho.in',
  },
  'com.au': {
    accounts: 'https://accounts.zoho.com.au',
    crm: 'https://www.zohoapis.com.au',
    desk: 'https://desk.zoho.com.au',
    bookings: 'https://www.zohoapis.com.au',
    salesiq: 'https://salesiq.zoho.com.au',
    books: 'https://www.zohoapis.com.au',
    projects: 'https://projectsapi.zoho.com.au',
    forms: 'https://forms.zoho.com.au',
  },
  jp: {
    accounts: 'https://accounts.zoho.jp',
    crm: 'https://www.zohoapis.jp',
    desk: 'https://desk.zoho.jp',
    bookings: 'https://www.zohoapis.jp',
    salesiq: 'https://salesiq.zoho.jp',
    books: 'https://www.zohoapis.jp',
    projects: 'https://projectsapi.zoho.jp',
    forms: 'https://forms.zoho.jp',
  },
} as const;

export type ZohoDC = keyof typeof ZOHO_DC;
export type ZohoApp = 'crm' | 'desk' | 'bookings' | 'salesiq' | 'books' | 'projects' | 'forms';

// All scopes requested in a single OAuth flow — covers all Zoho tools
export const ZOHO_SCOPES = [
  // CRM
  'ZohoCRM.modules.ALL',
  'ZohoCRM.settings.ALL',
  'ZohoCRM.settings.fields.ALL',
  'ZohoCRM.settings.layouts.ALL',
  'ZohoCRM.settings.pipeline.ALL',
  'ZohoCRM.org.READ',
  'ZohoCRM.notifications.ALL',
  // Desk
  'Desk.tickets.ALL',
  'Desk.contacts.ALL',
  'Desk.basic.ALL',
  'Desk.settings.ALL',
  // Bookings
  'ZohoBookings.data.ALL',
  // SalesIQ
  'SalesIQ.portals.ALL',
  'SalesIQ.visitors.ALL',
  'SalesIQ.conversations.ALL',
  // Books
  'ZohoBooks.invoices.ALL',
  'ZohoBooks.contacts.ALL',
  'ZohoBooks.settings.ALL',
  // Projects
  'ZohoProjects.projects.ALL',
  'ZohoProjects.tasks.ALL',
  'ZohoProjects.portals.ALL',
] as const;
