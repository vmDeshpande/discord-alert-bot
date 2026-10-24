# Discord Alert Bot

Monitors prices on Delta Exchange (India) for ETHUSD/SOLUSD/BTCUSD and sends price alerts. Includes optional trade management with strict safety gates.

## Quick Start (Alert-only)
1. `npm ci`
2. Copy `.env.example` to `.env`, set `DISCORD_BOT_TOKEN` and channel IDs
3. `npm run build && npm start`

## Commands
- `/alert set price:<price>`, `/alert list`, `/alert activate`, `/alert deactivate`, `/alert delete`
- `/level set/list/activate/deactivate/delete` (when trade management enabled)

## Trade Management
See [docs/TRADE_MANAGEMENT.md](docs/TRADE_MANAGEMENT.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). All live actions disabled by default; enable via separate gates.

## Safety
- No live trading by default
- Stop/close require explicit gates
- Reduce-only orders only
- Verification before protection/execution
