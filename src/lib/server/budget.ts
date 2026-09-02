import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  dollarsFromUnknown,
  isIsoDate,
  type BalanceView,
  type CashflowItem,
  type OccurrenceOverride,
  type ProjectionMonths,
  type UserSettings,
} from "@/lib/cashflow";
import { getSql } from "@/lib/db";

const iso = z.string().refine((v) => isIsoDate(v), "Invalid date");
const money = z.coerce.number().finite();
const posMoney = z.coerce.number().finite().positive();

type SettingsRow = {
  starting_balance: unknown;
  starting_balance_date: string;
  currency: string;
  projection_months: number;
  balance_view: string | null;
  alert_threshold: unknown;
  is_admin: boolean;
};

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

type OverrideRow = {
  id: string;
  item_id: string;
  original_date: string;
  kind: OccurrenceOverride["kind"];
  amount: unknown;
  moved_date: string | null;
};

function asMonths(n: number): ProjectionMonths {
  if (n === 1 || n === 3 || n === 12) return n;
  return 6;
}

function asBalanceView(v: string | null | undefined): BalanceView {
  return v === "activity" ? "activity" : "every_day";
}

function mapSettings(row: SettingsRow): UserSettings {
  return {
    startingBalance: dollarsFromUnknown(row.starting_balance),
    startingBalanceDate: row.starting_balance_date,
    currency: row.currency || "USD",
    projectionMonths: asMonths(Number(row.projection_months) || 6),
    balanceView: asBalanceView(row.balance_view),
    alertThreshold: Math.max(0, dollarsFromUnknown(row.alert_threshold)),
    isAdmin: Boolean(row.is_admin),
  };
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

function mapOverride(row: OverrideRow): OccurrenceOverride {
  return {
    id: row.id,
    itemId: row.item_id,
    originalDate: row.original_date,
    kind: row.kind,
    amount: row.amount == null ? null : dollarsFromUnknown(row.amount),
    movedDate: row.moved_date,
  };
}

export const getBootstrapState = createServerFn({ method: "GET" }).handler(
  async () => {
    const sql = await getSql();
    const rows = await sql<{ n: number }>`select count(*)::int as n from "user"`;
    return { needsSetup: (rows[0]?.n ?? 0) === 0 };
  },
);

export const getBudget = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const uid = context.userId;
    const [settingsRows, itemRows, overrideRows] = await Promise.all([
      sql<SettingsRow>`
        select starting_balance, starting_balance_date, currency, projection_months, balance_view, alert_threshold, is_admin
        from user_settings where user_id = ${uid}
      `,
      sql<ItemRow>`
        select id, name, type, amount, frequency, start_date, end_date,
               due_day, semi_day_1, semi_day_2, weekday, anchor_date,
               account_label, paused
        from cashflow_items
        where user_id = ${uid}
        order by type desc, name
      `,
      sql<OverrideRow>`
        select id, item_id, original_date, kind, amount, moved_date
        from occurrence_overrides
        where user_id = ${uid}
      `,
    ]);
    return {
      settings: settingsRows[0] ? mapSettings(settingsRows[0]) : null,
      items: itemRows.map(mapItem),
      overrides: overrideRows.map(mapOverride),
    };
  });

