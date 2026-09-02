import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  FREQUENCIES,
  dollarsFromUnknown,
  isIsoDate,
  parseDollars,
  parseIso,
  todayLocalIso,
  toCents,
  weekdayUtc,
  type CashflowItem,
  type Frequency,
  type ItemType,
  type OccurrenceOverride,
  type ProjectionMonths,
  type UserSettings,
} from "@/lib/cashflow";
import { getSql } from "@/lib/db";
import {
  getOverviewView,
  getWhatIfView,
  listRecurringView,
  listUpcomingView,
  type BudgetSnapshot,
} from "./views";

const PROTOCOL = "2025-03-26";
const SUPPORTED = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);

type Json = Record<string, unknown>;
type RpcId = string | number | null;

type ItemRow = {
  id: string;
  name: string;
  type: "income" | "bill";
  amount: unknown;
  frequency: CashflowItem["frequency"];
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  semi_day_1: number | null;
  semi_day_2: number | null;
  weekday: number | null;
  anchor_date: string | null;
  account_label: string;
  paused: boolean;
};

function jsonResponse(body: unknown, status: number, extra?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
      ...extra,
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-expose-headers": "mcp-protocol-version, mcp-session-id",
    "access-control-max-age": "86400",
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

function keysEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireApiKey(request: Request): Response | null {
  const expected = process.env.MCP_API_KEY?.trim() ?? "";
  if (!expected) {
    return jsonResponse({ error: "MCP_API_KEY is not set" }, 401);
  }
  const token = bearerToken(request);
  if (!token || !keysEqual(token, expected)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

function asMonths(n: number): ProjectionMonths {
  if (n === 3 || n === 12) return n;
  return 6;
}

function mapItem(row: ItemRow): CashflowItem {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    amount: dollarsFromUnknown(row.amount),
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    dueDay: row.due_day,
    semiDay1: row.semi_day_1,
    semiDay2: row.semi_day_2,
    weekday: row.weekday,
    anchorDate: row.anchor_date,
    accountLabel: row.account_label || "Checking",
    paused: Boolean(row.paused),
  };
}

async function resolveUserId(): Promise<string> {
  const bound = process.env.MCP_USER_ID?.trim();
  if (bound) return bound;
  const sql = await getSql();
  const rows = await sql<{ user_id: string }>`
    select user_id from user_settings order by created_at asc limit 2
  `;
  if (rows.length === 1 && rows[0]) return rows[0].user_id;
  const users = await sql<{ id: string }>`
    select id from "user" order by "createdAt" asc limit 2
  `;
  if (users.length === 1 && users[0]) return users[0].id;
  if (rows.length > 1 || users.length > 1) {
    throw new Error("Multiple users exist. Set MCP_USER_ID to bind this key to one account.");
  }
  throw new Error("No user found. Open Forward Balance and create an account, or set MCP_USER_ID.");
}

async function loadBudget(userId: string): Promise<BudgetSnapshot> {
  const sql = await getSql();
  const [settingsRows, itemRows, overrideRows] = await Promise.all([
    sql<{
      starting_balance: unknown;
      starting_balance_date: string;
      currency: string;
      projection_months: number;
      balance_view: string | null;
      is_admin: boolean;
    }>`
      select starting_balance, starting_balance_date, currency, projection_months, balance_view, is_admin
      from user_settings where user_id = ${userId}
    `,
    sql<ItemRow>`
      select id, name, type, amount, frequency, start_date, end_date,
             due_day, semi_day_1, semi_day_2, weekday, anchor_date,
             account_label, paused
      from cashflow_items
      where user_id = ${userId}
      order by type desc, name
    `,
    sql<{
      id: string;
      item_id: string;
      original_date: string;
      kind: OccurrenceOverride["kind"];
      amount: unknown;
      moved_date: string | null;
    }>`
      select id, item_id, original_date, kind, amount, moved_date
      from occurrence_overrides
      where user_id = ${userId}
    `,
  ]);
  const settingsRow = settingsRows[0];
  const settings: UserSettings | null = settingsRow
    ? {
        startingBalance: dollarsFromUnknown(settingsRow.starting_balance),
        startingBalanceDate: settingsRow.starting_balance_date,
        currency: settingsRow.currency || "USD",
        projectionMonths: asMonths(Number(settingsRow.projection_months) || 6),
        balanceView: settingsRow.balance_view === "activity" ? "activity" : "every_day",
        isAdmin: Boolean(settingsRow.is_admin),
      }
    : null;
  return {
    settings,
    items: itemRows.map(mapItem),
    overrides: overrideRows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      originalDate: row.original_date,
      kind: row.kind,
      amount: row.amount == null ? null : dollarsFromUnknown(row.amount),
      movedDate: row.moved_date,
    })),
  };
}

