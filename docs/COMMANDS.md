# Discord Commands Reference

Every slash command, subcommand, option, interaction, and response implemented in
the bot. Sources: `src/discord/client.ts`, `src/discord/router.ts`,
`src/discord/tradeInteractions.ts`, `src/discord/interactions.ts`, and
`src/index.ts` (interaction binding).

Commands are registered globally on `ClientReady` via
`REST.put(Routes.applicationCommands(...))` (discord.js REST v10). Propagation to
servers can take up to an hour; use a guild-scoped register for instant testing
(requires code change — registration is currently global).

## Command availability

- `/alert` — always available when the Discord client is running. Works only in
  the configured ETHUSD/SOLUSD/BTCUSD alert channels.
- `/level` — available only when trade management is enabled
  (`TRADE_MANAGEMENT_ENABLED=true`) and the trade storages are wired. Routed
  only if `tradeStorage` and `levelStorage` are present; otherwise replies
  "Trade management not available."

## /alert — Manage price alerts

Subcommands: `set`, `delete`, `activate`, `deactivate`, `list`.

### /alert set

```
Syntax:    /alert set price:<target price>
Options:   price (string, required) — target price, must be a positive finite number
Ephemeral: no
DB effect: yes — inserts a new alert row; deleted automatically on trigger
Trade mgmt: not required
```

Behavior:
1. Validates `price` is a positive finite number; otherwise replies
   "price must be a positive finite number."
2. Fetches baseline price from
   `GET https://api.india.delta.exchange/v2/tickers/{symbol}` (`result.close`,
   number or numeric string). On failure or invalid baseline replies
   "Current price unavailable. Please try again shortly." and does not create
   an alert.
3. Direction: `upward` if `target >= baseline`, else `downward`.
4. Inserts alert row (`active=1, triggered=0`) into SQLite.
5. Replies (non-ephemeral):
   `? {SYMBOL} alert set\nTarget: ${target}\nStatus: Active`

Example: `/alert set price:4500` in #ETHUSD

Prerequisite: command must be invoked in #ETHUSD, #SOLUSD, or #BTCUSD
(configured via `ETHUSD_CHANNEL_ID`/`SOLUSD_CHANNEL_ID`/`BTCUSD_CHANNEL_ID`).
Outside these channels replies "Price alerts can only be configured in
#ETHUSD, #SOLUSD or #BTCUSD."

Triggering: when the WebSocket price crosses the target (respecting baseline
and direction), the bot sends an alert message to the channel and deletes the
alert row. If Discord delivery fails, the alert remains active. Duplicate
delivery for the same price update is suppressed.

### /alert delete

```
Syntax:    /alert delete
Options:   none
Ephemeral: no
DB effect: yes — deletes the selected alert row
Trade mgmt: not required
```

Shows a select menu ("Select an alert to delete", customId `alert:delete`)
listing all alerts in the channel. Selecting an alert deletes it and updates
the message to "{SYMBOL} alert deleted." Replies "No alerts to delete in this
channel." when empty.

### /alert activate

```
Syntax:    /alert activate
Options:   none
Ephemeral: no
DB effect: yes — sets active=1 on the selected alert
Trade mgmt: not required
```

Shows a select menu listing inactive alerts in the channel. Selecting activates
the alert and replies "{SYMBOL} alert activated." Replies "No inactive alerts to
activate in this channel." when empty.

### /alert deactivate

```
Syntax:    /alert deactivate
Options:   none
Ephemeral: no
DB effect: yes — sets active=0 on the selected alert
Trade mgmt: not required
```

Shows a select menu listing active alerts in the channel. Selecting deactivates
the alert and replies "{SYMBOL} alert deactivated." Replies "No active alerts to
deactivate in this channel." when empty.

### /alert list

```
Syntax:    /alert list
Options:   none
Ephemeral: no
DB effect: no (read-only)
Trade mgmt: not required
```

Lists all alerts in the channel with price and Active/Inactive status. Header
uses the first alert's symbol, or the channel symbol when empty. Replies
"No alerts configured." when empty.

### Alert select menus (alert:delete / alert:activate / alert:deactivate)

Custom IDs: `alert:delete`, `alert:activate`, `alert:deactivate`.
- Validates the selected alert exists and belongs to the current channel
  (else "Alert not found..." / "This alert does not belong to this channel.").
- `delete` → `storage.deleteById`; `activate` → `active=true`; `deactivate` →
  `active=false`. Updates the interaction message on success or
  "An error occurred while processing the action." on failure.

## /level — Manage trade levels

Subcommands: `set`, `list`, `activate`, `deactivate`, `delete`.

### Important: registered options vs. handler requirements

In `src/discord/client.ts:98-153`, every `/level` option is registered with
`setRequired(false)` (optional). However every handler that uses them treats
`trade_id` (and `price`/`condition`/`level_id` where applicable) as required
and replies with a validation error when missing. This is a **known mismatch**:
the Discord UI will not require them, but the bot will reject incomplete
invocations.

### /level set

```
Syntax:    /level set trade_id:<id> price:<price> condition:<BUY|SELL>
Options:   trade_id (string, registered optional / handler required)
           price    (string, registered optional / handler required)
           condition(string, registered optional / handler required)
Ephemeral: yes
DB effect: yes — inserts a level row (status=inactive, monitoringState=idle)
Trade mgmt: required
Prerequisite: trade exists, not closed, stop_loss_status=verified
```

