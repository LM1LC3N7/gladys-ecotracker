// -----------------------------------------------------------------------------
// The Gladys device of an EcoTracker reader and its states. Pure.
//
// External id (forever): ecotracker:<key>, `sn-<serial>` when the reader
// gives a serial number, `reader` otherwise (src/ecotracker/model.js).
// Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service), as in gladys-p1-monitor and gladys-energieleser:
// - `consumption_index` (`energyCounterIn`, the electricity taken from the
//   grid) is the ONLY energy-sensor / index feature: the core derives the
//   consumption and its cost from its deltas, by itself. It passes the guard
//   of src/guard.js: never 0, a drop or a jump held until the user accepts it;
// - the tariff counters (`energyCounterInT1`, `energyCounterInT2`) are plain
//   sensors: as indexes they would be counted a second time;
// - the injection (`energyCounterOut`) is NEVER in an energy-sensor index nor
//   `energy` (it would be billed as consumption): a plain sensor, kWh in the
//   name;
// - `power` (the net power, negative when injecting) is the only
//   energy-sensor / power feature. The average and the phases are plain
//   sensors, so they are never taken for it;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh for energy-sensor, none for
//   unknown (the unit is then in the name).
//
// The features follow what the reader showed (a meter sends a subset of the
// fields): the set only grows, and always holds the features of the created
// device, so a device published again never loses one (an "Update" in
// Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, INDEX_MAX, POWER_MAX, RSSI_MIN } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  POWER_AVG: 'power_avg',
  phase: (n) => `power_l${n}`,
  CONSUMPTION_INDEX: 'consumption_index',
  consumptionTariff: (n) => `consumption_t${n}`,
  INJECTION_INDEX: 'injection_index',
  SIGNAL: 'signal',
};

const TARIFFS = [1, 2];
const PHASES = [1, 2, 3];

/** Every feature key, in the order of the device. */
export const ORDER = [
  FEATURE.POWER,
  FEATURE.CONSUMPTION_INDEX,
  ...TARIFFS.map(FEATURE.consumptionTariff),
  FEATURE.INJECTION_INDEX,
  FEATURE.POWER_AVG,
  ...PHASES.map(FEATURE.phase),
  FEATURE.SIGNAL,
];
const KNOWN = new Set(ORDER);

/** The external ids of the reader with this device key. */
export const ids = (gladys, key) => gladys.externalIds(EXTERNAL_ID_TYPE, key);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: INDEX_MAX,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (external, key, name, extra = {}) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);

const signedPower = { min: -POWER_MAX, max: POWER_MAX };

/** The definition of each feature key. */
const DEFINITIONS = {
  [FEATURE.POWER]: (e) =>
    feature(
      e,
      FEATURE.POWER,
      'Net power (negative when injecting)',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      { unit: U.WATT, ...signedPower },
    ),
  [FEATURE.CONSUMPTION_INDEX]: (e) =>
    feature(
      e,
      FEATURE.CONSUMPTION_INDEX,
      'Consumption index',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      { unit: U.KILOWATT_HOUR },
    ),
  ...Object.fromEntries(
    TARIFFS.map((n) => [
      FEATURE.consumptionTariff(n),
      (e) => plain(e, FEATURE.consumptionTariff(n), `Consumption index, tariff ${n} (kWh)`),
    ]),
  ),
  [FEATURE.INJECTION_INDEX]: (e) => plain(e, FEATURE.INJECTION_INDEX, 'Injection index (kWh)'),
  [FEATURE.POWER_AVG]: (e) =>
    plain(e, FEATURE.POWER_AVG, 'Net power, average of the last minute (W)', signedPower),
  ...Object.fromEntries(
    PHASES.map((n) => [
      FEATURE.phase(n),
      // A value every 10 s: no history unless the user turns it on.
      (e) => plain(e, FEATURE.phase(n), `Power L${n} (W)`, { ...signedPower, keep_history: false }),
    ]),
  ),
  [FEATURE.SIGNAL]: (e) =>
    plain(e, FEATURE.SIGNAL, 'Wi-Fi signal (dBm)', {
      min: RSSI_MIN,
      max: 0,
      keep_history: false,
    }),
};

/**
 * The device. `key`: its device key (src/ecotracker/model.js), `serial` the
 * serial number (undefined without one), `keys`: the feature keys to give it
 * (a Set, see capabilitiesOf). The features are fixed when the user creates it.
 */
export function buildDevice(gladys, key, serial, keys, address) {
  const external = ids(gladys, key);
  return {
    name: serial === undefined ? 'EcoTracker' : `EcoTracker ${serial}`,
    external_id: external.device,
    features: ORDER.filter((k) => keys.has(k)).map((k) => DEFINITIONS[k](external)),
    params: [
      { name: 'address', value: address },
      ...(serial === undefined ? [] : [{ name: 'serial', value: serial }]),
    ],
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The feature keys a reading shows (a value present). */
export function capabilitiesOf(reading) {
  const keys = new Set();
  const add = (key, value) => isNumber(value) && keys.add(key);
  add(FEATURE.POWER, reading.power);
  add(FEATURE.CONSUMPTION_INDEX, reading.imports.total);
  for (const n of TARIFFS) {
    add(FEATURE.consumptionTariff(n), reading.imports[`t${n}`]);
  }
  add(FEATURE.INJECTION_INDEX, reading.exportTotal);
  add(FEATURE.POWER_AVG, reading.powerAvg);
  reading.phases.forEach((value, i) => add(FEATURE.phase(i + 1), value));
  add(FEATURE.SIGNAL, reading.rssi);
  return keys;
}

/** The feature keys a CREATED device carries: never fewer when it is published again. */
export function capabilitiesOfDevice(device) {
  return new Set(
    (device?.features ?? [])
      .map((f) => String(f.external_id).split(':').at(-1))
      .filter((key) => KNOWN.has(key)),
  );
}

/** Keys read back from /data: known keys only. */
export const validKeys = (keys) =>
  new Set(Array.isArray(keys) ? keys.filter((key) => KNOWN.has(key)) : []);

export const union = (...sets) => new Set(sets.flatMap((s) => [...(s ?? [])]));

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A counter: never 0 (nor below), whatever the reader said. */
const counterState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];

/** The live values, read every 10 s: the powers and the signal. */
export function liveStates(external, reading) {
  return [
    ...state(external, FEATURE.POWER, reading.power, 0),
    ...state(external, FEATURE.POWER_AVG, reading.powerAvg, 0),
    ...reading.phases.flatMap((value, i) => state(external, FEATURE.phase(i + 1), value, 0)),
    ...state(external, FEATURE.SIGNAL, reading.rssi, 0),
  ];
}

/**
 * The indexes, published once a minute. `consumptionIndex` is the value the
 * IndexGuard let through (undefined: not published this time). Every other
 * counter is a plain sensor, never published at 0.
 */
export function indexStates(external, reading, consumptionIndex) {
  return [
    ...counterState(external, FEATURE.CONSUMPTION_INDEX, consumptionIndex),
    ...TARIFFS.flatMap((n) =>
      counterState(external, FEATURE.consumptionTariff(n), reading.imports[`t${n}`]),
    ),
    ...counterState(external, FEATURE.INJECTION_INDEX, reading.exportTotal),
  ];
}
