// -----------------------------------------------------------------------------
// The integration itself: the data page of the EcoTracker read every 10 s,
// its device, the consumption index checked by its guard and published once a
// minute, the pauses kept in /data, the test and accept buttons. index.js
// only wires the SDK handlers to it. Read-only: nothing is ever sent to the
// reader but one GET of its data page.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data). Structure taken from
// gladys-energieleser (approved), with the pause, the stop and the two-click
// acceptance of gladys-iskra / gladys-autarco (approved).
//
// A read belongs to its session (the client of one address): when the
// address changes, a late answer of the old one publishes nothing and sets no
// status (checked after every await).
//
// Identity, checked at every read (src/ecotracker/model.js): an answer with a
// serial number goes to the device of THAT serial, never to another one (a
// DHCP swap); a serial present but unreadable is a wrong answer, never
// "another reader"; an answer without serial after a reader with one, while
// that reader's device exists, is not used (a weaker identity is never a
// downgrade), nor while any device of a reader with a serial exists. A
// reader that gives no serial at all cannot always be told from another one:
// after an outage, another shape of its answer is held (followShape); with the
// same shape, the guard holds a drop or a rise larger than 50 kW x the hours
// since the last accepted value, but takes a smaller rise. A fixed address is
// needed (docs, status).
//
// Freshness: the answer has no time of its own. The age of the power
// (`agePower`), when sent, and a fingerprint of the values (kept in /data,
// hashed) tell an old reading: its live values are not sent.
//
// Two clocks: `now` (wall clock) dates the index and what /data keeps;
// `monotonic` paces the reads and the pauses, so that a wall clock set back
// never stops them.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  AGE_POWER_MAX,
  ATTEMPT_SAVE_EVERY,
  FROZEN_AFTER,
  INDEX_INTERVAL,
  INDEX_MAX_KW,
  INDEX_SLACK_KWH,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STOP_WAIT,
  TARIFF_TOLERANCE,
  TEST_ANSWER_WITHIN,
  UNIT_CHECK_GAP,
  UNIT_CHECK_KWH,
  UNIT_RATIO,
} from './constants.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOf,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
  round,
  union,
  validKeys,
} from './devices.js';
import { ReaderClient, ReaderError } from './ecotracker/client.js';
import {
  DEVICE_KEY,
  NO_SERIAL_KEY,
  SHAPE,
  deviceKey,
  fingerprintOf,
  meterShape,
} from './ecotracker/model.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };

const GUARD_LIMITS = { maxKw: INDEX_MAX_KW, slackKwh: INDEX_SLACK_KWH };
/** At most this many index states kept in /data (one per reader seen). */
const MAX_KEPT_INDEXES = 8;
const SERIAL = /^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$/;
const HASH = /^[0-9a-f]{16}$/;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A short hash of the values read: /data keeps it, never the values. */
const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    feature?.last_value !== '' &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/**
 * A pause read back from /data: `{ until, count, code, status }`. In memory
 * it ends at a monotonic `due` (its rest capped to PAUSE_MAX from now).
 */
function validPause(pause, now, mono) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** The freshness read back from /data: `{ key, hash, at }`, `at` never in the future. */
function validFresh(fresh, now) {
  return fresh &&
    typeof fresh.key === 'string' &&
    DEVICE_KEY.test(fresh.key) &&
    typeof fresh.hash === 'string' &&
    HASH.test(fresh.hash) &&
    finite(fresh.at)
    ? { key: fresh.key, hash: fresh.hash, at: Math.min(fresh.at, now) }
    : undefined;
}

/** The index states kept in /data: plain objects under feature ids only, no prototype. */
function keptIndexes(indexes) {
  const kept = Object.create(null);
  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) {
    return kept;
  }
  for (const [key, value] of Object.entries(indexes)) {
    if (
      /^[\w.:-]{1,200}$/.test(key) &&
      key !== '__proto__' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      kept[key] = value;
    }
  }
  return kept;
}

