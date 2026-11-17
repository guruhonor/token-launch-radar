# Token Radar

A token launch radar: every pre-token protocol in the sealed DefiLlama
snapshot, ranked by an implied value computed from the snapshot's own
numbers, with a concrete farm plan for each row.

## Run

```sh
node main.ts
```

Reads `/input/snapshot.json` and writes the bundle to `/output` (or
`MAKEFUN_OUTPUT_DIR`). Options: `--input <dir>`, `--output <dir>`. Node
22.18+ only, standard library only, no network, no clock — the same
snapshot bytes always produce the same output bytes.

## What the entry contains

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes
  `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, and
  builds `dossier.json` with the vendor library.
- `lib/model.ts` — the model: snapshot parsing, the implied-value formula,
  the farm-plan generator, board construction, and the data.js writer.
- `vendor/makefun-board.ts` — the house dossier library, copied from the
  competition kit (see its header).
- `dashboard/` — the offline dashboard: `index.html`, `app.css`, `app.js`.
  The page recomputes every row's value and farm plan from the same model,
  so the detail view shows the model's working and can be checked against
  the board.
- `screenshots/` — three screenshots of the dashboard (board, protocol
  detail, filtered view).
- `BUILD_LOG.md` — the build log.

## The model ("radar-2")

```
implied = TVL × sector(category) × growth × maturity
growth   = 1 + 0.6 × clamp(change_7d, −60, 120) / 100
maturity = 0.70 + 0.30 × min(age_days, 1460) / 1460
```

Sector multiple: 0.50 for exchange-like protocols (DEXs, lending, CDPs,
derivatives, perpetuals); 0.40 for allocators (vaults, curators, yield
aggregators); 0.30 for asset and utility protocols (RWA, wrappers,
payments, chains) and for any category the model does not name. A protocol
with no seven-day change scores a growth multiplier of 1; a protocol with
no listing date scores as if it were a year old.

The board is every protocol that passes the house's own exclusion rule:
no token on record, TVL above zero, not a bridge, liquid-staking,
restaking or CEX product, not a wrapped or staked product, not an
exchange product, not a versioned duplicate. That is the 40 watchlist
protocols plus every other rule-clean pre-token protocol in the snapshot
(158), for 198 rows. Token-bearing protocols are shown separately in the
dashboard's "Live token" tab, and the protocols the rule sets aside are
shown in the "Set aside" tab with the reason each one was left out.

## Farm plans

Each row gets seven steps, generated from the protocol's own numbers: the
capital follows its TVL ($50–$250), the gas follows its main chain, the
hold period follows its age (30–60 days), and the main action follows its
category. Every step states a cost and a time.
