import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/domain/errors.js';
import { bboxToPolygon, deriveGeometry } from '../src/domain/geo.js';
import { square } from './helpers.js';

describe('deriveGeometry', () => {
  it('computes area in hectares and centroid', () => {
    const { areaHa, centroid } = deriveGeometry(square(-75.57, 6.25, 0.0009));
    expect(areaHa).toBeGreaterThan(0.9);
    expect(areaHa).toBeLessThan(1.1);
    expect(centroid.coordinates[0]).toBeCloseTo(-75.56955, 4);
  });

  it('rejects self-intersecting (bow-tie) polygons', () => {
    const bowTie = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ] as [number, number][],
      ],
    };
    expect(() => deriveGeometry(bowTie)).toThrow(DomainError);
  });

  it('rejects absurdly large fields', () => {
    expect(() => deriveGeometry(square(-75, 5, 5))).toThrow(/exceeds/);
  });
});

describe('bboxToPolygon', () => {
  it('builds a closed ring', () => {
    const ring = bboxToPolygon([0, 0, 1, 1]).coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
});
