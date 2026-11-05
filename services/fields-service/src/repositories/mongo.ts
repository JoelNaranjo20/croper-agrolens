import { Readable } from 'node:stream';
import { GridFSBucket, ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import type {
  Crop,
  Field,
  Observation,
  ObservationSummary,
  Point,
  Polygon,
  VegetationAnalysis,
} from '../domain/field.js';
import { bboxToPolygon } from '../domain/geo.js';
import { decodeCursor, encodeCursor, toObjectId } from './cursor.js';
import type {
  FieldPatch,
  FieldRepository,
  ListFieldsQuery,
  NewField,
  NewImage,
  ObservationRepository,
  Page,
  StoredImage,
} from './types.js';

interface FieldDoc {
  _id: ObjectId;
  tenantId: string;
  name: string;
  crop: Crop;
  geometry: Polygon;
  centroid: Point;
  areaHa: number;
  soilPh?: number;
  plantedAt?: string;
  notes?: string;
  latestObservation?: ObservationSummary;
  createdAt: Date;
  updatedAt: Date;
}

interface ObservationDoc extends VegetationAnalysis {
  _id: ObjectId;
  tenantId: string;
  fieldId: ObjectId;
  capturedAt: Date;
  imageFileId: ObjectId;
  contentType: string;
  sizeBytes: number;
}

const toField = ({ _id, tenantId: _t, createdAt, updatedAt, ...rest }: FieldDoc): Field => ({
  id: _id.toHexString(),
  ...rest,
  createdAt: createdAt.toISOString(),
  updatedAt: updatedAt.toISOString(),
});

const toObservation = (d: ObservationDoc): Observation => ({
  id: d._id.toHexString(),
  fieldId: d.fieldId.toHexString(),
  capturedAt: d.capturedAt.toISOString(),
  vegetationCoverage: d.vegetationCoverage,
  stressRatio: d.stressRatio,
  exgMean: d.exgMean,
  health: d.health,
  imageUrl: `/v1/observations/${d._id.toHexString()}/image`,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
});

/** Idempotent; runs at boot. Compatible with Azure Cosmos DB for MongoDB (vCore). */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection('fields').createIndexes([
    { key: { tenantId: 1, _id: -1 }, name: 'tenant_recent' },
    { key: { tenantId: 1, crop: 1, _id: -1 }, name: 'tenant_crop_recent' },
    { key: { geometry: '2dsphere' }, name: 'geometry_2dsphere' },
    { key: { centroid: '2dsphere' }, name: 'centroid_2dsphere' },
  ]);
  await db
    .collection('observations')
    .createIndexes([{ key: { tenantId: 1, fieldId: 1, _id: -1 }, name: 'field_recent' }]);
}

export class MongoFieldRepository implements FieldRepository {
  private readonly col: Collection<FieldDoc>;

