import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { buildApp } from '../src/app.js';
import type { AiClient } from '../src/clients/ai-client.js';
import { loadConfig } from '../src/config.js';
import type { Polygon, VegetationAnalysis } from '../src/domain/field.js';
import {
  MongoFieldRepository,
  MongoObservationRepository,
  ensureIndexes,
} from '../src/repositories/mongo.js';
import type { FieldRepository, ObservationRepository } from '../src/repositories/types.js';
import { FieldService } from '../src/services/field-service.js';
import { InMemoryFieldRepository, InMemoryObservationRepository } from './in-memory-repos.js';

export class FakeAiClient implements AiClient {
  calls = 0;
  next: VegetationAnalysis | Error = {
    vegetationCoverage: 0.8,
    stressRatio: 0.05,
    exgMean: 0.21,
    health: 'healthy',
  };
  async analyzeVegetation(): Promise<VegetationAnalysis> {
    this.calls++;
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

export interface TestCtx {
  app: FastifyInstance;
  ai: FakeAiClient;
  backend: 'mongo' | 'memory';
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Same API suite, two backends: in-memory by default; real MongoDB when MONGO_TEST_URI is set
 * (CI runs a mongo:8 service container), which exercises 2dsphere indexes and geo operators.
 */
export async function setup(): Promise<TestCtx> {
  const ai = new FakeAiClient();
  let fields: FieldRepository;
  let observations: ObservationRepository;
  let reset: () => Promise<void>;
  let teardown = async () => {};
  const uri = process.env.MONGO_TEST_URI;

  if (uri) {
    const client = await new MongoClient(uri).connect();
    const db = client.db(`agrolens_test_${process.pid}`);
    await ensureIndexes(db);
    fields = new MongoFieldRepository(db);
    observations = new MongoObservationRepository(db);
    reset = async () => void (await db.collection('fields').deleteMany({}));
    teardown = async () => {
      await db.dropDatabase();
      await client.close();
    };
  } else {
    const mem = new InMemoryFieldRepository();
    fields = mem;
    observations = new InMemoryObservationRepository();
    reset = async () => mem.clear();
  }

  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', MAX_UPLOAD_BYTES: '100000' }),
    service: new FieldService(fields, observations, ai),
    isReady: async () => (await fields.ping(), true),
  });
  return {
    app,
    ai,
    backend: uri ? 'mongo' : 'memory',
    reset,
    close: async () => {
      await app.close();
      await teardown();
    },
  };
}

/** ~1 ha square near Medellín. */
export const square = (lng = -75.57, lat = 6.25, d = 0.0009): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
});

export const TENANT = { 'x-tenant-id': 'farm-a' };
