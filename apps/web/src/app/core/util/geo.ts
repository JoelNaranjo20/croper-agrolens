import type { LngLat } from '../api/models';

const EARTH_RADIUS_M = 6_378_137;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Geodesic area of a closed ring in hectares (spherical excess approximation, same formula
 * as Turf/Leaflet.draw). Used only for instant UI feedback while drawing — the server
 * recomputes the authoritative value.
 */
export function ringAreaHa(ring: LngLat[]): number {
  const n = ring.length;
  if (n < 4) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = ring[i]!;
    const [lng2, lat2] = ring[i + 1]!;
    total += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2) / 10_000;
}

/** Ensures first === last, as GeoJSON requires. */
export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length === 0) return ring;
  const [f, l] = [ring[0]!, ring[ring.length - 1]!];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
}
