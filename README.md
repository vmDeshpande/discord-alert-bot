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

Each channel has independent price alerts. Multiple alerts per channel are supported.

## Commands

### /alert set price:<price>

Create a new price alert for this crypto channel.

Example in #ETHUSD:
```
/alert set price:4500
```

Response:
```
✅ ETHUSD alert set
Target: $4,500
Status: Active
```

Every call creates a new alert. Existing alerts are not affected.

### /alert list

Show all alerts for this crypto channel.

Example:
```
🔔 ETHUSD Alerts

#abc123  $4,500  🟢 Active
#def456  $4,600  🟢 Active
#ghi789  $4,700  🔕 Inactive
#jkl012  $4,800  ✅ Triggered
```

### /alert activate id:<id>

Activate a specific alert by ID. Only alerts in the current channel can be activated.

### /alert deactivate id:<id>

Deactivate a specific alert by ID. Only alerts in the current channel can be deactivated. The alert is not deleted.

### /alert delete id:<id>

Permanently delete a specific alert by ID. Only alerts in the current channel can be deleted.

### /alert set requirements

- Only works in #ETHUSD or #SOLUSD
- Requires Delta price feed to be available
- If price is unavailable: "Current price unavailable. Please try again shortly."

## How Alerts Work

1. When you set an alert, the bot records the current Delta price as a **baseline**
2. The target direction is determined internally:
   - Target > baseline → upward alert
   - Target < baseline → downward alert
   - Target = baseline → triggers immediately
3. The bot monitors future price updates
4. Alert triggers when price crosses the target in the set direction
5. A single Discord message is sent, and the alert is marked as triggered
6. The alert will never fire again

### Examples

**Upward alert** (target above baseline):
```
Baseline: 4400 → Target: 4500
4400 → 4450 → 4498 → 4503 → ALERT 🔔
```

**Downward alert** (target below baseline):
```
Baseline: 4600 → Target: 4500
4600 → 4550 → 4502 → 4497 → ALERT 🔔
```

**Multiple alerts work independently:**
```
Baseline: 4400
Alert 1: target 4500
Alert 2: target 4600
Alert 3: target 4700

4500 → alert 1 fires
4600 → alert 2 fires
4700 → alert 3 fires
```

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
| `ETHUSD_CHANNEL_ID` | Discord channel ID for ETHUSD | *(required)* |
| `SOLUSD_CHANNEL_ID` | Discord channel ID for SOLUSD | *(required)* |

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
- `direction` - `upward` or `downward` (internal)
- `active` - Whether alert is active (1) or inactive (0)
- `triggered` - Whether alert has fired (1) or not (0)
- `created_at` - Creation timestamp
- `triggered_at` - When it fired (null if not triggered)

Multiple alerts per channel are supported. Each alert has a unique ID.

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
- Use `/alert set` to create alerts first
- Use `/alert list` to view existing alerts
- Check that alerts are Active (not Inactive)
- Use `/alert set` - if price is unavailable, try again shortly

### Alert creation fails
- Ensure you're in #ETHUSD or #SOLUSD channel
- Ensure Delta WebSocket is connected
- Verify price is a positive number

## Limitations

- No web dashboard (by design)
- No user authentication (by design)
- Uses Delta public market data only (no trading)
- Requires ETHUSD_CHANNEL_ID and SOLUSD_CHANNEL_ID environment variables
- No edit command - delete and recreate to change a target price
