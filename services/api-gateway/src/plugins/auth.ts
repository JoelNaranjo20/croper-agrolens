import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config.js';

export interface Principal {
  subject: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

const PUBLIC_PREFIXES = ['/health/'];

export class AuthError extends Error {
  readonly statusCode = 401;
}

/**
 * Authentication at the edge. Internal services never see end-user tokens: they receive a
 * trusted `x-tenant-id` from the gateway over the private network. Tenant comes from a verified
 * token claim, never from a client-controlled header.
 */
export const authPlugin = fp(
  async (app: FastifyInstance, opts: { config: Config; keySet?: JWTVerifyGetKey }) => {
    const { config } = opts;
    const keySet =
      opts.keySet ??
      (config.AUTH_MODE === 'jwt' ? createRemoteJWKSet(new URL(config.AUTH_JWKS_URL!)) : undefined);

    app.decorateRequest('principal', null);

    async function authenticate(req: FastifyRequest): Promise<Principal> {
      if (config.AUTH_MODE === 'none')
        return { subject: 'dev-user', tenantId: config.DEV_TENANT_ID };

      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new AuthError('Missing bearer token');
      try {
        const { payload } = await jwtVerify(header.slice(7), keySet!, {
          issuer: config.AUTH_ISSUER,
          audience: config.AUTH_AUDIENCE,
          algorithms: ['RS256', 'ES256'],
          clockTolerance: 30,
        });
        const tenant = payload[config.AUTH_TENANT_CLAIM];
        if (typeof tenant !== 'string' || !payload.sub) throw new AuthError('Token lacks claims');
        return { subject: payload.sub, tenantId: tenant };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError('Invalid token');
      }
    }

    app.addHook('onRequest', async (req, reply) => {
      if (req.method === 'OPTIONS' || PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
      try {
        req.principal = await authenticate(req);
      } catch (err) {
        return reply
          .status(401)
          .header('www-authenticate', 'Bearer')
          .type('application/problem+json')
          .send({ type: 'about:blank', title: (err as Error).message, status: 401 });
      }
    });
  },
);
