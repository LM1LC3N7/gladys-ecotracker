# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real EcoTracker (a three-phase meter
      ideally, one PIN-locked): test button, device creation, the
      consumption the core derives from the index.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real reader (built without one)

- [ ] The unit of the counters: Wh in the published description of the API
      and in a real answer (1 541 618.4 for a home), kWh in the README of the
      maker's library; T1 and T2 have no unit in the description (Wh assumed,
      its example has In = T1 + T2). Read in Wh here. A reader in kWh on an
      existing device gives a drop held by the guard; on a device created on
      it, the guard takes the first value, so the index would be 1000 times
      too small and rounded to the kWh: the unit check (index rise against
      the integral of the power over 1 kWh, ratio outside 1/20..20; T1 + T2
      against the index) tells it in the status and the log, without
      stopping the index.
- [ ] Whether some firmware sends `serial`, `firmwareVersion` and `rssi` (the
      maker's library reads them; the real answer we know has none).
- [ ] `agePower`: the age of the power in ms (496 in the real answer)? Does
      it grow when the optical head loses the meter?
- [ ] The PIN-locked meter: no `power` at all, or `power` at 0? Does it give
      the index to the whole kWh only (the "frozen" note is not shown when
      the answer has no power at all)?
- [ ] Whether the local API must be turned on in the everHome app.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-ecotracker:0.1.0`),
  as for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: everhome-gmbh/ecotracker (the maker, MIT, 0.1.14,
  `main` at commit e6af261, its only commit, 2025-05), cloned read-only in
  `~/code/ref/lot15/ecotracker`, ported to JavaScript (`src/ecotracker/`):
  the page, the fields, the serial. The library is thin (one GET, field
  getters): the units, the sign and `agePower` come from the published API
  description quoted in wwerther/ha-ecotracker-emulator (MIT, no code taken,
  see THIRD_PARTY_NOTICES.md). Home Assistant has no `ecotracker`
  integration in its core; stefanseeger/ecotracker (HACS) is GPL-3.0: not
  read. The SDK stays the only runtime dependency. Structure from
  gladys-energieleser (the same kind of reader, approved); the pause on a
  monotonic clock, the clean stop and the two-click acceptance from
  gladys-iskra / gladys-autarco (approved). The template's demo files were
  removed with `git rm`.
- **Read-only**: the reader takes no command.
- **External id (fixed forever)**: `ecotracker:sn-<serial in lower case>`
  when the answer carries a readable serial (`^[A-Za-z0-9][A-Za-z0-9_-]{2,47}$`,
  at least one digit, not only zeros), `ecotracker:reader` otherwise. One
  reader per integration; the address is only a param. The library's
  fallback of the serial to the IP address is not ported: an address is never
  an identity.
- **Identity, checked at every read**: the values of an answer go to the
  device of the serial of that same answer; another serial at the address
  gets its own device and never writes into the old one (status note). A
  serial present but unreadable is a wrong answer (red, retries doubled),
  never "another reader". An answer without serial, while any created device
  of a reader with a serial exists in Gladys (read from `gladys.devices`, not
  `/data`, which may be lost), is not used and does not touch `/data` (a
  weaker identity never downgrades a stronger one); deleting that device
  lets the serial-less reader get its own (documented). A reader that gives
  no serial cannot always be told from another one at the same address: a
  fixed address is needed (status note, docs, manifest). The shape of its
  answer (the meter fields present: powers, phases, counters, tariffs; never
  `agePower`, `rssi`, `firmwareVersion`, `serial`, which belong to the reader
  and change with a firmware: review r2) is kept in `/data`; after an outage
  (a start, a failure) another shape holds every value and does not grow the
  Discovery features until it comes back or the user accepts it in two
  clicks; without outage, a new shape becomes the reference after 3
  identical answers in a row (a single odd answer never does). With the same shape, the guard holds a drop or a
  rise above 50 kW x the hours since the last accepted value, and takes a
  smaller rise as consumption (stated as such in the status and the docs).
- **Energy index (lot 6 rules)**: `energyCounterIn` in Wh, rounded to the
  Wh, converted to kWh; 0, below 0, a text or `""` is never a value. It
  passes `IndexGuard` (`src/guard.js`, the approved file of
  gladys-p1-monitor with `maxKw` as a parameter, identical to
  gladys-energieleser's and gladys-iskra's; 50 kW, 0.5 kWh slack: 63 A x
  3 phases is about 43 kW) once a minute; a held value is sent as the last
  accepted one; the guard is in `/data` before Gladys gets the value, and a
  failed write sends no index that minute. The tariff counters and the
  injection are plain sensors (never an index, never `energy`), never 0. No
  `publishEnergyConsumption`, no scene event (tested).
- **Acceptance in two clicks (gladys-autarco / gladys-iskra, approved)**: the
  first click lists the index held and accepts nothing; the second, from 3 s
  to 5 min later and in the same session, accepts only when the guard still
  holds the same movement (direction, `from`, the threshold of a jump) and a
  value within the margin of the guard since the first click (at most
  4.667 kWh in 5 min at 50 kW). A save of the form never accepts.
- **Power**: `power` is the net power, signed (negative when injecting, as
  the published API says): the only energy-sensor power, min -100 kW.
  `powerAvg` and the phases are plain sensors (the phases without history).
- **Freshness**: the answer has no time of its own. `agePower` above 1 min:
  the live values are not sent. A fingerprint of the values (powers,
  counters; not `agePower`, not the signal) unchanged for 15 min: the live
  values are not sent (no heartbeat either), the index goes on. The hash of
  the fingerprint (16 hex digits, never the values) and the wall time it
  changed are kept in `/data`: after a restart, the same values keep their
  age; other values are trusted only once they move or when `agePower` says
  the power is recent. A meter at rest with no power field can be taken for
  frozen; the effect is only that its signal is not re-sent (the status says
  "or a meter at rest").
- **Pace (lot 11 lessons)**: one timer, one read at a time, never two reads
  less than 10 s apart whatever asks: a reconnection, a save, the Discover
  tab, a device created, the accept button only wait for the next read; the
  test button reads only when one is due. One clock read per decision
  (`dueAt(mono)`): a real clock always moves between two reads (review r1:
  without it, no read ever went). The test clock moves at every call, and a
  test runs real timers (sped up 20 times, read instants taken where the
  app calls fetch) against a real local server. The time of the last
  read is in `/data` (written at most once a minute, exactly at a clean
  stop); after a crash (time not marked exact, less than 70 s old) the first
  read waits a whole interval. A reconnection during a read does not start
  another one.
- **Late answers (lot 11)**: a read belongs to the session of its address; a
  late answer of an old address publishes nothing and sets no status (checked
  after every await, tested).
- **Errors**: unreachable or wrong answer: retries 10 s doubled to 5 min.
  429/5xx: pause from Retry-After or 1 min doubled, bounded 1 min to 6 h,
  counted from the failure; in memory on the monotonic clock (its rest capped
  to 6 h at every use), in `/data` on the wall clock (capped when read back);
  a reconnection keeps it, another address ends it.
- **Clean stop**: `/data` written at once (Docker stops the container 10 s
  after asking), then the read running is awaited at most 5 s, then written
  again.
- **`/data` writes**: the guard once a minute, the time of the last read and
  the freshness at most once a minute (an SD card is not written every
  10 s).
- **Hostile answers**: 16 KiB read into one buffer allocated once (a gzip
  bomb is cut at 16 KiB decompressed), 10 s for the whole answer, no redirect
  followed, 64 fields at most, every value against strict types and bounds,
  only own keys read (no prototype pollution, tested), nothing read as 0 by
  default. Tested against real local HTTP servers.
- **Secrets**: none (the local API has no login). Logs and statuses use our
  own codes only, never a text of the reader.
- **States**: `publishChangedStates` with a 10-minute heartbeat: at most
  6 live states every 10 s and 4 counters a minute (about 40 a minute), far
  below the 300 states a minute of Gladys.
- **Every connection** publishes the status and the Discovery list again and
  forgets the published states.
- **No custom User-Agent**, no imitation: Node's own fetch, one GET.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- Several readers in one integration (a list of addresses).
- The everHome cloud API (not needed: the local API gives the same values).
