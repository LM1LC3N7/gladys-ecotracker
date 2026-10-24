// -----------------------------------------------------------------------------
// Real clocks sped up 20 times (review r2, point 2): read instants taken where
// the app calls fetch (no network latency in the gaps); the real local server
// only proves the requests arrive. Whatever asks in between adds no read.
// -----------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EcoTrackerApp } from '../src/app.js';
import { ReaderClient } from '../src/ecotracker/client.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { eco } from './fixtures/ecotracker.js';

const SPEED = 20;
const clock = () => performance.now() * SPEED;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms / SPEED));

test('real clock x20: reads at 0, 1 and 2 intervals, whatever asks, few timers', async () => {
  let arrived = 0;
  const server = createServer((req, res) => {
    arrived += 1;
    res.end(JSON.stringify(eco()));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = `127.0.0.1:${server.address().port}`;
  const calls = [];
  let armed = 0;
  const gladys = createFakeGladys({ selector: 'ecotracker', config: { address } });
  await gladys.connect();
  const quiet = () => {};
  const app = new EcoTrackerApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => Date.now() * SPEED,
    monotonic: clock,
    timers: {
      setTimeout: (fn, ms) => {
        armed += 1;
        return setTimeout(fn, Math.max(0, ms) / SPEED);
      },
      clearTimeout: (id) => clearTimeout(id),
    },
    store: createMemoryStore(),
    clientFactory: (o) =>
      new ReaderClient({
        ...o,
        fetchImpl: (...args) => {
          calls.push(clock());
          return fetch(...args);
        },
      }),
  });
  const started = clock();
  try {
    await app.start({ address });
    const until = started + 2.5 * POLL_INTERVAL;
    while (clock() < until) {
      await app.testConnection();
      await app.scan();
      await app.start({ address });
      await sleep(500);
    }
  } finally {
    await app.stop();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const at = calls.map((t) => Math.round(t - started));
  assert.equal(calls.length, 3, `reads at ${at}`);
  assert.equal(arrived, 3, 'every read reached the server');
  assert.ok(calls[0] - started < POLL_INTERVAL / 2, `the first read at once: ${at}`);
  for (let i = 1; i < calls.length; i += 1) {
    const gap = calls[i] - calls[i - 1];
    assert.ok(gap >= 0.95 * POLL_INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * POLL_INTERVAL, `on time: ${at}`);
  }
  assert.ok(armed < 150, `${armed} timers`);
});
