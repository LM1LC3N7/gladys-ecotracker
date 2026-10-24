// -----------------------------------------------------------------------------
// The app end to end against the SDK's fake Gladys, a scripted reader and a
// virtual clock: discovery, states, the guarded index and its two-click
// acceptance, the pace, late answers, identity, freshness, pauses, buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { ADDRESS, NOW, SERIAL, eco, json } from './fixtures/ecotracker.js';
import { CONFIG, D, F, HOUR, MINUTE, SECOND, created, createReader, setup } from './helpers/app.js';

const statesOf = (gladys, key, serial) =>
  gladys.fake.states
    .filter((s) => s.device_feature_external_id === F(key, serial))
    .map((s) => s.state);

const status = (s) => s.gladys.fake.connectionStatus.message.en;

/** Every call of publishChangedStates, its states (the heartbeat included). */
function spy(gladys) {
  const calls = [];
  const original = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = (states, options) => {
    calls.push(states.map((s) => s.device_feature_external_id.split(':').at(-1)));
    return original(states, options);
  };
  return calls;
}

test('without a device: the reader is offered in Discovery, the status says so', async () => {
  const s = await setup();
  await s.start();
  const [device] = s.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, D(undefined));
  assert.equal(device.external_id, 'ext:ecotracker:ecotracker:reader');
  assert.equal(device.name, 'EcoTracker');
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys, [
    'power',
    'consumption_index',
    'consumption_t1',
    'consumption_t2',
    'injection_index',
    'power_avg',
    'power_l1',
    'power_l2',
    'power_l3',
  ]);
  const index = device.features.find((f) => f.external_id === F('consumption_index'));
  assert.equal(index.category, 'energy-sensor');
  assert.equal(index.type, 'index');
  assert.equal(index.unit, 'kilowatt-hour');
  const injection = device.features.find((f) => f.external_id === F('injection_index'));
  assert.equal(injection.category, 'unknown', 'the injection is never an energy index');
  assert.equal(s.gladys.fake.connectionStatus.connected, true);
  assert.match(status(s), /create its device/);
  assert.match(status(s), /no serial number/);
  assert.equal(s.gladys.fake.states.length, 0);
});

test('a created device: live values every 10 s, the indexes once a minute', async () => {
  let kwh = 9000;
  const reader = createReader(() => eco({ kwh, w: 400 }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  // The first reading of a fresh start, not yet seen moving: the live
  // values wait for the next one.
  assert.deepEqual(statesOf(s.gladys, 'power'), []);
  assert.match(status(s), /once the reading is seen moving/);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.deepEqual(statesOf(s.gladys, 'consumption_t1'), [5400]);
  assert.deepEqual(statesOf(s.gladys, 'injection_index'), [1500]);
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [400]);
  assert.deepEqual(statesOf(s.gladys, 'power_l1'), [200]);
  kwh = 9000.01;
  await s.wait(40 * SECOND);
  assert.equal(reader.net.calls.length, 6, 'one read every 10 s');
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000], 'not before a minute');
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000, 9000.01]);
  assert.match(status(s), /^Connected/);
  assert.equal(s.gladys.fake.sceneEvents.length, 0);
});

test('a recent agePower: the live values are sent at the first read', async () => {
  const reader = createReader(() => eco({ w: 250, extra: { agePower: 400 } }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'power'), [250]);
});

test('an old agePower: the live values are not sent, the status says so', async () => {
  const reader = createReader(() => eco({ w: 250, extra: { agePower: 5 * MINUTE } }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  await s.wait(MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'power'), []);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.match(status(s), /measured 5 min ago/);
  reader.world = () => eco({ w: 260, extra: { agePower: 300 } });
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [260]);
});

