// -----------------------------------------------------------------------------
// Real clocks and real timers against a real local HTTP server (review r1,
// point 1): a fresh install reads at once, then every 10 s, with a handful of
// timers; whatever asks in between never adds a read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EcoTrackerApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { eco } from './fixtures/ecotracker.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('real clock: reads at 0, 10 and 20 s, few timers, nothing faster', async () => {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(performance.now());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(eco()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `127.0.0.1:${server.address().port}`;
  const gladys = createFakeGladys({ selector: 'ecotracker', config: { address } });
  await gladys.connect();
  let armed = 0;
  const timers = {
    setTimeout: (fn, ms) => {
      armed += 1;
      return setTimeout(fn, ms);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const quiet = () => {};
  const app = new EcoTrackerApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    timers,
    store: createMemoryStore(),
  });
  const started = performance.now();
  try {
    await app.start({ address });
    await sleep(1000);
    assert.equal(hits.length, 1, 'a fresh install reads within 1 s');
    assert.ok(hits[0] - started < 1000);
    await sleep(1000);
    assert.ok(armed < 10, `${armed} timers armed in 2 s`);
    // Whatever asks in between: never a read sooner than the interval.
    const deadline = started + 24_000;
    while (performance.now() < deadline) {
      await app.testConnection();
      await app.scan();
      await app.start({ address });
      await sleep(500);
    }
    assert.equal(hits.length, 3, `reads at ${hits.map((t) => Math.round(t - started))}`);
    assert.ok(hits[1] - hits[0] >= 9_950 && hits[2] - hits[1] >= 9_950);
    assert.ok(hits[1] - hits[0] < 11_000, 'the next read comes at its time');
    // (The server sees a request a few ms after the read starts: 50 ms of slack.)
    assert.ok(armed < 200, `${armed} timers armed in 24 s`);
  } finally {
    await app.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
