# Linear Pulse

Linear Pulse is a Cloudflare Worker that relays [Linear](https://linear.app) webhook events to Telegram as formatted notifications. The Telegram bot is named **Blue**. It receives every webhook Linear fires, runs it through a 3-layer filter engine, formats it into a concise HTML message, and delivers it to one or more Telegram chats -- each with independent filter and project scope configuration. Configuration is managed via Telegram commands, a CLI tool, or the admin API.

## Features

- **Real-time Linear notifications** -- issues, comments, status changes, assignments, priority escalations, project updates, and more
- **HMAC-SHA256 signature verification** with timestamp drift protection
- **3-layer filter engine** -- event type/action filtering, project/team/label scoping, and noisy-field suppression
- **Multi-channel routing** -- send different projects to different Telegram chats, each with their own filter config
- **Smart formatting** -- status transitions show old/new state, priority escalations are highlighted, comments are truncated, urgent issues get a red dot
- **Auto-discovery** -- projects are registered automatically as events arrive; no manual ID entry needed
- **Per-chat admin controls** -- `/mute`, `/track`, `/reset` directly in Telegram
- **Locked to your chats** -- Blue ignores commands in chats it doesn't post to, and only listed admins can change config or add a chat
- **CLI tool** -- manage bot profile, view/update config, check health
- **Admin API** -- Bearer-token-protected endpoints for config reads and writes
- **Issue-to-project caching** -- comments (which lack project data in Linear's payload) are routed correctly via a KV lookup cache

## Architecture

The worker is a [Hono](https://hono.dev) app deployed to Cloudflare Workers. Linear sends webhooks to the worker, which verifies the signature, filters the event, formats it, resolves the target chat(s), and sends via the Telegram Bot API. All persistent state (filter configs, channel list, project directory, topic mappings, issue-project cache) lives in a single Workers KV namespace.

```
Linear Webhook --> [Signature Verify] --> [Filter Engine] --> [Formatter] --> [Channel Router] --> Telegram Bot API
                                                                                  |
                                                                           Workers KV (config,
                                                                           channels, project
                                                                           directory, cache)
```

### File Structure

```
linear-pulse/
  src/
    index.ts                  # Hono app, all routes, main webhook handler
    index.test.ts
    types/
      linear.ts               # Linear webhook payload types
      config.ts               # FilterConfig, Channel, TopicConfig types + defaults
    webhook/
      verify.ts               # HMAC-SHA256 signature verification, timestamp check, secret compare
      verify.test.ts
      telegram.ts             # Telegram bot command handler + project auto-registration
      telegram.test.ts
    filters/
      engine.ts               # 3-layer filter: event, scope, field
      engine.test.ts
    config/
      loader.ts               # KV read/write, merge, validation for FilterConfig + channels
      project-cache.ts        # Issue ID -> Project ID cache (30-day TTL)
    telegram/
      client.ts               # Telegram Bot API client (send, bot profile)
      formatter.ts            # Per-event-type HTML message templates
      formatter.test.ts
      html.ts                 # HTML escaping + safe truncation
    testing/
      fakes.ts                # In-memory KV + Telegram fakes for tests
  cli/
    index.ts                  # CLI entry point
    api.ts                    # HTTP clients for worker admin API + Telegram API
    run.sh                    # Shell wrapper for npx tsx
    commands/
      bot.ts                  # bot setup, info, set-description
      config.ts               # config get, set (--enable/--disable), reset
      status.ts               # health check + channel listing
  wrangler.toml
  package.json
  tsconfig.json
  vitest.config.ts
  .dev.vars.example
```

## Setup Guide

### Prerequisites

- A Cloudflare account with Workers enabled
- A Telegram account
- A Linear workspace with admin access to create webhooks
- Node.js >= 18 and npm

### 1. Create the Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot` and follow the prompts. Save the bot token.
3. **Disable privacy mode** so the bot can read commands in groups:
   - `/mybots` > select your bot > Bot Settings > Group Privacy > Turn off
4. **Allow joining groups:**
   - `/mybots` > select your bot > Bot Settings > Allow Groups > Turn on
5. Add the bot to your Telegram group chat
6. Get the chat ID. The easiest way: add [@RawDataBot](https://t.me/RawDataBot) to the group temporarily, note the `chat.id` value (negative number like `-100...`), then remove it.

### 2. Clone and Install

```bash
git clone https://github.com/Blueprint-Studio-AI/linear-pulse.git
cd linear-pulse
npm install
```

### 3. Create the KV Namespace

```bash
npx wrangler kv namespace create CONFIG
```

Copy the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CONFIG"
id = "<your-namespace-id>"
```

### 4. Set Secrets

```bash
npx wrangler secret put LINEAR_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

| Secret | Where to get it |
|---|---|
| `LINEAR_WEBHOOK_SECRET` | Linear Settings > API > Webhooks (shown when you create the webhook) |
| `TELEGRAM_BOT_TOKEN` | BotFather gives you this when you create the bot |
| `TELEGRAM_CHAT_ID` | The group chat ID (e.g. `-1001234567890`) |
| `ADMIN_TOKEN` | Generate yourself -- any strong random string (used for the admin API) |
| `TELEGRAM_WEBHOOK_SECRET` | Generate yourself -- any strong random string (used to verify Telegram webhook requests) |

All five are required. If `ADMIN_TOKEN` or `TELEGRAM_WEBHOOK_SECRET` is missing, the endpoints that check it reject every request.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the values.

### 5. Deploy

```bash
npx wrangler deploy
```

Your worker URL will be `https://linear-pulse.<your-subdomain>.workers.dev`.

Verify it's running:

```bash
curl https://linear-pulse.<your-subdomain>.workers.dev/health
# {"status":"ok","service":"linear-pulse"}
```

### 6. Register the Telegram Webhook

Tell Telegram to forward bot updates to your worker. Include the `secret_token` so the worker can verify requests are from Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://linear-pulse.<your-subdomain>.workers.dev/webhook/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

### 7. Create the Linear Webhook

1. Go to Linear Settings > API > Webhooks > New Webhook
2. Set the URL to `https://linear-pulse.<your-subdomain>.workers.dev/webhook/linear`
3. Subscribe to all resource types you want notifications for (Issue, Comment, Project, ProjectUpdate, etc.)
4. Save -- **immediately copy the signing secret** and use it as `LINEAR_WEBHOOK_SECRET`

### 8. Run Bot Setup

Configure Blue's Telegram profile (description, about text):

```bash
TELEGRAM_BOT_TOKEN=<token> npm run cli -- bot setup
```

### 9. Add Admins

Admin commands are refused until at least one admin is listed. Send `/whoami` to Blue (in any chat) to get your Telegram user ID, then store the list of admin IDs in KV:

```bash
npx wrangler kv key put admin_users '[123456789]' --binding CONFIG --remote
```

### 10. Seed the Project Directory

The project directory is populated automatically as Linear events arrive. To seed it immediately, create or update an issue in each Linear project. Blue will register each project on first contact.

## Multi-Channel Routing

By default, all events go to the single chat specified by `TELEGRAM_CHAT_ID`. For multi-channel routing, add the bot to multiple Telegram groups and use `/track` in each group to scope it to specific projects.

**How it works:**

1. Add Blue to a second Telegram group
2. As an admin, send `/track <project name>` in that group -- this registers the group as a channel with its own filter config. Only admins can register a new chat.
3. Events for that project now go to that group only (if it's the only group tracking it)
4. Groups with no project scope (empty `scope.projects`) receive all events

Each channel stores its own independent `FilterConfig` in KV under the `channels` key. When a webhook arrives, the worker iterates all channels and sends to each one whose filters pass.

Once any channel exists, `TELEGRAM_CHAT_ID` and the global `filter_config` are no longer used for routing. Register the default chat as a channel too (run any admin command in it) if it should keep receiving events.

**Example:**

- **#engineering** group: `/track API Platform` + `/track Infrastructure`
- **#design** group: `/track Brand Studio` + `/mute Comment`
- **#all-activity** group: no `/track` commands -- receives everything

## Telegram Commands

Blue answers only in chats it posts to: registered channels and the `TELEGRAM_CHAT_ID` chat. In any other chat it ignores everything except `/whoami`, and an admin-only command from an admin, which registers that chat. Admin-only commands require the sender's Telegram user ID to be in the admin list (KV key `admin_users`). If the list is empty, nobody can run them.

| Command | Description | Admin Only |
|---|---|---|
| `/help` | Show all available commands | No |
| `/status` | Show current filter config for this chat (muted types, tracked projects) | No |
| `/types` | List all Linear resource types | No |
| `/projects` | List all known projects with tracked/untracked status | No |
| `/mute <type>` | Mute a resource type in this chat (e.g. `/mute Comment`) | Yes |
| `/unmute <type>` | Unmute a resource type | Yes |
| `/track <name>` | Only notify for this project in this chat | Yes |
| `/untrack <name>` | Remove a project from this chat's scope | Yes |
| `/trackall` | Clear project filter -- receive events for all projects | Yes |
| `/reset` | Reset all filters for this chat to defaults | Yes |
| `/display` | Show which fields appear in messages | No |
| `/show <field>` | Show a field or message kind (`project`, `identifier`, `actor`, `transition`, `assignments`, `unassignments`) | Yes |
| `/hide <field>` | Hide a field, or stop assignment/unassignment messages | Yes |
| `/whoami` | Your Telegram user ID and this chat's ID (works in any chat) | No |

**Resource types available for muting:** Issue, Comment, Project, ProjectUpdate, Cycle, Document, Initiative, InitiativeUpdate, IssueLabel, Reaction, IssueSLA, Customer, CustomerRequest, User

## CLI

The CLI runs via `npx tsx` and communicates with both the deployed worker (admin API) and the Telegram Bot API directly.

**Environment variables:**

```bash
export TELEGRAM_BOT_TOKEN=<your-bot-token>
export PULSE_WORKER_URL=https://linear-pulse.<your-subdomain>.workers.dev
export PULSE_ADMIN_TOKEN=<your-admin-token>
```

### Commands

The `config` commands edit the global config, which only routes events while no chat has its own channel config. The CLI warns when that's the case.

```bash
# Bot management
npm run cli -- bot setup                    # Set Blue's description + about text
npm run cli -- bot info                     # Show bot info from Telegram
npm run cli -- bot set-description "text"   # Set a custom bot description

# Config management
npm run cli -- config get                   # View current global filter config
npm run cli -- config set --disable Issue   # Mute all Issue events
npm run cli -- config set --disable Issue.remove  # Mute only issue deletions
npm run cli -- config set --enable Comment  # Re-enable all Comment events
npm run cli -- config set --enable Issue.remove   # Re-enable issue deletions
npm run cli -- config reset                 # Reset global config to defaults

# Health & diagnostics
npm run cli -- status                       # Check worker health + list channel configs
```

## Configuration

### The 3-Layer Filter System

Every incoming Linear webhook passes through three filter layers in sequence. An event must pass all three to be forwarded.

**Layer 1 -- Event Type + Action**

Controls which resource types and actions are enabled. Stored in `config.events`.

```json
{
  "events": {
    "Reaction": [],
    "Issue": ["create", "update"]
  }
}
```

- Key absent = all actions allowed for that type
- Key present with array of actions = only those actions allowed
- Key present with empty array `[]` = type is fully muted

**Layer 2 -- Scope (Project / Team / Label)**

Restricts events to specific projects, teams, or labels. Stored in `config.scope`.

```json
{
  "scope": {
    "projects": ["project-uuid-1", "project-uuid-2"],
    "teams": [],
    "labels": ["bug", "urgent"]
  }
}
```

- Empty array = no filtering (all pass)
- Non-empty array = event must match at least one entry

For comments (which don't carry project info in Linear's payload), the worker uses a KV cache of issue-to-project mappings to resolve the project. Every Issue event updates the cache, including ones that don't notify. Entries expire after 30 days.

**Layer 3 -- Field-Level Update Filtering**

Suppresses noisy `update` events where only irrelevant fields changed. Stored in `config.updates.ignoreFields`.

```json
{
  "updates": {
    "ignoreFields": ["sortOrder", "boardOrder", "subscriberIds", "trashed"]
  }
}
```

If an `update` event's `updatedFrom` keys are all in `ignoreFields`, the event is silently dropped.

### KV Config Structure

All config is stored in a single Workers KV namespace under these keys:

| KV Key | Contents |
|---|---|
| `filter_config` | Global `FilterConfig` (fallback when no channels are configured) |
| `channels` | Array of `Channel` objects, each with `chatId`, `name`, and its own `FilterConfig` |
| `project_directory` | Array of `{ id, name }` entries, auto-populated from events |
| `admin_users` | Array of Telegram user IDs allowed to run admin commands |
| `ip:<issueId>` | Cached project ID for a given issue (30-day TTL) |
| `st:<stateId>` | Cached workflow state name, so status messages can show "Old → New" (Linear's `updatedFrom` only carries the old `stateId`) |

## API Endpoints

All admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Returns `{"status":"ok","service":"linear-pulse"}` |
| `POST` | `/webhook/linear` | Linear Signature | Receives Linear webhook events |
| `POST` | `/webhook/telegram` | Telegram Secret | Receives Telegram bot updates |
| `GET` | `/config` | Bearer | Get current global filter config |
| `PUT` | `/config` | Bearer | Update global filter config (partial merge) |
| `GET` | `/channels` | Bearer | List all registered channels with their configs |

### Examples

```bash
# Check health
curl https://linear-pulse.example.workers.dev/health

# Get config
curl -H "Authorization: Bearer $PULSE_ADMIN_TOKEN" \
  https://linear-pulse.example.workers.dev/config

# Mute Reaction events
curl -X PUT \
  -H "Authorization: Bearer $PULSE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"events":{"Reaction":[]}}' \
  https://linear-pulse.example.workers.dev/config

# List channels
curl -H "Authorization: Bearer $PULSE_ADMIN_TOKEN" \
  https://linear-pulse.example.workers.dev/channels
```

## Development

```bash
# Start local dev server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

Local dev uses `.dev.vars` for secrets. Copy `.dev.vars.example` and fill in values.