test('the index: never 0, a jump held, accepted only in two clicks', async () => {
  let answer = eco({ kwh: 9000 });
  const reader = createReader(() => answer);
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  answer = eco({ kwh: 0 });
  await s.wait(MINUTE);
  answer = eco({ kwh: 19_000 });
  await s.wait(MINUTE);
  await s.wait(MINUTE);
  const published = statesOf(s.gladys, 'consumption_index');
  assert.ok(!published.includes(0));
  assert.ok(!published.includes(19_000));
  assert.match(status(s), /a jump from 9000 to 19000 kWh \(10000 kWh\)/);
  assert.equal(s.store.data.indexes[F('consumption_index')].held.to, 19_000);
  // First click: listed, nothing accepted.
  const first = await s.app.acceptHeldIndex();
  assert.match(first.en, /Nothing is accepted yet/);
  assert.match(first.en, /at most 4\.667 kWh/);
  await s.wait(10 * SECOND);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(19_000));
  // Second click.
  const second = await s.app.acceptHeldIndex();
  assert.match(second.en, /^Accepted: the index 19000 kWh/);
  await s.wait(10 * SECOND);
  assert.equal(statesOf(s.gladys, 'consumption_index').at(-1), 19_000);
  assert.doesNotMatch(status(s), /a jump from/);
  assert.equal(
    (await s.app.acceptHeldIndex()).en,
    'No consumption index is held back: nothing to accept.',
  );
});

test('two clicks: a double click only lists, 5 min later lists again', async () => {
  const reader = createReader(() => eco({ kwh: 19_000 }));
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  await s.app.acceptHeldIndex();
  await s.wait(SECOND);
  assert.match((await s.app.acceptHeldIndex()).en, /Nothing is accepted yet/);
  await s.wait(6 * MINUTE);
  assert.match((await s.app.acceptHeldIndex()).en, /Nothing is accepted yet/);
  await s.wait(2 * MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(19_000));
});

test('two clicks: a value that grew beyond the margin, or another movement, is not taken', async () => {
  let kwh = 19_000;
  const reader = createReader(() => eco({ kwh }));
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  await s.app.acceptHeldIndex();
  kwh = 19_100;
  await s.wait(MINUTE);
  const refused = await s.app.acceptHeldIndex();
  assert.match(refused.en, /^Not accepted: the held value changed/);
  await s.wait(2 * MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').some((v) => v > 9000));
  // A drop listed, then a jump held: not the movement listed.
  kwh = 500;
  await s.wait(MINUTE);
  assert.match(status(s), /a drop from 9000 to 500 kWh/);
  await s.app.acceptHeldIndex();
  kwh = 30_000;
  await s.wait(MINUTE);
  assert.match((await s.app.acceptHeldIndex()).en, /^Not accepted/);
  await s.wait(2 * MINUTE);
  assert.deepEqual([...new Set(statesOf(s.gladys, 'consumption_index'))], [9000]);
});

test('two clicks: a value that grew within the margin is taken, and nothing more', async () => {
  let kwh = 19_000;
  const reader = createReader(() => eco({ kwh }));
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  await s.app.acceptHeldIndex();
  kwh = 19_000.2;
  await s.wait(MINUTE);
  assert.match((await s.app.acceptHeldIndex()).en, /^Accepted: the index 19000\.2 kWh/);
  await s.wait(MINUTE);
  assert.equal(statesOf(s.gladys, 'consumption_index').at(-1), 19_000.2);
});

test('a held index survives a restart; saving the configuration accepts nothing', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => eco({ kwh: 500 }));
  const device = created({ index: { value: 9000, at: NOW - MINUTE } });
  let s = await setup({ devices: [device], reader, store });
  await s.start();
  await s.app.start(CONFIG);
  await s.wait(MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
  await s.app.stop();
  s = await setup({ devices: [device], reader, store, now: s.clock.now + MINUTE });
  await s.start();
  assert.match(status(s), /a drop from 9000 to 500 kWh/);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
});

test('the guard is in /data before Gladys gets the index; a failed write sends none', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => eco({ kwh: 9000 }));
  const s = await setup({ devices: [created()], reader, store });
  const save = store.save.bind(store);
  store.save = async () => {
    throw Object.assign(new Error('disk'), { code: 'EROFS' });
  };
  await s.start();
  await s.wait(MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), []);
  store.save = save;
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.equal(store.data.indexes[F('consumption_index')].last.value, 9000);
});

test('the pace: never two reads less than 10 s apart, whatever asks', async () => {
  const store = createMemoryStore();
  const reader = createReader();
  const s = await setup({ reader, store });
  await s.start();
  assert.equal(reader.net.calls.length, 1);
  await s.app.start(CONFIG);
  await s.app.scan();
  await s.app.start(await s.gladys.getConfig());
  await s.app.onDeviceCreated(created());
  const test1 = await s.app.testConnection();
  assert.match(test1.en, /Last read .* ago.*Next read in 10 s/);
  await s.wait(5 * SECOND);
  assert.equal(reader.net.calls.length, 1, 'a reconnection, a save, a scan, the test: no read');
  await s.wait(5 * SECOND);
  assert.equal(reader.net.calls.length, 2);
  // A restart of the container 2 s after a read: the time is in /data.
  await s.app.stop();
  const again = await setup({ reader, store, now: s.clock.now + 2 * SECOND });
  await again.start();
  assert.equal(reader.net.calls.length, 2);
  await again.wait(8 * SECOND);
  assert.equal(reader.net.calls.length, 3);
});

