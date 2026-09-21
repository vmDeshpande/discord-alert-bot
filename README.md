# Discord Alert Bot

A simple Discord bot that monitors real-time prices for **ETHUSD** and **SOLUSD** on Delta Exchange (India) and sends price alerts to dedicated Discord channels.

## How It Works

- Connects to Delta Exchange's **public** WebSocket (no API key required)
- Monitors ETHUSD and SOLUSD prices in real time
- Sends a Discord notification when the price reaches your target
- Stores alert configurations in SQLite (survives restarts)

## Supported Cryptocurrencies & Channels

| Discord Channel | Symbol |
|-----------------|--------|
| #ETHUSD         | ETHUSD |
| #SOLUSD         | SOLUSD |

The channel determines which cryptocurrency the alert belongs to.

## Commands

### /set-alert price:<price>

Set or replace the price alert for this crypto channel.

Example in #ETHUSD:
```
/set-alert price:4500
```

Response:
```
✅ ETHUSD alert set
Target: $4,500
Status: Active
```

### /alert

Show the current alert for this channel.

### /remove-alert

Remove the alert for this channel.

If no alert exists:
```
No active alert in this channel.
```

### /status

Show bot status, Discord/Delta connection state, and current prices.

### /help

Show all available commands.

## How Alerts Work

1. When you set an alert, the bot records the current price as a **baseline**
2. The target direction (upward/downward) is determined by comparing target vs baseline
3. The bot monitors future price updates
4. Alert triggers when price crosses the target in the set direction
5. A single Discord message is sent, and the alert is marked as triggered
6. The alert will never fire again

### Examples

**Upward alert** (target above current price):
```
Current: 4400 → Target: 4500
4400 → 4450 → 4498 → 4503 → ALERT 🔔
```

**Downward alert** (target below current price):
```
Current: 4600 → Target: 4500
4600 → 4550 → 4502 → 4497 → ALERT 🔔
```

**Price jumps over target**: Still triggers in a single update.

## Requirements

- Node.js >= 18
- npm >= 9
- A Discord bot token (create at [Discord Developer Portal](https://discord.com/developers/applications))

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
| `ETHUSD_CHANNEL_ID` | Discord channel ID for ETHUSD alerts | *(required)* |
| `SOLUSD_CHANNEL_ID` | Discord channel ID for SOLUSD alerts | *(required)* |

## Delta Exchange

The bot connects to Delta Exchange's **public** WebSocket feed:
- URL: `wss://public-socket.india.delta.exchange`
- No API key required
- Monitors: ETHUSD, SOLUSD

## Database

Alerts are stored in SQLite. Schema:
- `id` - Unique alert ID
- `symbol` - Trading pair (ETHUSD or SOLUSD)
- `channel_id` - Discord channel ID
- `target_price` - Target price to trigger at
- `baseline_price` - Price when alert was created
- `direction` - `upward` or `downward`
- `enabled` - Whether alert is active
- `triggered` - Whether alert has fired
- `created_at` - Creation timestamp
- `triggered_at` - When it fired (null if not triggered)

## Running

```bash
# Development
npm run dev

# Build and run
npm run build
npm start

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Troubleshooting

### Bot doesn't connect to Discord
- Verify `DISCORD_BOT_TOKEN` is set correctly in `.env`
- Check bot permissions: Send Messages, Read Messages

### No price updates
- Check network connectivity to Delta WebSocket
- Verify Delta Exchange is online

### Alerts not triggering
- Verify the price hasn't already passed the target when setting the alert
- Use `/status` to check current prices
- Check logs for connection status

## Limitations

- One alert per crypto channel
- No web dashboard (by design)
- No user authentication (by design)
- Uses Delta public market data only (no trading)
- Requires ETHUSD_CHANNEL_ID and SOLUSD_CHANNEL_ID environment variables
