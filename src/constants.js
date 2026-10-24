// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the device: `ecotracker:<key>`. The local answer of the
 * EcoTracker usually carries no serial number (real answer of 2026-05, see
 * TODO.md); the library of the maker reads an optional `serial`. The rule,
 * fixed forever (src/ecotracker/model.js `deviceKey`):
 * - a readable `serial` gives `ecotracker:sn-<serial in lower case>`;
 * - no serial gives `ecotracker:reader` (one reader per integration).
 */
export const EXTERNAL_ID_TYPE = 'ecotracker';

// --- The local API of the reader (as the ecotracker library reads it) ---------------
/** The only page read: one JSON object of the last reading. */
export const DATA_PATH = '/v1/json';
/** The library waits 10 s for an answer; so do we, the body included. */
export const HTTP_TIMEOUT = 10_000;
/** The answer is about 200 bytes: more is not an EcoTracker answer. */
export const MAX_BODY_BYTES = 16 * 1024;
/** At most this many fields in the answer (an EcoTracker sends about 12). */
export const MAX_FIELDS = 64;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One read every 10 s, never faster, whatever asks for it. */
export const POLL_INTERVAL = 10 * SECOND;
/** The indexes are published (and their guard kept in /data) once a minute. */
export const INDEX_INTERVAL = MINUTE;
/** An unreachable reader or a wrong answer: tries after 10 s, doubled up to 5 minutes. */
export const RETRY_MIN = 10 * SECOND;
export const RETRY_MAX = 5 * MINUTE;
/** HTTP 429 or 5xx: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The time of the last read is written in /data at most once per this delay. */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 30 s). */
export const TEST_ANSWER_WITHIN = 20 * SECOND;
/** A clean stop waits at most this long for the read running (Docker stops after 10 s). */
export const STOP_WAIT = 5 * SECOND;
/**
 * The answer gives no time of its own. The values read (powers, indexes) have
 * not changed at all for this long: the reader may serve an old reading (its
 * optical head fell off the meter): the live values are no longer sent.
 * Measured on our monotonic clock; the time it changed is kept in /data.
 */
export const FROZEN_AFTER = 15 * MINUTE;
/**
 * `agePower` (ms, the age of the power measurement, sent by real readers but
 * not in the published API): above this, the power is old: not sent.
 */
export const AGE_POWER_MAX = MINUTE;

// --- "Accept the held index", in two clicks -------------------------------------------
/** The second click counts from this long after the first (a double click only lists). */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
/** ...and up to this long: later, it lists again. */
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;

// --- Plausibility of the consumption index (the one Gladys bills) -------------------
/**
 * A German home connection never draws more than this on average between two
 * published indexes (63 A x 3 x 230 V is about 43 kW). The guard of
 * src/guard.js takes it as a parameter.
 */
export const INDEX_MAX_KW = 50;
/** kWh always accepted on top of INDEX_MAX_KW x hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** A power above this (W), either way, is a glitch: not published. */
export const POWER_MAX = 100_000;
/** An index above this (kWh) is a glitch: not published. */
export const INDEX_MAX = 100_000_000;
/** A signal outside [-150, 0] dBm is a glitch. */
export const RSSI_MIN = -150;

// --- Is the counter in Wh? (review r1, point 2) -----------------------------------------
/** The rise of the index is compared to the energy the power gives over this much (kWh). */
export const UNIT_CHECK_KWH = 1;
/** A gap between two reads longer than this starts the comparison again. */
export const UNIT_CHECK_GAP = 30 * SECOND;
/** A ratio index / power outside [1/UNIT_RATIO, UNIT_RATIO]: the unit is told as doubtful. */
export const UNIT_RATIO = 20;
/** T1 + T2 may differ from the index by this share (and 0.1 kWh) before a note. */
export const TARIFF_TOLERANCE = 0.01;
