# Deployment

Deployment target: Amazon Linux 2023. The application is a compiled Node.js
service run via systemd, backed by a SQLite database file.

## Requirements

- Node.js 22+ and npm (engines not enforced in package.json; `@types/node`
  ^22 is used)
- `npm ci` for reproducible installs (`package-lock.json` committed)
- A Discord application/bot with token
- Delta Exchange India API credentials (only if trade management is enabled)
- Three Discord channels (ETHUSD, SOLUSD, BTCUSD), plus one dashboard channel
  if trade management is enabled

## Build

```bash
npm ci            # install dependencies from package-lock.json
npm run build     # tsc -> dist/ (TypeScript compile)
npm start         # node dist/index.js
npm run dev       # ts-node src/index.js (development only)
```

Scripts are defined in `package.json`:
- `build` — `tsc` (outputs to `dist/`, rootDir `src/`)
- `start` — `node dist/index.js`
- `dev` — `ts-node src/index.ts`
- `test` — `jest`
- `lint` — `eslint src/**/*.ts`
- `typecheck` — `tsc --noEmit`

`dist/` is gitignored and rebuilt on each deploy.

## First-time setup (Amazon Linux 2023)

1. Install Node.js 22 (e.g. via NodeSource or nvm).
2. Clone the repository to a service directory, e.g. `/opt/discord-alert-bot`.
3. `npm ci`
4. Copy `.env.example` to `.env` and fill in values. See docs/CONFIGURATION.md.
   Never commit `.env`.
5. `npm run build`
6. Start manually to verify: `npm start` (Ctrl-C to stop).
7. Install the systemd unit (below).

## systemd service

Create `/etc/systemd/system/discord-alert-bot.service`:

```ini
[Unit]
Description=Discord Alert Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/discord-alert-bot
EnvironmentFile=-/opt/discord-alert-bot/.env
ExecStart=/usr/bin/npm start
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening (adjust as needed)
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/discord-alert-bot
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Notes:
- `EnvironmentFile=-/opt/discord-alert-bot/.env` loads all variables; the `-`
  prefix means the unit still starts if the file is missing (it will fail at
  runtime if required variables are absent).
- `Restart=always` restarts on exit, including `shutdown()`'s
  `process.exit(0)`. For intentional shutdowns, `systemctl stop` first.
- Node path: adjust `ExecStart` to the actual `npm` binary (commonly
  `/usr/bin/npm`).

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now discord-alert-bot
sudo systemctl status discord-alert-bot
```

## Logs

```bash
journalctl -u discord-alert-bot -n 100          # last 100 lines
journalctl -u discord-alert-bot -f              # follow
journalctl -u discord-alert-bot --since "1 hour ago"
```

Logs are console output (`[INFO]`, `[WARN]`, `[ERROR]`, `[DEBUG]`) captured by
the journald. `LOG_LEVEL` controls verbosity.

## Configuration updates and restarts

1. Edit `.env` on the host.
2. `sudo systemctl restart discord-alert-bot`
3. Verify with `journalctl` and Discord slash-command responses.

Slash commands are registered globally on `ClientReady`, so every restart
re-registers them. Global registration can take up to an hour to propagate to
Discord clients.

## Database persistence and backups

- Database file: `DATABASE_PATH` (default `./alerts.db`, relative to working
  directory → `/opt/discord-alert-bot/alerts.db`).
- SQLite journal mode WAL, `synchronous = NORMAL`.
- Back up by copying the `.db` file (and optionally `-wal`/`-shm`) while the
  service is stopped, or use the SQLite `.backup` API. Example:

```bash
sudo systemctl stop discord-alert-bot
cp /opt/discord-alert-bot/alerts.db /opt/discord-alert-bot/backups/alerts-$(date +%F).db
sudo systemctl start discord-alert-bot
```

- Tables: `alerts`, `trades`, `levels`, `processed_candles` (schema only,
  unused), `trade_interactions`.

## Safe upgrades and rollback

Upgrade:
```bash
cd /opt/discord-alert-bot
git pull
npm ci
npm run build
sudo systemctl restart discord-alert-bot
```

Rollback:
```bash
git checkout <previous-tag>
npm ci
npm run build
sudo systemctl restart discord-alert-bot
```

Database migrations run automatically at startup (`initDatabase` adds missing
columns/tables). There is no down-migration; back up before upgrading.

Trade-management rollback (disable live behavior without reverting code):
```bash
TRADE_MANAGEMENT_ENABLED=false
TRADE_STOP_LOSS_ENABLED=false
TRADE_CLOSE_ENABLED=false
```
then restart. The bot returns to alert-only mode.

## Slash-command registration and propagation

Registration happens once on `ClientReady` in `src/discord/client.ts`
(`.setName('alert')` and `.setName('level')` builders, global `REST.put`).
- Commands appear in all guilds the bot is in (global commands).
- Propagation delay: up to ~1 hour globally. For instant updates during
  development, registration would need to be changed to guild-scoped (not
  currently implemented).
- If commands are missing after deploy: wait for propagation, confirm the bot
  is online (`ClientReady` logged), confirm `DISCORD_BOT_TOKEN` is valid, and
  check `journalctl` for "Failed to register Discord commands".

## Discord permission and channel ID problems

Required bot permissions (in each channel it operates):
- Alert channels (`ETHUSD_*`): View Channel, Send Messages, Read Message
  History, Embed Links, Manage Messages (select menu updates).
- Dashboard channel: View Channel, Send Messages, Embed Links, Read Message
  History, Manage Messages.
- Intents used: `Guilds`, `GuildMessages`.

Channel ID errors surface as:
- Config load error "Missing required channel configuration: ..." (empty IDs)
- Config load error "Duplicate channel configuration: ..." (shared IDs)
- "Price alerts can only be configured in #ETHUSD, #SOLUSD or #BTCUSD."
- Dashboard: "Trade dashboard channel missing" logged; no messages posted.

## Delta API authentication, trusted IP, and network failures

Authenticated endpoints (`/v2/positions/margined`, `/v2/orders`, etc.) use HMAC-SHA256
signatures (`api-key`, `timestamp`, `signature` headers), built by
`buildSignature` in `src/delta/authenticatedClient.ts`.

- `DELTA_API_BASE_URL` defaults to `https://api.india.delta.exchange`.
- Whitelist the egress IP of the host in the Delta Exchange API key settings.
  On EC2, assign an Elastic IP and add it to the key's trusted IP list; API
  requests from non-whitelisted IPs are rejected.
- Use least-privilege API keys (read positions/orders; order placement only if
  you enable live stop/close gates).
- Rate limit (HTTP 429) throws "Rate limited by Delta Exchange (reset ...)" and
  is logged; the poll/integration tick catches and continues.
- Network/API failures are logged and do not change session state (failed poll
  → no close marks; failed stop placement → status `failed`).

## Ports and firewall

The bot makes outbound HTTPS/WSS connections only (Discord gateway, Delta REST
and WebSocket). No inbound ports are required. Allow outbound 443/8443.
