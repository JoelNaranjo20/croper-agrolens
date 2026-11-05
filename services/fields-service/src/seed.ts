/* eslint-disable no-console */
/**
 * Seeds demo fields around Antioquia (Colombia) for the "demo" tenant.
 * Safe to run on every start: skips if the tenant already has data, unless `--force`
 * (which replaces the demo data).
 */
import { MongoClient } from 'mongodb';
import { loadConfig } from './config.js';
import type { Crop, Polygon } from './domain/field.js';
import { deriveGeometry } from './domain/geo.js';
import { MongoFieldRepository, ensureIndexes } from './repositories/mongo.js';

const TENANT = 'demo';

/** Small irregular quadrilateral around a centre point (~sizeDeg wide). */
function plot(lng: number, lat: number, sizeDeg: number, skew = 0.2): Polygon {
  const s = sizeDeg / 2;
  const ring: [number, number][] = [
    [lng - s, lat - s],
    [lng + s, lat - s * (1 - skew)],
    [lng + s * (1 - skew), lat + s],
    [lng - s * (1 + skew / 2), lat + s * (1 - skew)],
  ];
  ring.push(ring[0]!);
  return { type: 'Polygon', coordinates: [ring] };
}

const DEMO: { name: string; crop: Crop; lng: number; lat: number; size: number; soilPh: number }[] =
  [
    {
      name: 'Finca La Esperanza — Lote Café 1',
      crop: 'coffee',
      lng: -75.701,
      lat: 5.95,
      size: 0.006,
      soilPh: 5.4,
    },
    {
      name: 'Finca La Esperanza — Lote Café 2',
      crop: 'coffee',
      lng: -75.692,
      lat: 5.947,
      size: 0.005,
      soilPh: 5.6,
    },
    {
      name: 'El Retiro — Aguacate Hass',
      crop: 'avocado',
      lng: -75.503,
      lat: 6.06,
      size: 0.008,
      soilPh: 6.1,
    },
    {
      name: 'La Unión — Papa Capiro',
      crop: 'potato',
      lng: -75.36,
      lat: 5.973,
      size: 0.007,
      soilPh: 5.3,
    },
    {
      name: 'Urabá — Banano Lote Norte',
      crop: 'banana',
      lng: -76.63,
      lat: 7.88,
      size: 0.012,
      soilPh: 6.2,
    },
    {
      name: 'Valle de Aburrá — Maíz Experimental',
      crop: 'maize',
      lng: -75.62,
      lat: 6.33,
      size: 0.004,
      soilPh: 6.4,
    },
    {
      name: 'Magdalena Medio — Cacao Fino',
      crop: 'cocoa',
      lng: -74.66,
      lat: 6.47,
      size: 0.009,
      soilPh: 6.6,
    },
  ];

const config = loadConfig();
const client = await new MongoClient(config.MONGO_URI).connect();
try {
  const db = client.db(config.MONGO_DB);
  await ensureIndexes(db);
  const existing = await db.collection('fields').countDocuments({ tenantId: TENANT });
  if (existing > 0 && !process.argv.includes('--force')) {
    console.log(
      `Tenant "${TENANT}" already has ${existing} fields; skipping (use --force to reset)`,
    );
    process.exit(0);
  }
  await db.collection('fields').deleteMany({ tenantId: TENANT });
  const repo = new MongoFieldRepository(db);
  for (const f of DEMO) {
    const geometry = plot(f.lng, f.lat, f.size);
    await repo.create(TENANT, {
      name: f.name,
      crop: f.crop,
      geometry,
      soilPh: f.soilPh,
      ...deriveGeometry(geometry),
    });
  }
  console.log(`Seeded ${DEMO.length} fields for tenant "${TENANT}"`);
} finally {
  await client.close();
}
