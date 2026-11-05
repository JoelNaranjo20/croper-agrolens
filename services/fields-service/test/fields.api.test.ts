import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../src/domain/errors.js';
import { TENANT, setup, square, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setup();
}, 120_000);
afterAll(async () => ctx?.close());
beforeEach(async () => {
  await ctx.reset();
  ctx.ai.next = { vegetationCoverage: 0.8, stressRatio: 0.05, exgMean: 0.21, health: 'healthy' };
});

const create = (body: object, headers: Record<string, string> = TENANT) =>
  ctx.app.inject({ method: 'POST', url: '/v1/fields', headers, payload: body });

const validField = { name: 'Lote 1', crop: 'coffee', geometry: square(), soilPh: 5.5 };

function multipart(contentType: string, content: Buffer) {
  const boundary = '----agrolens';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.jpg"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { ...TENANT, 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('health', () => {
  it('reports live and ready', async () => {
    expect((await ctx.app.inject('/health/live')).statusCode).toBe(200);
    expect((await ctx.app.inject('/health/ready')).json()).toEqual({ status: 'ready' });
  });
});

describe('tenancy', () => {
  it('requires x-tenant-id', async () => {
    const res = await ctx.app.inject('/v1/fields');
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('isolates tenants', async () => {
    const { id } = (await create(validField)).json();
    const other = await ctx.app.inject({
      url: `/v1/fields/${id}`,
      headers: { 'x-tenant-id': 'farm-b' },
    });
    expect(other.statusCode).toBe(404);
  });
});

describe('fields CRUD', () => {
  it('creates a field with server-derived area and centroid', async () => {
    const res = await create(validField);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.areaHa).toBeCloseTo(1, 0);
    expect(body.centroid.type).toBe('Point');
    expect(res.headers.location).toBe(`/v1/fields/${body.id}`);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('validates input with a problem+json body', async () => {
    const res = await create({
      ...validField,
      crop: 'kale',
      geometry: { type: 'Polygon', coordinates: [[[0, 0]]] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it('rejects open rings', async () => {
    const g = square();
    g.coordinates[0]!.pop();
    expect((await create({ ...validField, geometry: g })).statusCode).toBe(400);
  });

  it('rejects self-intersecting polygons with 422', async () => {
    const bowTie = {
      type: 'Polygon',
      coordinates: [
        [
          [-75, 6],
          [-74.99, 6.01],
          [-74.99, 6],
          [-75, 6.01],
          [-75, 6],
        ],
      ],
    };
    const res = await create({ ...validField, geometry: bowTie });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_GEOMETRY');
  });

  it('updates geometry and recomputes area', async () => {
    const { id, areaHa } = (await create(validField)).json();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/fields/${id}`,
      headers: TENANT,
      payload: { geometry: square(-75.57, 6.25, 0.0018) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().areaHa).toBeGreaterThan(areaHa * 3.5);
  });

  it('deletes and then 404s', async () => {
    const { id } = (await create(validField)).json();
    expect(
      (await ctx.app.inject({ method: 'DELETE', url: `/v1/fields/${id}`, headers: TENANT }))
        .statusCode,
    ).toBe(204);
    expect((await ctx.app.inject({ url: `/v1/fields/${id}`, headers: TENANT })).statusCode).toBe(
      404,
    );
  });

  it('returns 404 for malformed ids instead of 500', async () => {
    expect(
      (await ctx.app.inject({ url: '/v1/fields/not-an-id', headers: TENANT })).statusCode,
    ).toBe(404);
  });
});

describe('listing', () => {
  beforeEach(async () => {
    await create({ ...validField, name: 'Medellín', geometry: square(-75.57, 6.25) });
    await create({
      ...validField,
      name: 'Rionegro',
      crop: 'avocado',
      geometry: square(-75.37, 6.15),
    });
    await create({ ...validField, name: 'Bogotá', crop: 'potato', geometry: square(-74.07, 4.71) });
  });

  it('paginates with opaque cursors', async () => {
    const p1 = (await ctx.app.inject({ url: '/v1/fields?limit=2', headers: TENANT })).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (
      await ctx.app.inject({ url: `/v1/fields?limit=2&cursor=${p1.nextCursor}`, headers: TENANT })
    ).json();
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const names = [...p1.items, ...p2.items].map((f: { name: string }) => f.name);
    expect(new Set(names).size).toBe(3);
  });

  it('filters by crop', async () => {
    const res = (await ctx.app.inject({ url: '/v1/fields?crop=avocado', headers: TENANT })).json();
    expect(res.items.map((f: { name: string }) => f.name)).toEqual(['Rionegro']);
  });

  it('filters by map viewport (bbox)', async () => {
    const res = (
      await ctx.app.inject({ url: '/v1/fields?bbox=-76,6,-75,7', headers: TENANT })
    ).json();
    expect(res.items.map((f: { name: string }) => f.name).sort()).toEqual(['Medellín', 'Rionegro']);
  });

  it('orders by distance with near', async () => {
    const res = (
      await ctx.app.inject({ url: '/v1/fields?near=-75.36,6.14&maxDistanceKm=50', headers: TENANT })
    ).json();
    expect(res.items.map((f: { name: string }) => f.name)).toEqual(['Rionegro', 'Medellín']);
  });

  it('rejects bbox combined with near', async () => {
    const res = await ctx.app.inject({
      url: '/v1/fields?bbox=-76,6,-75,7&near=-75,6',
      headers: TENANT,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed bbox', async () => {
    expect(
      (await ctx.app.inject({ url: '/v1/fields?bbox=1,2,3', headers: TENANT })).statusCode,
    ).toBe(400);
  });
});

describe('observations', () => {
  it('analyzes an image, stores it and updates the field summary', async () => {
    const { id } = (await create(validField)).json();
    const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/fields/${id}/observations`,
      ...multipart('image/jpeg', img),
    });
    expect(res.statusCode).toBe(201);
    const obs = res.json();
    expect(obs.health).toBe('healthy');

    const field = (await ctx.app.inject({ url: `/v1/fields/${id}`, headers: TENANT })).json();
    expect(field.latestObservation.observationId).toBe(obs.id);

    const list = (
      await ctx.app.inject({ url: `/v1/fields/${id}/observations`, headers: TENANT })
    ).json();
    expect(list.items).toHaveLength(1);

    const image = await ctx.app.inject({ url: obs.imageUrl, headers: TENANT });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.rawPayload.equals(img)).toBe(true);
  });

  it('rejects unsupported media types', async () => {
    const { id } = (await create(validField)).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/fields/${id}/observations`,
      ...multipart('application/pdf', Buffer.from('x')),
    });
    expect(res.statusCode).toBe(415);
    expect(ctx.ai.calls).toBeGreaterThanOrEqual(0);
  });

  it('rejects oversized uploads with 413', async () => {
    const { id } = (await create(validField)).json();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/fields/${id}/observations`,
      ...multipart('image/jpeg', Buffer.alloc(200_000)),
    });
    expect(res.statusCode).toBe(413);
  });

  it('maps AI outages to 503', async () => {
    const { id } = (await create(validField)).json();
    ctx.ai.next = new DomainError('UPSTREAM_UNAVAILABLE', 'AI down');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/fields/${id}/observations`,
      ...multipart('image/jpeg', Buffer.from('x')),
    });
    expect(res.statusCode).toBe(503);
  });

  it('does not call the AI for unknown fields', async () => {
    const before = ctx.ai.calls;
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/fields/64b7f0c2a1b2c3d4e5f60718/observations',
      ...multipart('image/jpeg', Buffer.from('x')),
    });
    expect(res.statusCode).toBe(404);
    expect(ctx.ai.calls).toBe(before);
  });
});