function parseAmount(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") {
    const parsed = parseDollars(value);
    if (parsed != null) return parsed;
  }
  throw new Error(`${label} must be a number`);
}

function parseDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

function asRecord(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Json;
  }
  return {};
}

function frequencyOf(value: unknown, fallback: Frequency): Frequency {
  if (typeof value !== "string") return fallback;
  if ((FREQUENCIES as readonly string[]).includes(value)) return value as Frequency;
  throw new Error("frequency must be weekly, biweekly, semimonthly, monthly, quarterly, yearly, or one_time");
}

async function insertItem(
  userId: string,
  item: {
    name: string;
    type: ItemType;
    amount: number;
    frequency: Frequency;
    startDate: string;
    dueDay: number | null;
    semiDay1: number | null;
    semiDay2: number | null;
    weekday: number | null;
    anchorDate: string | null;
  },
): Promise<string> {
  const sql = await getSql();
  const id = randomUUID();
  await sql`
    insert into cashflow_items (
      id, user_id, name, type, amount, frequency, start_date, end_date,
      due_day, semi_day_1, semi_day_2, weekday, anchor_date, account_label, paused, updated_at
    ) values (
      ${id}, ${userId}, ${item.name}, ${item.type}, ${item.amount},
      ${item.frequency}, ${item.startDate}, ${null}, ${item.dueDay},
      ${item.semiDay1}, ${item.semiDay2}, ${item.weekday}, ${item.anchorDate},
      ${"Checking"}, ${false}, now()
    )
  `;
  return id;
}

