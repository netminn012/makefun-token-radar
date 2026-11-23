# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/netminn012/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/netminn012/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar for make.fun's "Build the best token launch radar" bounty. It reads the sealed DefiLlama snapshot, ranks every pre-token protocol on the watchlist plus the strongest early finds below its floor by implied value, and hands each one a concrete farm plan.

The implied-value model is derived from the snapshot itself, never from a hardcoded list: each protocol's TVL is multiplied by the median market-cap/TVL of the snapshot's token-bearing protocols in the same category (the global median where a category has fewer than five traded peers, clamped to [0.05, 3]), then adjusted for seven-day TVL growth and for how long the protocol has run with no token. The dashboard states the model, shows each row's own inputs and arithmetic, and separates protocols whose token already trades from those still to come.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

This writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. Open `dashboard/index.html` from the output tree to use the radar; it renders with no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ht2t8hac&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
