# Architecture

The Discord Alert Bot is a Node.js/TypeScript application that monitors Delta
Exchange (India) prices, sends Discord price alerts, and optionally manages
open futures positions with stop-loss and multi-level monitoring. It is split
into alert-only functionality (always on when Discord is configured) and
trade-management functionality (gated behind `TRADE_MANAGEMENT_ENABLED`).

## Technology stack

- Node.js, TypeScript (ES2022 target, CommonJS modules)
- `discord.js` v14 — Discord API client, slash commands, buttons, select menus, modals
- `better-sqlite3` — SQLite persistence (WAL journal, `synchronous = NORMAL`)
- `ws` — Delta Exchange public WebSocket client
- `node:crypto` — HMAC-SHA256 signatures for authenticated Delta REST requests
- `fetch` (Node global) — Delta REST API calls and ticker baseline lookup
- `ts-node` / `tsc` — dev run and build; `jest` + `ts-jest` for tests

Runtime scripts (package.json): `build`, `start`, `dev`, `test`, `lint`, `typecheck`.

## Module overview

```
src/index.ts              — Application entry point; wires services, starts/shuts down
src/config/index.ts       — Environment loading and validation
src/logger/index.ts       — Tiny console logger (debug/info/warn/error)
src/database/index.ts     — SQLite schema initialization and connection
src/database/storage.ts   — Alert CRUD storage
src/database/tradeStorage.ts — Trade session CRUD storage
src/database/levelStorage.ts — Monitoring level CRUD storage
src/database/tradeInteractionStorage.ts — Discord interaction audit storage
src/delta/client.ts       — Public WebSocket price feed (trades channel)
src/delta/authenticatedClient.ts — Authenticated Delta REST client (HMAC)
src/alerts/engine.ts      — Price alert evaluation and delivery
src/alerts/validation.ts  — Target price validation
src/alerts/types.ts       — Alert types
src/discord/client.ts     — Discord client, command registration, /alert handlers
src/discord/router.ts     — Interaction router (commands, selects, buttons, modals)
src/discord/interactions.ts — Manage-trade custom-id helpers
src/discord/tradeInteractions.ts — Trade embeds, buttons, modals, select menus
src/tradeManagement/serviceManager.ts — Trade service manager (position poller + stop-loss manager)
src/tradeManagement/polling.ts — Position poller: discovery, reconciliation, close detection
src/tradeManagement/stopLoss.ts — Stop-loss manager: adopt/place/verify reduce-only stops
src/tradeManagement/integration.ts — Stop-loss integration tick (gated by TRADE_STOP_LOSS_ENABLED)
src/tradeManagement/levelMonitor.ts — 3-minute candle level monitor
src/tradeManagement/candleDecision.ts — Candle touch + LONG/SHORT close/hold decision rules
src/tradeManagement/closeExecutor.ts — Reduce-only close executor with flatness verification
src/tradeManagement/dashboard.ts — Trade embed builder
src/tradeManagement/dashboardService.ts — Dashboard message create/update/refresh/recovery
src/tradeManagement/priceValidation.ts — Tick-size price validation (not wired into command flow)
src/types.ts              — Shared domain types
```

## Startup sequence (src/index.ts)

1. `dotenv/config` loads `.env`.
2. `createLogger('info')` — console logger.
3. `loadConfig(logger)` — parses and validates env; throws on missing channel IDs
   or missing API credentials when trade management is enabled. `process.exit(1)`
   on database init failure.
4. `initDatabase(DATABASE_PATH)` — opens SQLite, enables WAL, creates/migrates
   `alerts`, `trades`, `levels`, `processed_candles`, `trade_interactions`
   tables and indexes.
5. `createAlertStorage(...)`.
6. `createDeltaClient(...)` — public WebSocket client; price updates are fed to
   the alert engine. Connection failure is logged, not fatal.
7. `createDiscordClient(...)` — registers slash commands on `ClientReady`; logs in
   if `DISCORD_BOT_TOKEN` is set, otherwise warns and skips Discord.
