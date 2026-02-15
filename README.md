# telegram-mcp

Production-grade Telegram MCP server (Bot API complete domains + MTProto foundation).

## Features
- Dual transport: `stdio` and streamable HTTP (`/mcp`).
- Security defaults: OIDC JWT auth (Keycloak), RBAC + tool allowlists, encrypted-at-rest bot/MTProto credentials.
- Strict per-method Bot API JSON Schema validation generated from `@grammyjs/types`.
- Automated Bot API parity checks against generated method inventory.
- PostgreSQL persistence with idempotency, audit log, policy storage, and session/account records.
- Telegram tool families:
  - `telegram.bot.messages`
  - `telegram.bot.media`
  - `telegram.bot.chats`
  - `telegram.bot.members`
  - `telegram.bot.inline`
  - `telegram.bot.commands`
  - `telegram.bot.webhooks`
  - `telegram.bot.payments`
  - `telegram.bot.business`
  - `telegram.bot.passport`
  - `telegram.bot.stickers`
  - `telegram.bot.forum`
  - `telegram.bot.raw` (restricted)
  - `telegram.mtproto.sessions`
  - `telegram.mtproto.core`
- MCP resources:
  - `telegram://bots`
  - `telegram://bot/{botId}/profile`
  - `telegram://policies`
  - `telegram://audit/recent`

## Prerequisites
- Node.js 22+
- PostgreSQL 16+
- Telegram bot token(s)
- Telegram `apiId` and `apiHash` for MTProto
- OIDC provider (Keycloak profile included in `docker/`)

## Quickstart
```bash
npm install
cp telegram-mcp.config.example.json telegram-mcp.config.json
```

Set a 32-byte base64 master key:
```bash
export TELEGRAM_MCP_MASTER_KEY="$(openssl rand -base64 32)"
```

Run migrations:
```bash
npm run migrate
```

Run HTTP mode:
```bash
npm run dev -- serve --transport=http --port=3000
```

Run stdio mode:
```bash
npm run dev -- serve --transport=stdio
```

## CLI
- `telegram-mcp serve --transport=stdio`
- `telegram-mcp serve --transport=http --port=3000`
- `telegram-mcp migrate`
- `telegram-mcp policy validate --file=policy.json`
- `telegram-mcp bot account-upsert --account-ref=... --display-name=... --token=...`
- `telegram-mcp bot webhook set --account-ref=... --url=...`
- `telegram-mcp mtproto session add --account-ref=... --display-name=... --phone=...`
- `telegram-mcp mtproto session list`
- `telegram-mcp mtproto session revoke --account-ref=...`
- `telegram-mcp mtproto session health --account-ref=...`

## HTTP Endpoints
- `POST|GET|DELETE /mcp`
- `GET /healthz`
- `GET /readyz`
- `GET /metrics`

## Docker Compose (Postgres + Keycloak + App)
```bash
cd docker
TELEGRAM_MCP_MASTER_KEY="$(openssl rand -base64 32)" docker compose up --build
```

## Tests
```bash
npm run test
```

Regenerate and validate Bot API contracts:
```bash
npm run generate:bot-contract
npm run check:bot-contract
```

GitHub automation:
- `.github/workflows/bot-contract-sync.yml` regenerates contract artifacts after `@grammyjs/types` bumps (via `package*.json` changes on `main`) and opens an automated PR when generated files change.

## Production Notes
- Keep `TELEGRAM_MCP_MASTER_KEY` in a secret manager or sealed environment secret.
- Rotate with `TELEGRAM_MCP_PREVIOUS_MASTER_KEY` for zero-downtime decryption fallback.
- Keep `telegram.bot.raw` limited to `admin`/`owner`.
- Use metadata-only retention by default; avoid storing message payloads unless required.
