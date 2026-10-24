// -----------------------------------------------------------------------------
// Answers of the data page: the example of the published local API of the
// maker, a real answer of a three-phase reader (as reported in the
// documentation of wwerther/ha-ecotracker-emulator, MIT), the answer the
// ecotracker library's tests use, and a builder.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.70';
export const NOW = Date.parse('2026-10-23T10:00:00Z');

/** The example of the published API (Wh, W). */
export const SPEC = {
  power: 125,
  powerAvg: 100,
  powerPhase1: 50,
  powerPhase2: 50,
  powerPhase3: 25,
  energyCounterIn: 145000,
  energyCounterInT1: 100000,
  energyCounterInT2: 45000,
  energyCounterOut: 4500,
};

/** A real answer (2026-05): no serial, no tariff, `agePower`, injecting. */
export const REAL = {
  power: -3127,
  powerAvg: -3114,
  agePower: 496,
  powerPhase1: -1025,
  powerPhase2: -1176,
  powerPhase3: -925,
  energyCounterOut: 5552927.8,
  energyCounterIn: 1541618.4,
};

/** The real answer as the reader sends it: pretty-printed with tabs. */
export const REAL_TEXT =
  '{\n\t"power":\t-3127,\n\t"powerAvg":\t-3114,\n\t"agePower":\t496,\n\t"powerPhase1":\t-1025,\n\t"powerPhase2":\t-1176,\n\t"powerPhase3":\t-925,\n\t"energyCounterOut":\t5552927.8,\n\t"energyCounterIn":\t1541618.4\n}';

/** With the fields the library of the maker also reads. */
export const SERIAL = 'ET1234567';
export const WITH_SERIAL = { ...SPEC, serial: SERIAL, firmwareVersion: '1.2.3', rssi: -61 };

/**
 * An answer: `kwh` the consumption counter (kWh, sent in Wh), `w` the net
 * power, `serial` (undefined: none), `extra` merged in. `agePower` is left
 * out unless given in `extra`.
 */
export function eco({ kwh = 9000, w = 350, serial, extra = {} } = {}) {
  return {
    power: w,
    powerAvg: w - 10,
    powerPhase1: w / 2,
    powerPhase2: w / 4,
    powerPhase3: w / 4,
    energyCounterIn: Math.round(kwh * 1000 * 10) / 10,
    energyCounterInT1: Math.round(kwh * 600),
    energyCounterInT2: Math.round(kwh * 400),
    energyCounterOut: 1_500_000,
    ...(serial === undefined ? {} : { serial }),
    ...extra,
  };
}

/** A fetch Response with a JSON body. */
export const json = (body, init = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