test('/data: the time of the last read and the freshness at most once a minute', async () => {
  const store = createMemoryStore();
  let writes = 0;
  const save = store.save.bind(store);
  store.save = (data) => {
    writes += 1;
    return save(data);
  };
  const reader = createReader(() => eco({ extra: { agePower: 100 } }));
  const s = await setup({ devices: [created()], reader, store });
  await s.start();
  writes = 0;
  await s.wait(10 * MINUTE);
  assert.equal(reader.net.calls.length, 61);
  // The guard (once a minute), the time of the read and the freshness: 3 a minute at most.
  assert.ok(writes <= 31, `${writes} writes in 10 minutes`);
});

test('a clean stop writes /data at once, waits at most 5 s for the read running', async () => {
  const store = createMemoryStore();
  const reader = createReader();
  const s = await setup({ devices: [created()], reader, store });
  await s.start();
  await s.wait(30 * SECOND);
  reader.net.hold = true;
  const running = s.advance(10 * SECOND);
  await new Promise((resolve) => setImmediate(resolve));
  const last = s.clock.now;
  let done = false;
  const stopping = s.app.stop().then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.data.lastAttemptAt, last, 'written before waiting');
  await s.advance(4 * SECOND);
  assert.equal(done, false);
  await s.advance(2 * SECOND);
  await stopping;
  assert.equal(done, true);
  reader.net.hold = false;
  reader.net.release();
  await running;
});

test('every connection publishes the status and the Discovery list again', async () => {
  const s = await setup();
  await s.start();
  const statuses = s.gladys.fake.connectionStatuses.length;
  const discoveries = s.gladys.fake.bodies('POST', '/discovered_device').length;
  // What index.js does on every `connected`.
  await s.app.start(await s.gladys.getConfig());
  await s.app.idle();
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(s.gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('a late answer of an old address publishes nothing and sets no status', async () => {
  const reader = createReader(() => eco({ kwh: 9000, w: 999, extra: { agePower: 1 } }));
  const s = await setup({ devices: [created()], reader });
  reader.net.hold = true;
  await s.app.start(CONFIG);
  // Not awaited: the timer runs the read, which waits for the held answer.
  const running = s.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reader.net.calls.length, 1);
  await s.app.start({ address: '192.168.1.71' });
  const statuses = s.gladys.fake.connectionStatuses.length;
  reader.net.hold = false;
  reader.net.release();
  await running;
  await s.app.idle();
  assert.deepEqual(statesOf(s.gladys, 'power'), []);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), []);
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses);
});

test('a reader with a serial number: its own device; another serial never writes into it', async () => {
  let serial = SERIAL;
  const reader = createReader(() => eco({ serial, w: 100, extra: { agePower: 1 } }));
  const s = await setup({ devices: [created({ answer: eco({ serial: SERIAL }) })], reader });
  await s.start();
  assert.equal(s.gladys.fake.discoveredDevices[0].name, `EcoTracker ${SERIAL}`);
  assert.deepEqual(statesOf(s.gladys, 'power', SERIAL), [100]);
  assert.equal(s.store.data.deviceKey, 'sn-et1234567');
  serial = 'ET7654321';
  reader.world = () => eco({ serial, w: 777, extra: { agePower: 1 } });
  await s.wait(30 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power', SERIAL), [100], 'never into the old device');
  assert.equal(s.gladys.fake.discoveredDevices[0].external_id, D('ET7654321'));
  assert.match(status(s), /Another reader answers at this address \(ET7654321\)/);
  // The first reader back, with its device: the note ends.
  reader.world = () => eco({ serial: SERIAL, w: 200, extra: { agePower: 1 } });
  await s.wait(10 * SECOND);
  assert.doesNotMatch(status(s), /Another reader/);
  assert.deepEqual(statesOf(s.gladys, 'power', SERIAL), [100, 200]);
});

test('an answer without serial after a reader with one is not used; /data untouched', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => eco({ serial: SERIAL, kwh: 9000, extra: { agePower: 1 } }));
  const device = created({ answer: eco({ serial: SERIAL }) });
  const s = await setup({ devices: [device], reader, store });
  await s.start();
  reader.world = () => eco({ kwh: 9000.5, w: 900, extra: { agePower: 1 } });
  await s.wait(2 * MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'power', SERIAL), [350]);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index', SERIAL), [9000]);
  assert.deepEqual(statesOf(s.gladys, 'power', undefined), []);
  assert.equal(store.data.deviceKey, 'sn-et1234567');
  assert.equal(store.data.serial, SERIAL);
  assert.match(status(s), /no longer gives a serial number/);
  assert.match((await s.app.testConnection()).en, /no longer gives a serial number/);
  // The user deletes the device of the old reader: the reader without number gets its own.
  s.gladys.devices.splice(0, s.gladys.devices.length);
  await s.wait(10 * SECOND);
  assert.equal(s.gladys.fake.discoveredDevices[0].external_id, D(undefined));
  assert.equal(store.data.deviceKey, 'reader');
});

