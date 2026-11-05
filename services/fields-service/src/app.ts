import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { errorsPlugin } from './plugins/errors.js';
import { tenantPlugin } from './plugins/tenant.js';
import { fieldRoutes } from './routes/fields.js';
import type { FieldService } from './services/field-service.js';

export interface AppDeps {
  config: Config;
  service: FieldService;
  /** Readiness probe: checks downstream dependencies (DB). */
  isReady: () => Promise<boolean>;
}

export async function buildApp({ config, service, isReady }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            ...(config.LOG_PRETTY && { transport: { target: 'pino-pretty' } }),
          },
    // Honour the gateway's request id so one id follows a request across every service.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    bodyLimit: 1024 * 1024, // JSON bodies; images go through multipart limits below
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(errorsPlugin);
  await app.register(tenantPlugin);
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  });

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: 'AgroLens Fields Service', version: '1.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.get('/health/live', { logLevel: 'silent' }, async () => ({ status: 'ok' }));
  app.get('/health/ready', { logLevel: 'silent' }, async (_req, reply) => {
    const ok = await isReady().catch(() => false);
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'unavailable' });
  });

  await app.register(fieldRoutes(service), { prefix: '/v1' });
  return app;
}
