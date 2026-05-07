# Linear Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that relays Linear webhook events to a Telegram group chat with forum topic routing, configurable filtering, and a CLI management tool.

**Architecture:** Hono-based Cloudflare Worker receives Linear webhooks, verifies HMAC signatures, filters events through a 3-layer config engine, formats HTML messages, routes to Telegram forum topics by project, and sends via Telegram Bot API. Admin API + CLI for config management.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Workers KV, Telegram Bot API, Vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts`
- Create: `.gitignore`
- Create: `.dev.vars.example`

- [ ] **Step 1: Initialize package.json with dependencies**

```bash
cd /Users/tylerstupart/linear-pulse
npm init -y
npm install hono
npm install -D wrangler typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create wrangler.toml**

```toml
name = "linear-pulse"
main = "src/index.ts"
compatibility_date = "2026-05-07"

[[kv_namespaces]]
binding = "CONFIG"
id = ""
preview_id = ""

[vars]
ENVIRONMENT = "production"
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
```

- [ ] **Step 5: Create .dev.vars.example**

```
LINEAR_WEBHOOK_SECRET=whs_your_secret_here
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=-100your_chat_id_here
ADMIN_TOKEN=your_admin_token_here
```

- [ ] **Step 6: Create minimal src/index.ts**

```typescript
import { Hono } from "hono";

type Bindings = {
  CONFIG: KVNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
```

- [ ] **Step 7: Verify it runs**

```bash
npx wrangler dev
# Should start on localhost:8787
# GET /health should return {"status":"ok"}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding — Hono + Cloudflare Workers"
```

---

### Task 2: Types — Linear Webhook Payloads

**Files:**
- Create: `src/types/linear.ts`

- [ ] **Step 1: Define Linear webhook payload types**

```typescript
export type LinearAction = "create" | "update" | "remove";
export type LinearSLAAction = "set" | "highRisk" | "breached";

export type LinearResourceType =
  | "Issue"
  | "Comment"
  | "IssueLabel"
  | "Project"
  | "ProjectUpdate"
  | "Cycle"
  | "Reaction"
  | "Document"
  | "Initiative"
  | "InitiativeUpdate"
  | "Customer"
  | "CustomerRequest"
  | "IssueSLA"
  | "User";

export interface LinearActor {
  id: string;
  type: string;
  name: string;
  email?: string;
}

export interface LinearWebhookPayload {
  action: LinearAction | LinearSLAAction;
  type: LinearResourceType;
  actor?: LinearActor;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  url: string;
  createdAt: string;
  webhookTimestamp: number;
  webhookId: string;
  organizationId: string;
}

// Commonly accessed nested fields on issue data
export interface LinearIssueData {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; type: string };
  assignee?: { id: string; name: string };
  project?: { id: string; name: string };
  team: { id: string; name: string; key: string };
  labels: Array<{ id: string; name: string }>;
  description?: string;
  url: string;
}

export interface LinearCommentData {
  id: string;
  body: string;
  issue: { id: string; identifier: string; title: string };
  user: { id: string; name: string };
  url: string;
}

export interface LinearProjectData {
  id: string;
  name: string;
  state: string;
  lead?: { id: string; name: string };
  url: string;
}

export interface LinearProjectUpdateData {
  id: string;
  body: string;
  project: { id: string; name: string };
  user: { id: string; name: string };
  url: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/linear.ts
git commit -m "feat: Linear webhook payload types"
```

---

### Task 3: Types — Config Schema

**Files:**
- Create: `src/types/config.ts`

- [ ] **Step 1: Define config types**

```typescript
import type { LinearResourceType, LinearAction, LinearSLAAction } from "./linear";

export type EventActions = Array<LinearAction | LinearSLAAction>;

export interface FilterConfig {
  events: Partial<Record<LinearResourceType, EventActions>>;
  scope: {
    projects: string[]; // Linear project IDs. Empty = all.
    teams: string[];    // Linear team IDs. Empty = all.
    labels: string[];   // Label names. Empty = no filtering.
  };
  updates: {
    ignoreFields: string[];
  };
}

export interface TopicMapping {
  topicId: number;
  name: string;
}

export interface TopicConfig {
  topics: Record<string, TopicMapping>; // key: linear project ID or "_general"
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  events: {},  // empty = all events, all actions enabled
  scope: {
    projects: [],
    teams: [],
    labels: [],
  },
  updates: {
    ignoreFields: ["sortOrder", "boardOrder", "subscriberIds", "trashed"],
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/config.ts
git commit -m "feat: config schema and defaults"
```

---

### Task 4: Signature Verification

**Files:**
- Create: `src/webhook/verify.ts`
- Create: `src/webhook/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/webhook/verify.test.ts
import { describe, it, expect } from "vitest";
import { verifyLinearSignature } from "./verify";

const SECRET = "whs_test_secret_123";

async function sign(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyLinearSignature", () => {
  it("returns true for a valid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const signature = await sign(body, SECRET);
    expect(await verifyLinearSignature(body, signature, SECRET)).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const body = '{"action":"create","type":"Issue"}';
    expect(await verifyLinearSignature(body, "bad_signature", SECRET)).toBe(false);
  });

  it("returns false for a tampered body", async () => {
    const body = '{"action":"create","type":"Issue"}';
    const signature = await sign(body, SECRET);
    expect(await verifyLinearSignature(body + "x", signature, SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts (project root)
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/webhook/verify.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 4: Implement signature verification**

```typescript
// src/webhook/verify.ts
export async function verifyLinearSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return expected === signature;
  } catch {
    return false;
  }
}

