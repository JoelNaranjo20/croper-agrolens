import Fastify, { type FastifyInstance } from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildGateway } from '../src/app.js';
import { loadConfig } from '../src/config.js';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, unknown>;
  body?: unknown;
}

const field = {
  id: 'f1',
  name: 'Lote Café',
  crop: 'coffee',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  centroid: { type: 'Point', coordinates: [0.5, 0.5] },
  areaHa: 2.5,
  soilPh: 5.4,
  latestObservation: {
    observationId: 'o1',
    capturedAt: '2026-01-01T00:00:00.000Z',
    vegetationCoverage: 0.9,
    stressRatio: 0.02,
    exgMean: 0.2,
    health: 'healthy',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let fieldsUp: FastifyInstance;
let aiUp: FastifyInstance;
let seen: Seen[] = [];
let fieldsUrl = '';
let aiUrl = '';

beforeAll(async () => {
  fieldsUp = Fastify();
  fieldsUp.addHook('onRequest', async (req) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
  });
  fieldsUp.get('/health/ready', async () => ({ status: 'ready' }));
  fieldsUp.get('/v1/fields', async () => ({ items: [field], nextCursor: null }));
  fieldsUp.get('/v1/fields/:id', async (req, reply) =>
    (req.params as { id: string }).id === 'f1'
      ? field
      : reply.status(404).send({ title: 'Field not found', status: 404, code: 'NOT_FOUND' }),
  );
  fieldsUp.post('/v1/fields', async (req, reply) => {
    seen.at(-1)!.body = req.body;
    return reply
      .status(422)
      .send({ title: 'Polygon is self-intersecting', status: 422, code: 'INVALID_GEOMETRY' });
  });
  fieldsUp.get('/v1/observations/:id/image', async (_req, reply) =>
    reply.type('image/jpeg').send(Buffer.from('img')),
  );
  fieldsUrl = await fieldsUp.listen({ port: 0, host: '127.0.0.1' });

  aiUp = Fastify();
  aiUp.get('/health/ready', async () => ({ status: 'ready' }));
  aiUp.post('/v1/predictions/yield', async (req) => {
    seen.push({ method: 'POST', url: req.url, headers: req.headers, body: req.body });
    return {
      crop: 'coffee',
      yieldTHa: { p10: 1, p50: 1.5, p90: 2 },
      totalT: { p10: 2.5, p50: 3.75, p90: 5 },
      modelVersion: '1.0.0',
    };
  });
  aiUp.get('/v1/models/yield', async () => ({
    version: '1.0.0',
    trainedAt: 'now',
    metrics: { r2: 0.93, mae_t_ha: 0.47 },
    crops: [],
  }));
  aiUrl = await aiUp.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fieldsUp?.close();
  await aiUp?.close();
});
beforeEach(() => {
  seen = [];
});

const cfg = (extra: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    FIELDS_SERVICE_URL: fieldsUrl,
    AI_SERVICE_URL: aiUrl,
    DEV_TENANT_ID: 'farm-x',
    ...extra,
  });

const gql = (
  app: FastifyInstance,
  query: string,
  variables?: object,
  headers: Record<string, string> = {},
) => app.inject({ method: 'POST', url: '/graphql', payload: { query, variables }, headers });

