import { getCookie, setCookie } from "@tanstack/react-start/server";
import {
  decryptCents,
  decryptMoneyField,
  decryptString,
  decryptTextField,
  encryptCents,
  encryptString,
  isCiphertext,
  kdfFromPassword,
  kdfFromSecret,
  KDF_N,
  KDF_P,
  KDF_R,
  makeRecoveryKey,
  newDek,
  newSalt,
  unwrapKey,
  wrapKey,
} from "@/lib/crypto/aes";
import {
  dollarsFromUnknown,
  defaultAccounts,
  sumAccounts,
  todayLocalIso,
  type BankAccount,
  type CashflowItem,
  type OccurrenceOverride,
  type UserSettings,
} from "@/lib/cashflow";
import { getSql, type Sql } from "@/lib/db";

export const VAULT_COOKIE = "fb_vault";
export const VAULT_LOCKED = "VaultLocked";

type VaultRow = {
  wrapped_dek: string | null;
  wrapped_dek_recovery: string | null;
  wrapped_dek_mcp: string | null;
  kdf_salt: string | null;
  kdf_n: number | null;
  kdf_r: number | null;
  kdf_p: number | null;
  crypto_migrated: boolean;
  starting_balance: unknown;
  starting_balance_enc: string | null;
  starting_balance_date: string | null;
  alert_threshold: unknown;
  alert_threshold_enc: string | null;
  currency: string | null;
  projection_months: number | null;
  balance_view: string | null;
  is_admin: boolean;
};

function cookieKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || "preview-only-vault-cookie";
  return kdfFromSecret(secret, "fb-vault-cookie");
}

function mcpKek(userId: string): Buffer | null {
  const key = process.env.MCP_API_KEY?.trim();
  if (!key) return null;
  return kdfFromSecret(key, `fb-mcp-dek:${userId}`);
}

export function sealPayload(userId: string, dek: Buffer): string {
  return encryptString(cookieKey(), JSON.stringify({ u: userId, k: dek.toString("base64url") }));
}

export function openPayload(userId: string, token: string): Buffer | null {
  try {
    const raw = decryptString(cookieKey(), token);
    const parsed = JSON.parse(raw) as { u?: string; k?: string };
    if (parsed.u !== userId || typeof parsed.k !== "string") return null;
    return Buffer.from(parsed.k, "base64url");
  } catch {
    return null;
  }
}

