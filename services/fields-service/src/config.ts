import { z } from 'zod';

/**
 * Configuration is validated once at boot. A misconfigured container fails fast
 * (and visibly) instead of erroring on the first request in production.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Human-readable logs for local dev only (pino-pretty is a devDependency). */
  LOG_PRETTY: z.stringbool().default(false),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017'),
  MONGO_DB: z.string().min(1).default('agrolens'),
  AI_SERVICE_URL: z.url().default('http://localhost:8000'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
