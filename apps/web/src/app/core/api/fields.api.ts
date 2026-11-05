import { Injectable, inject } from '@angular/core';
import { GraphqlClient } from './graphql.client';
import type {
  CreateFieldInput,
  Crop,
  FieldDetail,
  FieldSummary,
  Observation,
  Page,
  YieldForecast,
} from './models';

const SUMMARY = /* GraphQL */ `
  fragment FieldSummary on Field {
    id
    name
    crop
    areaHa
    geometry {
      coordinates
    }
    centroid {
      coordinates
    }
    latestObservation {
      observationId
      capturedAt
      vegetationCoverage
      stressRatio
      health
    }
  }
`;

export interface FieldsFilter {
  bbox?: [number, number, number, number];
  crop?: Crop;
  limit?: number;
  cursor?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FieldsApi {
  private readonly gql = inject(GraphqlClient);

  async list(filter: FieldsFilter = {}): Promise<Page<FieldSummary>> {
    const { fields } = await this.gql.query<{ fields: Page<FieldSummary> }>(
      `query Fields($limit: Int, $cursor: String, $crop: Crop, $bbox: [Float!]) {
        fields(limit: $limit, cursor: $cursor, crop: $crop, bbox: $bbox) {
          items { ...FieldSummary }
          nextCursor
        }
      }
      ${SUMMARY}`,
      { limit: filter.limit ?? 50, cursor: filter.cursor, crop: filter.crop, bbox: filter.bbox },
    );
    return { ...fields, items: fields.items.map(withPolygonType) };
  }

  async get(id: string): Promise<FieldDetail | null> {
    const { field } = await this.gql.query<{ field: FieldDetail | null }>(
      `query Field($id: ID!) {
        field(id: $id) { ...FieldSummary soilPh plantedAt notes createdAt }
      }
      ${SUMMARY}`,
      { id },
    );
    return field ? withPolygonType(field) : null;
  }

  async observations(id: string, cursor?: string | null): Promise<Page<Observation>> {
    const { field } = await this.gql.query<{ field: { observations: Page<Observation> } }>(
      `query Observations($id: ID!, $cursor: String) {
        field(id: $id) {
          observations(limit: 12, cursor: $cursor) {
            items { id capturedAt vegetationCoverage stressRatio health imageUrl }
            nextCursor
          }
        }
      }`,
      { id, cursor },
    );
    return field.observations;
  }

  async forecast(id: string, rainfallMm: number, avgTempC: number): Promise<YieldForecast> {
    const { field } = await this.gql.query<{ field: { yieldForecast: YieldForecast } }>(
      `query Forecast($id: ID!, $rain: Float!, $temp: Float!) {
        field(id: $id) {
          yieldForecast(rainfallMm: $rain, avgTempC: $temp) {
            yieldTHa { p10 p50 p90 }
            totalT { p10 p50 p90 }
            modelVersion
            vegetationCoverageUsed
          }
        }
      }`,
      { id, rain: rainfallMm, temp: avgTempC },
      { fresh: true }, // scenario-specific: never serve a cached forecast
    );
    return field.yieldForecast;
  }

  async create(input: CreateFieldInput): Promise<{ id: string }> {
    const { createField } = await this.gql.mutate<{ createField: { id: string } }>(
      `mutation Create($input: CreateFieldInput!) { createField(input: $input) { id } }`,
      { input },
    );
    return createField;
  }

  async delete(id: string): Promise<void> {
    await this.gql.mutate(`mutation Delete($id: ID!) { deleteField(id: $id) }`, { id });
  }
}

/** The fragment omits `type` to keep payloads lean; restore it for GeoJSON consumers. */
function withPolygonType<T extends FieldSummary>(f: T): T {
  return { ...f, geometry: { type: 'Polygon', coordinates: f.geometry.coordinates } };
}