test('an unreadable serial is never another reader; retries are doubled', async () => {
  const reader = createReader(() => eco({ serial: '??' }));
  const store = createMemoryStore({ deviceKey: 'sn-et1234567', serial: SERIAL, keys: ['power'] });
  const s = await setup({ devices: [created({ answer: eco({ serial: SERIAL }) })], reader, store });
  await s.start();
  assert.equal(s.gladys.fake.connectionStatus.connected, false);
  assert.match(status(s), /serial number that cannot be read/);
  assert.equal(s.gladys.fake.discoveredDevices[0].external_id, D(SERIAL));
  assert.deepEqual(s.gladys.fake.states, []);
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 2);
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 2, 'the second retry waits 20 s');
  await s.wait(10 * SECOND);
  assert.equal(reader.net.calls.length, 3);
  assert.equal(store.data.deviceKey, 'sn-et1234567');
});

test('not an EcoTracker answer: red status, nothing published', async () => {
  const reader = createReader(() => json({ hello: 'world' }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  assert.equal(s.gladys.fake.connectionStatus.connected, false);
  assert.match(status(s), /not an EcoTracker answer/);
  assert.deepEqual(s.gladys.fake.states, []);
});

test('429: a pause kept in /data, never a read during it, even after a restart', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => json('', { status: 429, headers: { 'retry-after': '600' } }));
  const s = await setup({ reader, store });
  await s.start();
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.equal(store.data.pause.due, undefined, 'the monotonic end stays in memory');
  assert.match(status(s), /asks to wait/);
  await s.wait(5 * MINUTE);
  assert.equal(reader.net.calls.length, 1);
  await s.app.stop();
  const again = await setup({ reader, store, now: s.clock.now });
  await again.start();
  await again.wait(4 * MINUTE);
  assert.equal(reader.net.calls.length, 1);
  await again.wait(2 * MINUTE);
  assert.equal(reader.net.calls.length, 2);
});

test('a pause runs on the monotonic clock: a wall clock set back never stretches it', async () => {
  const reader = createReader(() => json('', { status: 503 }));
  const s = await setup({ reader });
  await s.start();
  assert.equal(reader.net.calls.length, 1);
  reader.world = () => eco();
  s.wall.offset = -3 * 24 * HOUR;
  await s.wait(61 * SECOND);
  assert.equal(reader.net.calls.length, 2);
  assert.match(status(s), /^EcoTracker found|^Connected/);
});

test('a pause read back from /data is capped to 6 h', async () => {
  const store = createMemoryStore({
    pause: { until: NOW + 400 * 24 * HOUR, count: 3, code: 'server', status: 503 },
  });
  const reader = createReader();
  const s = await setup({ reader, store });
  await s.start();
  assert.equal(reader.net.calls.length, 0);
  await s.wait(6 * HOUR + SECOND);
  assert.equal(reader.net.calls.length, 1);
});

test('frozen values: the live values stop after 15 min, the index goes on', async () => {
  const reader = createReader(() => eco({ w: 300 }), { moving: false });
  const s = await setup({ devices: [created()], reader });
  const calls = spy(s.gladys);
  await s.start();
  reader.world = () => eco({ w: 301 });
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [301]);
  await s.wait(20 * MINUTE);
  const late = calls.slice(-5);
  assert.ok(
    late.every((keys) => !keys.includes('power')),
    'no power sent, no heartbeat',
  );
  assert.ok(
    late.some((keys) => keys.includes('consumption_index')),
    'the index goes on',
  );
  assert.match(status(s), /have not changed for 15 min|have not changed for 20 min/);
  reader.world = () => eco({ w: 302 });
  await s.wait(10 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [301, 302]);
  assert.doesNotMatch(status(s), /have not changed/);
});

