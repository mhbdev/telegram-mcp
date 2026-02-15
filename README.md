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
- Versioned MTProto superset tool families:
  - `telegram.v2.chats`
  - `telegram.v2.messages`
  - `telegram.v2.contacts`
  - `telegram.v2.profile`
  - `telegram.v2.search`
  - `telegram.v2.privacy`
  - `telegram.v2.drafts`
  - `telegram.v2.inline`
  - `telegram.v2.media` (S3/MinIO bridge)
  - `telegram.v2.approval.request`
  - `telegram.v2.approval.execute`
  - `telegram.v2.approval.status`
- MCP resources:
  - `telegram://bots`
  - `telegram://bot/{botId}/profile`
  - `telegram://policies`
  - `telegram://audit/recent`
  - `telegram://v2/chats`
  - `telegram://v2/contacts`
  - `telegram://v2/drafts`
  - `telegram://v2/approvals/recent`
  - `telegram://v2/media/{objectId}`

## Prerequisites
- Node.js 22+
- Docker + Docker Compose (for `--profile local`)
- PostgreSQL 16+ (for `--profile external`)
- Telegram bot token(s)
- Telegram `apiId` and `apiHash` for MTProto

## Quickstart (No Clone)
One-line setup:
```bash
npx @mhbdev/telegram-mcp@latest setup
```

One-line runtime (self-healing):
```bash
npx @mhbdev/telegram-mcp@latest run
```

Direct serve mode:
```bash
npx @mhbdev/telegram-mcp@latest serve --transport=stdio
```

## Profiles
- `local` (default): writes `.telegram-mcp/config.json` and `.telegram-mcp/.env`, sets `auth.required=false`, starts `postgres + keycloak + minio + minio-init`, and runs migrations unless `--skip-migrate`.
- `external`: writes config/env only by default and does not bootstrap local dependencies.

## Config And Env Defaults
- Config discovery order:
  - `.telegram-mcp/config.json`
  - `.telegram-mcp/config.yaml`
  - `.telegram-mcp/config.yml`
  - `telegram-mcp.config.json`
  - `telegram-mcp.config.example.json`
- Default generated files:
  - `.telegram-mcp/config.json`
  - `.telegram-mcp/.env`
- Setup format:
  - default `json`
  - `--format yaml` supported

Examples:
```bash
npx @mhbdev/telegram-mcp@latest setup --format yaml
npx @mhbdev/telegram-mcp@latest setup --profile external --non-interactive --yes
npx @mhbdev/telegram-mcp@latest run --transport http --host 127.0.0.1 --port 3000 --non-interactive --yes
```

## CLI
- `telegram-mcp setup [--profile local|external] [--format json|yaml]`
- `telegram-mcp run [--profile local|external] [--transport stdio|http]`
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

## Docker Compose (Postgres + Keycloak + MinIO + App)
```bash
cd docker
TELEGRAM_MCP_MASTER_KEY="$(openssl rand -base64 32)" docker compose up --build
```

## Competitive Matrix
- `docs/competitor-gap-matrix.md` maps competitor capability groups to `telegram.v2` operations.

## Tests
```bash
npm run test
```

CLI end-to-end smoke test:
```bash
npm run build
npm run test:e2e:smoke
```

Optional full-stack e2e (manual/nightly style):
```bash
npm run build
npm run test:e2e:fullstack
```

Regenerate and validate Bot API contracts:
```bash
npm run generate:bot-contract
npm run check:bot-contract
```

GitHub automation:
- `.github/workflows/bot-contract-sync.yml` regenerates contract artifacts after `@grammyjs/types` bumps (via `package*.json` changes on `main`) and opens an automated PR when generated files change.
- `.github/workflows/e2e-fullstack.yml` runs optional full-stack CLI e2e on schedule/manual trigger.

## Troubleshooting
- Docker Compose missing during `setup --profile local`:
  - interactive mode offers fallback options
  - non-interactive mode continues setup without dependency bootstrap
- Non-interactive `run` with missing setup artifacts:
  - pass `--yes` so self-healing setup can run automatically
- Existing config/env files:
  - setup prompts before overwrite in interactive mode
  - non-interactive overwrite requires `--force`

## Production Notes
- Keep `TELEGRAM_MCP_MASTER_KEY` in a secret manager or sealed environment secret.
- Rotate with `TELEGRAM_MCP_PREVIOUS_MASTER_KEY` for zero-downtime decryption fallback.
- Keep `telegram.bot.raw` limited to `admin`/`owner`.
- Use metadata-only retention by default; avoid storing message payloads unless required.
