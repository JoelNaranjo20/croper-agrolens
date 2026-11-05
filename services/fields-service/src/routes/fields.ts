import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError } from '../domain/errors.js';
import {
  CreateFieldSchema,
  CropSchema,
  FieldSchema,
  ObservationSchema,
  UpdateFieldSchema,
} from '../domain/field.js';
import type { BBox } from '../domain/geo.js';
import type { FieldService } from '../services/field-service.js';

const IdParams = z.object({ id: z.string().min(1).max(64) });

const numberList = (n: number, label: string) =>
  z
    .string()
    .transform((s) => s.split(',').map(Number))
    .refine((a) => a.length === n && a.every(Number.isFinite), `${label}: expected ${n} numbers`);

const ListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
    crop: CropSchema.optional(),
    bbox: numberList(4, 'bbox=minLng,minLat,maxLng,maxLat').optional(),
    near: numberList(2, 'near=lng,lat').optional(),
    maxDistanceKm: z.coerce.number().positive().max(500).default(25),
  })
  .refine((q) => !(q.bbox && q.near), {
    // MongoDB can't combine $nearSphere with another geo predicate in a single query.
    message: 'Use either bbox or near, not both',
    path: ['near'],
  });

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const fieldRoutes =
  (service: FieldService): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/fields',
      {
        schema: {
          tags: ['fields'],
          querystring: ListQuery,
          response: { 200: pageOf(FieldSchema) },
        },
      },
      async (req) => {
        const { limit, cursor, crop, bbox, near, maxDistanceKm } = req.query;
        return service.list({
          tenantId: req.tenantId,
          limit,
          cursor,
          crop,
          bbox: bbox as BBox | undefined,
          near: near ? { lng: near[0]!, lat: near[1]!, maxDistanceKm } : undefined,
        });
      },
    );

    app.get(
      '/fields/:id',
      { schema: { tags: ['fields'], params: IdParams, response: { 200: FieldSchema } } },
      async (req) => service.get(req.tenantId, req.params.id),
    );

    app.post(
      '/fields',
      { schema: { tags: ['fields'], body: CreateFieldSchema, response: { 201: FieldSchema } } },
      async (req, reply) => {
        const field = await service.create(req.tenantId, req.body);
        return reply.status(201).header('location', `/v1/fields/${field.id}`).send(field);
      },
    );

    app.patch(
      '/fields/:id',
      {
        schema: {
          tags: ['fields'],
          params: IdParams,
          body: UpdateFieldSchema,
          response: { 200: FieldSchema },
        },
      },
      async (req) => service.update(req.tenantId, req.params.id, req.body),
    );

    app.delete(
      '/fields/:id',
      { schema: { tags: ['fields'], params: IdParams } },
      async (req, reply) => {
        await service.delete(req.tenantId, req.params.id);
        return reply.status(204).send();
      },
    );

    app.post(
      '/fields/:id/observations',
      {
        schema: {
          tags: ['observations'],
          params: IdParams,
          consumes: ['multipart/form-data'],
          response: { 201: ObservationSchema },
        },
      },
      async (req, reply) => {
        const file = await req.file();
        if (!file) throw new DomainError('INVALID_INPUT', 'Multipart field "image" is required');
        if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
          throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Use JPEG, PNG or WebP');
        }
        const buffer = await file.toBuffer(); // bounded by multipart fileSize limit → 413
        const obs = await service.addObservation(
          req.tenantId,
          req.params.id,
          { buffer, contentType: file.mimetype, filename: file.filename || 'upload' },
          req.id,
        );
        return reply.status(201).send(obs);
      },
    );

    app.get(
      '/fields/:id/observations',
      {
        schema: {
          tags: ['observations'],
          params: IdParams,
          querystring: z.object({
            limit: z.coerce.number().int().min(1).max(50).default(10),
            cursor: z.string().max(200).optional(),
          }),
          response: { 200: pageOf(ObservationSchema) },
        },
      },
      async (req) =>
        service.listObservations(req.tenantId, req.params.id, req.query.limit, req.query.cursor),
    );

    app.get(
      '/observations/:id/image',
      { schema: { tags: ['observations'], params: IdParams } },
      async (req, reply) => {
        const img = await service.openImage(req.tenantId, req.params.id);
        return (
          reply
            .type(img.contentType)
            .header('content-length', img.sizeBytes)
            // Observation images are immutable: let browsers and the service worker cache them.
            .header('cache-control', 'private, max-age=31536000, immutable')
            .send(img.stream)
        );
      },
    );
  };
