import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { vaultMiddleware } from "@/lib/crypto/middleware";
import {
  encryptCents,
  encryptString,
  encodeAccounts,
  mapItemWithDek,
  mapOverrideWithDek,
  mapSettingsWithDek,
  sealPlaintext,
} from "@/lib/crypto/vault.server";
import {
  defaultAccounts,
  isIsoDate,
  sumAccounts,
  type BankAccount,
  type CashflowItem,
  type OccurrenceOverride,
} from "@/lib/cashflow";
import { getSql } from "@/lib/db";

const iso = z.string().refine((v) => isIsoDate(v), "Invalid date");
const money = z.coerce.number().finite();
const posMoney = z.coerce.number().finite().positive();

type SettingsRow = {
  starting_balance: unknown;
  starting_balance_enc: string | null;
  starting_balance_date: string;
  currency: string;
  projection_months: number;
  balance_view: string | null;
  alert_threshold: unknown;
  alert_threshold_enc: string | null;
  accounts_enc: string | null;
  is_admin: boolean;
};

type ItemRow = {
  id: string;
  name: string;
  name_enc: string | null;
  type: "income" | "bill";
  amount: unknown;
  amount_enc: string | null;
  frequency: CashflowItem["frequency"];
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  semi_day_1: number | null;
  semi_day_2: number | null;
  weekday: number | null;
  anchor_date: string | null;
  account_label: string;
  account_label_enc: string | null;
  paused: boolean;
};

type OverrideRow = {
  id: string;
  item_id: string;
  original_date: string;
  kind: OccurrenceOverride["kind"];
  amount: unknown;
  amount_enc: string | null;
  moved_date: string | null;
};

function dekOf(context: { dek?: Buffer }): Buffer {
  const dek = context.dek;
  if (!dek) throw new Error("VaultLocked");
  return dek;
}

export const getBootstrapState = createServerFn({ method: "GET" }).handler(
  async () => {
    const sql = await getSql();
    const rows = await sql<{ n: number }>`select count(*)::int as n from "user"`;
    return { needsSetup: (rows[0]?.n ?? 0) === 0 };
  },
);

export const getBudget = createServerFn({ method: "GET" })
  .middleware([authMiddleware, vaultMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const uid = context.userId;
    const dek = dekOf(context);
    await sealPlaintext(sql, uid, dek);
    const [settingsRows, itemRows, overrideRows] = await Promise.all([
      sql<SettingsRow>`
        select starting_balance, starting_balance_enc, starting_balance_date, currency,
               projection_months, balance_view, alert_threshold, alert_threshold_enc, accounts_enc, is_admin
        from user_settings where user_id = ${uid}
      `,
      sql<ItemRow>`
        select id, name, name_enc, type, amount, amount_enc, frequency, start_date, end_date,
               due_day, semi_day_1, semi_day_2, weekday, anchor_date,
               account_label, account_label_enc, paused
        from cashflow_items
        where user_id = ${uid}
        order by type desc, start_date, id
      `,
      sql<OverrideRow>`
        select id, item_id, original_date, kind, amount, amount_enc, moved_date
        from occurrence_overrides
        where user_id = ${uid}
      `,
    ]);
    return {
      settings: settingsRows[0] ? mapSettingsWithDek(settingsRows[0], dek) : null,
      items: itemRows.map((row) => mapItemWithDek(row, dek)),
      overrides: overrideRows.map((row) => mapOverrideWithDek(row, dek)),
    };
  });

