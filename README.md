# gladys-ecotracker

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**EcoTracker** (everHome), the optical reader of electricity meters, read
through its local API (`GET http://<address>/v1/json`), no cloud. Not
affiliated with everHome.

**Never tested with a real EcoTracker**: built from the maker's Python library
[everhome-gmbh/ecotracker](https://github.com/everhome-gmbh/ecotracker) (MIT)
and the published description of the local API, ported to JavaScript.

- Net power every 10 s, as the energy-sensor power.
- Consumption index (`energyCounterIn`, Wh converted to kWh) once a minute,
  as the only energy index of the Gladys energy monitoring, checked by a
  guard: never 0, a drop or a jump held until the user accepts it in two
  clicks.
- Tariff counters, injection, average power, the power per phase and the
  Wi-Fi signal as plain sensors (the injection is never billed).
- Old readings (`agePower`, values frozen for 15 minutes) are not sent as
  live values; the serial number, when the reader gives one, is checked at
  every read.
- Read-only. One reader per integration.

User guides: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm run format:check
npm run lint
npm test
npm run audit
npm run cover        # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .
```

Architecture and rules: [CLAUDE.md](CLAUDE.md). Decisions and open points:
[TODO.md](TODO.md). Releases: Actions → Release (see
[CHANGELOG.md](CHANGELOG.md)).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the ported logic of
everhome-gmbh/ecotracker is under MIT, see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
