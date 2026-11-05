import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { DomainError } from '../domain/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
  }
}

const TENANT_RE = /^[\w-]{1,64}$/;

/**
 * Multi-tenancy: every query is scoped by tenant (farm / cooperative / organisation).
 * This internal service sits behind the API gateway on a private network; the gateway
 * authenticates the user and injects `x-tenant-id` from verified token claims.
 */
export const tenantPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/v1/')) return;
    const tenant = req.headers['x-tenant-id'];
    if (typeof tenant !== 'string' || !TENANT_RE.test(tenant)) {
      throw new DomainError('INVALID_INPUT', 'Missing or invalid x-tenant-id header');
    }
    req.tenantId = tenant;
  });
});
