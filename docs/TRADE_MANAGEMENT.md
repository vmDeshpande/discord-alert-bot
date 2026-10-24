# Trade Management (Delta Exchange India)

Trade management monitors open Delta Exchange futures positions, maintains
protective stop-losses, and supports multi-level monitoring with automated
close decisions. All of it is disabled by default and gated behind independent
configuration flags.

## Master switch

| Variable | Default | Meaning |
|---|---|---|
| `TRADE_MANAGEMENT_ENABLED` | `false` | Enables position polling, stop-loss, level monitoring, dashboard, `/level` commands. Requires `DELTA_API_KEY`, `DELTA_API_SECRET`, `TRADE_DISCORD_CHANNEL_ID`. |

When false, the bot runs alert-only. No trade tables are touched beyond schema
creation.

## Independent safety gates

These gates are orthogonal and each defaults to `false`. They are read directly
from `process.env` in `src/index.ts` (see docs/CONFIGURATION.md).

| Variable | Default | Controls |
|---|---|---|
| `TRADE_STOP_LOSS_ENABLED` | `false` | Live stop placement (reduce-only stop-market orders). |
| `TRADE_CLOSE_ENABLED` | `false` | Live close execution (reduce-only market close orders). |
| `TRADE_DEMO_MODE` | `false` | Dry-run: no orders submitted; stops/closes simulated only. |

See docs/CONFIGURATION.md for the full flag interaction matrix and safe
configuration examples.

## Components

- **Position poller** (`src/tradeManagement/polling.ts`): polls
  `GET /v2/positions/margined` every `TRADE_POLL_INTERVAL_MS` (default 30s).
  Reconciles each non-flat position into a trade row; discovers new trades;
  marks trades closed when their product disappears after a successful poll.
  Failed polls do not change session state.
- **Stop-loss manager** (`src/tradeManagement/stopLoss.ts`): calculates stop
  price from entry/side + `TRADE_STOP_LOSS_OFFSET`; adopts an existing matching
  open stop order, or places a reduce-only `stop_market_order` when live-gated;
  verifies the order in open orders. Dry-run when `TRADE_DEMO_MODE=true`.
- **Stop-loss integration** (`src/tradeManagement/integration.ts`): tick at
  `max(pollIntervalMs, 5000)`; protects trades lacking a verified stop when
  `TRADE_STOP_LOSS_ENABLED`.
- **Level monitor** (`src/tradeManagement/levelMonitor.ts`): 15s tick;
  evaluates active levels against 3-minute candles; decides HOLD/CLOSE;
  triggers close execution.
- **Close executor** (`src/tradeManagement/closeExecutor.ts`): reduce-only
  market close; verifies position is flat before marking complete.
- **Candle decision** (`src/tradeManagement/candleDecision.ts`): touch detection
  and LONG/SHORT close/hold rules.
- **Dashboard** (`docs/DASHBOARD.md`): trade embeds + Manage Trade controls.

## Trade discovery and session lifecycle

1. Poller fetches positions. For each position with `size != 0`:
   - Existing trade matched by `product_id` → updated (side, size, entry,
     mark price, PnL, last seen). A previously closed trade is restored to
     `monitoring_status='active'`.
   - No existing trade → new trade row with `monitoring_status='pending'`,
     `stop_loss_status='none'`, `last_event='discovered'`.
   - Trade ID format: `trade-{product_id}-{timestamp}`.
2. After a successful poll, trades whose `product_id` is absent from the
   positions list are marked `monitoring_status='closed'` (last event:
   exchange-position gone).
