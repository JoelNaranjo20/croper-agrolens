import closeWithGrace from 'close-with-grace';
import { buildGateway } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildGateway({ config });

closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
  if (err) app.log.error({ err }, 'fatal error, shutting down');
  else app.log.info({ signal }, 'shutting down');
  await app.close();
});

await app.listen({ port: config.PORT, host: config.HOST });
