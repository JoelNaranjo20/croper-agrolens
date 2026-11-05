import closeWithGrace from 'close-with-grace';
import { MongoClient } from 'mongodb';
import { buildApp } from './app.js';
import { HttpAiClient } from './clients/ai-client.js';
import { loadConfig } from './config.js';
import {
  MongoFieldRepository,
  MongoObservationRepository,
  ensureIndexes,
} from './repositories/mongo.js';
import { FieldService } from './services/field-service.js';

const config = loadConfig();

const mongo = new MongoClient(config.MONGO_URI, {
  appName: 'agrolens-fields-service',
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5_000,
  retryWrites: true,
});
await mongo.connect();
const db = mongo.db(config.MONGO_DB);
await ensureIndexes(db);

const fields = new MongoFieldRepository(db);
const service = new FieldService(
  fields,
  new MongoObservationRepository(db),
  new HttpAiClient(config.AI_SERVICE_URL, config.AI_TIMEOUT_MS),
);

const app = await buildApp({
  config,
  service,
  isReady: async () => {
    await fields.ping();
    return true;
  },
});

// Graceful shutdown: stop accepting connections, drain in-flight requests, then close the pool.
closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
  if (err) app.log.error({ err }, 'fatal error, shutting down');
  else app.log.info({ signal }, 'shutting down');
  await app.close();
  await mongo.close();
});

await app.listen({ port: config.PORT, host: config.HOST });