export function isTimestampValid(
  webhookTimestamp: number,
  maxDriftMs: number = 60_000
): boolean {
  return Math.abs(Date.now() - webhookTimestamp) <= maxDriftMs;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/webhook/verify.test.ts
```

Expected: 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/webhook/ vitest.config.ts
git commit -m "feat: HMAC-SHA256 signature verification for Linear webhooks"
```

---

### Task 5: Filter Engine

**Files:**
- Create: `src/filters/engine.ts`
- Create: `src/filters/engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/filters/engine.test.ts
import { describe, it, expect } from "vitest";
import { shouldForwardEvent } from "./engine";
import { DEFAULT_FILTER_CONFIG } from "../types/config";
import type { LinearWebhookPayload } from "../types/linear";
import type { FilterConfig } from "../types/config";

function makePayload(overrides: Partial<LinearWebhookPayload> = {}): LinearWebhookPayload {
  return {
    action: "create",
    type: "Issue",
    data: {
      id: "issue-1",
      identifier: "ENG-1",
      title: "Test issue",
      team: { id: "team-1", name: "Engineering", key: "ENG" },
      project: { id: "proj-1", name: "Test Project" },
      labels: [],
    },
    url: "https://linear.app/test/issue/ENG-1",
    createdAt: new Date().toISOString(),
    webhookTimestamp: Date.now(),
    webhookId: "wh-1",
    organizationId: "org-1",
    ...overrides,
  };
}

describe("shouldForwardEvent", () => {
  it("forwards all events with default config", () => {
    expect(shouldForwardEvent(makePayload(), DEFAULT_FILTER_CONFIG)).toBe(true);
  });

  it("blocks a disabled resource type", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: [] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("blocks a disabled action", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: ["create"] },
    };
    expect(shouldForwardEvent(makePayload({ action: "update" }), config)).toBe(false);
  });

  it("allows a permitted action", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      events: { Issue: ["create", "update"] },
    };
    expect(shouldForwardEvent(makePayload({ action: "create" }), config)).toBe(true);
  });

  it("filters by project scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, projects: ["proj-other"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("allows matching project scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, projects: ["proj-1"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(true);
  });

  it("filters by team scope", () => {
    const config: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      scope: { ...DEFAULT_FILTER_CONFIG.scope, teams: ["team-other"] },
    };
    expect(shouldForwardEvent(makePayload(), config)).toBe(false);
  });

  it("ignores noisy field-only updates", () => {
    const payload = makePayload({
      action: "update",
      updatedFrom: { sortOrder: 1.5 },
    });
    expect(shouldForwardEvent(payload, DEFAULT_FILTER_CONFIG)).toBe(false);
  });

  it("allows updates with meaningful field changes", () => {
    const payload = makePayload({
      action: "update",
      updatedFrom: { sortOrder: 1.5, state: { name: "Todo" } },
    });
    expect(shouldForwardEvent(payload, DEFAULT_FILTER_CONFIG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/filters/engine.test.ts
```

- [ ] **Step 3: Implement filter engine**

```typescript
// src/filters/engine.ts
import type { FilterConfig } from "../types/config";
import type { LinearWebhookPayload } from "../types/linear";

export function shouldForwardEvent(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  // Layer 1: Resource type + action filtering
  if (!passesEventFilter(payload, config)) return false;

  // Layer 2: Scope filtering (project, team, label)
  if (!passesScopeFilter(payload, config)) return false;

  // Layer 3: Field-level update filtering
  if (!passesFieldFilter(payload, config)) return false;

  return true;
}

function passesEventFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  const allowedActions = config.events[payload.type];

  // If resource type is not in config, all actions are allowed
  if (allowedActions === undefined) return true;

  // If explicitly set to empty array, resource type is disabled
  if (allowedActions.length === 0) return false;

  return allowedActions.includes(payload.action as typeof allowedActions[number]);
}

function passesScopeFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  const data = payload.data as Record<string, unknown>;

  // Project filtering
  if (config.scope.projects.length > 0) {
    const project = data.project as { id: string } | undefined;
    if (!project || !config.scope.projects.includes(project.id)) return false;
  }

  // Team filtering
  if (config.scope.teams.length > 0) {
    const team = data.team as { id: string } | undefined;
    if (!team || !config.scope.teams.includes(team.id)) return false;
  }

  // Label filtering
  if (config.scope.labels.length > 0) {
    const labels = (data.labels as Array<{ name: string }>) || [];
    const labelNames = labels.map((l) => l.name);
    if (!config.scope.labels.some((l) => labelNames.includes(l))) return false;
  }

  return true;
}

function passesFieldFilter(
  payload: LinearWebhookPayload,
  config: FilterConfig
): boolean {
  // Only applies to update actions
  if (payload.action !== "update") return true;

  // If no updatedFrom, can't determine what changed — forward it
  if (!payload.updatedFrom) return true;

  const changedFields = Object.keys(payload.updatedFrom);
  const meaningfulFields = changedFields.filter(
    (field) => !config.updates.ignoreFields.includes(field)
  );

  // If all changed fields are ignored, don't forward
  return meaningfulFields.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/filters/engine.test.ts
```

Expected: 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/filters/ src/types/
git commit -m "feat: 3-layer event filter engine"
```

---

### Task 6: Telegram Client

**Files:**
- Create: `src/telegram/client.ts`

- [ ] **Step 1: Implement Telegram API client**

```typescript
// src/telegram/client.ts
export interface TelegramSendOptions {
  chatId: string;
  text: string;
  topicId?: number;
  replyMarkup?: TelegramInlineKeyboard;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{
    text: string;
    url?: string;
    callback_data?: string;
  }>>;
}

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export class TelegramClient {
  private baseUrl: string;

  constructor(private token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(options: TelegramSendOptions): Promise<TelegramResponse> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      text: options.text,
      parse_mode: "HTML",
    };

    if (options.topicId) {
      body.message_thread_id = options.topicId;
    }

    if (options.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }

    const res = await fetch(`${this.baseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return res.json() as Promise<TelegramResponse>;
  }

  async createForumTopic(
    chatId: string,
    name: string
  ): Promise<{ topicId: number } | null> {
    const res = await fetch(`${this.baseUrl}/createForumTopic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, name }),
    });

    const data = (await res.json()) as TelegramResponse;
    if (data.ok && data.result) {
      const result = data.result as { message_thread_id: number };
      return { topicId: result.message_thread_id };
    }
    return null;
  }

  async getForumTopics(chatId: string): Promise<Array<{ name: string; topicId: number }>> {
    // Telegram doesn't have a "list topics" API — we manage mappings in KV
    // This method exists for the future if Telegram adds it
    return [];
  }

  async setMyDescription(description: string): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async setMyShortDescription(shortDescription: string): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: shortDescription }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async setMyCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return res.json() as Promise<TelegramResponse>;
  }

  async getMe(): Promise<TelegramResponse> {
    const res = await fetch(`${this.baseUrl}/getMe`);
    return res.json() as Promise<TelegramResponse>;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/telegram/client.ts
git commit -m "feat: Telegram Bot API client"
```

---

### Task 7: Message Formatter

**Files:**
- Create: `src/telegram/formatter.ts`
- Create: `src/telegram/formatter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/telegram/formatter.test.ts
import { describe, it, expect } from "vitest";
import { formatLinearEvent } from "./formatter";
import type { LinearWebhookPayload } from "../types/linear";

function makeIssuePayload(
  action: string,
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>
): LinearWebhookPayload {
  return {
    action: action as LinearWebhookPayload["action"],
    type: "Issue",
    actor: { id: "u1", type: "user", name: "Tyler" },
    data: {
      id: "i1",
      identifier: "ENG-142",
      title: "API rate limiting for external clients",
      priority: 2,
      priorityLabel: "High",
      state: { id: "s1", name: "In Progress", type: "started" },
      team: { id: "t1", name: "Engineering", key: "ENG" },
      project: { id: "p1", name: "Linear Pulse" },
      labels: [],
      ...data,
    },
    updatedFrom,
    url: "https://linear.app/test/issue/ENG-142",
    createdAt: new Date().toISOString(),
    webhookTimestamp: Date.now(),
    webhookId: "wh-1",
    organizationId: "org-1",
  };
}

describe("formatLinearEvent", () => {
  it("formats issue creation", () => {
    const result = formatLinearEvent(makeIssuePayload("create", {}));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("📋");
    expect(result!.text).toContain("New issue");
    expect(result!.text).toContain("Tyler");
    expect(result!.text).toContain("ENG-142");
    expect(result!.text).toContain("API rate limiting");
    expect(result!.url).toBe("https://linear.app/test/issue/ENG-142");
  });

  it("formats status change", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { state: { id: "s2", name: "Done", type: "completed" } },
        { state: { id: "s1", name: "In Progress", type: "started" } }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Done");
    expect(result!.text).toContain("In Progress");
  });

  it("formats assignee change", () => {
    const result = formatLinearEvent(
      makeIssuePayload(
        "update",
        { assignee: { id: "u2", name: "Jordan" } },
        { assignee: null }
      )
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("assigned");
    expect(result!.text).toContain("Jordan");
  });

  it("formats comment creation", () => {
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      actor: { id: "u1", type: "user", name: "Alex" },
      data: {
        id: "c1",
        body: "Can we scope this to just the public API for v1?",
        issue: { id: "i1", identifier: "ENG-142", title: "API rate limiting" },
        user: { id: "u1", name: "Alex" },
      },
      url: "https://linear.app/test/issue/ENG-142#comment-c1",
      createdAt: new Date().toISOString(),
      webhookTimestamp: Date.now(),
      webhookId: "wh-2",
      organizationId: "org-1",
    };
    const result = formatLinearEvent(payload);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("💬");
    expect(result!.text).toContain("Alex");
    expect(result!.text).toContain("scope this to just the public API");
  });

  it("truncates long comments", () => {
    const longBody = "A".repeat(300);
    const payload: LinearWebhookPayload = {
      action: "create",
      type: "Comment",
      actor: { id: "u1", type: "user", name: "Alex" },
      data: {
        id: "c1",
        body: longBody,
        issue: { id: "i1", identifier: "ENG-142", title: "Test" },
        user: { id: "u1", name: "Alex" },
      },
      url: "https://linear.app/test/issue/ENG-142#comment-c1",
      createdAt: new Date().toISOString(),
      webhookTimestamp: Date.now(),
      webhookId: "wh-2",
      organizationId: "org-1",
    };
    const result = formatLinearEvent(payload);
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThan(longBody.length);
    expect(result!.text).toContain("...");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/telegram/formatter.test.ts
```

- [ ] **Step 3: Implement the formatter**

```typescript
// src/telegram/formatter.ts
import type { LinearWebhookPayload } from "../types/linear";

export interface FormattedMessage {
  text: string;
  url: string;
  projectId?: string;
}

const PRIORITY_EMOJI: Record<number, string> = {
  0: "⚪",  // No priority
  1: "🔴",  // Urgent
  2: "🟠",  // High
  3: "🟡",  // Medium
  4: "🔵",  // Low
};

const STATUS_EMOJI: Record<string, string> = {
  backlog: "📥",
  unstarted: "⭕",
  started: "🔵",
  completed: "✅",
  canceled: "🚫",
  triage: "📋",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + "...";
}

function actorName(payload: LinearWebhookPayload): string {
  return payload.actor?.name ?? "Someone";
}

function getDataField<T>(data: Record<string, unknown>, field: string): T | undefined {
  return data[field] as T | undefined;
}

export function formatLinearEvent(payload: LinearWebhookPayload): FormattedMessage | null {
  switch (payload.type) {
    case "Issue":
      return formatIssueEvent(payload);
    case "Comment":
      return formatCommentEvent(payload);
    case "Project":
      return formatProjectEvent(payload);
    case "ProjectUpdate":
      return formatProjectUpdateEvent(payload);
    case "IssueSLA":
      return formatSLAEvent(payload);
    default:
      return formatGenericEvent(payload);
  }
}

function formatIssueEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const identifier = data.identifier as string || "";
  const title = escapeHtml(data.title as string || "Untitled");
  const actor = escapeHtml(actorName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const team = getDataField<{ name: string }>(data, "team");
  const priority = data.priority as number ?? 0;
  const priorityLabel = data.priorityLabel as string ?? "";
  const state = getDataField<{ name: string; type: string }>(data, "state");

  if (payload.action === "create") {
    let details = `Priority: ${PRIORITY_EMOJI[priority] ?? "⚪"} ${escapeHtml(priorityLabel)}`;
    if (project) details += ` · Project: ${escapeHtml(project.name)}`;
    if (team) details += ` · Team: ${escapeHtml(team.name)}`;

    return {
      text: `📋 <b>New issue</b> by ${actor}\n<b>${identifier}: ${title}</b>\n${details}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  if (payload.action === "remove") {
    return {
      text: `🗑 <b>Issue removed</b> by ${actor}\n<b>${identifier}: ${title}</b>`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Update — determine what changed
  const updatedFrom = payload.updatedFrom ?? {};

  // Status change
  if ("state" in updatedFrom) {
    const oldState = updatedFrom.state as { name: string; type: string };
    const emoji = STATUS_EMOJI[state?.type ?? ""] ?? "🔄";
    return {
      text: `${emoji} <b>Marked as ${escapeHtml(state?.name ?? "Unknown")}</b> by ${actor}\n<b>${identifier}: ${title}</b>\nWas: ${escapeHtml(oldState.name)} → Now: ${escapeHtml(state?.name ?? "Unknown")}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Assignee change
  if ("assignee" in updatedFrom || "assigneeId" in updatedFrom) {
    const assignee = getDataField<{ name: string }>(data, "assignee");
    if (assignee) {
      return {
        text: `👤 <b>${identifier} assigned to ${escapeHtml(assignee.name)}</b>\n${title}\nBy: ${actor} · Priority: ${PRIORITY_EMOJI[priority] ?? "⚪"} ${escapeHtml(priorityLabel)}`,
        url: payload.url,
        projectId: project?.id,
      };
    } else {
      return {
        text: `👤 <b>${identifier} unassigned</b> by ${actor}\n${title}`,
        url: payload.url,
        projectId: project?.id,
      };
    }
  }

  // Priority change
  if ("priority" in updatedFrom) {
    const oldPriority = updatedFrom.priority as number;
    const oldLabel = updatedFrom.priorityLabel as string ?? "None";
    const direction = priority < oldPriority ? "escalated" : "lowered";
    return {
      text: `${PRIORITY_EMOJI[priority] ?? "⚪"} <b>Priority ${direction}</b> on ${identifier}\n${title}\nWas: ${PRIORITY_EMOJI[oldPriority] ?? "⚪"} ${escapeHtml(oldLabel)} → Now: ${PRIORITY_EMOJI[priority] ?? "⚪"} ${escapeHtml(priorityLabel)}`,
      url: payload.url,
      projectId: project?.id,
    };
  }

  // Generic update
  const changedFields = Object.keys(updatedFrom);
  return {
    text: `🔄 <b>Issue updated</b> by ${actor}\n<b>${identifier}: ${title}</b>\nChanged: ${changedFields.map(escapeHtml).join(", ")}`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatCommentEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const issue = getDataField<{ identifier: string; title: string }>(data, "issue");
  const body = truncate(escapeHtml(data.body as string || ""), 200);
  const issueRef = issue ? `${issue.identifier}` : "";

  if (payload.action === "create") {
    return {
      text: `💬 <b>Comment</b> by ${actor} on <b>${issueRef}</b>\n"${body}"`,
      url: payload.url,
    };
  }

  return {
    text: `💬 <b>Comment ${payload.action}d</b> by ${actor} on <b>${issueRef}</b>`,
    url: payload.url,
  };
}

function formatProjectEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const name = escapeHtml(data.name as string || "Untitled");
  const actor = escapeHtml(actorName(payload));

  return {
    text: `📁 <b>Project ${payload.action}d</b> by ${actor}\n${name}`,
    url: payload.url,
    projectId: data.id as string,
  };
}

function formatProjectUpdateEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const project = getDataField<{ id: string; name: string }>(data, "project");
  const body = truncate(escapeHtml(data.body as string || ""), 200);

  return {
    text: `📢 <b>Project update</b> on ${escapeHtml(project?.name ?? "Unknown")} by ${actor}\n"${body}"`,
    url: payload.url,
    projectId: project?.id,
  };
}

function formatSLAEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const issue = getDataField<{ identifier: string; title: string }>(data, "issue") ??
    { identifier: data.identifier as string ?? "", title: data.title as string ?? "" };

  const actionLabels: Record<string, string> = {
    set: "⏱ SLA set",
    highRisk: "⚠️ SLA at risk",
    breached: "🚨 SLA breached",
  };

  return {
    text: `${actionLabels[payload.action] ?? "⏱ SLA event"} on <b>${escapeHtml(issue.identifier)}</b>\n${escapeHtml(issue.title)}`,
    url: payload.url,
  };
}

function formatGenericEvent(payload: LinearWebhookPayload): FormattedMessage {
  const data = payload.data as Record<string, unknown>;
  const actor = escapeHtml(actorName(payload));
  const name = data.name as string || data.title as string || data.identifier as string || "";

  return {
    text: `🔔 <b>${payload.type} ${payload.action}d</b> by ${actor}${name ? `\n${escapeHtml(name)}` : ""}`,
    url: payload.url,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/telegram/formatter.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/telegram/
git commit -m "feat: message formatter with per-event-type templates"
```

---

### Task 8: Forum Topic Router

**Files:**
- Create: `src/topics/router.ts`

- [ ] **Step 1: Implement topic routing**

```typescript
// src/topics/router.ts
import type { TopicConfig, TopicMapping } from "../types/config";
import { TelegramClient } from "../telegram/client";

const TOPIC_CONFIG_KEY = "topic_mappings";
const GENERAL_TOPIC_KEY = "_general";

export class TopicRouter {
  constructor(
    private kv: KVNamespace,
    private telegram: TelegramClient,
    private chatId: string
  ) {}

  async resolveTopicId(projectId?: string): Promise<number | undefined> {
    const config = await this.getTopicConfig();
    const key = projectId ?? GENERAL_TOPIC_KEY;

    // Check existing mapping
    const existing = config.topics[key];
    if (existing) return existing.topicId;

    // No mapping — we don't auto-create General topic (use main chat)
    if (!projectId) return undefined;

    return undefined;
  }

  async createTopicForProject(
    projectId: string,
    projectName: string
  ): Promise<number | null> {
    const result = await this.telegram.createForumTopic(this.chatId, projectName);
    if (!result) return null;

    const config = await this.getTopicConfig();
    config.topics[projectId] = {
      topicId: result.topicId,
      name: projectName,
    };
    await this.saveTopicConfig(config);

    return result.topicId;
  }

  async resolveOrCreateTopicId(
    projectId?: string,
    projectName?: string
  ): Promise<number | undefined> {
    const existing = await this.resolveTopicId(projectId);
    if (existing) return existing;

    // Auto-create topic for new projects
    if (projectId && projectName) {
      const topicId = await this.createTopicForProject(projectId, projectName);
      return topicId ?? undefined;
    }

    return undefined;
  }

  async getTopicConfig(): Promise<TopicConfig> {
    const raw = await this.kv.get(TOPIC_CONFIG_KEY);
    if (!raw) return { topics: {} };
    return JSON.parse(raw) as TopicConfig;
  }

  private async saveTopicConfig(config: TopicConfig): Promise<void> {
    await this.kv.put(TOPIC_CONFIG_KEY, JSON.stringify(config));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/topics/
git commit -m "feat: forum topic router with auto-creation"
```

---

### Task 9: Config Loader

**Files:**
- Create: `src/config/loader.ts`

- [ ] **Step 1: Implement config loading from KV with defaults**

```typescript
// src/config/loader.ts
import type { FilterConfig } from "../types/config";
import { DEFAULT_FILTER_CONFIG } from "../types/config";

const FILTER_CONFIG_KEY = "filter_config";

export async function loadFilterConfig(kv: KVNamespace): Promise<FilterConfig> {
  const raw = await kv.get(FILTER_CONFIG_KEY);
  if (!raw) return DEFAULT_FILTER_CONFIG;

  const overrides = JSON.parse(raw) as Partial<FilterConfig>;
  return mergeConfig(DEFAULT_FILTER_CONFIG, overrides);
}

export async function saveFilterConfig(
  kv: KVNamespace,
  config: FilterConfig
): Promise<void> {
  await kv.put(FILTER_CONFIG_KEY, JSON.stringify(config));
}

function mergeConfig(
  defaults: FilterConfig,
  overrides: Partial<FilterConfig>
): FilterConfig {
  return {
    events: overrides.events !== undefined
      ? { ...defaults.events, ...overrides.events }
      : defaults.events,
    scope: {
      projects: overrides.scope?.projects ?? defaults.scope.projects,
      teams: overrides.scope?.teams ?? defaults.scope.teams,
      labels: overrides.scope?.labels ?? defaults.scope.labels,
    },
    updates: {
      ignoreFields: overrides.updates?.ignoreFields ?? defaults.updates.ignoreFields,
    },
  };
}

export function validateFilterConfig(input: unknown): input is Partial<FilterConfig> {
  if (typeof input !== "object" || input === null) return false;

  const obj = input as Record<string, unknown>;

  if (obj.events !== undefined) {
    if (typeof obj.events !== "object" || obj.events === null) return false;
    for (const actions of Object.values(obj.events as Record<string, unknown>)) {
      if (!Array.isArray(actions)) return false;
      if (!actions.every((a) => typeof a === "string")) return false;
    }
  }

  if (obj.scope !== undefined) {
    if (typeof obj.scope !== "object" || obj.scope === null) return false;
    const scope = obj.scope as Record<string, unknown>;
    for (const key of ["projects", "teams", "labels"]) {
      if (scope[key] !== undefined) {
        if (!Array.isArray(scope[key])) return false;
        if (!(scope[key] as unknown[]).every((v) => typeof v === "string")) return false;
      }
    }
  }

  if (obj.updates !== undefined) {
    if (typeof obj.updates !== "object" || obj.updates === null) return false;
    const updates = obj.updates as Record<string, unknown>;
    if (updates.ignoreFields !== undefined) {
      if (!Array.isArray(updates.ignoreFields)) return false;
      if (!updates.ignoreFields.every((v) => typeof v === "string")) return false;
    }
  }

  return true;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/config/
git commit -m "feat: KV config loader with merge and validation"
```

---

### Task 10: Main Webhook Handler — Wire Everything Together

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement the full Hono app**

```typescript
// src/index.ts
import { Hono } from "hono";
import { verifyLinearSignature, isTimestampValid } from "./webhook/verify";
import { shouldForwardEvent } from "./filters/engine";
import { formatLinearEvent } from "./telegram/formatter";
import { TelegramClient } from "./telegram/client";
import { TopicRouter } from "./topics/router";
import { loadFilterConfig, saveFilterConfig, validateFilterConfig } from "./config/loader";
import type { LinearWebhookPayload } from "./types/linear";

type Bindings = {
  CONFIG: KVNamespace;
  LINEAR_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ADMIN_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "linear-pulse" }));

// Linear webhook receiver
app.post("/webhook/linear", async (c) => {
  const rawBody = await c.req.text();

  // 1. Verify signature
  const signature = c.req.header("Linear-Signature") ?? "";
  const isValid = await verifyLinearSignature(rawBody, signature, c.env.LINEAR_WEBHOOK_SECRET);
  if (!isValid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  // 2. Parse and validate timestamp
  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }

  if (!isTimestampValid(payload.webhookTimestamp)) {
    return c.json({ error: "timestamp drift" }, 401);
  }

  // 3. Filter
  const config = await loadFilterConfig(c.env.CONFIG);
  if (!shouldForwardEvent(payload, config)) {
    return c.json({ status: "filtered" }, 200);
  }

  // 4. Format
  const message = formatLinearEvent(payload);
  if (!message) {
    return c.json({ status: "unformatted" }, 200);
  }

  // 5. Resolve topic
  const telegram = new TelegramClient(c.env.TELEGRAM_BOT_TOKEN);
  const topicRouter = new TopicRouter(c.env.CONFIG, telegram, c.env.TELEGRAM_CHAT_ID);

  const data = payload.data as Record<string, unknown>;
  const project = data.project as { id: string; name: string } | undefined;
  const topicId = await topicRouter.resolveOrCreateTopicId(
    message.projectId ?? project?.id,
    project?.name
  );

  // 6. Send
  const result = await telegram.sendMessage({
    chatId: c.env.TELEGRAM_CHAT_ID,
    text: message.text,
    topicId,
    replyMarkup: {
      inline_keyboard: [[{ text: "View in Linear", url: message.url }]],
    },
  });

  if (!result.ok) {
    console.error("Telegram send failed:", result.description);
  }

  return c.json({ status: "sent" }, 200);
});

// Admin: get config
app.get("/config", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const config = await loadFilterConfig(c.env.CONFIG);
  return c.json(config);
});

// Admin: update config
app.put("/config", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json();
  if (!validateFilterConfig(body)) {
    return c.json({ error: "invalid config" }, 400);
  }

  const current = await loadFilterConfig(c.env.CONFIG);
  const merged = { ...current, ...body };
  await saveFilterConfig(c.env.CONFIG, merged);

  return c.json({ status: "updated", config: merged });
});

// Admin: get topic mappings
app.get("/topics", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const topicRouter = new TopicRouter(
    c.env.CONFIG,
    new TelegramClient(c.env.TELEGRAM_BOT_TOKEN),
    c.env.TELEGRAM_CHAT_ID
  );
  const config = await topicRouter.getTopicConfig();
  return c.json(config);
});

export default app;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: main webhook handler wiring all modules together"
```

---

### Task 11: CLI Tool

**Files:**
- Create: `cli/index.ts`
- Create: `cli/commands/bot.ts`
- Create: `cli/commands/config.ts`
- Create: `cli/commands/status.ts`
- Create: `cli/api.ts`
- Modify: `package.json` (add bin + cli deps)

- [ ] **Step 1: Install CLI dependencies**

```bash
npm install -D tsx
```

- [ ] **Step 2: Create API client for CLI**

```typescript
// cli/api.ts
export class PulseAPI {
  constructor(
    private workerUrl: string,
    private adminToken: string
  ) {}

  async getConfig(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/config`, {
      headers: { Authorization: `Bearer ${this.adminToken}` },
    });
    return res.json();
  }

  async updateConfig(config: unknown): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/config`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(config),
    });
    return res.json();
  }

  async getHealth(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/health`);
    return res.json();
  }

  async getTopics(): Promise<unknown> {
    const res = await fetch(`${this.workerUrl}/topics`, {
      headers: { Authorization: `Bearer ${this.adminToken}` },
    });
    return res.json();
  }
}

export class TelegramAPI {
  private baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getMe(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/getMe`);
    return res.json();
  }

  async setDescription(description: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    return res.json();
  }

  async setShortDescription(shortDescription: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyShortDescription`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ short_description: shortDescription }),
    });
    return res.json();
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
    return res.json();
  }
}
```

- [ ] **Step 3: Create bot commands**

```typescript
// cli/commands/bot.ts
import { TelegramAPI } from "../api";

export async function botSetup(token: string): Promise<void> {
  const tg = new TelegramAPI(token);

  console.log("Setting up Blue...\n");

  const desc = await tg.setDescription("Linear notifications for Blueprint Studio");
  console.log("Description:", JSON.stringify(desc));

  const about = await tg.setShortDescription("Team activity feed from Linear");
  console.log("About:", JSON.stringify(about));

  console.log("\nBlue is configured.");
}

export async function botInfo(token: string): Promise<void> {
  const tg = new TelegramAPI(token);
  const info = await tg.getMe();
  console.log(JSON.stringify(info, null, 2));
}

export async function botSetDescription(token: string, description: string): Promise<void> {
  const tg = new TelegramAPI(token);
  const result = await tg.setDescription(description);
  console.log(JSON.stringify(result, null, 2));
}
```

- [ ] **Step 4: Create config commands**

```typescript
// cli/commands/config.ts
import { PulseAPI } from "../api";

export async function configGet(workerUrl: string, adminToken: string): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const config = await api.getConfig();
  console.log(JSON.stringify(config, null, 2));
}

export async function configSet(
  workerUrl: string,
  adminToken: string,
  args: string[]
): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const current = (await api.getConfig()) as Record<string, unknown>;

  // Parse --disable ResourceType or --disable ResourceType.action
  const disableIdx = args.indexOf("--disable");
  if (disableIdx !== -1 && args[disableIdx + 1]) {
    const target = args[disableIdx + 1]!;
    const events = (current.events ?? {}) as Record<string, string[]>;

    if (target.includes(".")) {
      // Disable specific action: Issue.remove
      const [resource, action] = target.split(".");
      if (resource && action && events[resource]) {
        events[resource] = events[resource]!.filter((a) => a !== action);
      }
    } else {
      // Disable entire resource type
      events[target] = [];
    }

    const result = await api.updateConfig({ events });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Parse --enable ResourceType.action
  const enableIdx = args.indexOf("--enable");
  if (enableIdx !== -1 && args[enableIdx + 1]) {
    const target = args[enableIdx + 1]!;
    const events = (current.events ?? {}) as Record<string, string[]>;

    if (target.includes(".")) {
      const [resource, action] = target.split(".");
      if (resource && action) {
        if (!events[resource]) events[resource] = [];
        if (!events[resource]!.includes(action)) events[resource]!.push(action);
      }
    } else {
      // Enable all actions: remove the override (falls back to default = all)
      delete events[target];
    }

    const result = await api.updateConfig({ events });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Usage: linear-pulse config set --disable <ResourceType[.action]>");
  console.log("       linear-pulse config set --enable <ResourceType[.action]>");
}

export async function configReset(workerUrl: string, adminToken: string): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);
  const result = await api.updateConfig({
    events: {},
    scope: { projects: [], teams: [], labels: [] },
    updates: { ignoreFields: ["sortOrder", "boardOrder", "subscriberIds", "trashed"] },
  });
  console.log("Config reset to defaults.");
  console.log(JSON.stringify(result, null, 2));
}
```

- [ ] **Step 5: Create status command**

```typescript
// cli/commands/status.ts
import { PulseAPI } from "../api";

export async function status(workerUrl: string, adminToken: string): Promise<void> {
  const api = new PulseAPI(workerUrl, adminToken);

  try {
    const health = await api.getHealth();
    console.log("Worker:", JSON.stringify(health));
  } catch (e) {
    console.error("Worker unreachable:", (e as Error).message);
  }

  try {
    const topics = await api.getTopics();
    console.log("Topics:", JSON.stringify(topics, null, 2));
  } catch (e) {
    console.error("Topics fetch failed:", (e as Error).message);
  }
}
```

- [ ] **Step 6: Create CLI entry point**

```typescript
// cli/index.ts
import { botSetup, botInfo, botSetDescription } from "./commands/bot";
import { configGet, configSet, configReset } from "./commands/config";
import { status } from "./commands/status";

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

const WORKER_URL = process.env.PULSE_WORKER_URL ?? "http://localhost:8787";
const ADMIN_TOKEN = process.env.PULSE_ADMIN_TOKEN ?? "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

async function main() {
  switch (command) {
    case "bot":
      if (!TELEGRAM_TOKEN) {
        console.error("Set TELEGRAM_BOT_TOKEN env var");
        process.exit(1);
      }
      switch (subcommand) {
        case "setup":
          await botSetup(TELEGRAM_TOKEN);
          break;
        case "info":
          await botInfo(TELEGRAM_TOKEN);
          break;
        case "set-description":
          await botSetDescription(TELEGRAM_TOKEN, args.slice(2).join(" "));
          break;
        default:
          console.log("Usage: linear-pulse bot <setup|info|set-description>");
      }
      break;

    case "config":
      if (!ADMIN_TOKEN) {
        console.error("Set PULSE_ADMIN_TOKEN env var");
        process.exit(1);
      }
      switch (subcommand) {
        case "get":
          await configGet(WORKER_URL, ADMIN_TOKEN);
          break;
        case "set":
          await configSet(WORKER_URL, ADMIN_TOKEN, args.slice(2));
          break;
        case "reset":
          await configReset(WORKER_URL, ADMIN_TOKEN);
          break;
        default:
          console.log("Usage: linear-pulse config <get|set|reset>");
      }
      break;

    case "status":
      await status(WORKER_URL, ADMIN_TOKEN);
      break;

    default:
      console.log("linear-pulse CLI\n");
      console.log("Commands:");
      console.log("  bot setup              Set up Blue's Telegram profile");
      console.log("  bot info               Show bot info");
      console.log("  bot set-description    Set bot description");
      console.log("  config get             View current filter config");
      console.log("  config set             Update filters");
      console.log("  config reset           Reset to defaults");
      console.log("  status                 Worker health + topic mappings");
      console.log("\nEnv vars:");
      console.log("  TELEGRAM_BOT_TOKEN     Telegram bot token");
      console.log("  PULSE_WORKER_URL       Worker URL (default: http://localhost:8787)");
      console.log("  PULSE_ADMIN_TOKEN      Admin bearer token");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 7: Add bin entry to package.json**

Add to package.json:
```json
{
  "bin": {
    "linear-pulse": "./cli/run.sh"
  },
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "cli": "npx tsx cli/index.ts",
    "test": "vitest run"
  }
}
```

Create `cli/run.sh`:
```bash
#!/usr/bin/env bash
exec npx tsx "$(dirname "$0")/index.ts" "$@"
```

```bash
chmod +x cli/run.sh
```

- [ ] **Step 8: Test CLI help output**

```bash
npx tsx cli/index.ts
```

Expected: Shows help text with commands list

- [ ] **Step 9: Commit**

```bash
git add cli/ package.json
git commit -m "feat: CLI tool for bot management and config"
```

---

### Task 12: Deploy and Test

- [ ] **Step 1: Install wrangler globally**

```bash
npm install -g wrangler
```

- [ ] **Step 2: Login to Cloudflare**

```bash
wrangler login
```

- [ ] **Step 3: Create KV namespace**

```bash
wrangler kv namespace create CONFIG
wrangler kv namespace create CONFIG --preview
```

Update `wrangler.toml` with the returned IDs.

- [ ] **Step 4: Set secrets**

```bash
wrangler secret put LINEAR_WEBHOOK_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put ADMIN_TOKEN
```

- [ ] **Step 5: Deploy**

```bash
wrangler deploy
```

- [ ] **Step 6: Verify health endpoint**

```bash
curl https://linear-pulse.<subdomain>.workers.dev/health
```

Expected: `{"status":"ok","service":"linear-pulse"}`

- [ ] **Step 7: Run bot setup via CLI**

```bash
TELEGRAM_BOT_TOKEN=<token> npx tsx cli/index.ts bot setup
```

- [ ] **Step 8: Create Linear webhook**

Go to Linear Settings > API > Webhooks > New Webhook:
- URL: `https://linear-pulse.<subdomain>.workers.dev/webhook/linear`
- Subscribe to all resource types
- Save the signing secret immediately

- [ ] **Step 9: Test with a real Linear event**

Create a test issue in Linear. Verify Blue posts a formatted notification in the Telegram group chat.

- [ ] **Step 10: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: deployment config and final adjustments"
```

- [ ] **Step 11: Push to GitHub**

```bash
git push origin main
```
