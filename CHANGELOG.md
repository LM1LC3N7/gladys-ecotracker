# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: an EcoTracker (everHome) read through its local API
  (`/v1/json`) every 10 seconds, one device per reader, keyed by its serial
  number when it gives one.
- Net power as the energy-sensor power; the consumption index
  (`energyCounterIn`, Wh converted to kWh) as the only energy index,
  published once a minute and checked by a guard (never 0, a drop or a jump
  held until "Accept the held index" in two clicks, kept in `/data`).
- Tariff counters, injection, average power, power per phase and Wi-Fi
  signal as plain sensors (the injection is never billed).
- Old readings are not sent as live values: `agePower` above a minute,
  values unchanged for 15 minutes, a reading frozen before a restart.
- Status notes: no serial number, another reader at the address, an answer
  without serial after a reader with one, no power (PIN-locked meter),
  unusable counter, index held back.
- Test button that never reads faster than the 10-second pace; pace and
  429/5xx pauses kept across restarts, pauses on a monotonic clock.