3. A failed poll aborts without changing any session state ("Position poll
   failed; not changing session state").

Trade statuses (`MONITORING_STATUSES`): `pending`, `active`, `suspended`,
`orphaned`, `closed`.

Stop-loss statuses (`STOP_LOSS_STATUSES`): `none`, `pending`, `verified`,
`failed`, `unavailable`.

## Protective stop-loss management

Stop price calculation (`calculateStopPrice`):
- BUY/LONG: `stop = entry_price - offset`
- SELL/SHORT: `stop = entry_price + offset`
- `offset` = `TRADE_STOP_LOSS_OFFSET` (default 100). Must be positive.

Flow per unprotected trade (integration tick, only if `TRADE_STOP_LOSS_ENABLED`):
1. Look up the exchange position for the trade's product.
2. Fetch open orders for the product.
3. If an existing stop order's `stop_price` matches the calculated stop price
   → adopt it: `stop_loss_status='verified'`, `monitoring_status='active'`,
   last event "stop adopted". No new order placed.
4. Else if dry-run (`TRADE_DEMO_MODE=true`): `stop_loss_status='pending'`,
   no order submitted.
5. Else live: place reduce-only `stop_market_order` with
   `stop_trigger_method='last_traded_price'`; verify it appears in open orders
   (3 retries, 50ms apart). Verified → `stop_loss_status='verified'`,
   `monitoring_status='active'`. Verification failure → `pending`.

Levels cannot be added or activated until `stop_loss_status === 'verified'`.

## Multiple-level monitoring

Levels are rows in the `levels` table bound to a trade via `trade_id` (foreign
key, ON DELETE CASCADE).

Level statuses (`LEVEL_STATUSES`): `inactive`, `active`, `monitoring`,
`touched`, `hold`, `error`.

Level monitoring states (`LEVEL_MONITORING_STATES`):
`idle`, `waiting_for_stop`, `monitoring`, `triggered`, `waiting_next_candle`,
`evaluating`, `hold`, `error`.

### Adding levels to one trade

- `/level set trade_id:<id> price:<price> condition:<BUY|SELL>` inserts a level
  with `status='inactive'`, `monitoringState='idle'`. Requires a verified stop.
- Manage Trade → Add Level modal inserts the same way.
- Multiple levels may be added to a single trade, each with its own price and
  condition (`BUY`/`SELL`). Levels are independent of each other.

### Level activation

- `/level activate` or Manage Trade → Activate sets `status='active'`,
  `monitoringState='monitoring'`. Only active levels are evaluated by the level
  monitor.
- Deactivate sets `status='inactive'`, `monitoringState='idle'`.

### What constitutes a level touch

`isTouch(candle, levelPrice)` returns true when
`candle.low <= levelPrice && levelPrice <= candle.high`. The level monitor
scans the last 10 three-minute candles for each active level and takes the most
recent candle whose range touches the level price as the trigger candle.

### Why only the immediately following completed 3-minute candle is evaluated

After a touch:
1. `nextCandleTime = trigger.time + 180000` (3 minutes).
2. The monitor looks for the candle at exactly that timestamp, falling back to
   the latest available candle if absent.
3. If `level.lastProcessedCandleTs === nextCandle.time`, the level is skipped
   (already evaluated for that candle).
4. `evaluateCandleDecision` decides on the next candle's **close** only.

Rationale: a touch alone does not act; confirmation requires the next candle's
close relative to the level. Only the immediately following candle is evaluated
so that each level consumes at most one decision per touch, and subsequent
candle behavior is handled by new touches/decisions.

### Decision rules

`evaluateCandleDecision(level, trade, triggerCandle, nextCandle)`:

| Side | Condition | Next close vs level | Action |
|---|---|---|---|
| LONG / BUY | `close > levelPrice` | CLOSE ("close above level") |
| LONG / BUY | `close < levelPrice` | HOLD ("close below level") |
| LONG / BUY | `close === levelPrice` | HOLD ("close equal level") |
| SHORT / SELL | `close < levelPrice` | CLOSE ("close below level") |
| SHORT / SELL | `close > levelPrice` | HOLD ("close above level") |
| SHORT / SELL | `close === levelPrice` | HOLD ("close equal level") |

- "Strictly above/below" — equality always means HOLD.
- Only the close of the next candle matters; wicks/highs after the touch do
  not trigger a close on their own.

### HOLD consumes only the triggering level

On HOLD, the evaluated level is set to `status='inactive'`,
`monitoringState='idle'`, `lastProcessedCandleTs=<next candle time>`. Other
levels on the same trade are untouched and continue monitoring.

### CLOSE prevents duplicate close attempts

On CLOSE:
1. The triggering level is set `status='inactive'`, `monitoringState='idle'`,
   `lastProcessedCandleTs=<candle time>`.
2. `closingTrades` set (in-memory, per process) guards the trade so the same
   trade is not closed twice within one monitor run.
3. `executeCloseDecision` validates: decision action is `close`; level is
   `active` and bound to the trade; trade `monitoring_status='active'`;
   `stop_loss_status='verified'`; exchange position exists and is not flat;
   position side matches trade side.
4. Submit reduce-only market close order (`size = abs(position.size)`),
   unless dry-run (`demoMode || !closeEnabled`) → returns `dry-run`.
5. Verify flat (5 retries, 50ms apart). On failure → status `failed`,
   orderId if any, trade NOT marked closed.
6. On verified flat: `tradeStorage.markClosed(trade.id, now)` sets
   `monitoring_status='closed'`; level set `inactive`/`idle` with
   `lastProcessedCandleTs`.

Close execution results: `executed`, `dry-run`, `skipped`, `failed`.

### All remaining active levels are deleted only after the trade is confirmed closed

The level monitor's trade loop deletes every level of a trade once
`monitoring_status === 'closed'`. This happens on the next monitor tick after
the trade row is marked closed. Until then, remaining levels stay in place (the
in-memory `closingTrades` guard prevents re-attempting the close).

### Manual exchange close

If a position is closed manually on Delta Exchange, the position poller no
longer sees that `product_id` on its next successful poll and marks the trade
`monitoring_status='closed'`. The level monitor then deletes the trade's levels
on its next tick. No exchange order is sent by the bot in this case.

## Trade session state summary (persisted for restart recovery)

| Table | Columns of note | Survives restart |
|---|---|---|
| `trades` | id, product_id, symbol, side, size, entry_price, mark_price, unrealized_pnl, stop_loss_order_id, stop_loss_price, stop_loss_status, monitoring_status, discord_channel_id, discord_message_id, last_event, updated_at, last_seen_at | Yes (SQLite) |
| `levels` | id, trade_id, level_price, condition, status, monitoring_state, trigger_candle_ts, next_candle_ts, last_processed_candle_ts, hold_count | Yes (SQLite) |
| `trade_interactions` | id, trade_id, type, state, user_id, channel_id, message_id, data | Yes (SQLite) |
| `processed_candles` | level_id, candle_ts, decision | Schema exists; **never written or read** |

On restart, `dashboardService.initialize()` re-creates/updates dashboard messages
from persisted `discord_message_id`s; the poller re-reconciles exchange
positions into trade rows; the level monitor resumes evaluating persisted active
levels. In-memory state (`closingTrades`, `lastReconcileAt`, dashboard throttle
timers) is rebuilt empty.

## Close execution and cleanup

`executeCloseDecision` (`src/tradeManagement/closeExecutor.ts`):
1. Validates decision/trade/level preconditions (see above).
2. Fetches current positions; skips if position already flat or side changed.
3. Dry-run or `demoMode` → no order, status `dry-run`/`skipped`.
4. Live: `POST /v2/orders` reduce-only `market_order` on the close side.
5. Verify flat via repeated `getPositions`.
6. If flat: `markClosed` (trade `closed`), level `inactive`/`idle`,
   `lastProcessedCandleTs = decision.candleTs`, status `executed`.
7. If not flat after retries: status `failed`, trade not marked closed.

## Safety gates summary

- No stop or close order is ever placed unless `TRADE_MANAGEMENT_ENABLED=true`.
- Stop placement additionally requires `TRADE_STOP_LOSS_ENABLED=true`.
- Close execution additionally requires `TRADE_CLOSE_ENABLED=true` and
  `TRADE_DEMO_MODE=false`.
- All orders are reduce-only; the bot never opens or increases positions.
- Stop and close executions are verified against the exchange before state is
  marked protected/closed.
- A failed poll never marks positions closed; only a successful poll with the
  product absent does.

## Known limitations

- `processed_candles` table exists but is unused; candle dedup relies on
  `levels.last_processed_candle_ts` only.
- `closingTrades` dedup is in-memory only; a restart between CLOSE decision and
  `markClosed` could allow a duplicate close attempt on restart.
- Dashboard `lastReconcileAt`/freshness are in-memory and reset on restart.
- Close verification retries are 50ms apart (very short window).
- Trade IDs embed a timestamp; two polls in the same millisecond for the same
  product would collide on insert (ON CONFLICT update), not create duplicates.
- No partial-close support; close uses the full current position size.
