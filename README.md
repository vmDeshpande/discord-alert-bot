# Discord Alert Bot

Discord bot that monitors Delta Exchange (India) prices for ETHUSD, SOLUSD, and
BTCUSD and sends price alerts. Includes optional trade management with
independent safety gates: position reconciliation, protective stop-losses,
multi-level 3-minute candle monitoring, and automated reduce-only closes.

**No live trading by default.** Every trade-management action is off unless you
explicitly enable it. Read the Safety section before enabling trade management.

## Features

- Price alerts via WebSocket trade feed from Delta Exchange public socket
  (`ETHUSD`, `SOLUSD`, `BTCUSD`)
- `/alert set|delete|activate|deactivate|list` with per-channel select menus
- Optional trade management (`TRADE_MANAGEMENT_ENABLED`)
- Position discovery/reconciliation from authenticated Delta REST API
- Protective stop-loss: adopt existing or place reduce-only stop-market orders
- Multiple monitoring levels per trade with 3-minute candle HOLD/CLOSE rules
- Automated reduce-only close with flatness verification
- Dedicated Discord dashboard channel with trade embeds and Manage Trade
  buttons/modals/select menus
- SQLite persistence (WAL); restart recovery of trade/session state
- Console logging, graceful shutdown on SIGTERM/SIGINT

## Requirements

- Node.js 22+ and npm
- Discord application with a bot token
- Delta Exchange India API key/secret (trade management only)
- Four Discord channels: one each for ETHUSD, SOLUSD, BTCUSD alerts, plus one
  dashboard channel if trade management is enabled

## Quick start (alert-only)

```bash
git clone <repo>
cd discord-alert-bot
npm ci
cp .env.example .env
# Edit .env: set DISCORD_BOT_TOKEN, ETHUSD_CHANNEL_ID, SOLUSD_CHANNEL_ID,
# BTCUSD_CHANNEL_ID
npm run build
npm start
```

Invite the bot to your server and use `/alert set price:4500` in #ETHUSD
(etc.).

## Environment configuration

Copy `.env.example` to `.env` and fill in values. All variables are documented
in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Key variables:

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token (required) |
| `ETHUSD_CHANNEL_ID`, `SOLUSD_CHANNEL_ID`, `BTCUSD_CHANNEL_ID` | Alert channels (all required, must be unique) |
| `DATABASE_PATH` | SQLite file (default `./alerts.db`) |
| `LOG_LEVEL` | `debug\|info\|warn\|error` (default `info`) |
| `DELTA_WS_URL` | Public Delta WebSocket (default `wss://public-socket.india.delta.exchange`) |

Trade management (all off by default):

| Variable | Purpose |
|---|---|
| `TRADE_MANAGEMENT_ENABLED` | Master switch (`false`) |
| `TRADE_DEMO_MODE` | Dry-run, no orders (`false`) |
| `DELTA_API_KEY`, `DELTA_API_SECRET` | Authenticated Delta API (required if trade mgmt on) |
| `TRADE_STOP_LOSS_ENABLED` | Live stop placement gate (`false`) |
| `TRADE_CLOSE_ENABLED` | Live close execution gate (`false`) |
| `TRADE_DISCORD_CHANNEL_ID` | Dashboard channel (required if trade mgmt on) |
| `TRADE_STOP_LOSS_OFFSET` | Stop offset from entry (default `100`) |
| `TRADE_POLL_INTERVAL_MS` | Position poll interval (default `30000`) |
| `TRADE_DASHBOARD_THROTTLE_MS` | Dashboard refresh throttle (default `5000`) |

## Discord application and bot setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and create an application.
2. Add a Bot, copy the token into `DISCORD_BOT_TOKEN`.
3. Enable Gateway Intents: **Guilds** and **Guild Messages** (the bot hardcodes
   these; message content intent is not required).
4. Copy Channel IDs (Developer Mode → right-click channel → Copy Channel ID) into
   `ETHUSD_CHANNEL_ID`, `SOLUSD_CHANNEL_ID`, `BTCUSD_CHANNEL_ID`.
5. Generate an invite link with the `bot` scope and `applications.commands`
   permission, plus channel permissions:
   - Alert channels: View Channel, Send Messages, Read Message History, Embed
     Links, Manage Messages
   - Dashboard channel (trade management): same, plus Manage Messages

Slash commands register globally on bot startup; propagation can take up to an
hour.

## Delta Exchange API key setup

Required only when `TRADE_MANAGEMENT_ENABLED=true`.

1. Create an API key/secret in your Delta Exchange (India) account.
2. **Trusted IPs:** add the egress IP of your host to the key's trusted-IP
   whitelist. On EC2, assign an Elastic IP and whitelist it; otherwise API
   requests are rejected.
3. Use least-privilege permissions: read positions/orders; enable order
   placement only if you intend to use live stop/close gates.
4. Set `DELTA_API_KEY`, `DELTA_API_SECRET`, and
   `DELTA_API_BASE_URL=https://api.india.delta.exchange` in `.env`.

## Build, test, typecheck, lint, run

