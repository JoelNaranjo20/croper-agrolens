import type { Readable } from 'node:stream';
import type {
  Crop,
  Field,
  Observation,
  ObservationSummary,
  Point,
  Polygon,
  VegetationAnalysis,
} from '../domain/field.js';
import type { BBox } from '../domain/geo.js';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListFieldsQuery {
  tenantId: string;
  limit: number;
  cursor?: string;
  crop?: Crop;
  /** Fields intersecting the map viewport — the map only loads what is visible. */
  bbox?: BBox;
  /** Nearest fields to a point (e.g. the farmer's GPS position), ordered by distance. */
  near?: { lng: number; lat: number; maxDistanceKm: number };
}

export interface NewField {
  name: string;
  crop: Crop;
  geometry: Polygon;
  centroid: Point;
  areaHa: number;
  soilPh?: number;
  plantedAt?: string;
  notes?: string;
}

export type FieldPatch = Partial<NewField>;

export interface FieldRepository {
  list(query: ListFieldsQuery): Promise<Page<Field>>;
  get(tenantId: string, id: string): Promise<Field | null>;
  create(tenantId: string, field: NewField): Promise<Field>;
  update(tenantId: string, id: string, patch: FieldPatch): Promise<Field | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  setLatestObservation(tenantId: string, id: string, summary: ObservationSummary): Promise<void>;
  ping(): Promise<void>;
}

export interface NewImage {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface StoredImage {
  stream: Readable;
  contentType: string;
  sizeBytes: number;
}

export interface ObservationRepository {
  create(
    tenantId: string,
    fieldId: string,
    analysis: VegetationAnalysis,
    image: NewImage,
  ): Promise<Observation>;
  listByField(
    tenantId: string,
    fieldId: string,
    limit: number,
    cursor?: string,
  ): Promise<Page<Observation>>;
  openImage(tenantId: string, observationId: string): Promise<StoredImage | null>;
  deleteByField(tenantId: string, fieldId: string): Promise<void>;
}
