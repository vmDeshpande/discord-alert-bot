# Troubleshooting

Diagnostic commands assume the systemd service `discord-alert-bot` and the
deploy directory `/opt/discord-alert-bot` from docs/DEPLOYMENT.md.

## First response

```bash
sudo systemctl status discord-alert-bot
sudo journalctl -u discord-alert-bot -n 200
```

Look for `[ERROR]` lines. The bot logs startup progress: "Configuration loaded",
"Discord connected", "Trade dashboard initialized", "Bot started successfully".

## Common problems

### 1. Service fails to start / config errors

**"Missing required channel configuration"**
- `ETHUSD_CHANNEL_ID`, `SOLUSD_CHANNEL_ID`, and `BTCUSD_CHANNEL_ID` must all be
  set to non-empty, unique Discord channel IDs. Whitespace-only values count as
  missing. Verify `.env` and rerun `npm run typecheck` locally to catch
  issues before deploying.

**"Duplicate channel configuration"**
- Two symbols are mapped to the same channel ID. Each symbol needs its own
  channel.

**"Trade management is enabled but DELTA_API_KEY or DELTA_API_SECRET is missing"**
- `TRADE_MANAGEMENT_ENABLED=true` requires both API credentials. Either fill
  them in or set `TRADE_MANAGEMENT_ENABLED=false`.

**Diagnostic:** run locally with `LOG_LEVEL=debug` and `npm run dev`, or inspect
the logged "Configuration loaded" block (it prints all resolved values except
secrets).

### 2. Slash commands missing in Discord

- Commands register globally on `ClientReady`. Wait up to an hour after first
  start or restart.
- Confirm the bot is online and `journalctl` shows "Discord commands registered"
  (no "Failed to register Discord commands").
- Confirm `DISCORD_BOT_TOKEN` is valid and the bot is in the guild.
- The `/level` command is only registered if trade management storages are
  wired at startup; it always appears in the registration list but responds
  "Trade management not available." when `TRADE_MANAGEMENT_ENABLED=false`.

### 3. /alert commands say "Price alerts can only be configured in..."

- The command was run outside #ETHUSD/#SOLUSD/#BTCUSD. Move to the correct
  channel, or verify the channel ID env vars match the channels you are using.

### 4. Alerts not triggering

- Confirm Delta WebSocket connected: `journalctl` shows "Delta WebSocket
  connected" and price updates flowing.
- Confirm the alert is `active=1`, `triggered=0` in the `alerts` table, in the
  right channel (`channel_id`).
- Baseline price must be fetchable from
  `https://api.india.delta.exchange/v2/tickers/{symbol}` at `/alert set` time.
  Otherwise alert creation is rejected.
- Direction: target >= baseline → upward (price must reach/exceed target);
  target < baseline → downward (price must fall to/below target).
- Once triggered, the alert is deleted after successful Discord delivery.

Inspect alerts via sqlite3:
```bash
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT id, symbol, target_price, direction, active, triggered FROM alerts;"
```

### 5. Trade management: no trades discovered

- Requires `TRADE_MANAGEMENT_ENABLED=true` and valid API credentials.
- Confirm the API key's trusted IP list includes the host egress IP (Elastic IP
  on EC2).
- Confirm the position exists on Delta Exchange and is non-flat.
- Poll interval `TRADE_POLL_INTERVAL_MS` default 30s; first poll runs
  immediately at startup.
- Failed polls log "Position poll failed; not changing session state" and leave
  state unchanged.

Inspect trades:
```bash
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT id, symbol, side, size, entry_price, monitoring_status, stop_loss_status FROM trades;"
```

### 6. Stop loss not placed / not verified

- `TRADE_STOP_LOSS_ENABLED` must be `true` (default false).
- Trade must have `monitoring_status` not closed and `stop_loss_status != verified`.
- `TRADE_DEMO_MODE=true` disables live placement (dry-run only).
- Check `journalctl` for "Stop placement failed", "Stop verification failed",
  or "Adopted existing stop" / "Stop verified".
- The stop price is `entry ± TRADE_STOP_LOSS_OFFSET`; confirm the offset is
  sane for the instrument.

### 7. Levels not evaluating / not closing

- Level must be `status='active'` and trade `monitoring_status='active'`,
  `stop_loss_status='verified'`.
- The level monitor tick runs every 15s; allow up to one tick plus candle
  timing.
- A touch must occur in a 3m candle, and only the **next completed** candle's
  close decides HOLD/CLOSE. Equality means HOLD.
- HOLD consumes (deactivates) only the evaluated level; other levels continue.
- Close requires a non-flat exchange position of matching side; manual closes
  on the exchange mark the trade closed on the next successful poll.
- Dry-run (`TRADE_DEMO_MODE=true` or `TRADE_CLOSE_ENABLED=false`) skips order
  submission.

Inspect levels:
```bash
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT id, trade_id, level_price, condition, status, monitoring_state, last_processed_candle_ts FROM levels;"
```

### 8. Dashboard empty / not updating

- `TRADE_DISCORD_CHANNEL_ID` must be set when trade management is enabled.
- Confirm bot permissions in the dashboard channel: Send Messages, Embed Links,
  Read Message History, Manage Messages.
- Dashboard only shows non-closed trades. Closed trades are skipped.
- "Dashboard send failed" / "Dashboard edit failed" in `journalctl` indicate
  permission or channel-ID problems. The service keeps running; messages are
  retried on each refresh (`max(TRADE_DASHBOARD_THROTTLE_MS, 5000)` ms).
- Deleted dashboard messages are recreated automatically on the next refresh
  (edit failure → resend, new `discord_message_id` persisted).

### 9. SQLite database locked / WAL files

- The process holds the database open. Stop the service before copying the `.db`
  file for backups. WAL (`-wal`, `-shm`) files are normal.

### 10. REST API rate limits (Delta)

- HTTP 429 logs "Rate limited by Delta Exchange (reset ...)" and throws; the
  affected tick is caught and retried on the next interval. Space out polls via
  `TRADE_POLL_INTERVAL_MS` if you hit limits repeatedly.

## Useful diagnostic commands

```bash
# Service state
sudo systemctl is-active discord-alert-bot
sudo systemctl is-enabled discord-alert-bot

# Recent logs
sudo journalctl -u discord-alert-bot --since "30 minutes ago" --no-pager

# Error logs only
sudo journalctl -u discord-alert-bot -p err -n 100 --no-pager

# Database inspection (sqlite3 may need installation: sudo dnf install sqlite)
sqlite3 /opt/discord-alert-bot/alerts.db ".tables"
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT * FROM trades;"
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT * FROM levels;"
sqlite3 /opt/discord-alert-bot/alerts.db "SELECT * FROM trade_interactions;"

# Local validation (from project directory, with a test .env)
npm run typecheck
npm run lint
npm test
npm run build
```

## Verifying the running configuration

The startup log block "Configuration loaded" prints resolved settings (excluding
secrets):
- `databasePath`, `deltaSymbols`, `deltaWsUrl`, `logLevel`
- channel IDs
- `tradeManagementEnabled`, `tradeDemoMode`, `tradeApiBaseUrl`,
  `tradeStopLossOffset`, `tradeDiscordChannelId`

Use this to confirm which mode the bot actually started in.
