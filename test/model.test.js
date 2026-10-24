// -----------------------------------------------------------------------------
// The data page parsed as the ecotracker library reads it, with the units of
// the published API (Wh) and our stricter rules: types, bounds, nothing read
// as 0 by default, a strict serial number.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceKey,
  fingerprintOf,
  numberOf,
  parseData,
  serialOf,
} from '../src/ecotracker/model.js';
import { REAL, REAL_TEXT, SERIAL, SPEC, WITH_SERIAL } from './fixtures/ecotracker.js';

test('the example of the published API: Wh to kWh, powers in W, tariffs', () => {
  const r = parseData(SPEC);
  assert.equal(r.imports.total, 145);
  assert.equal(r.imports.t1, 100);
  assert.equal(r.imports.t2, 45);
  assert.equal(r.exportTotal, 4.5);
  assert.equal(r.power, 125);
  assert.equal(r.powerAvg, 100);
  assert.deepEqual(r.phases, [50, 50, 25]);
  assert.equal(r.serial, undefined);
  assert.equal(r.serialState, 'absent');
  assert.equal(r.rssi, undefined);
  assert.equal(r.agePower, undefined);
  assert.equal(r.indexRefused, false);
});

test('a real answer: injecting (negative), no tariff, agePower, tabs', () => {
  const r = parseData(JSON.parse(REAL_TEXT));
  assert.deepEqual(r, parseData(REAL));
  assert.equal(r.power, -3127);
  assert.deepEqual(r.phases, [-1025, -1176, -925]);
  assert.equal(r.imports.total, 1541.618);
  assert.equal(r.exportTotal, 5552.928);
  assert.equal(r.imports.t1, undefined);
  assert.equal(r.agePower, 496);
});

test('the fields of the library: serial, rssi', () => {
  const r = parseData(WITH_SERIAL);
  assert.equal(r.serial, SERIAL);
  assert.equal(r.serialState, 'ok');
  assert.equal(r.rssi, -61);
  assert.equal(deviceKey(r.serial), 'sn-et1234567');
  assert.equal(deviceKey(undefined), 'reader');
});

test('a serial is strict: never a prototype key, an address, only zeros or junk', () => {
  assert.deepEqual(serialOf(undefined), { absent: true });
  assert.deepEqual(serialOf(null), { absent: true });
  assert.deepEqual(serialOf(''), { absent: true });
  assert.deepEqual(serialOf(' AB12345 '), { serial: 'AB12345' });
  assert.deepEqual(serialOf(1234567), { serial: '1234567' });
  for (const bad of [
    '__proto__',
    'constructor',
    'reader',
    '0000000',
    '192.168.1.70',
    'a:b:c1',
    'AB 123',
    'x'.repeat(70),
    'é12345',
    'AB\n123',
    0,
    -5,
    1.5,
    {},
    [],
    true,
  ]) {
    assert.deepEqual(serialOf(bad), { unreadable: true }, JSON.stringify(bad));
  }
  assert.equal(parseData({ ...SPEC, serial: '__proto__' }).serialState, 'unreadable');
});

test('numbers: a JSON number or a plain decimal string, never 0 by default', () => {
  assert.equal(numberOf(12.5), 12.5);
  assert.equal(numberOf(' 12.5 '), 12.5);
  assert.equal(numberOf('-3'), -3);
  for (const bad of ['', ' ', '1e3', '0x10', 'NaN', 'Infinity', '12 W', null, true, [], {}]) {
    assert.equal(numberOf(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(numberOf(Number.NaN), undefined);
});

test('the index: never 0, never below 0, never out of bounds; told when refused', () => {
  for (const raw of [0, -5, '', 'x', null, 1e30, '0']) {
    const r = parseData({ ...SPEC, energyCounterIn: raw });
    assert.equal(r.imports.total, undefined, JSON.stringify(raw));
    assert.equal(r.indexRefused, raw !== null, JSON.stringify(raw));
  }
  assert.equal(parseData({ ...SPEC, energyCounterIn: '9000001' }).imports.total, 9000.001);
  // Rounded to the Wh: no float residue.
  assert.equal(parseData({ ...SPEC, energyCounterIn: 1234567.8 }).imports.total, 1234.568);
  const { energyCounterIn, ...noIndex } = SPEC;
  assert.ok(energyCounterIn);
  assert.equal(parseData(noIndex).indexRefused, false);
});

test('powers bounded; a 0 dBm signal is no signal (the library default)', () => {
  assert.equal(parseData({ ...SPEC, power: 200_000 }).power, undefined);
  assert.equal(parseData({ ...SPEC, power: -99_000 }).power, -99_000);
  assert.equal(parseData({ ...SPEC, rssi: 0 }).rssi, undefined);
  assert.equal(parseData({ ...SPEC, rssi: -200 }).rssi, undefined);
  assert.equal(parseData({ ...SPEC, agePower: -1 }).agePower, undefined);
});

test('not an EcoTracker answer: not an object, too many fields, no power nor counter', () => {
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  for (const payload of [null, [], 'x', 42, {}, { hello: 1 }, { ...many, power: 1 }]) {
    assert.equal(parseData(payload), undefined, JSON.stringify(payload).slice(0, 40));
  }
  assert.ok(parseData({ power: 5 }));
  assert.ok(parseData({ energyCounterIn: 5000 }));
  // An own `__proto__` key of JSON.parse is never read as a field.
  const hostile = JSON.parse('{"__proto__": {"power": 5}, "energyCounterIn": 9000000}');
  const r = parseData(hostile);
  assert.equal(r.power, undefined);
  assert.equal({}.power, undefined);
});

test('the fingerprint changes with any value read', () => {
  const a = fingerprintOf(parseData(SPEC));
  assert.equal(a, fingerprintOf(parseData({ ...SPEC })));
  assert.notEqual(a, fingerprintOf(parseData({ ...SPEC, powerAvg: 101 })));
  assert.notEqual(a, fingerprintOf(parseData({ ...SPEC, energyCounterIn: 145001 })));
  assert.notEqual(a, fingerprintOf(parseData({ ...SPEC, energyCounterOut: 4501 })));
  // agePower and the signal are not values of the meter.
  assert.equal(a, fingerprintOf(parseData({ ...SPEC, agePower: 900, rssi: -50 })));
});