8. `createAlertEngine(...)`.
9. If `TRADE_MANAGEMENT_ENABLED` and Discord client and DB are available:
   - Creates authenticated Delta client (`DELTA_API_KEY`/`DELTA_API_SECRET`).
   - `createTradeServiceManager(...)` — position poller + stop-loss manager (stop-loss
     manager is created for explicit gating only).
   - `tradeServiceManager.start()` — begins position polling at
     `TRADE_POLL_INTERVAL_MS`.
   - `createTradeIntegration(...)` — stop-loss integration tick at
     `max(pollIntervalMs, 5000)`, gated by `TRADE_STOP_LOSS_ENABLED`.
   - `createLevelMonitor(...)` — 3m candle level monitor, tick every 15s. Dry-run
     mode is `demoMode || !closeEnabled`.
   - Builds a Discord adapter (sendMessage/editMessage) over the raw Discord client.
   - `createDashboardService(...)` for `TRADE_DISCORD_CHANNEL_ID`.
   - Rebinds the Discord `interactionCreate` listener to `routeInteraction(...)` with
     trade storages and a channel-to-symbol map (ETHUSD/SOLUSD/BTCUSD).
   - `dashboardService.initialize()` — creates/updates dashboard embed messages.
   - Starts `setInterval(dashboardService.refresh, max(dashboardThrottleMs, 5000))`.
10. `deltaClient.connect()` — connects the public WebSocket.
11. Logs "Bot started successfully".

Process-level handlers:
- `unhandledRejection` — logged as error.
- `uncaughtException` — logged as error.
- `SIGTERM` / `SIGINT` — invoke `shutdown()`.

## Shutdown sequence (shutdown())

Invoked on SIGTERM/SIGINT. Steps, in order:

1. Clear the dashboard refresh interval.
2. `dashboardService.stop()` — clears pending dashboard refresh timer.
3. `levelMonitor.stop()` — stops the level monitor tick.
4. `tradeIntegration.stop()` — stops the stop-loss integration tick.
5. `tradeServiceManager.stop()` — stops the position poller.
6. `deltaClient.disconnect()` — closes the WebSocket, prevents reconnect.
7. `discordClient.stop()` — `client.destroy()`.
8. `dbResult.close()` — closes SQLite.
9. `process.exit(0)`.

Note: `shutdown()` always calls `process.exit(0)` even if a service stop throws
(individual stops are not wrapped in try/catch except via `.catch(() => {})` on
discord stop). Uncaught exceptions and unhandled rejections are logged but do not
trigger shutdown.

## Data flow

### Price alerts (alert-only path)

1. Delta public WebSocket emits trade messages (`type: 'trades'`) for ETHUSD,
   SOLUSD, BTCUSD.
2. `parseDeltaTrade` validates shape/symbol/price; `PriceUpdatePayload` is
   produced.
3. Delta client calls `alertEngine.onPriceUpdate(payload)`.
4. Alert engine fetches active, untriggered alerts for the symbol from SQLite.
5. `evaluateAlert(alert, priceUpdate)` compares current price vs target using
   `baseline_price` + `direction` (upward/downward).
6. On trigger: Discord alert message is sent to the alert channel; on success the
   alert row is deleted from SQLite (self-deleting one-shot alert). On failure
   the alert remains active. Duplicate sends are suppressed via a per-update
   pending set.

Baseline price: when `/alert set` is used, the bot fetches
`GET https://api.india.delta.exchange/v2/tickers/{symbol}` and uses
`result.close` as `baseline_price`. Direction is `upward` if
`target >= baseline`, else `downward`. If baseline lookup fails, the alert is
not created.

### Trade management path

1. Position poller (`TRADE_POLL_INTERVAL_MS`, default 30s) calls
   `GET /v2/positions/margined` via the authenticated client.
2. Each non-flat position is reconciled:
   - Existing trade (matched by `product_id`) is updated (side, size, entry,
     mark price, PnL, last seen). A closed trade is restored to `active`.
   - New position creates a trade row with `monitoring_status='pending'`,
     `stop_loss_status='none'`.
3. After a successful poll, trades whose product is no longer in the positions
   list are marked `monitoring_status='closed'`. Failed polls do NOT change
   session state.
4. Stop-loss integration tick (`max(pollIntervalMs, 5000)`): for each active
   trade without a verified stop, if `TRADE_STOP_LOSS_ENABLED`, calls
   `stopLossManager.protect(trade, position, dryRun)`:
   - Adopts an existing open stop order matching the calculated stop price
     (`verified`), or
     - Dry-run: marks `pending` without placing; or
     - Live: places a reduce-only `stop_market_order` and verifies it appears in
       open orders (3 retries, 50ms apart).