describe('gateway (dev auth)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildGateway({ config: cfg() });
  });
  afterAll(() => app.close());

  it('reports readiness of dependencies', async () => {
    const res = await app.inject('/health/ready');
    expect(res.json()).toEqual({ status: 'ready', dependencies: { fields: true, ai: true } });
  });

  it('lists fields and propagates tenant + request id downstream', async () => {
    const res = await gql(
      app,
      '{ fields(limit: 5, crop: coffee) { items { id name areaHa } nextCursor } }',
    );
    expect(res.json().data.fields.items[0].name).toBe('Lote Café');
    const call = seen.find((s) => s.url.startsWith('/v1/fields?'))!;
    expect(call.url).toContain('limit=5');
    expect(call.url).toContain('crop=coffee');
    expect(call.headers['x-tenant-id']).toBe('farm-x');
    expect(call.headers['x-request-id']).toBe(res.headers['x-request-id']);
  });

  it('returns null for a missing field', async () => {
    const res = await gql(app, '{ field(id: "nope") { id } }');
    expect(res.json()).toEqual({ data: { field: null } });
  });

  it('composes yield forecast from field data + AI service', async () => {
    const res = await gql(
      app,
      '{ field(id: "f1") { yieldForecast(rainfallMm: 1800, avgTempC: 20) { totalT { p50 } vegetationCoverageUsed modelVersion } } }',
    );
    expect(res.json().data.field.yieldForecast).toEqual({
      totalT: { p50: 3.75 },
      vegetationCoverageUsed: 0.9,
      modelVersion: '1.0.0',
    });
    const ai = seen.find((s) => s.url === '/v1/predictions/yield')!;
    expect(ai.body).toEqual({
      crop: 'coffee',
      areaHa: 2.5,
      rainfallMm: 1800,
      avgTempC: 20,
      soilPh: 5.4,
      vegetationCoverage: 0.9,
    });
  });

  it('maps upstream 422 to BAD_USER_INPUT with a reason', async () => {
    const res = await gql(
      app,
      'mutation($i: CreateFieldInput!) { createField(input: $i) { id } }',
      {
        i: {
          name: 'X',
          crop: 'maize',
          geometry: {
            coordinates: [
              [
                [0, 0],
                [1, 1],
                [1, 0],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
      },
    );
    const err = res.json().errors[0];
    expect(err.message).toBe('Polygon is self-intersecting');
    expect(err.extensions).toMatchObject({ code: 'BAD_USER_INPUT', reason: 'INVALID_GEOMETRY' });
    expect(seen.at(-1)!.body).toMatchObject({ geometry: { type: 'Polygon' } });
  });

  it('exposes model info', async () => {
    const res = await gql(app, '{ yieldModel { version r2 maeTHa } }');
    expect(res.json().data.yieldModel).toEqual({ version: '1.0.0', r2: 0.93, maeTHa: 0.47 });
  });

  it('proxies binary REST traffic and overrides client tenant header', async () => {
    const res = await app.inject({
      url: '/api/v1/observations/o1/image',
      headers: { 'x-tenant-id': 'evil' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('img');
    const call = seen.find((s) => s.url === '/v1/observations/o1/image')!;
    expect(call.headers['x-tenant-id']).toBe('farm-x');
  });

  it('sets security headers', async () => {
    const res = await app.inject('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('gateway resilience', () => {
  it('maps unreachable upstreams to UPSTREAM_UNAVAILABLE and degraded readiness', async () => {
    const app = await buildGateway({
      config: cfg({ FIELDS_SERVICE_URL: 'http://127.0.0.1:1', UPSTREAM_TIMEOUT_MS: '500' }),
    });
    const res = await gql(app, '{ fields { items { id } } }');
    expect(res.json().errors[0].extensions.code).toBe('UPSTREAM_UNAVAILABLE');
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(503);
    await app.close();
  });
});

describe('gateway (JWT auth)', () => {
  let app: FastifyInstance;
  let sign: (claims: object, aud?: string) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    sign = (claims, aud = 'agrolens-api') =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://idp.test/')
        .setAudience(aud)
        .setSubject('user-1')
        .setExpirationTime('5m')
        .sign(privateKey);
    app = await buildGateway({
      config: cfg({
        AUTH_MODE: 'jwt',
        AUTH_JWKS_URL: 'https://idp.test/jwks',
        AUTH_ISSUER: 'https://idp.test/',
        AUTH_AUDIENCE: 'agrolens-api',
      }),
      keySet: createLocalJWKSet({ keys: [jwk] }),
    });
  });
  afterAll(() => app.close());

  it('rejects requests without a token', async () => {
    const res = await gql(app, '{ fields { items { id } } }');
    expect(res.statusCode).toBe(401);
  });

  it('rejects tokens for another audience', async () => {
    const token = await sign({ tenant_id: 't1' }, 'other-api');
    const res = await gql(app, '{ fields { items { id } } }', undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('derives the tenant from the verified claim', async () => {
    const token = await sign({ tenant_id: 'coop-42' });
    const res = await gql(app, '{ fields { items { id } } }', undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(seen.find((s) => s.url.startsWith('/v1/fields'))!.headers['x-tenant-id']).toBe(
      'coop-42',
    );
  });

  it('keeps health endpoints public', async () => {
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
});

describe('config', () => {
  it('refuses AUTH_MODE=none in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/not allowed in production/);
  });
  it('requires JWKS settings for jwt mode', () => {
    expect(() => loadConfig({ AUTH_MODE: 'jwt' })).toThrow(/requires/);
  });
});
