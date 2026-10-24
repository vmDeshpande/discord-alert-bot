# Trade Management (Delta Exchange India)

## Architecture
- Authenticated Delta client (HMAC) for positions/orders/products
- Position poller reconciles exchange state; never infers closure from failed API calls
- Trade/Level/Interaction storage in SQLite
- Stop-loss manager (adopt existing or place reduce-only stop; verify from exchange)
- 3-minute candle decision engine
- Reduce-only close executor with flatness verification
- Discord dashboard service and Manage Trade interactions
- Router for commands/buttons/selects/modals

## Safety Gates
- `TRADE_MANAGEMENT_ENABLED` - enable trade management features (default false)
- Live stop placement: requires explicit gate (not started by default)
- Live closing: requires explicit gate (not started by default)
- `TRADE_DEMO_MODE` - intended for dry-run behavior
- All live actions disabled by default

## Position Identity
Aggregate position model per product; reconciliation updates existing trades or discovers new ones. A failed API call does not mark positions closed.

## Stop Loss
Calculated from entry/side with configured offset, adopts existing valid stops, places reduce-only stop only when explicitly gated, verifies from authoritative state before marking protected.

## Custom Levels
Bound to trade session ID; creation/activation require verified stop; stored in levels table.

## Candle Rules (3m)
- BUY: next close > level -> CLOSE, else HOLD (equality -> HOLD)
- SELL: next close < level -> CLOSE, else HOLD (equality -> HOLD)
- Evaluate only next fully closed candle after touch

## Close Execution
Only reduce-only market orders; re-check position before execution; verify flat before marking complete; no position increases/reversals.

## Dashboard
Persists message IDs, recovers on failures, shows last reconcile time and freshness, independent of safety-critical processing.

## Commands
- `/level set|list|activate|deactivate|delete` (ephemeral)
- Manage Trade buttons/modals/selects

## Deployment
See docs/DEPLOYMENT.md. Start in alert-only mode, then read-only monitoring, then separately gated stop placement/closing.