5. Level monitor (15s tick): for each `active` trade with `verified` stop and
   active levels, fetches the last 10 `3m` candles from
   `GET /v2/history/candles`. For each active level:
   - Finds the most recent candle whose `[low, high]` touches `level_price`
     (`isTouch`).
   - Evaluates only the immediately following completed candle
     (`nextCandleTime = triggerTs + 180000`).
   - Skips if that candle was already processed (`lastProcessedCandleTs`).
   - `evaluateCandleDecision`: BUY/LONG — close strictly above level => CLOSE,
     otherwise HOLD (equality => HOLD). SELL/SHORT — close strictly below level
     => CLOSE, otherwise HOLD (equality => HOLD).
   - HOLD: level set to `inactive`/`idle` (consumed); other levels continue.
   - CLOSE: `executeCloseDecision` — reduce-only market close of the current
     exchange position, verifies flat (5 retries), marks trade `closed`, sets
     level `inactive`.
6. Dashboard service (`max(dashboardThrottleMs, 5000)` interval): for each
   non-closed trade, creates or edits a Discord embed message in
   `TRADE_DISCORD_CHANNEL_ID`; persists `discord_message_id` on the trade. On
   edit failure, recreates the message. Shows last reconcile time and data
   freshness.

### Discord interactions

- `/alert {set,delete,activate,deactivate,list}` — handled in
  `src/discord/client.ts`; routed by `src/discord/router.ts`. Select menus
  (`alert:delete|activate|deactivate`) for multi-select actions.
- `/level {set,list,activate,deactivate,delete}` — handled in
  `src/discord/client.ts` (`handleLevelCommand`); requires trade storages.
- Manage Trade buttons (`trade:manage:{tradeId}:{add|list|refresh|activate|deactivate|delete}`)
  on the dashboard embed.
- Add Level modal (`trade:modal:{tradeId}:addlevel`).
- Level select menus (`trade:levelsel:{tradeId}:{action}`).

All interaction handling is bound in `src/index.ts` only when trade management
is enabled; otherwise the default router in `src/discord/client.ts` handles
`/alert` and alert select menus.

## Databases / tables

| Table | Purpose |
|---|---|
| `alerts` | Price alerts (symbol, target, baseline, direction, active, triggered) |
| `trades` | Discovered/reconciled exchange positions (trade sessions) |
| `levels` | Monitoring levels bound to a trade (price, condition, status, state) |
| `processed_candles` | Schema created; **never written or read** by the application (reserved/unused) |
| `trade_interactions` | Audit log of Discord manage-trade interactions |

## Service lifecycle summary

| Service | Started when | Interval/timer | Stopped on shutdown |
|---|---|---|---|
| Delta WebSocket client | Always (if constructed) | Event-driven + 10s heartbeat | `disconnect()` |
| Discord client | If token present | Event-driven | `destroy()` |
| Alert engine | After Discord client | Event-driven (price updates) | No explicit stop |
| Position poller | Trade mgmt enabled | `TRADE_POLL_INTERVAL_MS` | `tradeServiceManager.stop()` |
| Stop-loss manager | Trade mgmt enabled | Created once (gated tick in integration) | `tradeServiceManager.stop()` |
| Stop-loss integration | Trade mgmt enabled | `max(pollIntervalMs, 5000)` | `tradeIntegration.stop()` |
| Level monitor | Trade mgmt enabled | 15s | `levelMonitor.stop()` |
| Dashboard service | Trade mgmt enabled | `max(dashboardThrottleMs, 5000)` | `dashboardService.stop()` + clear interval |

## Known gaps / unwired behavior

- `processed_candles` table exists but is never used.
- `DELTA_SYMBOLS` env var is not read; symbols are hardcoded.
- `priceValidation.ts` (tick-size validation) is exported but not called from any
  command or handler.
- `TRADE_STOP_LOSS_ENABLED` / `TRADE_CLOSE_ENABLED` are read directly from
  `process.env` in `src/index.ts`, not through `loadConfig`.
- Stop-loss manager is instantiated inside `serviceManager` but the integration
  creates its own separate instance; both exist when trade management is on.
- Dashboard embed shows trade fields only; level details are not shown on the
  dashboard (only in the Manage Trade embed).
- No process supervisor restart beyond systemd (external). `shutdown()` exits the
  process.
