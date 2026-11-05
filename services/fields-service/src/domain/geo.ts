import area from '@turf/area';
import booleanValid from '@turf/boolean-valid';
import centroid from '@turf/centroid';
import type { Point, Polygon } from './field.js';
import { DomainError } from './errors.js';

const M2_PER_HA = 10_000;
/** Sanity cap: a single "field" larger than this is almost certainly a drawing mistake. */
export const MAX_FIELD_AREA_HA = 50_000;

/**
 * Validates topology (no self-intersections, holes inside the shell) — something a schema
 * can't express — and derives area/centroid server-side so clients can never send inconsistent
 * values. MongoDB also rejects self-intersecting polygons on 2dsphere indexes, so this turns a
 * cryptic DB error into a clear 422.
 */
export function deriveGeometry(geometry: Polygon): { areaHa: number; centroid: Point } {
  if (!booleanValid(geometry)) {
    throw new DomainError('INVALID_GEOMETRY', 'Polygon is self-intersecting or malformed');
  }
  const areaHa = Math.round((area(geometry) / M2_PER_HA) * 10_000) / 10_000;
  if (areaHa <= 0) throw new DomainError('INVALID_GEOMETRY', 'Polygon has zero area');
  if (areaHa > MAX_FIELD_AREA_HA) {
    throw new DomainError('INVALID_GEOMETRY', `Field exceeds ${MAX_FIELD_AREA_HA} ha`);
  }
  const c = centroid(geometry).geometry.coordinates;
  return { areaHa, centroid: { type: 'Point', coordinates: [c[0]!, c[1]!] } };
}

export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export function bboxToPolygon([minLng, minLat, maxLng, maxLat]: BBox): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}
