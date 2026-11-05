import { type CallContext, JsonHttpClient } from './http.js';

export interface Polygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface ObservationSummary {
  observationId: string;
  capturedAt: string;
  vegetationCoverage: number;
  stressRatio: number;
  exgMean: number;
  health: string;
}

export interface Field {
  id: string;
  name: string;
  crop: string;
  geometry: Polygon;
  centroid: { type: 'Point'; coordinates: [number, number] };
  areaHa: number;
  soilPh?: number;
  plantedAt?: string;
  notes?: string;
  latestObservation?: ObservationSummary;
  createdAt: string;
  updatedAt: string;
}

export interface Observation extends Omit<ObservationSummary, 'observationId'> {
  id: string;
  fieldId: string;
  imageUrl: string;
  contentType: string;
  sizeBytes: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListFieldsArgs {
  limit?: number;
  cursor?: string;
  crop?: string;
  bbox?: number[];
  near?: number[];
  maxDistanceKm?: number;
}

export interface FieldInput {
  name?: string;
  crop?: string;
  geometry?: Polygon;
  soilPh?: number;
  plantedAt?: string;
  notes?: string;
}

export interface YieldRange {
  p10: number;
  p50: number;
  p90: number;
}

export interface YieldResponse {
  crop: string;
  yieldTHa: YieldRange;
  totalT: YieldRange;
  modelVersion: string;
}

export interface ModelInfo {
  version: string;
  trainedAt: string;
  metrics: Record<string, number>;
  crops: string[];
}

export class FieldsApi {
  private readonly http: JsonHttpClient;
  constructor(baseUrl: string, timeoutMs: number) {
    this.http = new JsonHttpClient(baseUrl, timeoutMs);
  }

  list(ctx: CallContext, args: ListFieldsArgs): Promise<Page<Field>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v === undefined || v === null) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return this.http.request('GET', `/v1/fields?${qs}`, ctx);
  }

  get(ctx: CallContext, id: string): Promise<Field> {
    return this.http.request('GET', `/v1/fields/${encodeURIComponent(id)}`, ctx);
  }

  create(ctx: CallContext, input: FieldInput): Promise<Field> {
    return this.http.request('POST', '/v1/fields', ctx, input);
  }

  update(ctx: CallContext, id: string, input: FieldInput): Promise<Field> {
    return this.http.request('PATCH', `/v1/fields/${encodeURIComponent(id)}`, ctx, input);
  }

  delete(ctx: CallContext, id: string): Promise<void> {
    return this.http.request('DELETE', `/v1/fields/${encodeURIComponent(id)}`, ctx);
  }

  observations(ctx: CallContext, id: string, limit: number, cursor?: string) {
    const qs = new URLSearchParams({ limit: String(limit), ...(cursor && { cursor }) });
    return this.http.request<Page<Observation>>(
      'GET',
      `/v1/fields/${encodeURIComponent(id)}/observations?${qs}`,
      ctx,
    );
  }
}

export interface YieldRequest {
  crop: string;
  areaHa: number;
  rainfallMm: number;
  avgTempC: number;
  soilPh?: number;
  vegetationCoverage?: number;
}

export class AiApi {
  private readonly http: JsonHttpClient;
  constructor(baseUrl: string, timeoutMs: number) {
    this.http = new JsonHttpClient(baseUrl, timeoutMs);
  }

  predictYield(ctx: CallContext, body: YieldRequest): Promise<YieldResponse> {
    return this.http.request('POST', '/v1/predictions/yield', ctx, body);
  }

  modelInfo(ctx: CallContext): Promise<ModelInfo> {
    return this.http.request('GET', '/v1/models/yield', ctx);
  }
}