```bash
npm ci          # install dependencies
npm run build   # compile TypeScript to dist/
npm start       # run the bot
npm run dev     # run via ts-node (development)
npm test        # run jest suite
npm run typecheck
npm run lint
```

## Discord commands

### /alert — price alerts (always on)

- `/alert set price:<target>` — create a one-shot alert in the current channel.
  Baseline price is fetched from Delta; direction is inferred from target vs
  baseline. When the price crosses the target, an alert is posted and the alert
  is deleted.
- `/alert list` — list all alerts in the channel.
- `/alert delete` / `/alert activate` / `/alert deactivate` — select-menu driven;
  pick an alert from the list.

Works only in #ETHUSD, #SOLUSD, #BTCUSD. Responses are not ephemeral.

### /level — trade levels (trade management only)

Available when `TRADE_MANAGEMENT_ENABLED=true`. Requires a trade with a verified
stop-loss before levels can be added or activated.

- `/level set trade_id:<id> price:<price> condition:<BUY\|SELL>` — add an
  inactive level to a trade.
- `/level list [trade_id]` — list levels for a trade (or all trades).
- `/level activate trade_id:<id> level_id:<id>` — activate a level.
- `/level deactivate trade_id:<id> level_id:<id>` — deactivate a level.
- `/level delete trade_id:<id> level_id:<id>` — delete a level.

`/level` responses are ephemeral. Full command details:
[docs/COMMANDS.md](docs/COMMANDS.md).

> Note: all `/level` options are registered as optional in Discord but required
> by the handler; incomplete invocations are rejected with a validation message.

### Manage Trade interactions (dashboard)

On the dashboard trade embed: **Add Level** (opens a modal), **List Levels**,
**Refresh**, and **Activate/Deactivate/Delete** (level select menu). These
buttons/modals/selects manage the levels bound to a trade session.

## Dashboard channel

`TRADE_DISCORD_CHANNEL_ID` hosts one embed per open trade (symbol, entry, size,
mark price, PnL, stop loss, status, last event, updated) plus "Last Exchange
Reconcile" and "Data Freshness". Messages are created, edited, and recovered
after restarts from persisted message IDs. Closed trades are skipped. Full
details: [docs/DASHBOARD.md](docs/DASHBOARD.md).

## Trade management workflow

1. Position poller discovers open Delta positions as trade sessions
   (`monitoring_status='pending'` → `active`).
2. Stop-loss manager adopts or places a verified reduce-only stop
   (`stop_loss_status='verified'`, gated by `TRADE_STOP_LOSS_ENABLED`).
3. Add levels to the trade; activate them (`status='active'`).
4. Level monitor watches 3-minute candles: on a level touch, only the next
   completed candle's close decides — strictly above/below means CLOSE,
   otherwise HOLD (equality means HOLD). HOLD consumes only that level.
5. On CLOSE, a reduce-only market close is executed and flatness is verified;
   the trade is marked closed and remaining levels are cleaned up.

Full details: [docs/TRADE_MANAGEMENT.md](docs/TRADE_MANAGEMENT.md).

## Deployment (Amazon Linux 2023)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the systemd unit, logs
(`journalctl -u discord-alert-bot`), database backups, upgrades/rollback, and
Delta trusted-IP guidance.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common errors and
diagnostic commands.

## Safety and limitations

- All live exchange actions are disabled by default. `TRADE_DEMO_MODE=true`
  simulates stops and closes without submitting orders.
- Stop placement additionally requires `TRADE_STOP_LOSS_ENABLED=true`; close
  execution additionally requires `TRADE_CLOSE_ENABLED=true`.
- All orders are reduce-only; the bot never opens or increases positions.
- Stops and closes are verified against the exchange before state is marked
  protected/closed.
- A failed Delta API poll never marks positions closed.
- Dashboard is independent of safety-critical processing.

**Limitations / unverified behavior:**
- `processed_candles` table exists in the schema but is never written or read.
- `DELTA_SYMBOLS` env var is not read; monitored symbols are hardcoded
  (ETHUSD, SOLUSD, BTCUSD).
- `TRADE_STOP_LOSS_ENABLED`/`TRADE_CLOSE_ENABLED` are read directly from
  `process.env`, not through the config loader.
- `closeTrades` deduplication is in-memory only (per process).
- Dashboard `lastReconcileAt`/freshness are in-memory and reset on restart.
- No guarantee of restart recovery beyond persisted trade/level rows; test in
  read-only/demo mode before enabling live gates.

Do not enable `TRADE_STOP_LOSS_ENABLED` or `TRADE_CLOSE_ENABLED` on a
production account until you have validated behavior with
`TRADE_DEMO_MODE=true`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, startup/shutdown, data flow
- [docs/COMMANDS.md](docs/COMMANDS.md) — every slash command and interaction
- [docs/DASHBOARD.md](docs/DASHBOARD.md) — dashboard channel
- [docs/TRADE_MANAGEMENT.md](docs/TRADE_MANAGEMENT.md) — trade lifecycle, levels, candle rules
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — full environment variable reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Amazon Linux 2023 deployment
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — diagnostics
