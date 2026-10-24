# Configuration Reference

Complete reference for every environment variable read by the Discord Alert Bot.
Variable names, defaults, and requirements match `src/config/index.ts`, `src/index.ts`,
and `.env.example`. Do not commit `.env` or any file containing real tokens or keys.

## Loading rules

- `dotenv/config` loads `.env` at startup (src/index.ts:1).
- `loadConfig(logger)` in src/config/index.ts parses and validates all variables.
- Boolean variables accept `true`/`false` (case-insensitive, trimmed). Empty or
  missing values fall back to the documented default.
- Numeric variables use `parseInt(..., 10)`; non-numeric or missing values fall
  back to the documented default.
- `DELTA_API_BASE_URL` has trailing slashes stripped.
- `TRADE_STOP_LOSS_ENABLED` and `TRADE_CLOSE_ENABLED` are read directly from
  `process.env` in src/index.ts (not through `loadConfig`). They default to
  `false` and only take effect when `TRADE_MANAGEMENT_ENABLED=true`.

## Variable reference

### Discord

| Variable | Default | Required | Controls |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | `''` (empty) | Yes, for Discord | Bot authentication token from the Discord Developer Portal. If missing, Discord client is not started. |
| `ETHUSD_CHANNEL_ID` | `''` | Yes | Discord channel ID for ETHUSD price alerts. |
| `SOLUSD_CHANNEL_ID` | `''` | Yes | Discord channel ID for SOLUSD price alerts. |
| `BTCUSD_CHANNEL_ID` | `''` | Yes | Discord channel ID for BTCUSD price alerts. |

Channel validation: all three channel IDs must be present and unique. Empty or
whitespace-only values are treated as missing. Duplicate channel IDs across
symbols are rejected. Each symbol must use a different channel.

### Database & logging

| Variable | Default | Required | Controls |
|---|---|---|---|
| `DATABASE_PATH` | `./alerts.db` | No | SQLite database file path. Created automatically if missing; WAL journal mode and `synchronous = NORMAL` are used. |
| `LOG_LEVEL` | `info` | No | Console logger threshold. One of `debug`, `info`, `warn`, `error`. Lower = more verbose. |

### Delta Exchange public WebSocket (price alerts)

| Variable | Default | Required | Controls |
|---|---|---|---|
| `DELTA_WS_URL` | `wss://public-socket.india.delta.exchange` | No | WebSocket URL for the public Delta trades feed. |
| `DELTA_RECONNECT_INTERVAL_MS` | `2000` | No | Initial reconnect delay in ms. Backoff grows exponentially up to the max. |
| `DELTA_MAX_RECONNECT_INTERVAL_MS` | `60000` | No | Maximum reconnect delay in ms. |

Monitored symbols are hardcoded to `ETHUSD`, `SOLUSD`, `BTCUSD` in
`src/config/index.ts`. `DELTA_SYMBOLS` (present in `.env`) is **not read** by
the application and has no effect.

### Trade management (Delta Exchange India)

All trade-management features are off by default. Enabling `TRADE_MANAGEMENT_ENABLED`
requires `DELTA_API_KEY`, `DELTA_API_SECRET`, and `TRADE_DISCORD_CHANNEL_ID`.

| Variable | Default | Required | Controls |
|---|---|---|---|
| `TRADE_MANAGEMENT_ENABLED` | `false` | No | Master switch for trade management (position polling, stop loss, level monitoring, dashboard, `/level` commands). |
| `TRADE_DEMO_MODE` | `false` | No | Dry-run mode. Stop placement and close execution are simulated; no orders are submitted. |
| `DELTA_API_KEY` | `''` | Yes if trade mgmt enabled | Authenticated Delta REST API key. |
| `DELTA_API_SECRET` | `''` | Yes if trade mgmt enabled | Authenticated Delta REST API secret (used for HMAC signatures). |
| `DELTA_API_BASE_URL` | `https://api.india.delta.exchange` | No | Delta Exchange India REST base URL. Trailing slashes are stripped. |

### Independent safety gates

Each gate defaults to `false` (disabled) and is read directly from `process.env`.
These gates are orthogonal: enabling trade management alone does NOT enable
stop placement or closing.

| Variable | Default | Required | Controls |
|---|---|---|---|
| `TRADE_STOP_LOSS_ENABLED` | `false` | No | Live stop placement gate. When true, the integration tick attempts to adopt/place reduce-only stop-loss orders on positions without a verified stop. When false, stops are never placed live (dry-run only via `TRADE_DEMO_MODE`). |
| `TRADE_CLOSE_ENABLED` | `false` | No | Live close execution gate. When false, the level monitor runs in dry-run mode for closes (`dryRun = demoMode || !closeEnabled`). When true and demo mode off, reduce-only market close orders are submitted. |

