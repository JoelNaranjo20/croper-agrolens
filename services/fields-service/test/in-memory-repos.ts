import { Readable } from 'node:stream';
import booleanIntersects from '@turf/boolean-intersects';
import distance from '@turf/distance';
import { ObjectId } from 'mongodb';
import type {
  Field,
  Observation,
  ObservationSummary,
  VegetationAnalysis,
} from '../src/domain/field.js';
import { bboxToPolygon } from '../src/domain/geo.js';
import { decodeCursor, encodeCursor } from '../src/repositories/cursor.js';
import type {
  FieldPatch,
  FieldRepository,
  ListFieldsQuery,
  NewField,
  NewImage,
  ObservationRepository,
  Page,
  StoredImage,
} from '../src/repositories/types.js';

/**
 * In-memory implementations honouring the same contract as the Mongo repositories.
 * The API suite runs against these by default (fast, hermetic) and against a real
 * MongoDB when MONGO_TEST_URI is set (CI service container).
 */
export class InMemoryFieldRepository implements FieldRepository {
  private rows = new Map<string, { tenantId: string; field: Field }>();

  async ping() {}

  async list(q: ListFieldsQuery): Promise<Page<Field>> {
    let items = [...this.rows.values()]
      .filter((r) => r.tenantId === q.tenantId)
      .map((r) => r.field)
      .filter((f) => !q.crop || f.crop === q.crop)
      .filter((f) => !q.bbox || booleanIntersects(f.geometry, bboxToPolygon(q.bbox)));

    if (q.near) {
      const p = [q.near.lng, q.near.lat];
      items = items
        .map((f) => ({ f, d: distance(p, f.centroid.coordinates, { units: 'kilometers' }) }))
        .filter(({ d }) => d <= q.near!.maxDistanceKm)
        .sort((a, b) => a.d - b.d)
        .map(({ f }) => f);
      return { items: items.slice(0, q.limit), nextCursor: null };
    }

    items.sort((a, b) => (a.id < b.id ? 1 : -1));
    if (q.cursor) {
      const c = decodeCursor(q.cursor).toHexString();
      items = items.filter((f) => f.id < c);
    }
    const page = items.slice(0, q.limit);
    return {
      items: page,
      nextCursor: items.length > q.limit ? encodeCursor(page[page.length - 1]!.id) : null,
    };
  }

  async get(tenantId: string, id: string) {
    const r = this.rows.get(id);
    return r && r.tenantId === tenantId ? r.field : null;
  }

  async create(tenantId: string, input: NewField) {
    const now = new Date().toISOString();
    const field: Field = {
      id: new ObjectId().toHexString(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(field.id, { tenantId, field });
    return field;
  }

  async update(tenantId: string, id: string, patch: FieldPatch) {
    const current = await this.get(tenantId, id);
    if (!current) return null;
    const field = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.rows.set(id, { tenantId, field });
    return field;
  }

  async delete(tenantId: string, id: string) {
    if (!(await this.get(tenantId, id))) return false;
    return this.rows.delete(id);
  }

  async setLatestObservation(tenantId: string, id: string, summary: ObservationSummary) {
    const f = await this.get(tenantId, id);
    if (f && (!f.latestObservation || f.latestObservation.capturedAt <= summary.capturedAt)) {
      f.latestObservation = summary;
    }
  }

  clear() {
    this.rows.clear();
  }
}

export class InMemoryObservationRepository implements ObservationRepository {
  private rows: { tenantId: string; obs: Observation; image: Buffer }[] = [];

  async create(tenantId: string, fieldId: string, a: VegetationAnalysis, image: NewImage) {
    const id = new ObjectId().toHexString();
    const obs: Observation = {
      id,
      fieldId,
      capturedAt: new Date().toISOString(),
      ...a,
      imageUrl: `/v1/observations/${id}/image`,
      contentType: image.contentType,
      sizeBytes: image.buffer.length,
    };
    this.rows.push({ tenantId, obs, image: image.buffer });
    return obs;
  }

  async listByField(tenantId: string, fieldId: string, limit: number, cursor?: string) {
    let items = this.rows
      .filter((r) => r.tenantId === tenantId && r.obs.fieldId === fieldId)
      .map((r) => r.obs)
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    if (cursor) {
      const c = decodeCursor(cursor).toHexString();
      items = items.filter((o) => o.id < c);
    }
    const page = items.slice(0, limit);
    return { items: page, nextCursor: items.length > limit ? encodeCursor(page.at(-1)!.id) : null };
  }

  async openImage(tenantId: string, id: string): Promise<StoredImage | null> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.obs.id === id);
    return r
      ? {
          stream: Readable.from(r.image),
          contentType: r.obs.contentType,
          sizeBytes: r.image.length,
        }
      : null;
  }

  async deleteByField(tenantId: string, fieldId: string) {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.obs.fieldId === fieldId));
  }
}