async function callTool(name: string, args: Json): Promise<unknown> {
  const userId = await resolveUserId();
  const today = todayLocalIso();

  if (name === "get_overview") {
    return getOverviewView(await loadBudget(userId), today);
  }

  if (name === "list_upcoming") {
    const days = typeof args.days === "number" ? args.days : Number(args.days ?? 14);
    return listUpcomingView(await loadBudget(userId), today, Number.isFinite(days) ? days : 14);
  }

  if (name === "list_recurring") {
    return listRecurringView(await loadBudget(userId), today);
  }

  if (name === "add_recurring") {
    const itemName = String(args.name ?? "").trim();
    if (!itemName) throw new Error("name is required");
    const typeRaw = String(args.type ?? "");
    if (typeRaw !== "income" && typeRaw !== "bill") {
      throw new Error("type must be income or bill");
    }
    const amount = parseAmount(args.amount, "amount");
    if (amount <= 0) throw new Error("amount must be greater than zero");
    const startDate =
      typeof args.start_date === "string" && isIsoDate(args.start_date)
        ? args.start_date
        : today;
    const dueDay =
      args.due_day != null
        ? Math.min(31, Math.max(1, Number(args.due_day)))
        : parseIso(startDate).d;
    const frequency = frequencyOf(args.frequency, "monthly");
    const weekday = weekdayUtc(startDate);
    const id = await insertItem(userId, {
      name: itemName,
      type: typeRaw,
      amount,
      frequency,
      startDate,
      dueDay: ["monthly", "quarterly", "yearly"].includes(frequency) ? dueDay : null,
      semiDay1: frequency === "semimonthly" ? 1 : null,
      semiDay2: frequency === "semimonthly" ? 15 : null,
      weekday: frequency === "weekly" || frequency === "biweekly" ? weekday : null,
      anchorDate: frequency === "biweekly" ? startDate : null,
    });
    return { id, name: itemName, type: typeRaw, amount_cents: toCents(amount), frequency, start_date: startDate, due_day: dueDay };
  }

  if (name === "update_recurring") {
    const id = String(args.id ?? "").trim();
    if (!id) throw new Error("id is required");
    const sql = await getSql();
    const rows = await sql<ItemRow>`
      select id, name, type, amount, frequency, start_date, end_date,
             due_day, semi_day_1, semi_day_2, weekday, anchor_date,
             account_label, paused
      from cashflow_items
      where id = ${id} and user_id = ${userId}
    `;
    const current = rows[0];
    if (!current) throw new Error("id not found");
    const next = mapItem(current);
    if (args.name != null) next.name = String(args.name).trim() || next.name;
    if (args.amount != null) {
      const amount = parseAmount(args.amount, "amount");
      if (amount <= 0) throw new Error("amount must be greater than zero");
      next.amount = amount;
    }
    if (args.frequency != null) next.frequency = frequencyOf(args.frequency, next.frequency);
    if (args.due_day != null) next.dueDay = Math.min(31, Math.max(1, Number(args.due_day)));
    const dateArg = args.start_date ?? args.date;
    if (dateArg != null) next.startDate = parseDate(dateArg, "date");
    if (typeof args.enabled === "boolean") next.paused = !args.enabled;
    await sql`
      update cashflow_items set
        name = ${next.name},
        amount = ${next.amount},
        frequency = ${next.frequency},
        start_date = ${next.startDate},
        due_day = ${next.dueDay},
        paused = ${next.paused},
        updated_at = now()
      where id = ${id} and user_id = ${userId}
    `;
    return {
      id: next.id,
      name: next.name,
      amount_cents: toCents(next.amount),
      frequency: next.frequency,
      enabled: !next.paused,
      due_day: next.dueDay,
      start_date: next.startDate,
    };
  }

  if (name === "add_one_time") {
    const itemName = String(args.name ?? "").trim();
    if (!itemName) throw new Error("name is required");
    const typeRaw = String(args.type ?? "");
    if (typeRaw !== "income" && typeRaw !== "expense" && typeRaw !== "bill") {
      throw new Error("type must be income or expense");
    }
    const type: ItemType = typeRaw === "income" ? "income" : "bill";
    const amount = parseAmount(args.amount, "amount");
    if (amount <= 0) throw new Error("amount must be greater than zero");
    const date = parseDate(args.date, "date");
    const id = await insertItem(userId, {
      name: itemName,
      type,
      amount,
      frequency: "one_time",
      startDate: date,
      dueDay: parseIso(date).d,
      semiDay1: null,
      semiDay2: null,
      weekday: null,
      anchorDate: null,
    });
    return { id, name: itemName, type, amount_cents: toCents(amount), date };
  }

  if (name === "update_starting_balance") {
    const amount = parseAmount(args.amount, "amount");
    const date = parseDate(args.date, "date");
    const sql = await getSql();
    await sql`
      insert into user_settings (
        user_id, starting_balance, starting_balance_date, currency, projection_months, is_admin, updated_at
      ) values (
        ${userId}, ${amount}, ${date}, 'USD', 6, false, now()
      )
      on conflict (user_id) do update set
        starting_balance = excluded.starting_balance,
        starting_balance_date = excluded.starting_balance_date,
        updated_at = now()
    `;
    return { starting_balance_cents: toCents(amount), starting_balance_date: date };
  }

  if (name === "get_what_if") {
    const recurringId = String(args.recurring_id ?? "").trim();
    if (!recurringId) throw new Error("recurring_id is required");
    const newAmount = parseAmount(args.new_amount, "new_amount");
    if (newAmount <= 0) throw new Error("new_amount must be greater than zero");
    return getWhatIfView(await loadBudget(userId), today, recurringId, newAmount);
  }

  throw new Error(`Unknown tool: ${name}`);
}