  constructor(private readonly db: Db) {
    this.col = db.collection<FieldDoc>('fields');
  }

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  async list(q: ListFieldsQuery): Promise<Page<Field>> {
    const filter: Filter<FieldDoc> = { tenantId: q.tenantId };
    if (q.crop) filter.crop = q.crop;
    if (q.bbox) filter.geometry = { $geoIntersects: { $geometry: bboxToPolygon(q.bbox) } };

    if (q.near) {
      // Distance-ordered results don't combine with keyset cursors: return a single bounded page.
      filter.centroid = {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [q.near.lng, q.near.lat] },
          $maxDistance: q.near.maxDistanceKm * 1000,
        },
      };
      const docs = await this.col.find(filter).limit(q.limit).toArray();
      return { items: docs.map(toField), nextCursor: null };
    }

    if (q.cursor) filter._id = { $lt: decodeCursor(q.cursor) };
    const docs = await this.col
      .find(filter)
      .sort({ _id: -1 })
      .limit(q.limit + 1)
      .toArray();
    const hasMore = docs.length > q.limit;
    const items = docs.slice(0, q.limit).map(toField);
    return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]!.id) : null };
  }

  async get(tenantId: string, id: string): Promise<Field | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const doc = await this.col.findOne({ _id, tenantId });
    return doc ? toField(doc) : null;
  }

  async create(tenantId: string, field: NewField): Promise<Field> {
    const now = new Date();
    const doc: FieldDoc = {
      _id: new ObjectId(),
      tenantId,
      ...field,
      createdAt: now,
      updatedAt: now,
    };
    await this.col.insertOne(doc);
    return toField(doc);
  }

  async update(tenantId: string, id: string, patch: FieldPatch): Promise<Field | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const doc = await this.col.findOneAndUpdate(
      { _id, tenantId },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return doc ? toField(doc) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const res = await this.col.deleteOne({ _id, tenantId });
    return res.deletedCount === 1;
  }

  async setLatestObservation(tenantId: string, id: string, summary: ObservationSummary) {
    const _id = toObjectId(id);
    if (!_id) return;
    // Conditional update: an older observation processed late never overwrites a newer one.
    await this.col.updateOne(
      {
        _id,
        tenantId,
        $or: [
          { latestObservation: { $exists: false } },
          { 'latestObservation.capturedAt': { $lte: summary.capturedAt } },
        ],
      },
      { $set: { latestObservation: summary, updatedAt: new Date() } },
    );
  }
}

export class MongoObservationRepository implements ObservationRepository {
  private readonly col: Collection<ObservationDoc>;
  private readonly bucket: GridFSBucket;

  constructor(db: Db) {
    this.col = db.collection<ObservationDoc>('observations');
    // GridFS keeps the demo self-contained. In Azure this maps 1:1 to Blob Storage + SAS URLs.
    this.bucket = new GridFSBucket(db, { bucketName: 'observationImages' });
  }

  async create(
    tenantId: string,
    fieldId: string,
    analysis: VegetationAnalysis,
    image: NewImage,
  ): Promise<Observation> {
    const _id = new ObjectId();
    const imageFileId = new ObjectId();
    await new Promise<void>((resolve, reject) => {
      Readable.from(image.buffer)
        .pipe(
          this.bucket.openUploadStreamWithId(imageFileId, image.filename, {
            metadata: { tenantId, observationId: _id, contentType: image.contentType },
          }),
        )
        .on('finish', () => resolve())
        .on('error', reject);
    });
    const doc: ObservationDoc = {
      _id,
      tenantId,
      fieldId: new ObjectId(fieldId),
      capturedAt: new Date(),
      ...analysis,
      imageFileId,
      contentType: image.contentType,
      sizeBytes: image.buffer.length,
    };
    await this.col.insertOne(doc);
    return toObservation(doc);
  }

  async listByField(tenantId: string, fieldId: string, limit: number, cursor?: string) {
    const fid = toObjectId(fieldId);
    if (!fid) return { items: [], nextCursor: null };
    const filter: Filter<ObservationDoc> = { tenantId, fieldId: fid };
    if (cursor) filter._id = { $lt: decodeCursor(cursor) };
    const docs = await this.col
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .toArray();
    const items = docs.slice(0, limit).map(toObservation);
    const nextCursor = docs.length > limit ? encodeCursor(items[items.length - 1]!.id) : null;
    return { items, nextCursor };
  }

  async openImage(tenantId: string, observationId: string): Promise<StoredImage | null> {
    const _id = toObjectId(observationId);
    if (!_id) return null;
    const doc = await this.col.findOne({ _id, tenantId });
    if (!doc) return null;
    return {
      stream: this.bucket.openDownloadStream(doc.imageFileId),
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
    };
  }

  async deleteByField(tenantId: string, fieldId: string): Promise<void> {
    const fid = toObjectId(fieldId);
    if (!fid) return;
    const docs = await this.col
      .find({ tenantId, fieldId: fid }, { projection: { imageFileId: 1 } })
      .toArray();
    await Promise.all(docs.map((d) => this.bucket.delete(d.imageFileId).catch(() => undefined)));
    await this.col.deleteMany({ tenantId, fieldId: fid });
  }
}
