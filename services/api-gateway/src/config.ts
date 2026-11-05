import { z } from 'zod';

const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Human-readable logs for local dev only (pino-pretty is a devDependency). */
    LOG_PRETTY: z.stringbool().default(false),
    FIELDS_SERVICE_URL: z.url().default('http://localhost:4001'),
    AI_SERVICE_URL: z.url().default('http://localhost:8000'),
    UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    CORS_ORIGINS: csv.default(['http://localhost:4200']),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    /**
     * AUTH_MODE=jwt  → verify Bearer tokens against a JWKS (Entra ID, Auth0, Cognito, Keycloak…).
     * AUTH_MODE=none → every request runs as DEV_TENANT_ID. Refused in production.
     */
    AUTH_MODE: z.enum(['jwt', 'none']).default('none'),
    AUTH_JWKS_URL: z.url().optional(),
    AUTH_ISSUER: z.string().optional(),
    AUTH_AUDIENCE: z.string().optional(),
    AUTH_TENANT_CLAIM: z.string().default('tenant_id'),
    DEV_TENANT_ID: z.string().default('demo'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && c.AUTH_MODE === 'none') {
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=none is not allowed in production' });
    }
    if (c.AUTH_MODE === 'jwt' && (!c.AUTH_JWKS_URL || !c.AUTH_ISSUER || !c.AUTH_AUDIENCE)) {
      ctx.addIssue({
        code: 'custom',
        message: 'AUTH_MODE=jwt requires AUTH_JWKS_URL, AUTH_ISSUER and AUTH_AUDIENCE',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