const settingsInput = z.object({
  startingBalance: money,
  startingBalanceDate: iso,
  projectionMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  balanceView: z.enum(["every_day", "activity"]).optional(),
  alertThreshold: z.coerce.number().finite().min(0).optional(),
  claimAdmin: z.boolean().optional(),
});

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => settingsInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const uid = context.userId;
    const existing = await sql<{ is_admin: boolean }>`
      select is_admin from user_settings where user_id = ${uid}
    `;
    let isAdmin = Boolean(existing[0]?.is_admin);
    if (data.claimAdmin && !isAdmin) {
      const admins = await sql<{ n: number }>`
        select count(*)::int as n from user_settings where is_admin = true
      `;
      if ((admins[0]?.n ?? 0) === 0) isAdmin = true;
    }
    const view = data.balanceView ?? "every_day";
    const threshold = data.alertThreshold ?? 0;
    await sql`
      insert into user_settings (
        user_id, starting_balance, starting_balance_date, currency, projection_months, balance_view, alert_threshold, is_admin, updated_at
      ) values (
        ${uid}, ${data.startingBalance}, ${data.startingBalanceDate}, 'USD',
        ${data.projectionMonths}, ${view}, ${threshold}, ${isAdmin}, now()
      )
      on conflict (user_id) do update set
        starting_balance = excluded.starting_balance,
        starting_balance_date = excluded.starting_balance_date,
        projection_months = excluded.projection_months,
        balance_view = excluded.balance_view,
        alert_threshold = excluded.alert_threshold,
        is_admin = user_settings.is_admin or excluded.is_admin,
        updated_at = now()
    `;
    return { ok: true as const, isAdmin };
  });

const itemInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  type: z.enum(["income", "bill"]),
  amount: posMoney,
  frequency: z.enum([
    "weekly",
    "biweekly",
    "semimonthly",
    "monthly",
    "quarterly",
    "yearly",
    "one_time",
  ]),
  startDate: iso,
  endDate: iso.nullable(),
  dueDay: z.number().int().min(1).max(31).nullable(),
  semiDay1: z.number().int().min(1).max(31).nullable(),
  semiDay2: z.number().int().min(1).max(31).nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  anchorDate: iso.nullable(),
  accountLabel: z.string().trim().min(1).max(40),
  paused: z.boolean(),
});

export const upsertItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => itemInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = data.id ?? randomUUID();
    await sql`
      insert into cashflow_items (
        id, user_id, name, type, amount, frequency, start_date, end_date,
        due_day, semi_day_1, semi_day_2, weekday, anchor_date, account_label, paused, updated_at
      ) values (
        ${id}, ${context.userId}, ${data.name}, ${data.type}, ${data.amount},
        ${data.frequency}, ${data.startDate}, ${data.endDate}, ${data.dueDay},
        ${data.semiDay1}, ${data.semiDay2}, ${data.weekday}, ${data.anchorDate},
        ${data.accountLabel}, ${data.paused}, now()
      )
      on conflict (id) do update set
        name = excluded.name,
        type = excluded.type,
        amount = excluded.amount,
        frequency = excluded.frequency,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        due_day = excluded.due_day,
        semi_day_1 = excluded.semi_day_1,
        semi_day_2 = excluded.semi_day_2,
        weekday = excluded.weekday,
        anchor_date = excluded.anchor_date,
        account_label = excluded.account_label,
        paused = excluded.paused,
        updated_at = now()
      where cashflow_items.user_id = ${context.userId}
    `;
    return { id };
  });

export const deleteItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      delete from cashflow_items
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

const overrideInput = z.object({
  itemId: z.string().min(1),
  originalDate: iso,
  kind: z.enum(["skip", "amount", "move"]),
  amount: posMoney.nullable(),
  movedDate: iso.nullable(),
});

export const upsertOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => overrideInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from cashflow_items
      where id = ${data.itemId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Item not found");
    const id = randomUUID();
    await sql`
      insert into occurrence_overrides (
        id, user_id, item_id, original_date, kind, amount, moved_date
      ) values (
        ${id}, ${context.userId}, ${data.itemId}, ${data.originalDate},
        ${data.kind}, ${data.amount}, ${data.movedDate}
      )
      on conflict (item_id, original_date) do update set
        kind = excluded.kind,
        amount = excluded.amount,
        moved_date = excluded.moved_date
      where occurrence_overrides.user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const clearOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ itemId: z.string().min(1), originalDate: iso }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      delete from occurrence_overrides
      where item_id = ${data.itemId}
        and original_date = ${data.originalDate}
        and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });
