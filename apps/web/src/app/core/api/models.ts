export const CROPS = ['maize', 'coffee', 'rice', 'potato', 'avocado', 'banana', 'cocoa'] as const;
export type Crop = (typeof CROPS)[number];
export type Health = 'healthy' | 'moderate' | 'stressed' | 'bare';

export type LngLat = [lng: number, lat: number];

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: LngLat[][];
}

export interface ObservationSummary {
  observationId: string;
  capturedAt: string;
  vegetationCoverage: number;
  stressRatio: number;
  health: Health;
}

export interface FieldSummary {
  id: string;
  name: string;
  crop: Crop;
  areaHa: number;
  geometry: GeoPolygon;
  centroid: { coordinates: LngLat };
  latestObservation: ObservationSummary | null;
}

export interface FieldDetail extends FieldSummary {
  soilPh: number | null;
  plantedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Observation {
  id: string;
  capturedAt: string;
  vegetationCoverage: number;
  stressRatio: number;
  health: Health;
  imageUrl: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface YieldRange {
  p10: number;
  p50: number;
  p90: number;
}

export interface YieldForecast {
  yieldTHa: YieldRange;
  totalT: YieldRange;
  modelVersion: string;
  vegetationCoverageUsed: number;
}

export interface CreateFieldInput {
  name: string;
  crop: Crop;
  geometry: GeoPolygon;
  soilPh?: number;
  plantedAt?: string;
  notes?: string;
}
