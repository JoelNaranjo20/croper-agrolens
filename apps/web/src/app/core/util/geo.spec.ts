import { closeRing, ringAreaHa } from './geo';

describe('geo utils', () => {
  it('computes ~1 ha for a 100 m square near the equator', () => {
    const d = 0.000898; // ≈100 m in degrees at lat 6°
    const ring: [number, number][] = [
      [-75.57, 6.25],
      [-75.57 + d, 6.25],
      [-75.57 + d, 6.25 + d],
      [-75.57, 6.25 + d],
      [-75.57, 6.25],
    ];
    expect(ringAreaHa(ring)).toBeGreaterThan(0.95);
    expect(ringAreaHa(ring)).toBeLessThan(1.05);
  });

  it('returns 0 for degenerate rings', () => {
    expect(
      ringAreaHa([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBe(0);
  });

  it('closes open rings and leaves closed rings intact', () => {
    expect(
      closeRing([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    const closed: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 0],
    ];
    expect(closeRing(closed)).toBe(closed);
  });
});
