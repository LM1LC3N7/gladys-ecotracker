# EcoTracker

Unofficial integration, not affiliated with everHome. It reads an
**EcoTracker**, the everHome optical reader clipped on the infrared port of
an electricity meter, through its local API: no cloud, no account, nothing
sent to the reader but one read (`GET /v1/json`) every 10 seconds.

**Never tested with a real EcoTracker**: the integration was written from
the maker's Python library (everhome-gmbh/ecotracker) and the published
description of its local API. Your feedback is welcome.

## What you get

One **EcoTracker** device (or **EcoTracker <serial number>** when the reader
gives one), with the values the meter gives (a meter sends only some of
them):

| Feature                                    | Kind                     | Field of the reader            |
| ------------------------------------------ | ------------------------ | ------------------------------ |
| Net power (negative when the home injects) | energy sensor, W         | `power`                        |
| Consumption index                          | energy index, kWh        | `energyCounterIn`              |
| Consumption index, tariffs 1 and 2 (kWh)   | plain sensor             | `energyCounterInT1`, `…T2`     |
| Injection index (kWh)                      | plain sensor             | `energyCounterOut`             |
| Net power, average of the last minute      | plain sensor, W          | `powerAvg`                     |
| Power L1, L2, L3 (W)                       | plain sensor, no history | `powerPhase1` to `powerPhase3` |
| Wi-Fi signal (dBm)                         | plain sensor, no history | `rssi` (when given)            |

- The **consumption index** feeds the Gladys energy monitoring, which
  derives the consumption and its cost from it. It is published once a
  minute and checked first: never 0; any drop, even of 1 Wh, or a jump the
  home could not have drawn (more than 50 kW on average) is **held back**
  (the last accepted value is sent again), kept across restarts and shown in
  the status of the integration. Neither time nor repetition confirms it.
- The **injection** and the **tariffs** never enter the energy monitoring
  (the injection would be billed as consumption, the tariffs counted twice):
  plain sensors.
- The reader gives its counters in Wh (published API description and a real
  answer): they are converted to kWh.
- The powers are sent every 10 seconds, only when they change (and every
  10 minutes otherwise). They are not sent:
  - when the reader says (field `agePower`) that its power is more than a
    minute old;
  - when no value read (powers, counters) has moved for 15 minutes: the
    reader may serve an old reading (optical head moved); a meter at rest may
    too, the status says so;
  - after a start, until the reading moves (about ten seconds), unless
    `agePower` says it is recent: a reading frozen before a restart is not
    sent as new.

  The index goes on in all these cases.

- When the meter later gives new values (meter unlocked with its PIN), the
  device gets new features: in the **Discover** tab, click **Update** on the
  device to add them (its history is kept).

## Setup

1. Install the EcoTracker on your meter and connect it to your Wi-Fi with the
   everHome app, as the maker explains. If the app offers it, turn on the
   local API of the reader.
2. Find its IP address (in your router or the app) and preferably give it a
   fixed address in your router.
3. In Gladys, open the integration, enter this address, save.
4. In the **Discover** tab, create the device.

If the status says the meter gives no power, it is probably PIN-locked:
enter on the meter the PIN given by your grid operator to unlock its
extended data. The indexes go on meanwhile.

## Buttons

- **Test the connection**: reads the reader when a read is due (never more
  than one every 10 seconds), otherwise tells the last read.
- **Accept the held index**, in two clicks, only when the held value is right
  (new meter, long outage):
  - the first click shows the movement held (a jump or a drop) and accepts
    nothing;
  - the second click, from 3 seconds to 5 minutes later, takes that value,
    plus what the meter may have measured between the two clicks (at most
    4.667 kWh);
  - when the held value changed otherwise between the clicks (another
    direction, another starting point, a larger jump), nothing is taken: look
    at the status and start again.

  An accepted jump is counted at once as consumption; an accepted drop bills
  nothing, the consumption goes on from there. Saving the configuration never
  accepts anything.

## Identity of the reader

- The real reader we know gives no serial number in its local answer: the
  device is then named **EcoTracker** (`ecotracker:reader`), and another
  reader answering at the same address cannot be told from it. The status
  recalls it; the guard of the index holds the jump or drop it would cause
  anyway.
- When the reader gives a serial number (field `serial`, read by the maker's
  library), the device carries it and every answer is checked: another
  number at the same address gets its own device, its values never go to the
  previous one; an unreadable number is not used (red status, new try
  spaced out).
- An answer without number after a reader that gave one is not used while
  the device of that reader exists: the status says so. If you replaced the
  reader with one without number, delete the old device in Gladys: the new
  reader then gets its own device.
- Going from a reader without number to one with a number (after an update
  of the reader, for instance) creates a new device, without the history of
  the old one.

## Limits

- One reader per integration.
- An unreadable counter (text, negative value, 0, out of bounds) is never
  used: the status says so.
- Read-only: the reader receives no command.

## Troubleshooting

The status of the integration says what is going on: missing or invalid
address, unreachable reader or unexpected answer (new try after 10 s, doubled
up to 5 minutes), reader asking to wait (HTTP 429 or 5xx: reads paused from
1 minute to 6 hours, kept across a restart), index held back, old values. To
look at the reader yourself, open `http://<address>/v1/json` in a browser on
the same network.
