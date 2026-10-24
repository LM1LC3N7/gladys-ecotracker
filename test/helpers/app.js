// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted reader and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { EcoTrackerApp } from '../../src/app.js';
import { buildDevice, capabilitiesOf } from '../../src/devices.js';
import { ReaderClient } from '../../src/ecotracker/client.js';
import { deviceKey, parseData } from '../../src/ecotracker/model.js';
import { createMemoryStore } from '../../src/store.js';
import { ADDRESS, NOW, eco, json } from '../fixtures/ecotracker.js';
import { createFetch, timeoutError } from './fakeNet.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'ecotracker';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** The external id of a feature of the reader with this serial (undefined: none). */
export const F = (key, serial) => `ext:${SELECTOR}:ecotracker:${deviceKey(serial)}:${key}`;
export const D = (serial) => `ext:${SELECTOR}:ecotracker:${deviceKey(serial)}`;
export const CONFIG = { address: ADDRESS };

/** The device as the user created it from `answer`, the index Gladys holds when given. */
export function created({ index, answer = eco() } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const reading = parseData(answer);
  const device = buildDevice(
    gladys,
    deviceKey(reading.serial),
    reading.serial,
    capabilitiesOf(reading),
    ADDRESS,
  );
  if (index) {
    const feature = device.features.find(
      (f) => f.external_id === F('consumption_index', reading.serial),
    );
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

/**
 * The reader: `world(t)` -> an answer object | 'timeout' | a Response. A live
 * reader: `powerAvg` moves by 1 W from one read to the next (as a real
 * average does), unless `moving` is false (a frozen reading).
 */
export function createReader(world = () => eco(), { moving = true } = {}) {
  const reader = { world, moving, clock: { now: NOW } };
  reader.net = createFetch(() => {
    const answer = reader.world(reader.clock.now);
    if (answer === 'timeout') throw timeoutError();
    if (answer instanceof Response) return answer;
    if (reader.moving && typeof answer.powerAvg === 'number') {
      return json({ ...answer, powerAvg: answer.powerAvg + (reader.net.calls.length % 2) });
    }
    return json(answer);
  });
  return reader;
}

export async function setup({
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  reader = createReader(),
  config = CONFIG,
  monotonicOffset = 0,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const { clock, timers, advance } = createFakeClock(now);
  reader.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const wall = { offset: 0 };
  // A monotonic clock that moves at every call, as a real one does (review
  // r1, point 1): two reads of it in one decision are never equal.
  let lastMono = -Infinity;
  const monotonic = () => {
    lastMono = Math.max(lastMono + 0.001, clock.now + monotonicOffset);
    return lastMono;
  };
  const app = new EcoTrackerApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    now: () => clock.now + wall.offset,
    monotonic,
    timers,
    store,
    clientFactory: (options) => new ReaderClient({ ...options, fetchImpl: reader.net.fetch }),
  });
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  // A real clock moves between two calls: a read due at 10 s is due a few
  // microseconds later. Each wait goes 1 ms further, so that it is reached.
  const wait = async (ms) => {
    await advance(ms + 1);
    await app.idle();
  };
  return { app, gladys, clock, store, reader, start, wait, advance, lines, wall };
}
