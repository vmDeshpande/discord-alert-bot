# Deployment Guide

## Prerequisites
- Node.js 22+, npm
- Discord bot with intents and slash commands
- Delta Exchange India API credentials (least privilege)
- Linux (Amazon Linux 2023 recommended)

## Setup
1. `npm ci`
2. Copy `.env.example` to `.env` and configure
3. `npm run build`
4. Start with `npm start` or systemd

## Discord
- Create bot, invite with permissions to send messages/manage messages
- Slash commands registered on ready

## Delta
- Create API key/secret with minimal permissions
- Use production/demo base URLs as appropriate

## Staged Rollout
1. Alert-only: all trade flags false
2. Read-only monitoring: TRADE_MANAGEMENT_ENABLED=true with explicit channel, no live gates
3. Stop placement: enable only with verified gate
4. Closing: enable only with verified gate

## systemd (example)
See service unit configuration as appropriate; ensure env loaded and restart policy set.

## Backup
Backup SQLite database file regularly.

## Rollback
Set trade flags false to return to alert-only.
