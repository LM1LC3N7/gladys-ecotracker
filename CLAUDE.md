# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads an **EcoTracker** (everHome, the optical reader of an electricity
meter) through its local API (`GET http://<address>/v1/json`, one JSON
object, no login, no cloud). The page and its fields are ported from
[ecotracker](https://github.com/everhome-gmbh/ecotracker) (everHome, MIT, see
`THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with everHome.
**Read-only**: never `onSetValue`. Siblings: `gladys-energieleser` (the
structure), `gladys-p1-monitor` (the guard), `gladys-iskra` /
`gladys-autarco` (the pauses, the stop, the two-click acceptance).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        EcoTrackerApp: the pace, identity, freshness, the index, pauses, buttons
src/ecotracker/client.js          the only HTTP access (one GET, bounded, our error codes)
src/ecotracker/model.js           the answer -> values, the serial, the fingerprint (pure)
src/guard.js                      plausibility of an energy index (approved shared file, pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     the address, normalized
src/constants.js                  page, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, a fake reader, a virtual clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `consumption_index` (`energy-sensor` / `index`,
  `energyCounterIn` in kWh) is the only index; it passes `IndexGuard`
  (`src/guard.js`, 50 kW, 0.5 kWh): never 0, a drop and a jump never
  confirmed by repetition nor by time, taken only by the `accept_held_index`
  action in two clicks, bounded to what the first click listed. The tariffs
  and the injection are plain sensors: never an index, never `energy`, never
  `publishEnergyConsumption`. Do not change `src/guard.js` without the same
  change in its siblings and a review.
- **Units**: only the core's (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): W and kWh
  for `energy-sensor`, none for `unknown` (the unit is in the name). The
  counters of the reader are in Wh.
- **The pace**: never two reads less than 10 s apart, whatever asks; the time
  of the last read is in `/data`. Never add a read path that skips `dueAt()`.
- **Late answers**: every await in a read is followed by `gone()`; an old
  session never publishes nor sets a status.
- **Identity**: the values of an answer go to the device of the serial of
  that answer (`ecotracker:sn-<serial>`, or `ecotracker:reader` without
  serial). An unreadable serial is a wrong answer, never another reader; no
  serial after a serial (device existing) is not used.
- **Freshness**: `agePower` above 1 min or values unchanged for 15 min: no
  live value sent; the index goes on.
- **Pauses**: 429/5xx pause from 1 min to 6 h, on the monotonic clock in
  memory, kept in `/data` (end capped when read back); a reconnection clears
  neither a pause nor the client.
- **Never a text of the reader in a message**, never a URL in the logs.
- **External ids are forever**: `ecotracker:<key>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys and actions. Features only grow: a
  device published again keeps every feature it was created with.
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/ecotracker-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM nor control bytes (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the client tests use local
  servers on 127.0.0.1 only).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is not
  a bug in the code.

## Checking an answer against a real reader

On the same LAN as the reader:

```bash
curl -s "http://192.168.1.70/v1/json"; echo
```

Change the serial digits (when there is one) before the answer becomes a
fixture.
