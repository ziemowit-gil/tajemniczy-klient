const path = require('node:path');
const { z } = require('zod');

const emptyToUndefined = (v) => (v === '' ? undefined : v);
const optional = (schema) => z.preprocess(emptyToUndefined, schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: optional(z.url()),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),

  DATABASE_PATH: z.string().default('./data/tajemniczy-klient.sqlite'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(8),

  SESSION_SECRET: optional(z.string().min(32, 'SESSION_SECRET musi mieć min. 32 znaki')),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),

  SZO_AUTH_MODE: z.enum(['jwt', 'api', 'szo', 'dev']).default('jwt'),
  SZO_BASE_URL: optional(z.url()),
  SZO_SCOPE: z.string().regex(/^[a-z0-9:_-]+$/).default('audytor:access'),
  ADMIN_EMAILS: z.string().default(''),
  // Domeny adresów e-mail dozwolone przy imporcie osoby po adresie (panel Użytkownicy). Pusta wartość = dowolna domena.
  // Wymóg złożenia oświadczenia o poufności po zalogowaniu. Domyślnie włączony (poza testami automatycznymi).
  DECLARATION_REQUIRED: z.enum(['true', 'false']).optional(),
  // Wysyłka SMS (kody logowania użytkowników zewnętrznych): szo = przez SZO, log = tylko konsola (zabronione w produkcji).
  SMS_MODE: z.enum(['off', 'log', 'szo']).default('off'),
  IMPORT_EMAIL_DOMAINS: z.string().default('feer.org.pl'),
  SZO_LOGIN_URL: optional(z.url()),
  SZO_JWT_SECRET: optional(z.string().min(16)),
  SZO_JWT_PUBLIC_KEY: optional(z.string()),
  SZO_JWT_ALGORITHMS: z.string().default('HS256'),
  SZO_JWT_ISSUER: optional(z.string()),
  SZO_JWT_AUDIENCE: optional(z.string()),
  SZO_VERIFY_URL: optional(z.url()),
  SZO_API_KEY: optional(z.string()),
  SZO_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  SZO_CLAIM_ID: z.string().default('sub'),
  SZO_CLAIM_NAME: z.string().default('name'),
  SZO_CLAIM_EMAIL: z.string().default('email'),
  SZO_CLAIM_ROLE: z.string().default('role'),
  SZO_ROLE_MAP: z.string().default('{}'),
  MAIL_MODE: z.enum(['off', 'log', 'smtp', 'szo']).default('off'),
  MAIL_FROM: optional(z.string().max(200)),
  MAIL_AUTOFLUSH: z.enum(['true', 'false']).default('true'),
  MAIL_REMINDER_DAYS: z.coerce.number().int().min(1).max(30).default(3),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),

  // Rola nowego konta bez roli z SZO. Administratora celowo nie można tu ustawić (administratorów wskazuje ADMIN_EMAILS
  // albo panel Użytkownicy), żeby błąd w konfiguracji nie dawał pełnych uprawnień każdemu zalogowanemu.
  SZO_DEFAULT_ROLE: z.enum(['auditor', 'coordinator'], { error: 'SZO_DEFAULT_ROLE: dozwolone auditor lub coordinator' }).default('auditor'),
});

