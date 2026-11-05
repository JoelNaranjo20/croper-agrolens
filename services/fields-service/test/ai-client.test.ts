import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpAiClient } from '../src/clients/ai-client.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function stub(status: number, body: unknown, delayMs = 0): Promise<string> {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () =>
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delayMs),
    );
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const ok = {
  vegetationCoverage: 0.5,
  stressRatio: 0.1,
  exgMean: 0.1,
  health: 'moderate',
  analyzedWidth: 10,
  analyzedHeight: 10,
};

describe('HttpAiClient', () => {
  it('parses a valid response', async () => {
    const c = new HttpAiClient(await stub(200, ok), 1000);
    await expect(c.analyzeVegetation(Buffer.from('x'), 'image/jpeg')).resolves.toMatchObject({
      health: 'moderate',
    });
  });

  it('maps 422 to UPSTREAM_REJECTED', async () => {
    const c = new HttpAiClient(await stub(422, { title: 'bad image' }), 1000);
    await expect(c.analyzeVegetation(Buffer.from('x'), 'image/jpeg')).rejects.toMatchObject({
      code: 'UPSTREAM_REJECTED',
      message: 'bad image',
    });
  });

  it('maps 5xx to UPSTREAM_UNAVAILABLE', async () => {
    const c = new HttpAiClient(await stub(500, {}), 1000);
    await expect(c.analyzeVegetation(Buffer.from('x'), 'image/jpeg')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('times out', async () => {
    const c = new HttpAiClient(await stub(200, ok, 500), 50);
    await expect(c.analyzeVegetation(Buffer.from('x'), 'image/jpeg')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('rejects contract drift', async () => {
    const c = new HttpAiClient(await stub(200, { health: 'great' }), 1000);
    await expect(c.analyzeVegetation(Buffer.from('x'), 'image/jpeg')).rejects.toThrow();
  });
});
