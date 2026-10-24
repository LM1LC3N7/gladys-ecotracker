# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, and test data taken from the
documentation of a second one, each distributed under its own license.

## ecotracker (everhome-gmbh/ecotracker)

<https://github.com/everhome-gmbh/ecotracker>, by everHome (everhome-gmbh),
the maker of the EcoTracker. Version 0.1.14 (`main` at commit e6af261,
2025-05-14).

Ported to JavaScript in `src/ecotracker/client.js` and
`src/ecotracker/model.js`: the local API of the reader (`GET /v1/json` on
port 80, one JSON object, a 10-second timeout) and its fields (`power`,
`powerPhase1` to `powerPhase3`, `powerAvg`, `energyCounterIn`,
`energyCounterInT1`, `energyCounterInT2`, `energyCounterOut`, `serial`,
`firmwareVersion`, `rssi`), every field optional, the serial number naming
the reader. Changed here: the energy counters are read in Wh (the published
description of the local API and a real answer, against the kWh of the
library's README), values are read against strict types and bounds, the
library's fallback of the serial to the IP address is not ported.

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2025 everhome-gmbh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ha-ecotracker-emulator (wwerther/ha-ecotracker-emulator)

<https://github.com/wwerther/ha-ecotracker-emulator>, by Walter Werther
(`main` at commit 59ba8ea, 2026-05-17). No code is taken from it. Its file
`docs/api-spec.md` (the published description of the local API, and an
answer captured from a real EcoTracker) gave the units (Wh), the sign of the
power, the `agePower` field and the test answers of
`test/fixtures/ecotracker.js` (`SPEC`, `REAL`, `REAL_TEXT`).

Its license, reproduced as it appears in the repository:

```
MIT License

Copyright (c) 2026 Walter Werther

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-energieleser, gladys-p1-monitor, gladys-iskra, gladys-autarco

The plausibility guard of the billed index (`src/guard.js`, the approved file
of gladys-p1-monitor with its margin as a parameter), the `/data` store
(`src/store.js`), the address parser (`src/config.js`), the pace of the
reads, the pauses on a monotonic clock and the two-click acceptance come from
the sibling integrations
[gladys-energieleser](https://github.com/LM1LC3N7/gladys-energieleser),
[gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor),
[gladys-iskra](https://github.com/LM1LC3N7/gladys-iskra) and
[gladys-autarco](https://github.com/LM1LC3N7/gladys-autarco), same project,
Apache-2.0.
