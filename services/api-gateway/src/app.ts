import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { JWTVerifyGetKey } from 'jose';
import mercurius from 'mercurius';
import { AiApi, FieldsApi } from './clients/services.js';
import type { Config } from './config.js';
import type { GatewayContext } from './graphql/resolvers.js';
import { resolvers } from './graphql/resolvers.js';
import { schema } from './graphql/schema.js';
import { authPlugin } from './plugins/auth.js';

export interface GatewayDeps {
  config: Config;
  /** Injected in tests to verify JWTs without a remote JWKS. */
  keySet?: JWTVerifyGetKey;
}

async function upstreamReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('/health/ready', url), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function buildGateway({ config, keySet }: GatewayDeps): Promise<FastifyInstance> {
  const isProd = config.NODE_ENV === 'production';
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            ...(config.LOG_PRETTY && { transport: { target: 'pino-pretty' } }),
          },
    genReqId: () => randomUUID(), // edge: never trust a client-supplied id
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(helmet, {
    // API only: no HTML is served here except GraphiQL in development.
    contentSecurityPolicy: isProd,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  // Auth before rate limiting so limits are keyed per tenant, not per shared NAT IP
  // (rural cooperatives often share one connection).
  await app.register(authPlugin, { config, keySet });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Per authenticated tenant when available, else per IP.
    keyGenerator: (req) => req.principal?.tenantId ?? req.ip,
    allowList: (req) => req.url.startsWith('/health/'),
  });

  const fieldsApi = new FieldsApi(config.FIELDS_SERVICE_URL, config.UPSTREAM_TIMEOUT_MS);
  const aiApi = new AiApi(config.AI_SERVICE_URL, config.UPSTREAM_TIMEOUT_MS);

  await app.register(mercurius, {
    schema,
    resolvers,
    path: '/graphql',
    graphiql: !isProd,
    jit: 1, // compile hot queries with graphql-jit
    queryDepth: 6, // block abusive deeply-nested queries
    context: (req): Partial<GatewayContext> => ({
      call: { tenantId: req.principal!.tenantId, requestId: req.id },
      fieldsApi,
      aiApi,
    }),
    errorFormatter: (execution, ctx) => {
      const formatted = mercurius.defaultErrorFormatter(execution, ctx);
      // Resolver errors are part of a valid GraphQL response: keep HTTP 200 (spec-compliant).
      return {
        statusCode: formatted.statusCode >= 500 ? 200 : formatted.statusCode,
        response: formatted.response,
      };
    },
  });

  /**
   * REST passthrough for binary traffic (image upload/download) that doesn't fit GraphQL.
   * Client-sent x-tenant-id is overwritten with the verified one: no tenant spoofing.
   */
  await app.register(proxy, {
    upstream: config.FIELDS_SERVICE_URL,
    prefix: '/api/v1',
    rewritePrefix: '/v1',
    httpMethods: ['GET', 'POST'],
    replyOptions: {
      rewriteRequestHeaders: (req, headers) => ({
        ...headers,
        authorization: undefined,
        'x-tenant-id': req.principal!.tenantId,
        'x-request-id': req.id,
      }),
    },
  });

  app.get('/health/live', { logLevel: 'silent' }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { logLevel: 'silent' }, async (_req, reply) => {
    const [fields, ai] = await Promise.all([
      upstreamReady(config.FIELDS_SERVICE_URL),
      upstreamReady(config.AI_SERVICE_URL),
    ]);
    const ok = fields && ai;
    return reply
      .status(ok ? 200 : 503)
      .send({ status: ok ? 'ready' : 'degraded', dependencies: { fields, ai } });
  });

  return app;
}
