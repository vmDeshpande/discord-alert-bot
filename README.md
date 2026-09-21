# Discord Alert Bot

A lightweight Discord bot that monitors real-time prices from Delta Exchange and sends price alerts to specific Discord channels.

## What This Bot Does

- Connects to Delta Exchange's public WebSocket feed for real-time price data
- Monitors configured trading pairs for price movements
- Sends Discord alerts when prices cross user-defined thresholds
- Persists alert configurations in SQLite (survives restarts)
- Automatically reconnects Delta WebSocket and Discord on disconnect

## Architecture Overview

```
Delta WebSocket → Price Handler → Alert Engine → Discord Client → Channel
                      ↓
               SQLite Storage (alerts config)
```

- **Delta Integration**: Isolated in `src/delta/` - WebSocket client with auto-reconnect and exponential backoff
- **Alert Engine**: Pure business logic in `src/alerts/` - testable without Discord/Delta
- **Discord Client**: `src/discord/` - Discord.js wrapper with command handling
- **Database**: `src/database/` - SQLite persistence for alert configs
- **Config**: `src/config/` - Environment variable loading and validation

## Requirements

- Node.js >= 18
- npm >= 9
- A Discord bot token (create at [Discord Developer Portal](https://discord.com/developers/applications))
- Delta Exchange account (for live trading pairs; the bot uses public market data only)

## Installation

```bash
cd discord-alert-bot
npm install
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token | *(required)* |
| `DATABASE_PATH` | SQLite database file path | `./alerts.db` |
| `LOG_LEVEL` | Log verbosity | `info` |
| `DELTA_WS_URL` | Delta WebSocket URL | `wss://public-socket.india.delta.exchange` |
| `DELTA_SYMBOLS` | Comma-separated symbols | `BTCUSD` |
| `DELTA_RECONNECT_INTERVAL_MS` | Initial reconnect delay | `2000` |
| `DELTA_MAX_RECONNECT_INTERVAL_MS` | Max reconnect delay | `60000` |

## How to Create/Configure the Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" → give it a name → create
3. Go to "Bot" tab → click "Add Bot" → copy the token
4. Enable "Message Content Intent" under Privileged Gateway Intents
5. Go to "OAuth2" → "URL Generator":
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Read Messages`, `Embed Links`
6. Invite the bot to your server using the generated URL
7. Copy the bot token to `.env`

## How to Run Locally

```bash
# Install dependencies
npm install

# Set your environment (create .env from .env.example)
cp .env.example .env
# Edit .env and add your DISCORD_BOT_TOKEN

# Run with ts-node (development)
npm run dev

# Or build and run
npm run build
npm start
```

## How to Run Tests

```bash
npm test
```

Tests cover the alert engine logic independently - no Discord or Delta connection needed. 54 tests covering ticker parsing, alert evaluation, validation, and Discord-gated integration.

## How to Build for Production

```bash
npm run build
```

Output goes to `dist/`.

## How to Run with Node.js

```bash
npm run build
NODE_ENV=production node dist/index.js
```

## Basic VPS/EC2 Deployment

### Option 1: systemd service

Create `/etc/systemd/system/discord-alert-bot.service`:

```ini
[Unit]
Description=Discord Alert Bot
After=network.target

[Service]
Type=simple
User=alertbot
WorkingDirectory=/opt/discord-alert-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/discord-alert-bot/.env

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-alert-bot
sudo systemctl start discord-alert-bot
sudo systemctl status discord-alert-bot
```

### Quick start on a small instance

```bash
# On a fresh Ubuntu/Debian VPS
sudo apt update && sudo apt install -y nodejs npm
sudo npm install -g npm@latest
mkdir -p /opt/discord-alert-bot
# Copy your project files there
cd /opt/discord-alert-bot
npm install --production
npm run build
# Create .env with your token
npm start
```

## How Alerts Work

#### Price Tracking

The Delta client tracks both the previous and current price per symbol. On each price update:

- **First update** (no prior price): `previousPrice` is `null` → no alert triggers until a second update provides a comparison point
- **Subsequent updates**: `previousPrice` and `currentPrice` are compared against the alert target

#### Alert Conditions

| Condition | Trigger |
|-----------|---------|
| `crossed_above` | Price crosses from below target to above (previous < target ≤ current) |
| `crossed_below` | Price crosses from above target to below (previous > target ≥ current) |
| `reaches_or_above` | Price is at or above target (current ≥ target) |
| `reaches_or_below` | Price is at or below target (current ≤ target) |

#### Discord-Gated Delivery

Alerts are **not** marked as `triggered` until Discord confirms delivery. If Discord send fails, the alert remains active and will be re-evaluated on the next price update. A `pendingSends` set prevents duplicate notifications for the same alert while a delivery attempt is in flight.

#### Why Not `currentPrice === targetPrice`?

Market prices can jump over exact targets (e.g., from 99950 to 100020). The bot uses cross detection and threshold comparisons instead of equality checks.

#### Example

Target = 100000, Previous = 99950, Current = 100020 → **Triggers** `crossed_above`

#### Deduplication

Once an alert fires, it is marked as `triggered` and won't re-fire until manually reset. The `pendingSends` set also prevents duplicate sends while Discord delivery is in progress.

### Alert Fields

- `id` - Unique identifier
- `symbol` - Trading pair (e.g., BTCUSD)
- `condition` - Alert condition type
- `targetPrice` - Target price level
- `discordChannelId` - Where to send the alert
- `enabled` - Whether the alert is active
- `triggered` - Whether the alert has fired
- `createdAt` - Creation timestamp
- `triggeredAt` - When it last fired

## Example Configuration

`.env` file:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
DATABASE_PATH=./alerts.db
LOG_LEVEL=info
DELTA_WS_URL=wss://public-socket.india.delta.exchange
DELTA_SYMBOLS=BTCUSD,ETHUSD
DELTA_RECONNECT_INTERVAL_MS=2000
DELTA_MAX_RECONNECT_INTERVAL_MS=60000
```

## Troubleshooting

### Bot doesn't connect to Discord
- Verify `DISCORD_BOT_TOKEN` is set correctly in `.env`
- Check the bot is invited to the server with correct permissions
- Ensure Message Content Intent is enabled in Discord Developer Portal

### No price updates received
- Check Delta WebSocket URL in logs
- Verify symbols are valid Delta Exchange trading pairs
- Check network connectivity to `wss://public-socket.india.delta.exchange`

### Alerts not triggering
- Verify alerts are enabled (not triggered, not disabled)
- Check that symbols match exactly (case-sensitive)
- Use `/status` command to check connection status

### Checking connection health

Use the `/status` Discord command to check:
- Bot uptime
- Delta WebSocket connection status
- Last Delta price update timestamp

Check logs for:
- `[INFO] Delta WebSocket connected`
- `[INFO] Discord connected`
- `[WARN] Delta WebSocket disconnected` (reconnecting automatically)

## Important Files

- `src/index.ts` - Entry point
- `src/config/index.ts` - Configuration loader
- `src/logger/index.ts` - Structured logger
- `src/delta/client.ts` - Delta WebSocket client
- `src/alerts/engine.ts` - Alert evaluation engine
- `src/alerts/types.ts` - Type definitions
- `src/alerts/validation.ts` - Input validation
- `src/database/index.ts` - Database initialization
- `src/database/storage.ts` - Alert CRUD operations
- `src/discord/client.ts` - Discord bot client
- `tests/alertEngine.test.ts` - Alert engine tests

## Limitations

- No web dashboard (by design)
- No user authentication (by design)
- Uses Delta public market data only (no authenticated trading)
- Alerts require manual reset after triggering (via database or future UI)
- Discord bot token must be provided via environment variable
