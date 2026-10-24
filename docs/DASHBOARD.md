# Trade Dashboard

The trade dashboard is a dedicated Discord channel that publishes one embed per
active trade session. It is part of trade management and requires
`TRADE_MANAGEMENT_ENABLED=true`.

## Dashboard channel variable

| Variable | Default | Required when |
|---|---|---|
| `TRADE_DISCORD_CHANNEL_ID` | `''` | `TRADE_MANAGEMENT_ENABLED=true` |

There is **no fallback** to the ETHUSD/SOLUSD/BTCUSD alert channels. If trade
management is enabled and this variable is empty, `loadConfig` throws:
"TRADE_DISCORD_CHANNEL_ID must be configured for trade management dashboard."

### Obtaining the Discord channel ID

1. In Discord, go to User Settings → Advanced → enable "Developer Mode".
2. Right-click the target channel → "Copy Channel ID".
3. Paste the 17–19 digit numeric ID into `TRADE_DISCORD_CHANNEL_ID`.

The bot must be able to view, send, and edit messages in that channel
(required permissions below).

## How dashboard messages are created, edited, persisted

The dashboard service (`src/tradeManagement/dashboardService.ts`) is created in
`src/index.ts` only when trade management is enabled. It uses a Discord adapter
over the raw Discord client (`channels.fetch`, `messages.fetch`, `send`,
`edit`).

Lifecycle on each refresh:

1. `tradeStorage.getAll()` returns all trade rows.
2. For each trade with `monitoring_status != 'closed'`:
   - If `discordMessageId` is null: `sendMessage(channelId, undefined, embed)`.
     On success, upserts the trade with `discordChannelId`, `discordMessageId`,
     `updatedAt`, `lastSeenAt`. Logs "Dashboard message created".
   - If `discordMessageId` exists: `editMessage(channelId, messageId, undefined,
     embed)`. On success nothing is persisted. On failure (`ok === false` or
     exception): recreates by sending a new message and upserting the new
     messageId ("Dashboard message recreated after edit failure").
3. Closed trades are skipped (no message created/updated for them).

Refresh interval: `Math.max(TRADE_DASHBOARD_THROTTLE_MS, 5000)` ms via
`setInterval` started in `src/index.ts`. The service also enforces its own
`throttleMs` minimum and defers refreshes that arrive too soon. Concurrency
guard (`running` flag) prevents overlapping refreshes.

## Dashboard embed fields

Built by `buildTradeEmbed` (`src/tradeManagement/dashboard.ts`). Each embed:

| Field | Value |
|---|---|
| Title | `{SYMBOL} {LONG|SHORT}` |
| Product ID | `trade.productId` |
| Entry Price | `trade.entryPrice` |
| Size | `trade.size` |
| Mark Price | `trade.markPrice` or "Unavailable" |
| Unrealized PnL | `trade.unrealizedPnl` + currency or "Unavailable" |
| Stop Loss | `{price} ({status})` or "Unavailable" |
| Status | `trade.monitoringStatus` |
| Last Event | `trade.lastEvent` or "none" |
| Updated | `trade.lastSeenAt` |

The dashboard service additionally appends two fields:
- "Last Exchange Reconcile" — `lastReconcileAt` (in-memory timestamp of the last
  successful dashboard refresh) or "Unknown".
- "Data Freshness" — "Recent" or "Stale/Unavailable".

The dashboard embed does **not** show monitoring levels. Level details appear
only in the Manage Trade embed (opened via the Manage Trade button).

## What happens when a trade closes

- The position poller marks the trade `monitoring_status='closed'` when its
  product disappears from the exchange positions list after a successful poll.
- The level monitor deletes all levels of a closed trade during its tick.
- The dashboard service skips closed trades entirely (`upsertTrade` returns
  early). Their previously posted message, if any, is **not** edited or deleted
  by the bot — it remains in the channel as a historical record.

## Required permissions

The bot needs, in the dashboard channel:
- View Channel
- Send Messages
- Embed Links
- Read Message History
- Manage Messages (needed to edit messages it sent)

If the bot lacks permissions, `sendMessage`/`editMessage` fail, are logged
("Dashboard send failed" / "Dashboard edit failed"), and the dashboard keeps
running with the last known state. Message IDs may not be persisted if sending
fails.

## Dashboard vs. ETHUSD/SOLUSD/BTCUSD alert channels

| | Dashboard channel (`TRADE_DISCORD_CHANNEL_ID`) | Alert channels (`ETHUSD_*` etc.) |
|---|---|---|
| Purpose | Trade session embeds + Manage Trade controls | Price alert delivery + /alert commands |
| Content | One embed per open trade (position, PnL, stop, status) | One-shot alert messages when targets are hit |
| Commands | None hosted here | `/alert set/list/activate/deactivate/delete` |
| Buttons/modals | Manage Trade buttons, add-level modal, level selects | Alert select menus (delete/activate/deactivate) |
| Created by | Dashboard service (auto) | User-created Discord channels |
| Required when trade mgmt on | Yes (`TRADE_DISCORD_CHANNEL_ID`) | Yes (all three channel IDs always required) |

The dashboard channel is independent of the alert channels. Alerts never post
to the dashboard channel and the dashboard never sends price alerts.

## Recovery after restarts

- Trade rows (including `discord_channel_id` and `discord_message_id`) persist
  in SQLite. After a restart, `dashboardService.initialize()` calls `refresh()`,
  which edits existing messages by ID or creates new ones if the ID is missing
  or the message was deleted (edit failure → recreate).
- `lastReconcileAt` / "Data Freshness" are **in-memory only** and reset on
  restart ("Unknown" / "Stale/Unavailable" until the next refresh).
- Trade session state (monitoring status, stop loss, levels) is restored from
  SQLite; the position poller re-reconciles with the exchange on its first poll.
- In-memory dashboard refresh timers are recreated at startup.

## Failure behavior

- Edit failure → message is recreated (new `discord_message_id` persisted).
- Send failure → error logged, no message ID persisted; retried on next refresh.
- Database `getAll` failure → error logged, refresh continues (no crash).
- Discord API rate limits / transient failures → individual trade update fails,
  other trades still processed; service keeps running.
- Dashboard is explicitly "independent of safety-critical processing" — dashboard
  failures do not stop position polling, stop-loss management, or level
  monitoring.