### Stop loss & monitoring

| Variable | Default | Required | Controls |
|---|---|---|---|
| `TRADE_STOP_LOSS_OFFSET` | `100` | No | Offset from entry price (quote-currency units) used to calculate stop price: `entry - offset` for BUY/LONG, `entry + offset` for SELL/SHORT. Must be positive when trade management is enabled. |
| `TRADE_POLL_INTERVAL_MS` | `30000` | No | Position-poll interval in ms. Also used for the integration tick (`max(pollIntervalMs, 5000)`). Must be >= 1000 when trade management is enabled. |

### Trade dashboard

| Variable | Default | Required | Controls |
|---|---|---|---|
| `TRADE_DISCORD_CHANNEL_ID` | `''` | Yes if trade mgmt enabled | Dedicated Discord channel ID for the trade dashboard. No fallback to alert channels. Required when trade management is enabled. |
| `TRADE_DASHBOARD_THROTTLE_MS` | `5000` | No | Minimum ms between dashboard refreshes. Effective interval is `max(throttleMs, 5000)`. Must be >= 1000 when trade management is enabled. |

## Flag interaction matrix

| `TRADE_MANAGEMENT_ENABLED` | `TRADE_STOP_LOSS_ENABLED` | `TRADE_CLOSE_ENABLED` | `TRADE_DEMO_MODE` | Behavior |
|---|---|---|---|---|
| false | any | any | any | Trade management off. Alert-only mode. |
| true | false | any | true | Read-only monitoring + dashboard. No live stops or closes. |
| true | true | false | false | Stop placement live (reduce-only). Closing dry-run only. |
| true | true | true | false | Stops live; closes live (reduce-only market, flatness verified). |
| true | true | true | true | Everything dry-run; no orders submitted. |

## Safe configuration examples

### Read-only testing (recommended first step with trade management)

```
TRADE_MANAGEMENT_ENABLED=true
TRADE_DEMO_MODE=true
TRADE_STOP_LOSS_ENABLED=false
TRADE_CLOSE_ENABLED=false
```
No exchange orders are submitted. Positions are discovered and reconciled;
dashboards render; `/level` commands work but stops are not placed and trades
are not closed.

### Stop placement dry-run (no live orders)

```
TRADE_MANAGEMENT_ENABLED=true
TRADE_DEMO_MODE=true
TRADE_STOP_LOSS_ENABLED=true
TRADE_CLOSE_ENABLED=false
```
Stop-loss calculation and dry-run logging run, but `placeOrder` is never
called.

### Live stop placement only (no auto-close)

```
TRADE_MANAGEMENT_ENABLED=true
TRADE_DEMO_MODE=false
TRADE_STOP_LOSS_ENABLED=true
TRADE_CLOSE_ENABLED=false
```
Reduce-only stop-market orders may be placed on the exchange. Automatic close
execution is disabled.

### Full live operation (stop + close)

```
TRADE_MANAGEMENT_ENABLED=true
TRADE_DEMO_MODE=false
TRADE_STOP_LOSS_ENABLED=true
TRADE_CLOSE_ENABLED=true
```
Stop placement and automatic close execution are both live. Use only after
read-only testing on a non-production account.

## Settings that authorize exchange orders

The following combinations can cause the bot to submit orders to Delta Exchange:

- `TRADE_STOP_LOSS_ENABLED=true` + `TRADE_DEMO_MODE=false` (stop-market, reduce-only)
- `TRADE_CLOSE_ENABLED=true` + `TRADE_DEMO_MODE=false` (market close, reduce-only)

Always test with `TRADE_DEMO_MODE=true` first. API keys should use least
privilege and be IP-restricted (trusted IPs / Elastic IP). See docs/DEPLOYMENT.md
and the Security section of README.md.

## Existing-but-unused or non-functional settings

- `processed_candles` table exists in the SQLite schema
  (src/database/index.ts:120) but is never written or read by the application.
  It is reserved/unused.
- `DELTA_SYMBOLS` in `.env` is not read; monitored symbols are hardcoded.
- `TRADE_STOP_LOSS_ENABLED` and `TRADE_CLOSE_ENABLED` are not part of the
  `TradeManagementConfig` interface; they are read directly from `process.env`
  in src/index.ts:122-123.