function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Nieprawidłowa konfiguracja (.env):\n${details}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const problems = [];

  if (isProd && !e.SESSION_SECRET) problems.push('SESSION_SECRET jest wymagany w produkcji');
  if (isProd && e.SZO_AUTH_MODE === 'dev') problems.push('SZO_AUTH_MODE=dev jest zabroniony w produkcji');
  if (e.SZO_AUTH_MODE === 'jwt' && !e.SZO_JWT_SECRET && !e.SZO_JWT_PUBLIC_KEY) {
    problems.push('Tryb jwt wymaga SZO_JWT_SECRET albo SZO_JWT_PUBLIC_KEY');
  }
  if (isProd && e.SMS_MODE === 'log') problems.push('SMS_MODE=log jest zabroniony w produkcji (kody trafiałyby do logów)');
  if (e.SMS_MODE === 'szo' && !e.SZO_BASE_URL) problems.push('Tryb szo wysyłki SMS wymaga SZO_BASE_URL');
  if (e.MAIL_MODE === 'smtp' && (!e.SMTP_HOST || !e.MAIL_FROM)) problems.push('Tryb smtp wymaga SMTP_HOST i MAIL_FROM');
  // Klucz API SZO może pochodzić z .env albo zostać wklejony w panelu (Administracja → Integracja z SZO), więc nie jest wymagany przy starcie.
  if (e.MAIL_MODE === 'szo' && !e.SZO_BASE_URL) problems.push('Tryb szo (wysyłka przez SZO / Microsoft Graph) wymaga SZO_BASE_URL');
  if (e.MAIL_MODE !== 'off' && !e.APP_URL) problems.push('Powiadomienia e-mail wymagają APP_URL (odnośniki w wiadomościach)');
  if (e.SZO_AUTH_MODE === 'szo' && !e.SZO_BASE_URL) problems.push('Tryb szo wymaga SZO_BASE_URL (np. https://szo.feer.org.pl)');
  if (e.SZO_AUTH_MODE === 'szo' && !e.APP_URL) problems.push('Tryb szo wymaga APP_URL (adres powrotu z SZO)');
  if (e.SZO_AUTH_MODE === 'api' && !e.SZO_VERIFY_URL) problems.push('Tryb api wymaga SZO_VERIFY_URL');

  let roleMap;
  try {
    roleMap = JSON.parse(e.SZO_ROLE_MAP);
    if (typeof roleMap !== 'object' || roleMap === null || Array.isArray(roleMap)) throw new Error();
  } catch {
    problems.push('SZO_ROLE_MAP musi być obiektem JSON, np. {"admin":"administrator"}');
  }
  if (problems.length) throw new Error(`Nieprawidłowa konfiguracja (.env):\n  - ${problems.join('\n  - ')}`);

  return {
    env: e.NODE_ENV,
    isProd,
    port: e.PORT,
    appUrl: e.APP_URL,
    trustProxy: e.TRUST_PROXY === 'true',
    databasePath: e.DATABASE_PATH === ':memory:' ? e.DATABASE_PATH : path.resolve(e.DATABASE_PATH),
    uploadDir: path.resolve(e.UPLOAD_DIR),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    // Poza produkcją wolno użyć stałego sekretu, aby restart nie wylogowywał developera.
    sessionSecret: e.SESSION_SECRET || 'dev-only-secret-change-me-dev-only-secret',
    sessionTtlSeconds: Math.round(e.SESSION_TTL_HOURS * 3600),
    declarationRequired: e.DECLARATION_REQUIRED ? e.DECLARATION_REQUIRED === 'true' : e.NODE_ENV !== 'test',
    sms: { mode: e.SMS_MODE },
    mail: {
      mode: e.MAIL_MODE,
      from: e.MAIL_FROM,
      autoFlush: e.MAIL_AUTOFLUSH === 'true',
      reminderDays: e.MAIL_REMINDER_DAYS,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE === 'true', user: e.SMTP_USER, pass: e.SMTP_PASS },
    },
    szo: {
      mode: e.SZO_AUTH_MODE,
      loginUrl: e.SZO_LOGIN_URL,
      baseUrl: e.SZO_BASE_URL,
      scope: e.SZO_SCOPE,
      importDomains: e.IMPORT_EMAIL_DOMAINS.split(',').map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
      adminEmails: e.ADMIN_EMAILS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
      jwtSecret: e.SZO_JWT_SECRET,
      jwtPublicKey: e.SZO_JWT_PUBLIC_KEY ? e.SZO_JWT_PUBLIC_KEY.replace(/\\n/g, '\n') : undefined,
      jwtAlgorithms: e.SZO_JWT_ALGORITHMS.split(',').map((a) => a.trim()).filter(Boolean),
      issuer: e.SZO_JWT_ISSUER,
      audience: e.SZO_JWT_AUDIENCE,
      verifyUrl: e.SZO_VERIFY_URL,
      apiKey: e.SZO_API_KEY,
      timeoutMs: e.SZO_TIMEOUT_MS,
      claims: { id: e.SZO_CLAIM_ID, name: e.SZO_CLAIM_NAME, email: e.SZO_CLAIM_EMAIL, role: e.SZO_CLAIM_ROLE },
      roleMap,
      defaultRole: e.SZO_DEFAULT_ROLE,
    },
  };
}

module.exports = { loadConfig };