test('a reading frozen before a restart is never published as new', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => eco({ w: 300 }), { moving: false });
  const device = created();
  const s = await setup({ devices: [device], reader, store });
  await s.start();
  reader.world = () => eco({ w: 3000 });
  await s.wait(20 * MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'power'), [3000]);
  await s.app.stop();
  assert.ok(store.data.fresh && /^[0-9a-f]{16}$/.test(store.data.fresh.hash));
  // Restarted 30 s later, the reading still frozen: nothing live is sent.
  const again = await setup({ devices: [device], reader, store, now: s.clock.now + 30 * SECOND });
  await again.start();
  await again.wait(MINUTE);
  assert.deepEqual(statesOf(again.gladys, 'power'), []);
  assert.match(status(again), /have not changed for 2[01] min/);
  // Frozen at values never kept: not sent until they move.
  await again.app.stop();
  reader.world = () => eco({ w: 2500 });
  const third = await setup({ devices: [device], reader, store, now: again.clock.now + MINUTE });
  await third.start();
  await third.wait(MINUTE);
  assert.deepEqual(statesOf(third.gladys, 'power'), []);
  reader.world = () => eco({ w: 400 });
  await third.wait(10 * SECOND);
  assert.deepEqual(statesOf(third.gladys, 'power'), [400]);
});

test('a counter not usable is told in the status, even before any index', async () => {
  const reader = createReader(() => ({ power: 1, energyCounterIn: 'n/a' }));
  const s = await setup({ reader });
  await s.start();
  assert.match(status(s), /no usable consumption counter/);
  const keys = s.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(!keys.includes(F('consumption_index')));
});

test('no power (PIN-locked meter): the indexes go on, the status says so', async () => {
  const reader = createReader(() => ({ energyCounterIn: 9_000_000 }));
  const s = await setup({ devices: [created()], reader });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.match(status(s), /PIN-locked/);
  // The device published again keeps every feature it was created with.
  const keys = s.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(keys.includes(F('power')) && keys.includes(F('power_l3')));
});

test('a device created again starts without the old index state', async () => {
  const store = createMemoryStore();
  const reader = createReader(() => eco({ kwh: 500 }));
  const device = created({ index: { value: 9000, at: NOW - MINUTE } });
  const s = await setup({ devices: [device], reader, store });
  await s.start();
  assert.match(status(s), /a drop/);
  const fresh = created();
  s.gladys.devices.splice(0, 1, fresh);
  await s.app.onDeviceCreated(fresh);
  assert.equal(store.data.indexes[F('consumption_index')], undefined);
  await s.wait(MINUTE);
  assert.equal(statesOf(s.gladys, 'consumption_index').at(-1), 500);
  assert.doesNotMatch(status(s), /a drop from/);
});

test('a bad address is told; an empty one asks for it', async () => {
  const s = await setup();
  await s.start();
  await s.app.start({ address: 'http://user:pw@host/' });
  assert.match(status(s), /not valid/);
  await s.app.start({});
  assert.match(status(s), /Enter the address/);
  assert.match((await s.app.testConnection()).en, /Enter the address/);
});

test('the test button reads when a read is due, and tells it', async () => {
  const s = await setup({ config: { address: ADDRESS } });
  const reader = s.reader;
  await s.start();
  assert.match((await s.app.testConnection()).en, /^Last read .*Next read in 10 s/);
  // The clock moves without the timer firing: the click finds a read due.
  s.clock.now += 10 * SECOND;
  const answer = await s.app.testConnection();
  assert.match(answer.en, /^Read now: EcoTracker, net power 350 W, consumption index 9000 kWh/);
  assert.equal(reader.net.calls.length, 2);
});

test('the test button tells a held index as held', async () => {
  const reader = createReader(() => eco({ kwh: 900_000 }));
  const s = await setup({
    devices: [created({ index: { value: 9000, at: NOW - MINUTE } })],
    reader,
  });
  await s.start();
  assert.match((await s.app.testConnection()).en, /900000 kWh \(held back\)/);
});