const settingsInput = z.object({
  startingBalance: money,
  startingBalanceDate: iso,
  projectionMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  balanceView: z.enum(["every_day", "activity"]).optional(),
  alertThreshold: z.coerce.number().finite().min(0).optional(),
  accounts: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        name: z.string().trim().min(1).max(40),
        balance: z.coerce.number().finite(),
      }),
    )
    .optional(),
  claimAdmin: z.boolean().optional(),
});

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware, vaultMiddleware])
  .validator((data: unknown) => settingsInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const uid = context.userId;
    const dek = dekOf(context);
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
    const accounts: BankAccount[] = (data.accounts?.length
      ? data.accounts.map((a) => ({
          id: a.id ?? randomUUID(),
          name: a.name,
          balance: a.balance,
        }))
      : defaultAccounts(data.startingBalance));
    const total = sumAccounts(accounts);
    const startEnc = encryptCents(dek, total);
    const alertEnc = encryptCents(dek, threshold);
    const accountsEnc = encodeAccounts(dek, accounts);
    await sql`
      insert into user_settings (
        user_id, starting_balance, starting_balance_enc, starting_balance_date, currency,
        projection_months, balance_view, alert_threshold, alert_threshold_enc, accounts_enc, is_admin,
        crypto_migrated, updated_at
      ) values (
        ${uid}, 0, ${startEnc}, ${data.startingBalanceDate}, 'USD',
        ${data.projectionMonths}, ${view}, 0, ${alertEnc}, ${accountsEnc}, ${isAdmin},
        true, now()
      )
      on conflict (user_id) do update set
        starting_balance = 0,
        starting_balance_enc = excluded.starting_balance_enc,
        starting_balance_date = excluded.starting_balance_date,
        projection_months = excluded.projection_months,
        balance_view = excluded.balance_view,
        alert_threshold = 0,
        alert_threshold_enc = excluded.alert_threshold_enc,
        accounts_enc = excluded.accounts_enc,
        is_admin = user_settings.is_admin or excluded.is_admin,
        crypto_migrated = true,
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
  .middleware([authMiddleware, vaultMiddleware])
  .validator((data: unknown) => itemInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = data.id ?? randomUUID();
    const dek = dekOf(context);
    const nameEnc = encryptString(dek, data.name);
    const amountEnc = encryptCents(dek, data.amount);
    const labelEnc = encryptString(dek, data.accountLabel);
    await sql`
      insert into cashflow_items (
        id, user_id, name, name_enc, type, amount, amount_enc, frequency, start_date, end_date,
        due_day, semi_day_1, semi_day_2, weekday, anchor_date, account_label, account_label_enc, paused, updated_at
      ) values (
        ${id}, ${context.userId}, '', ${nameEnc}, ${data.type}, 0, ${amountEnc},
        ${data.frequency}, ${data.startDate}, ${data.endDate}, ${data.dueDay},
        ${data.semiDay1}, ${data.semiDay2}, ${data.weekday}, ${data.anchorDate},
        '', ${labelEnc}, ${data.paused}, now()
      )
      on conflict (id) do update set
        name = '',
        name_enc = excluded.name_enc,
        type = excluded.type,
        amount = 0,
        amount_enc = excluded.amount_enc,
        frequency = excluded.frequency,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        due_day = excluded.due_day,
        semi_day_1 = excluded.semi_day_1,
        semi_day_2 = excluded.semi_day_2,
        weekday = excluded.weekday,
        anchor_date = excluded.anchor_date,
        account_label = '',
        account_label_enc = excluded.account_label_enc,
        paused = excluded.paused,
        updated_at = now()
      where cashflow_items.user_id = ${context.userId}
    `;
    return { id };
  });

export const deleteItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware, vaultMiddleware])
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
  .middleware([authMiddleware, vaultMiddleware])
  .validator((data: unknown) => overrideInput.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const dek = dekOf(context);
    const owned = await sql<{ id: string }>`
      select id from cashflow_items
      where id = ${data.itemId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Item not found");
    const id = randomUUID();
    const amountEnc = data.amount == null ? null : encryptCents(dek, data.amount);
    await sql`
      insert into occurrence_overrides (
        id, user_id, item_id, original_date, kind, amount, amount_enc, moved_date
      ) values (
        ${id}, ${context.userId}, ${data.itemId}, ${data.originalDate},
        ${data.kind}, ${null}, ${amountEnc}, ${data.movedDate}
      )
      on conflict (item_id, original_date) do update set
        kind = excluded.kind,
        amount = null,
        amount_enc = excluded.amount_enc,
        moved_date = excluded.moved_date
      where occurrence_overrides.user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const clearOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware, vaultMiddleware])
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