Behavior:
1. Requires `trade_id`, `price`, `condition`; else "Provide trade_id, price,
   and condition (BUY/SELL)."
2. Trade must exist and not be closed; else "Trade not found or closed."
3. `trade.stopLossStatus` must be `verified`; else "Stop must be verified before
   adding levels." (ephemeral)
4. `price` must be a positive finite number; else "Invalid price."
5. `condition` must be `BUY` or `SELL` (uppercased); else "Condition must be
   BUY or SELL."
6. Inserts level row bound to `trade.id` with `status='inactive'`,
   `monitoringState='idle'`.
7. Replies "Level added (inactive)."

### /level list

```
Syntax:    /level list [trade_id:<id>]
Options:   trade_id (string, registered optional / handler conditional)
Ephemeral: yes only when multiple trades and no trade_id
DB effect: no (read-only)
Trade mgmt: required
```

- With `trade_id`: shows that trade's levels or "No levels for trade {id}."
- Without `trade_id`: lists all trades; if exactly one trade, shows its levels;
  if multiple trades, replies "Multiple trades found. Specify trade_id."
  (ephemeral); if none, "No trade sessions found."
- Level line format: `- {id}: {levelPrice} {condition} [{status}/{monitoringState}]`

### /level activate

```
Syntax:    /level activate trade_id:<id> level_id:<id>
Options:   trade_id (registered optional / handler required)
           level_id (registered optional / handler required)
Ephemeral: yes
DB effect: yes — sets level status=active, monitoringState=monitoring
Trade mgmt: required
Prerequisite: trade exists, not closed, stop_loss_status=verified; level belongs to trade
```

Replies "Level activated." on success.

### /level deactivate

```
Syntax:    /level deactivate trade_id:<id> level_id:<id>
Options:   trade_id (registered optional / handler required)
           level_id (registered optional / handler required)
Ephemeral: yes
DB effect: yes — sets level status=inactive, monitoringState=idle
Trade mgmt: required
Prerequisite: level belongs to trade
```

Replies "Level deactivated." on success. Does not verify the trade is open or
the stop is verified.

### /level delete

```
Syntax:    /level delete trade_id:<id> level_id:<id>
Options:   trade_id (registered optional / handler required)
           level_id (registered optional / handler required)
Ephemeral: yes
DB effect: yes — deletes the level row
Trade mgmt: required
Prerequisite: level belongs to trade
```

Replies "Level deleted." on success.

## Manage Trade interactions (dashboard)

These are component interactions, not slash commands. They appear on dashboard
trade embeds and in follow-up replies.

### Manage Trade button

Custom ID format: `trade:manage:{tradeId}:{action}`
Actions: `add`, `list`, `refresh`, `activate`, `deactivate`, `delete`.

Buttons are rendered by `buildManageButtons(tradeId)` (add/list/refresh) and
`buildLevelActionButtons(tradeId)` (activate/deactivate/delete) in
`src/discord/tradeInteractions.ts`.

#### add
- Prerequisite: `trade.stopLossStatus === 'verified'`; else "Stop must be
  verified before adding levels."
- Opens the Add Level modal (`trade:modal:{tradeId}:addlevel`).

#### list
- Replies with the trade manage embed + manage buttons. Replies "No levels to
  manage." when no levels.

#### refresh
- Re-renders the trade manage embed + manage buttons.

#### activate / deactivate / delete
- Requires at least one level; else "No levels to manage."
- `activate` additionally requires `stopLossStatus === 'verified'`.
- Shows a level select menu (`trade:levelsel:{tradeId}:{action}`) titled
  "Select level to {action}:".

### Level select menu

Custom ID format: `trade:levelsel:{tradeId}:{action}` (action: activate,
deactivate, delete).
- Validates trade exists and is not closed; level exists and belongs to trade.
- `activate` requires `stopLossStatus === 'verified'` (else ephemeral error).
- `activate` → level status=active/monitoringState=monitoring.
- `deactivate` → level status=inactive/monitoringState=idle.
- `delete` → deletes the level row.
- Replies "Level activated/deactivated/deleted." or "Invalid level." / "Trade is
  closed."

### Add Level modal

Custom ID format: `trade:modal:{tradeId}:addlevel`.
- Text inputs: `level_price` (required), `level_condition` (required, BUY/SELL).
- Prerequisite: trade exists, not closed, `stopLossStatus === 'verified'`.
- Validates price (positive finite) and condition (BUY/SELL).
- Inserts level row (`status='inactive'`, `monitoringState='idle'`).
- Replies "Level added (inactive)."

### Interaction audit (trade_interactions table)

When a `trade:manage:{tradeId}:{action}` button is pressed, a row is inserted
into `trade_interactions` (`type=manage_{action}`, `state='open'`, user,
channel, message, data) if `tradeInteractionStorage` is available. Insert
failures are ignored.

## Response conventions

- `/alert` responses are **not ephemeral** (visible in channel).
- `/level` responses are **ephemeral** where noted.
- Button/select/modal replies are generally ephemeral.
- Errors reply "An error occurred." or "An error occurred while processing the
  action." and are logged.
- Unknown subcommand replies "Unknown subcommand." / "Unknown action."

## Known mismatches and limitations

- All `/level` options are registered optional but required by handlers.
- `/level deactivate` and `/level delete` do not check that the trade is open
  or that the stop is verified; they only check level ownership.
- `/level set` requires a verified stop before any level can be added.
- Level management is only available when trade management is enabled at
  startup; it cannot be toggled at runtime without restart.