const TOOLS = [
  {
    name: "get_overview",
    description:
      "Today's projected checking balance, starting balance and date, cushion, lowest balance in the next 30 days, and items that hit in the next 7 days.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_upcoming",
    description: "Daily ending balances and items that hit, from today forward.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 365, default: 14 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_recurring",
    description: "Income and bills with ids, amounts, frequency, next date, and enabled flag.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_recurring",
    description: "Add a repeating income or bill. Use due_day for monthly items (for example electric on the 15th).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["income", "bill"] },
        amount: { type: "number", description: "USD amount, always positive" },
        frequency: {
          type: "string",
          enum: ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly", "one_time"],
        },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        due_day: { type: "integer", minimum: 1, maximum: 31 },
        notes: { type: "string" },
      },
      required: ["name", "type", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "update_recurring",
    description: "Change a recurring item by id. Only provided fields are updated.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        amount: { type: "number" },
        frequency: {
          type: "string",
          enum: ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly", "one_time"],
        },
        due_day: { type: "integer", minimum: 1, maximum: 31 },
        date: { type: "string", description: "YYYY-MM-DD start / first due date" },
        start_date: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_one_time",
    description: "Add a one-time income or expense on a calendar date.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["income", "expense"] },
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
        notes: { type: "string" },
      },
      required: ["name", "type", "amount", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "update_starting_balance",
    description: "Set the as-of checking balance and date used by the projection.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["amount", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "get_what_if",
    description:
      "Compare the current 30-day low to a new amount on one recurring item. Does not save.",
    inputSchema: {
      type: "object",
      properties: {
        recurring_id: { type: "string" },
        new_amount: { type: "number" },
      },
      required: ["recurring_id", "new_amount"],
      additionalProperties: false,
    },
  },
];

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(message: Json): Promise<unknown | null> {
  const id = (message.id as RpcId) ?? null;
  const method = String(message.method ?? "");
  const params = asRecord(message.params);
  const isNotification = !Object.prototype.hasOwnProperty.call(message, "id");

  if (method === "initialize") {
    const requested = String(params.protocolVersion ?? PROTOCOL);
    const protocolVersion = SUPPORTED.has(requested) ? requested : PROTOCOL;
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "forward-balance", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return isNotification ? null : rpcResult(id, {});
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const toolName = String(params.name ?? "");
    const args = asRecord(params.arguments);
    try {
      const data = await callTool(toolName, args);
      const text = JSON.stringify(data);
      return rpcResult(id, {
        content: [{ type: "text", text }],
        structuredContent: data,
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "Tool failed";
      return rpcResult(id, {
        content: [{ type: "text", text: messageText }],
        isError: true,
      });
    }
  }

  if (method === "resources/list") return rpcResult(id, { resources: [] });
  if (method === "prompts/list") return rpcResult(id, { prompts: [] });

  if (isNotification) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function encodeSse(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  if (request.method === "GET" || request.method === "DELETE") {
    return jsonResponse(
      { error: "Method not allowed. POST JSON-RPC to this Streamable HTTP endpoint." },
      405,
      { allow: "POST, OPTIONS" },
    );
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, { allow: "POST, OPTIONS" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses: unknown[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      responses.push(rpcError(null, -32600, "Invalid request"));
      continue;
    }
    const result = await handleRpc(message as Json);
    if (result) responses.push(result);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  const accept = request.headers.get("accept") ?? "";
  const wantsSse = accept.includes("text/event-stream") && !accept.includes("application/json");
  if (wantsSse) {
    return new Response(encodeSse(payload), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "mcp-protocol-version": PROTOCOL,
        ...corsHeaders(),
      },
    });
  }

  return jsonResponse(payload, 200, { "mcp-protocol-version": PROTOCOL });
}
