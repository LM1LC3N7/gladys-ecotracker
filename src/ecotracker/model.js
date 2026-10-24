// -----------------------------------------------------------------------------
// The answer of GET /v1/json -> values. Pure. Ported from the ecotracker
// library of the maker (everHome, MIT, see THIRD_PARTY_NOTICES.md),
// ecotracker/meter.py and data.py:
// - one JSON object, every field optional: `power`, `powerPhase1` to
//   `powerPhase3`, `powerAvg`, `energyCounterIn`, `energyCounterInT1`,
//   `energyCounterInT2`, `energyCounterOut`, `serial`, `firmwareVersion`,
//   `rssi`;
// - the serial number, when given, names the reader (`get_serial`).
// Changed here, after the published description of the local API and a real
// answer (see TODO.md):
// - the energy counters are in Wh (the library's README says kWh; the
//   maker's API description and a real answer, 1 541 618.4, say Wh):
//   converted to kWh, rounded to the Wh;
// - `power` is signed: negative when injecting, positive when drawing;
// - `agePower` (ms, the age of the power, sent by real readers) is read when
//   it is a number;
// - values are read against strict types and bounds, never as 0 by default:
//   a number, or a string of a plain decimal number (`""` is unknown);
// - the library's fallback of the serial to the IP address is not ported: an
//   address is never an identity.
// -----------------------------------------------------------------------------

import { INDEX_MAX, MAX_FIELDS, POWER_MAX, RSSI_MIN } from '../constants.js';

/** A serial we accept: it becomes an external id, forever. */
const SERIAL = /^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$/;

/** The device key of a reader without serial number (`ecotracker:reader`). */
export const NO_SERIAL_KEY = 'reader';

/** A device key we accept from /data: `reader` or `sn-<serial in lower case>`. */
export const DEVICE_KEY = /^(?:reader|sn-[a-z0-9][a-z0-9_-]{2,47})$/;

const DECIMAL = /^\s*-?\d{1,15}(?:\.\d{1,9})?\s*$/;

/** A JSON number, or a string of a plain decimal number; else undefined (never 0 by default). */
export function numberOf(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string' && raw.length <= 32 && DECIMAL.test(raw)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

const own = (payload, key) => (Object.hasOwn(payload, key) ? payload[key] : undefined);

/**
 * The serial of the answer: a string (or a whole number) matching SERIAL, with
 * at least one digit and not only zeros. `{ serial }` when readable,
 * `{ absent: true }` when the field is missing, null or empty, `{ unreadable:
 * true }` otherwise (never "another reader").
 */
export function serialOf(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { absent: true };
  }
  const text =
    typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
      ? String(raw)
      : typeof raw === 'string' && raw.length <= 64
        ? raw.trim()
        : undefined;
  if (text === undefined || !SERIAL.test(text) || !/\d/.test(text) || /^0+$/.test(text)) {
    return { unreadable: true };
  }
  return { serial: text };
}

/** The device key of a serial (undefined: none): `sn-<lower case>` or `reader`. */
export const deviceKey = (serial) =>
  serial === undefined ? NO_SERIAL_KEY : `sn-${serial.toLowerCase()}`;

/** A counter in Wh -> kWh: above 0 and within bounds, rounded to the Wh; else undefined. */
function energyOf(payload, key) {
  const wh = numberOf(own(payload, key));
  if (wh === undefined) {
    return undefined;
  }
  const kwh = Math.round(wh) / 1000;
  return kwh > 0 && kwh <= INDEX_MAX ? kwh : undefined;
}

/** A power in W, signed, within ±POWER_MAX. */
function powerOf(payload, key) {
  const w = numberOf(own(payload, key));
  return w !== undefined && Math.abs(w) <= POWER_MAX ? w : undefined;
}

function rssiOf(raw) {
  const value = numberOf(raw);
  // The library gives 0 when it is absent: 0 dBm is not a signal.
  return value !== undefined && value >= RSSI_MIN && value < 0 ? value : undefined;
}

function ageOf(raw) {
  const value = numberOf(raw);
  return value !== undefined && value >= 0 && value <= 1e12 ? value : undefined;
}

/** The fields whose presence makes the "shape" of an answer (a reader without serial). */
const SHAPE_FIELDS = [
  'power',
  'powerAvg',
  'agePower',
  'powerPhase1',
  'powerPhase2',
  'powerPhase3',
  'energyCounterIn',
  'energyCounterInT1',
  'energyCounterInT2',
  'energyCounterOut',
  'serial',
  'firmwareVersion',
  'rssi',
];

/** A shape we accept from /data: known field names joined by commas. */
export const SHAPE = new RegExp(`^(?:(?:${SHAPE_FIELDS.join('|')})(?:,|$))*$`);

/**
 * The answer, parsed:
 * - undefined: not an EcoTracker answer (not an object, too many fields, or
 *   neither a power nor a consumption counter field);
 * - `{ serial, serialState, power, powerAvg, phases, agePower, imports:
 *   { total, t1, t2 }, exportTotal, rssi, indexRefused }`, `serial`
 *   undefined unless readable, `serialState` 'ok' | 'absent' | 'unreadable'.
 */
export function parseData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  if (Object.keys(payload).length > MAX_FIELDS) {
    return undefined;
  }
  // The two fields of the published API every reader sends: without both,
  // it is another device answering at this address.
  if (!Object.hasOwn(payload, 'power') && !Object.hasOwn(payload, 'energyCounterIn')) {
    return undefined;
  }
  const id = serialOf(own(payload, 'serial'));
  const rawIndex = own(payload, 'energyCounterIn');
  const total = energyOf(payload, 'energyCounterIn');
  return {
    serial: id.serial,
    serialState: id.serial !== undefined ? 'ok' : id.absent ? 'absent' : 'unreadable',
    power: powerOf(payload, 'power'),
    powerAvg: powerOf(payload, 'powerAvg'),
    phases: [
      powerOf(payload, 'powerPhase1'),
      powerOf(payload, 'powerPhase2'),
      powerOf(payload, 'powerPhase3'),
    ],
    agePower: ageOf(own(payload, 'agePower')),
    imports: {
      total,
      t1: energyOf(payload, 'energyCounterInT1'),
      t2: energyOf(payload, 'energyCounterInT2'),
    },
    exportTotal: energyOf(payload, 'energyCounterOut'),
    rssi: rssiOf(own(payload, 'rssi')),
    // The fields present (not null), in a fixed order: another reader at the
    // address often sends another set (phases, tariffs, agePower).
    shape: SHAPE_FIELDS.filter(
      (key) => own(payload, key) !== undefined && own(payload, key) !== null,
    ).join(','),
    // energyCounterIn sent but not usable (not a number, 0 or below, out of
    // bounds): the status says so; the index is never published at 0.
    indexRefused: rawIndex !== undefined && rawIndex !== null && total === undefined,
  };
}

/**
 * The fingerprint of the values read (powers, counters): when it does not
 * move for FROZEN_AFTER, the reader may serve an old reading. A plain string,
 * hashed by the app before it reaches /data.
 */
export function fingerprintOf(reading) {
  return JSON.stringify([
    reading.power ?? null,
    reading.powerAvg ?? null,
    reading.phases.map((p) => p ?? null),
    reading.imports.total ?? null,
    reading.imports.t1 ?? null,
    reading.imports.t2 ?? null,
    reading.exportTotal ?? null,
  ]);
}
