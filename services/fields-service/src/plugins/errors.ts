import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { DomainError } from '../domain/errors.js';

/** All errors leave the service as RFC 9457 `application/problem+json`. */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const send = (status: number, title: string, extra: Record<string, unknown> = {}) =>
      reply
        .status(status)
        .type('application/problem+json')
        .send({ type: 'about:blank', title, status, instance: req.url, ...extra });

    if (err instanceof DomainError) {
      return send(err.statusCode, err.message, { code: err.code });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(400, 'Validation failed', {
        code: 'INVALID_INPUT',
        errors: err.validation.map((v) => ({
          path: `${err.validationContext}${v.instancePath}`,
          message: v.message,
        })),
      });
    }
    const status = err.statusCode ?? 500;
    if (status < 500) return send(status, err.message, { code: err.code });

    // Unexpected: log full error with request id, return nothing internal to the client.
    req.log.error({ err }, 'unhandled error');
    return send(500, 'Internal Server Error');
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .type('application/problem+json')
      .send({ type: 'about:blank', title: 'Route not found', status: 404, instance: req.url }),
  );
});