export function writeVaultCookie(token: string) {
  const secure = (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "").startsWith("https:");
  setCookie(VAULT_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearVaultCookie() {
  const secure = (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "").startsWith("https:");
  setCookie(VAULT_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 0,
  });
}

export function readRequestDek(userId: string, vaultToken?: string | null): Buffer | null {
  const cookie = getCookie(VAULT_COOKIE);
  if (cookie) {
    const dek = openPayload(userId, cookie);
    if (dek) return dek;
  }
  if (vaultToken) {
    const dek = openPayload(userId, vaultToken);
    if (dek) return dek;
  }
  return null;
}

async function loadVaultRow(sql: Sql, userId: string): Promise<VaultRow | null> {
  const rows = await sql<VaultRow>`
    select wrapped_dek, wrapped_dek_recovery, wrapped_dek_mcp, kdf_salt, kdf_n, kdf_r, kdf_p,
           crypto_migrated, starting_balance, starting_balance_enc, starting_balance_date,
           alert_threshold, alert_threshold_enc, currency, projection_months, balance_view, is_admin
    from user_settings where user_id = ${userId}
  `;
  return rows[0] ?? null;
}

async function saveWraps(
  sql: Sql,
  userId: string,
  args: {
    wrappedDek: string;
    wrappedRecovery: string | null;
    wrappedMcp: string | null;
    salt: string;
    n: number;
    r: number;
    p: number;
    migrated: boolean;
  },
) {
  const existing = await sql<{ user_id: string }>`select user_id from user_settings where user_id = ${userId}`;
  if (!existing[0]) {
    await sql`
      insert into user_settings (
        user_id, starting_balance, starting_balance_date, currency, projection_months,
        wrapped_dek, wrapped_dek_recovery, wrapped_dek_mcp, kdf_salt, kdf_n, kdf_r, kdf_p, crypto_migrated, updated_at
      ) values (
        ${userId}, 0, ${todayLocalIso()}, 'USD', 6,
        ${args.wrappedDek}, ${args.wrappedRecovery}, ${args.wrappedMcp}, ${args.salt},
        ${args.n}, ${args.r}, ${args.p}, ${args.migrated}, now()
      )
    `;
    return;
  }
  await sql`
    update user_settings set
      wrapped_dek = ${args.wrappedDek},
      wrapped_dek_recovery = coalesce(${args.wrappedRecovery}, wrapped_dek_recovery),
      wrapped_dek_mcp = ${args.wrappedMcp},
      kdf_salt = ${args.salt},
      kdf_n = ${args.n},
      kdf_r = ${args.r},
      kdf_p = ${args.p},
      crypto_migrated = ${args.migrated},
      updated_at = now()
    where user_id = ${userId}
  `;
}

export async function sealPlaintext(sql: Sql, userId: string, dek: Buffer) {
  const settings = await sql<{
    starting_balance: unknown;
    starting_balance_enc: string | null;
    alert_threshold: unknown;
    alert_threshold_enc: string | null;
    accounts_enc: string | null;
  }>`
    select starting_balance, starting_balance_enc, alert_threshold, alert_threshold_enc, accounts_enc
    from user_settings where user_id = ${userId}
  `;
  const s = settings[0];
  if (s) {
    const startEnc = s.starting_balance_enc && isCiphertext(s.starting_balance_enc)
      ? s.starting_balance_enc
      : encryptCents(dek, dollarsFromUnknown(s.starting_balance));
    const startBal = decryptMoneyField(dek, startEnc, s.starting_balance);
    const alertEnc = s.alert_threshold_enc && isCiphertext(s.alert_threshold_enc)
      ? s.alert_threshold_enc
      : encryptCents(dek, Math.max(0, dollarsFromUnknown(s.alert_threshold)));
    const accountsEnc = s.accounts_enc && isCiphertext(s.accounts_enc)
      ? s.accounts_enc
      : encodeAccounts(dek, defaultAccounts(startBal));
    await sql`
      update user_settings set
        starting_balance_enc = ${startEnc},
        alert_threshold_enc = ${alertEnc},
        accounts_enc = ${accountsEnc},
        starting_balance = 0,
        alert_threshold = 0,
        crypto_migrated = true,
        updated_at = now()
      where user_id = ${userId}
    `;
  }

  const items = await sql<{
    id: string;
    name: string;
    name_enc: string | null;
    amount: unknown;
    amount_enc: string | null;
    account_label: string;
    account_label_enc: string | null;
    notes_enc: string | null;
  }>`
    select id, name, name_enc, amount, amount_enc, account_label, account_label_enc, notes_enc
    from cashflow_items where user_id = ${userId}
  `;
  for (const item of items) {
    const nameEnc = item.name_enc && isCiphertext(item.name_enc)
      ? item.name_enc
      : encryptString(dek, item.name || "");
    const amountEnc = item.amount_enc && isCiphertext(item.amount_enc)
      ? item.amount_enc
      : encryptCents(dek, dollarsFromUnknown(item.amount));
    const labelEnc = item.account_label_enc && isCiphertext(item.account_label_enc)
      ? item.account_label_enc
      : encryptString(dek, item.account_label || "Checking");
    await sql`
      update cashflow_items set
        name_enc = ${nameEnc},
        amount_enc = ${amountEnc},
        account_label_enc = ${labelEnc},
        name = '',
        amount = 0,
        account_label = '',
        updated_at = now()
      where id = ${item.id} and user_id = ${userId}
    `;
  }

  const overrides = await sql<{
    id: string;
    amount: unknown;
    amount_enc: string | null;
  }>`
    select id, amount, amount_enc from occurrence_overrides where user_id = ${userId}
  `;
  for (const row of overrides) {
    if (row.amount == null && !row.amount_enc) continue;
    const amountEnc = row.amount_enc && isCiphertext(row.amount_enc)
      ? row.amount_enc
      : row.amount == null
        ? null
        : encryptCents(dek, dollarsFromUnknown(row.amount));
    await sql`
      update occurrence_overrides set
        amount_enc = ${amountEnc},
        amount = null
      where id = ${row.id} and user_id = ${userId}
    `;
  }
}

export async function unwrapMcpDek(userId: string): Promise<Buffer | null> {
  const kek = mcpKek(userId);
  if (!kek) return null;
  const sql = await getSql();
  const rows = await sql<{ wrapped_dek_mcp: string | null }>`
    select wrapped_dek_mcp from user_settings where user_id = ${userId}
  `;
  const wrapped = rows[0]?.wrapped_dek_mcp;
  if (!wrapped) return null;
  try {
    return unwrapKey(kek, wrapped);
  } catch {
    return null;
  }
}

function wrapMcp(userId: string, dek: Buffer): string | null {
  const kek = mcpKek(userId);
  if (!kek) return null;
  return wrapKey(kek, dek);
}

export async function unlockWithSecret(
  userId: string,
  secret: { password?: string; recoveryKey?: string },
): Promise<{ vaultToken: string; recoveryKey: string | null; migrated: boolean }> {
  const password = secret.password?.trim() ?? "";
  const recoveryKey = secret.recoveryKey?.trim() ?? "";
  if (!password && !recoveryKey) {
    throw new Error("Enter your password or recovery key.");
  }

  const sql = await getSql();
  const row = await loadVaultRow(sql, userId);
  let dek: Buffer;
  let salt = row?.kdf_salt ? Buffer.from(row.kdf_salt, "base64url") : newSalt();
  let n = row?.kdf_n || KDF_N;
  let r = row?.kdf_r || KDF_R;
  let p = row?.kdf_p || KDF_P;
  let wrappedRecovery = row?.wrapped_dek_recovery ?? null;
  let shownRecovery: string | null = null;
  let migrated = Boolean(row?.crypto_migrated && row.wrapped_dek);

  if (row?.wrapped_dek) {
    try {
      if (password) {
        const kek = await kdfFromPassword(password, salt, n, r, p);
        dek = unwrapKey(kek, row.wrapped_dek);
      } else {
        if (!wrappedRecovery) throw new Error("No recovery key is on file.");
        dek = unwrapKey(kdfFromSecret(recoveryKey, "fb-recovery", userId), wrappedRecovery);
      }
    } catch {
      throw new Error("That password or recovery key does not unlock this ledger.");
    }
  } else {
    if (!password) throw new Error("A password is required to create your key.");
    dek = newDek();
    salt = newSalt();
    n = KDF_N;
    r = KDF_R;
    p = KDF_P;
    shownRecovery = makeRecoveryKey();
    wrappedRecovery = wrapKey(kdfFromSecret(shownRecovery, "fb-recovery", userId), dek);
  }

  const kek = password ? await kdfFromPassword(password, salt, n, r, p) : null;
  const wrappedDek = kek ? wrapKey(kek, dek) : row?.wrapped_dek;
  if (!wrappedDek) throw new Error("Could not lock the key.");

  if (!wrappedRecovery) {
    shownRecovery = makeRecoveryKey();
    wrappedRecovery = wrapKey(kdfFromSecret(shownRecovery, "fb-recovery", userId), dek);
  }

  await saveWraps(sql, userId, {
    wrappedDek,
    wrappedRecovery,
    wrappedMcp: wrapMcp(userId, dek),
    salt: salt.toString("base64url"),
    n,
    r,
    p,
    migrated: true,
  });
  await sealPlaintext(sql, userId, dek);

  const vaultToken = sealPayload(userId, dek);
  writeVaultCookie(vaultToken);
  return { vaultToken, recoveryKey: shownRecovery, migrated: !migrated };
}

export async function rewrapWithPassword(
  userId: string,
  dek: Buffer,
  currentPassword: string,
  newPassword: string,
) {
  const sql = await getSql();
  const row = await loadVaultRow(sql, userId);
  if (!row?.wrapped_dek || !row.kdf_salt) throw new Error("No key is on file.");
  const salt = Buffer.from(row.kdf_salt, "base64url");
  const n = row.kdf_n || KDF_N;
  const r = row.kdf_r || KDF_R;
  const p = row.kdf_p || KDF_P;
  try {
    const currentKek = await kdfFromPassword(currentPassword, salt, n, r, p);
    unwrapKey(currentKek, row.wrapped_dek);
  } catch {
    throw new Error("Current password does not unlock this ledger.");
  }
  const newSaltBuf = newSalt();
  const newKek = await kdfFromPassword(newPassword, newSaltBuf, KDF_N, KDF_R, KDF_P);
  const wrappedDek = wrapKey(newKek, dek);
  await sql`
    update user_settings set
      wrapped_dek = ${wrappedDek},
      wrapped_dek_mcp = ${wrapMcp(userId, dek)},
      kdf_salt = ${newSaltBuf.toString("base64url")},
      kdf_n = ${KDF_N},
      kdf_r = ${KDF_R},
      kdf_p = ${KDF_P},
      updated_at = now()
    where user_id = ${userId}
  `;
  const vaultToken = sealPayload(userId, dek);
  writeVaultCookie(vaultToken);
  return { vaultToken };
}

export function mapSettingsWithDek(row: {
  starting_balance: unknown;
  starting_balance_enc?: string | null;
  starting_balance_date: string;
  currency: string;
  projection_months: number;
  balance_view: string | null;
  alert_threshold: unknown;
  alert_threshold_enc?: string | null;
  accounts_enc?: string | null;
  is_admin: boolean;
}, dek: Buffer): UserSettings {
  const startingBalance = decryptMoneyField(dek, row.starting_balance_enc, row.starting_balance);
  const accounts = decodeAccounts(dek, row.accounts_enc, startingBalance);
  const total = accounts.length ? sumAccounts(accounts) : startingBalance;
  return {
    startingBalance: total,
    startingBalanceDate: row.starting_balance_date,
    currency: row.currency || "USD",
    projectionMonths: row.projection_months === 1 || row.projection_months === 3 || row.projection_months === 12
      ? row.projection_months
      : 6,
    balanceView: row.balance_view === "activity" ? "activity" : "every_day",
    alertThreshold: Math.max(0, decryptMoneyField(dek, row.alert_threshold_enc, row.alert_threshold)),
    accounts,
    isAdmin: Boolean(row.is_admin),
  };
}

export function mapItemWithDek(row: {
  id: string;
  name: string;
  name_enc?: string | null;
  type: CashflowItem["type"];
  amount: unknown;
  amount_enc?: string | null;
  frequency: CashflowItem["frequency"];
  start_date: string;
  end_date: string | null;
  due_day: number | null;
  semi_day_1: number | null;
  semi_day_2: number | null;
  weekday: number | null;
  anchor_date: string | null;
  account_label: string;
  account_label_enc?: string | null;
  paused: boolean;
}, dek: Buffer): CashflowItem {
  return {
    id: row.id,
    name: decryptTextField(dek, row.name_enc, row.name),
    type: row.type,
    amount: decryptMoneyField(dek, row.amount_enc, row.amount),
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    dueDay: row.due_day,
    semiDay1: row.semi_day_1,
    semiDay2: row.semi_day_2,
    weekday: row.weekday,
    anchorDate: row.anchor_date,
    accountLabel: decryptTextField(dek, row.account_label_enc, row.account_label) || "Checking",
    paused: Boolean(row.paused),
  };
}

export function mapOverrideWithDek(row: {
  id: string;
  item_id: string;
  original_date: string;
  kind: OccurrenceOverride["kind"];
  amount: unknown;
  amount_enc?: string | null;
  moved_date: string | null;
}, dek: Buffer): OccurrenceOverride {
  let amount: number | null = null;
  if (row.amount_enc && isCiphertext(row.amount_enc)) amount = decryptCents(dek, row.amount_enc);
  else if (row.amount != null) amount = dollarsFromUnknown(row.amount);
  return {
    id: row.id,
    itemId: row.item_id,
    originalDate: row.original_date,
    kind: row.kind,
    amount,
    movedDate: row.moved_date,
  };
}

export function encodeAccounts(dek: Buffer, accounts: BankAccount[]): string {
  const payload = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    cents: Math.round(a.balance * 100),
  }));
  return encryptString(dek, JSON.stringify(payload));
}

export function decodeAccounts(
  dek: Buffer,
  enc: string | null | undefined,
  fallbackBalance: number,
): BankAccount[] {
  if (enc && isCiphertext(enc)) {
    try {
      const parsed = JSON.parse(decryptString(dek, enc)) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((row, i) => {
          const r = row as { id?: unknown; name?: unknown; cents?: unknown; balance?: unknown };
          const cents = typeof r.cents === "number" ? r.cents : Math.round(Number(r.balance ?? 0) * 100);
          return {
            id: typeof r.id === "string" && r.id ? r.id : `account-${i + 1}`,
            name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : `Account ${i + 1}`,
            balance: cents / 100,
          };
        });
      }
    } catch {
      /* fall back */
    }
  }
  return defaultAccounts(fallbackBalance);
}

export { encryptCents, encryptString };