export class EcoTrackerApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'ecotracker' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new ReaderClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: the guard of the index, the reader and its features, the pause, the last read. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address; replaced (never reused) when it changes. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    /** The first click of "Accept the held index": `{ at, listedAt, list, session }`. */
    this.pendingAccept = undefined;

    const kept = store.load();
    const at = now();
    const mono = monotonic();
    this.pause = validPause(kept.pause, at, mono);
    /** The device key of the reader last read (src/ecotracker/model.js), offered at a restart. */
    this.deviceKey =
      typeof kept.deviceKey === 'string' && DEVICE_KEY.test(kept.deviceKey)
        ? kept.deviceKey
        : undefined;
    /** Its serial number as the reader gives it (undefined: none). */
    this.serial =
      this.deviceKey?.startsWith('sn-') &&
      typeof kept.serial === 'string' &&
      SERIAL.test(kept.serial) &&
      deviceKey(kept.serial) === this.deviceKey
        ? kept.serial
        : undefined;
    if (this.deviceKey?.startsWith('sn-') && this.serial === undefined) {
      this.deviceKey = undefined;
    }
    /** The feature keys of that reader (src/devices.js): only grow. */
    this.keys = this.deviceKey ? validKeys(kept.keys) : new Set();
    // The last read before a restart: the next one never comes sooner than
    // the interval (a date in the future, a clock set back, is brought to now).
    this.lastAttemptAt = finite(kept.lastAttemptAt) ? Math.min(kept.lastAttemptAt, at) : undefined;
    this.savedAttemptAt = this.lastAttemptAt;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : mono - (at - this.lastAttemptAt);
    if (
      this.lastAttemptAt !== undefined &&
      kept.attemptExact !== true &&
      at - this.lastAttemptAt < ATTEMPT_SAVE_EVERY + POLL_INTERVAL
    ) {
      // Not a clean stop: the time in /data may be up to a minute old and a
      // read may have gone since (review r1, point 6): a whole interval.
      this.lastReadAt = mono;
    }
    /** Whether /data holds the exact time of the last read (written at a clean stop). */
    this.attemptExact = false;
    /**
     * The shape of the answers of a reader without serial (the fields it
     * sends), kept in /data: `{ key, shape }` (review r1, point 3).
     */
    this.shape =
      kept.shape &&
      typeof kept.shape.key === 'string' &&
      DEVICE_KEY.test(kept.shape.key) &&
      typeof kept.shape.shape === 'string' &&
      kept.shape.shape.length <= 400 &&
      SHAPE.test(kept.shape.shape)
        ? { key: kept.shape.key, shape: meterShape(kept.shape.shape) }
        : undefined;
    /** A new shape seen without outage: `{ shape, count }`, the reference after 3 in a row. */
    this.shapeCandidate = undefined;
    /** The start read an exact time in /data: the first read rewrites it at once (r2, 3). */
    this.attemptRewrite = kept.attemptExact === true;
    /**
     * The freshness kept in /data: `{ key, hash, at }`, the hash of the last
     * values read and the wall time they last changed. After a restart, a
     * reading with these same values keeps its age: a frozen reading is
     * never published as new.
     */
    this.fresh = validFresh(kept.fresh, at);
    this.keptFresh = this.fresh;
    /** The freshness last written to /data, and when (wall clock). */
    this.savedFresh = this.fresh;
    this.savedFreshAt = undefined;
    /** By index feature external id. */
    this.guards = new Map();
    this.resetReads();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'error', reading?, err? }`. */
    this.outcome = undefined;
    /** Wrong answers and unreachable reader: retries doubled, in memory. */
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** Freshness of the reading: the hash of its values, and when (monotonic) it last changed. */
    this.readingStamp = undefined;
    this.freshAt = 0;
    /**
     * The values were seen changing in this session, or match the ones kept
     * in /data, or the reader said its power is recent: until then the live
     * values are not published (a reading frozen before a restart is never
     * sent as new).
     */
    this.freshKnown = false;
    /** The serial of another reader that answered after the previous one (a note). */
    this.otherReader = undefined;
    /** An answer without serial after a reader with one: not used (a note). */
    this.identityLost = false;
    /** Monotonic time the indexes were last published. */
    this.lastIndexAt = undefined;
    /**
     * The next answer follows an outage (a start, a failure): its shape is
     * compared to the one kept (a reader without serial).
     */
    this.afterOutage = true;
    this.shapeCandidate = undefined;
    /**
     * A reader without serial answers with another shape after an outage:
     * maybe another reader at the address. `{ from, to }`; nothing is
     * published until the shape comes back or the user accepts it.
     */
    this.shapeChanged = undefined;
    this.resetUnitCheck();
    /** The counters do not follow the power (`{ ratio }`), or T1 + T2 is not the index. */
    this.unitDoubt = undefined;
    this.tariffDoubt = false;
  }

  /** The comparison of the index with the power starts again (review r1, point 2). */
  resetUnitCheck(reading, mono) {
    this.unitWindow =
      reading && reading.power !== undefined && reading.imports.total !== undefined
        ? { from: reading.imports.total, kwh: 0, at: mono, power: reading.power }
        : undefined;
  }

  /**
   * Is the counter in Wh? Over at least UNIT_CHECK_KWH drawn according to the
   * power (the integral of max(power, 0) between reads, gaps over 30 s start
   * again), the rise of the index must be within a factor of 20 of it. A
   * reader in kWh read as Wh gives 1/1000. Only a note and a log line: the
   * index is never stopped on this (a power in kW would be the wrong one).
   * And T1 + T2 must be the index when the three are given.
   */
  checkUnits(reading, mono) {
    const { t1, t2, total } = reading.imports;
    if (t1 !== undefined && t2 !== undefined && total !== undefined) {
      const doubt = Math.abs(t1 + t2 - total) > Math.max(0.1, total * TARIFF_TOLERANCE);
      if (doubt && !this.tariffDoubt) {
        this.logger.warn('ecotracker: the tariff counters do not add up to the index');
      }
      this.tariffDoubt = doubt;
    }
    const w = this.unitWindow;
    if (
      !w ||
      reading.power === undefined ||
      total === undefined ||
      total < w.from ||
      mono - w.at > UNIT_CHECK_GAP ||
      mono < w.at
    ) {
      this.resetUnitCheck(reading, mono);
      return;
    }
    const hours = (mono - w.at) / 3_600_000;
    w.kwh += ((Math.max(0, w.power) + Math.max(0, reading.power)) / 2 / 1000) * hours;
    w.at = mono;
    w.power = reading.power;
    if (w.kwh < UNIT_CHECK_KWH) {
      return;
    }
    const ratio = (total - w.from) / w.kwh;
    const doubt = ratio < 1 / UNIT_RATIO || ratio > UNIT_RATIO;
    if (doubt && !this.unitDoubt) {
      this.logger.warn(
        `ecotracker: the consumption counter does not follow the power (ratio ${ratio.toPrecision(2)}): unit?`,
      );
    }
    this.unitDoubt = doubt ? { ratio } : undefined;
    this.resetUnitCheck(reading, mono);
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  /**
   * Stops the reads, waits (bounded) for the one running, and writes /data:
   * the time of the last read and what was seen since the last save are
   * never lost by a clean stop.
   */
  stop() {
    return this.serialize(async () => {
      this.doStop();
      // Written first: Docker stops the container 10 s after asking.
      await this.saveState({ all: true });
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
      }
      await this.saveState({ all: true });
    });
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first ||
      config.address !== this.config.address ||
      config.invalidAddress !== this.config.invalidAddress;
    this.config = config;
    if (changed) {
      this.session = {
        client: isComplete(config) ? this.clientFactory({ address: config.address }) : undefined,
        discovered: false,
      };
      // A list of the first click belongs to its session.
      this.pendingAccept = undefined;
      if (!first) {
        // Another address: its own story. A pause asked by the old one ends;
        // the pace does not (never two reads less than an interval apart).
        this.resetReads();
        if (this.pause) {
          this.pause = undefined;
          await this.saveState();
        }
      }
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read).
    this.lastStatus = undefined;
    this.lastIndexAt = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.setStatus(false, config.invalidAddress ? T.badAddress : T.incomplete);
      return;
    }
    if (!changed || first) {
      // At the first start, the reader kept in /data is offered again with
      // the address of the form (the SDK may update the `address` param of
      // its device before any answer: cosmetic). When the address changes
      // while running, another address may be another reader: its device is
      // published once its answer is read, never the old one with the new
      // address.
      await this.discover();
    }
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- Pace ------------------------------------------------------------------

  /** The rest of the pause (ms, monotonic), capped to PAUSE_MAX at every use; 0 when none. */
  pauseLeft(mono = this.monotonic()) {
    if (!this.pause) {
      return 0;
    }
    return Math.min(Math.max(0, this.pause.due - mono), PAUSE_MAX);
  }

  /**
   * The monotonic time from which the next read may start, computed at the
   * caller's instant `mono`: one clock read per decision (a second read of a
   * real clock is always later, and `mono < dueAt()` would never let a read
   * go).
   */
  dueAt(mono = this.monotonic()) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + POLL_INTERVAL;
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, Math.min(this.nextTryAt, mono + RETRY_MAX));
    }
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client) {
      return;
    }
    const mono = this.monotonic();
    // Whole milliseconds, rounded up: a timer never fires before the read is due.
    const wait = Math.max(0, Math.ceil(this.dueAt(mono) - mono));
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`ecotracker: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick() {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read() {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      return;
    }
    /** Another address (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let reading;
    try {
      reading = await client.readData();
      if (reading.serialState === 'unreadable') {
        // A serial present but not readable: a wrong answer, never another reader.
        throw new ReaderError('bad_serial');
      }
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone()) return;
    await this.succeeded(reading, mono, gone);
  }

  async saveAttempt(now) {
    this.lastAttemptAt = now;
    const rewrite = this.attemptRewrite;
    this.attemptRewrite = false;
    if (
      rewrite ||
      this.savedAttemptAt === undefined ||
      now < this.savedAttemptAt ||
      now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedAttemptAt = now;
      await this.saveState();
    }
  }

  // --- Outcomes ----------------------------------------------------------------

  /**
   * The device key of an answer: its serial's, or `reader` without serial,
   * or undefined when the answer has no serial after a reader that had one
   * and whose device exists (a weaker identity: not used, /data untouched).
   */
  identityOf(reading) {
    if (reading.serial !== undefined) {
      return deviceKey(reading.serial);
    }
    if (this.serialDevice()) {
      return undefined;
    }
    return NO_SERIAL_KEY;
  }

  /**
   * A created device of a reader with a serial, from Gladys itself (not
   * /data, which may be lost: review r1, point 5): the one of /data first.
   */
  serialDevice() {
    const devices = (this.gladys.devices ?? []).filter((d) =>
      /:ecotracker:sn-[a-z0-9][a-z0-9_-]{2,47}$/.test(String(d.external_id)),
    );
    const mine = this.deviceKey?.startsWith('sn-') ? this.createdDevice() : undefined;
    return mine ?? devices[0];
  }

  /** The serial of that device, for the note (its param, checked). */
  serialOfDevice(device) {
    const raw = (device?.params ?? []).find((p) => p.name === 'serial')?.value;
    return typeof raw === 'string' && SERIAL.test(raw) ? raw : this.serial;
  }

  async succeeded(reading, mono, gone) {
    // An answer: a pause asked before and the retries are over.
    this.pause = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    const key = this.identityOf(reading);
    if (key === undefined) {
      if (!this.identityLost) {
        this.logger.warn('ecotracker: the answer has no serial number any more: not used');
      }
      this.identityLost = true;
      this.lostSerial = this.serialOfDevice(this.serialDevice());
      this.outcome = { at: mono, kind: 'reading', reading, unused: true };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    this.identityLost = false;
    // The identity of this read: the serial in the same answer as its values.
    const previous = this.deviceKey;
    const otherId = previous !== undefined && previous !== key;
    if (otherId) {
      this.otherReader = reading.serial ?? null;
      this.logger.warn('ecotracker: another reader answers at this address');
      this.keys = new Set();
      this.readingStamp = undefined;
      this.lastIndexAt = undefined;
    }
    this.deviceKey = key;
    this.serial = reading.serial;
    if (this.createdDevice()) {
      // The reader answering has its device: the note about it ends.
      this.otherReader = undefined;
    }
    this.followShape(reading, key);
    this.followFreshness(reading, key, mono);
    this.outcome = { at: mono, kind: 'reading', reading };
    if (!this.shapeChanged) {
      this.checkUnits(reading, mono);
    }
    // While the shape is held (maybe another reader), its features are not
    // offered (r2, point 4).
    const keys = union(
      this.keys,
      capabilitiesOfDevice(this.createdDevice()),
      this.shapeChanged ? undefined : capabilitiesOf(reading),
    );
    const grew = keys.size !== this.keys.size;
    this.keys = keys;
    const session = this.session;
    if (grew || otherId || !session.discovered) {
      // Also the first reading of a session: a new address of the same
      // reader reaches the Discovery list at once.
      session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    await this.publish(reading, mono, gone);
    if (gone()) return;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  async failed(err, mono, gone) {
    const code = err?.code ?? 'error';
    // The next answer comes after an outage: its shape is checked.
    this.afterOutage = true;
    this.shapeCandidate = undefined;
    this.resetUnitCheck();
    const now = this.now();
    // The pause and the next try count from the failure, not from the start
    // of the read (a slow answer would shorten them).
    const at = this.monotonic();
    // Our own words only (ReaderError codes): never a text of the reader.
    this.logger.warn(
      `ecotracker read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        due: at + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    // Retries doubled (never faster than a poll).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures = Math.min(this.failures + 1, 32);
    this.lastError = err;
    this.nextTryAt = at + wait;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  /**
   * The reading is old when the reader says its power is old (`agePower`),
   * or when the values have not changed at all for FROZEN_AFTER (monotonic).
   * The first values of a session are trusted only when they match the ones
   * kept in /data (their age then goes on from there), when the reader says
   * its power is recent, or once they change: a reading frozen before a
   * restart is never sent as new.
   */
  followFreshness(reading, key, mono) {
    const hash = hashOf(fingerprintOf(reading));
    const now = this.now();
    const recent = reading.agePower !== undefined && reading.agePower <= AGE_POWER_MAX;
    if (this.readingStamp === undefined) {
      this.readingStamp = hash;
      const kept = this.keptFresh;
      if (kept && kept.key === key && kept.hash === hash) {
        this.freshKnown = true;
        this.freshAt = mono - Math.max(0, now - kept.at);
        this.fresh = kept;
      } else {
        this.freshKnown = recent;
        this.freshAt = mono;
        this.fresh = { key, hash, at: now };
      }
      return;
    }
    if (hash !== this.readingStamp) {
      this.readingStamp = hash;
      this.freshAt = mono;
      this.freshKnown = true;
      this.fresh = { key, hash, at: now };
    }
  }

  /**
   * A reader without serial cannot be told from another one at the same
   * address. Its shape (the meter fields it sends) is kept in /data; after
   * an outage (a start, a failure), another shape is maybe another reader:
   * its values are not published until the shape comes back or the user
   * accepts it (the accept button). Without outage, a new shape (a meter
   * unlocked by its PIN) becomes the reference after 3 identical answers in
   * a row.
   */
  followShape(reading, key) {
    const afterOutage = this.afterOutage;
    this.afterOutage = false;
    if (key !== NO_SERIAL_KEY) {
      this.shapeChanged = undefined;
      return;
    }
    const kept = this.shape?.key === key ? this.shape.shape : undefined;
    if (kept === undefined || reading.shape === kept) {
      this.shapeChanged = undefined;
      this.shapeCandidate = undefined;
      this.shape = { key, shape: reading.shape };
      return;
    }
    if (afterOutage || this.shapeChanged) {
      if (!this.shapeChanged) {
        this.logger.warn('ecotracker: the answer has another shape after an outage: held');
      }
      this.shapeChanged = { from: kept, to: reading.shape };
      this.shapeCandidate = undefined;
      return;
    }
    // Without outage, a new shape becomes the reference only after 3
    // identical answers in a row: a single odd answer never does (r2, 1).
    const count = this.shapeCandidate?.shape === reading.shape ? this.shapeCandidate.count + 1 : 1;
    this.shapeCandidate = { shape: reading.shape, count };
    if (count >= 3) {
      this.shape = { key, shape: reading.shape };
      this.shapeCandidate = undefined;
    }
  }

  isFrozen(mono) {
    return this.readingStamp !== undefined && mono - this.freshAt >= FROZEN_AFTER;
  }

  /** The reader says its power is older than AGE_POWER_MAX. */
  static isOldPower(reading) {
    return reading.agePower !== undefined && reading.agePower > AGE_POWER_MAX;
  }

  /** Whether the live values (powers, signal) of this reading may be published. */
  isLive(reading, mono) {
    return this.freshKnown && !this.isFrozen(mono) && !EcoTrackerApp.isOldPower(reading);
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      return [false, this.config.invalidAddress ? T.badAddress : T.incomplete];
    }
    const notes = this.heldNotes();
    const left = this.pauseLeft();
    if (this.pause && left > 0) {
      return [false, T.paused(address, this.pause, left, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - this.monotonic());
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'reading' && this.identityLost) {
      return [true, T.ok(address, [T.notes.identityLost(this.lostSerial), ...notes])];
    }
    if (this.outcome?.kind === 'reading' && this.deviceKey) {
      const reading = this.outcome.reading;
      const mono = this.monotonic();
      const extra = [];
      if (this.otherReader !== undefined) extra.push(T.notes.otherReader(this.otherReader));
      if (this.shapeChanged) extra.push(T.notes.shapeChanged);
      if (this.serial === undefined) extra.push(T.notes.noSerial);
      const powerless =
        reading.power === undefined &&
        reading.powerAvg === undefined &&
        reading.phases.every((p) => p === undefined);
      if (reading.power === undefined) extra.push(T.notes.noPower);
      if (EcoTrackerApp.isOldPower(reading)) extra.push(T.notes.oldPower(reading.agePower));
      // Without any power, nothing live is sent anyway: "no power" says it all.
      else if (powerless) {
        // (no frozen note: a locked meter moves its index once a kWh)
      } else if (this.isFrozen(mono)) extra.push(T.notes.frozen(mono - this.freshAt));
      else if (!this.freshKnown) extra.push(T.notes.notYetFresh);
      if (this.unitDoubt) extra.push(T.notes.unitDoubt(this.unitDoubt.ratio));
      if (this.tariffDoubt) extra.push(T.notes.tariffDoubt);
      // energyCounterIn sent but unusable, or gone after it was seen.
      if (
        reading.indexRefused ||
        (reading.imports.total === undefined && this.keys.has(FEATURE.CONSUMPTION_INDEX))
      ) {
        extra.push(T.notes.noIndex);
      }
      if (!this.createdDevice()) {
        return [true, T.noDevice(this.serial, [...extra, ...notes])];
      }
      return [true, T.ok(address, [...extra, ...notes])];
    }
    return [false, T.waiting(address)];
  }

  /** The index held back, for every status (the user must see it while waiting). */
  heldNotes() {
    const held = this.heldList();
    return held.length > 0 ? [T.notes.held(held[0])] : [];
  }

  /** The index held back, as the first click lists it: `[{ id, direction, from, to, threshold }]`. */
  heldList() {
    const created = this.createdDevice();
    if (!created) {
      return [];
    }
    const id = this.external().feature(FEATURE.CONSUMPTION_INDEX);
    const held = this.guardOf(created, id).held;
    return held
      ? [
          {
            id,
            direction: held.direction,
            from: held.from,
            to: held.to,
            threshold: held.threshold,
          },
        ]
      : [];
  }

  // --- /data -------------------------------------------------------------------------

  /**
   * Keeps the reader, the pause, the time of the last read and the guards when
   * they changed. Returns false when /data could not be written. The time of
   * the last read and the freshness change at every read: they are written
   * at most once a minute (a write every 10 s would wear an SD card), and
   * in full at a clean stop (`all`).
   */
  async saveState({ all = false } = {}) {
    const now = this.now();
    // The exact time of the last read only at a clean stop: a later save
    // (a new start) writes the time of the minute again.
    this.attemptExact = all && !this.busy;
    if (all) {
      this.savedAttemptAt = this.lastAttemptAt;
    }
    if (
      all ||
      this.savedFreshAt === undefined ||
      now < this.savedFreshAt ||
      now - this.savedFreshAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedFresh = this.fresh;
      this.savedFreshAt = now;
    }
    const indexes = Object.create(null);
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    const kept = keptIndexes(this.store.load().indexes);
    for (const id of Object.keys(indexes)) delete kept[id];
    const merged = Object.entries({ ...kept, ...indexes }).slice(-MAX_KEPT_INDEXES);
    const state = {
      deviceKey: this.deviceKey ?? null,
      serial: this.serial ?? null,
      keys: [...this.keys],
      pause: this.pause
        ? {
            until: this.pause.until,
            count: this.pause.count,
            code: this.pause.code,
            status: this.pause.status,
          }
        : null,
      lastAttemptAt: this.savedAttemptAt ?? null,
      attemptExact: this.attemptExact && this.savedAttemptAt === this.lastAttemptAt,
      shape: this.shape ?? null,
      fresh: this.savedFresh ?? null,
      indexes: Object.fromEntries(merged),
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return true;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      return true;
    } catch (err) {
      this.logger.warn(`Saving the ecotracker state in /data failed (${err?.code ?? 'error'})`);
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------------

  external() {
    return this.deviceKey ? ids(this.gladys, this.deviceKey) : undefined;
  }

  /** The created Gladys device of the reader, undefined until the user creates it. */
  createdDevice() {
    const id = this.external()?.device;
    return id ? (this.gladys.devices ?? []).find((d) => d.external_id === id) : undefined;
  }

  async discover() {
    if (!this.deviceKey || !this.session?.client) {
      return;
    }
    const keys = union(this.keys, capabilitiesOfDevice(this.createdDevice()));
    if (keys.size === 0) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([
        buildDevice(this.gladys, this.deviceKey, this.serial, keys, this.config.address),
      ])
      .catch((err) =>
        this.logger.warn(`Publishing the ecotracker device failed (${err?.name ?? 'Error'})`),
      );
  }

  /** The Discover tab asks: the known device, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    const external = this.external();
    if (!external || device?.external_id !== external.device) {
      return;
    }
    // A new device: no reference of its index yet (nor a state kept in /data
    // for a deleted device of the same id). Its values come at the next read.
    // A new guard set BEFORE any await (review r1, point 4): a read in
    // between never loads the state of the deleted device from /data, and
    // saveState() replaces it there, in its one queue.
    const id = external.feature(FEATURE.CONSUMPTION_INDEX);
    this.guards.set(id, new IndexGuard(undefined, undefined, this.now(), GUARD_LIMITS));
    this.pendingAccept = undefined;
    this.lastIndexAt = undefined;
    this.savedKey = undefined;
    await this.saveState();
    // The reader now answering has its device: the note about it ends.
    this.otherReader = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (device?.external_id === this.external()?.device) {
      // New features (Update in Discovery): their indexes at the next read.
      this.lastIndexAt = undefined;
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The guard of the index of the created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = keptIndexes(this.store.load().indexes)[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved, this.now(), GUARD_LIMITS),
      );
    }
    return this.guards.get(id);
  }

  /** The states of a reading: the live values every time, the indexes once a minute. */
  async publish(reading, mono, gone) {
    const created = this.createdDevice();
    if (!created || this.shapeChanged) {
      // Maybe another reader: nothing is published (review r1, point 3).
      return;
    }
    const external = this.external();
    // An old reading (frozen, or an old power), or one not yet seen moving
    // since a restart: its power would look live, it is not sent.
    const states = this.isLive(reading, mono) ? liveStates(external, reading) : [];
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      this.lastIndexAt = undefined;
    }
    if (this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL) {
      this.lastIndexAt = mono;
      const id = external.feature(FEATURE.CONSUMPTION_INDEX);
      const guard = this.guardOf(created, id);
      const raw = reading.imports.total;
      const total = finite(raw) ? round(raw, 3) : undefined;
      const plausible = total !== undefined && guard.accept(total, this.now());
      if (total !== undefined && !plausible && guard.held) {
        this.logger.warn(
          `ecotracker consumption index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      let index = plausible ? total : guard.held ? guard.last?.value : undefined;
      // The guard is in /data BEFORE Gladys gets the value: a crash in
      // between never sends an index /data does not know. Not written: the
      // index waits for the next minute.
      const saved = await this.saveState();
      if (gone()) return;
      if (!saved) {
        index = undefined;
        this.lastIndexAt = undefined;
      }
      states.push(...indexStates(external, reading, index));
    }
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) =>
        this.logger.warn(`Publishing the ecotracker values failed (${err?.name ?? 'Error'})`),
      );
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks (gladys-iskra / gladys-autarco,
   * approved): the first lists the index held (nothing is accepted); the
   * second, from 3 s to 5 min later and in the same session, accepts exactly
   * what the first listed, and only when the guard still holds the same
   * movement (same direction, same `from`, same threshold for a jump) and a
   * value within what the meter may have measured since the first click
   * (src/guard.js `margin`). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    // A changed shape first (a reader without serial after an outage): the
    // same two clicks take it, nothing else (review r1, point 3).
    const shape = this.shapeChanged
      ? [{ kind: 'shape', from: this.shapeChanged.from, to: this.shapeChanged.to }]
      : undefined;
    const list = shape ?? this.heldList();
    const mono = this.monotonic();
    const now = this.now();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (
      !pending ||
      pending.session !== this.session ||
      elapsed > ACCEPT_CONFIRM_WITHIN ||
      elapsed < ACCEPT_CONFIRM_AFTER
    ) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list, session: this.session };
      if (shape) {
        return T.accept.confirmShape(ACCEPT_CONFIRM_WITHIN);
      }
      // The most the meter may add between the clicks: maxKw over the window, plus the slack.
      const margin = (INDEX_MAX_KW * ACCEPT_CONFIRM_WITHIN) / 3_600_000 + INDEX_SLACK_KWH;
      return T.accept.confirm(list[0], ACCEPT_CONFIRM_WITHIN, margin);
    }
    if (pending.list[0]?.kind === 'shape') {
      const entry = pending.list[0];
      const now2 = this.shapeChanged;
      if (now2 && now2.from === entry.from && now2.to === entry.to) {
        this.shape = { key: NO_SERIAL_KEY, shape: entry.to };
        this.shapeChanged = undefined;
        this.lastIndexAt = undefined;
        this.logger.info('ecotracker: the new shape of the answer accepted by the user');
        await this.saveState();
        await this.updateStatus();
        return T.accept.shapeDone;
      }
      return now2 ? T.accept.changed : T.accept.nothing;
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.threshold === entry.threshold &&
            held.to >= entry.to &&
            held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
        this.logger.info(
          `ecotracker consumption index ${entry.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
        );
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    // Published at the next read (never a read sooner than the interval).
    this.lastIndexAt = undefined;
    return accepted.length > 0 ? T.accept.done(accepted[0]) : T.accept.changed;
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it; otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.config.invalidAddress ? T.badAddress : T.incomplete;
    }
    if (this.pauseLeft() > 0) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    const since = mono;
    try {
      return await Promise.race([this.tick().then(() => this.describeOutcome(since)), late]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /**
   * The last read in words, and the time to the next one. `since`: when this
   * click started a read; a read from then on is told as "read now".
   */
  describeOutcome(since) {
    const mono = this.monotonic();
    const next = Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return T.test.notYet(next);
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading' && outcome.unused) {
      // An answer without serial after a reader with one: the status tells it.
      return this.currentStatus()[1];
    }
    if (outcome.kind === 'reading') {
      const { serial, power, imports } = outcome.reading;
      // The index as published: the value held is told as held.
      const held = this.heldList().length > 0;
      return T.test.reading({ serial, power, index: imports.total, held }, ago, next);
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}
