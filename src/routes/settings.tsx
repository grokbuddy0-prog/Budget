import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageSkeleton, RequireAuth } from "@/components/app-shell";
import { BudgetProvider, useBudget } from "@/components/budget-provider";
import { Onboarding } from "@/components/onboarding";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input, NativeSelect } from "@/components/ui/input";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { authClient } from "@/lib/auth/client";
import { rememberVaultToken } from "@/lib/crypto/client";
import { rewrapVaultPassword } from "@/lib/server/vault";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { parseDollars, formatMoney, sumAccounts, toCents, type BalanceView, type ProjectionMonths } from "@/lib/cashflow";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  return (
    <RequireAuth>
      <BudgetProvider>
        <AppShell>
          <SettingsBody />
        </AppShell>
      </BudgetProvider>
    </RequireAuth>
  );
}

function SettingsBody() {
  const user = useCurrentUser();
  const { loading, error, settings, saveUserSettings } = useBudget();
  const [accounts, setAccounts] = useState<{ id: string; name: string; balance: string }[]>([]);
  const [date, setDate] = useState("");
  const [months, setMonths] = useState<ProjectionMonths>(6);
  const [balanceView, setBalanceView] = useState<BalanceView>("every_day");
  const [threshold, setThreshold] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setAccounts(
      (settings.accounts.length
        ? settings.accounts
        : [{ id: "checking", name: "Checking", balance: settings.startingBalance }]
      ).map((a) => ({ id: a.id, name: a.name, balance: String(a.balance) })),
    );
    setDate(settings.startingBalanceDate);
    setMonths(settings.projectionMonths);
    setBalanceView(settings.balanceView);
    setThreshold(settings.alertThreshold ? String(settings.alertThreshold) : "");
  }, [settings]);

  if (loading) return <PageSkeleton />;
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (!settings) return <Onboarding />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = accounts
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        balance: parseDollars(row.balance) ?? 0,
      }))
      .filter((row) => row.name);
    if (!parsed.length) return;
    const amount = sumAccounts(parsed);
    const asOf = date || settings?.startingBalanceDate;
    if (!asOf) return;
    setBusy(true);
    try {
      await saveUserSettings({
        startingBalance: amount,
        startingBalanceDate: asOf,
        projectionMonths: months,
        balanceView,
        alertThreshold: parseDollars(threshold) ?? 0,
        accounts: parsed,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <h1 className="text-xl font-medium tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Update account balances whenever you check the bank. The main screen
        shows the total. Everything after the as-of date is a projection.
      </p>

      <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => void save(e)}>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-muted">Accounts</span>
          {accounts.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_7.5rem_auto] gap-2">
              <Input
                value={row.name}
                onChange={(e) =>
                  setAccounts((cur) =>
                    cur.map((a) => (a.id === row.id ? { ...a, name: e.target.value } : a)),
                  )
                }
                placeholder="Checking"
              />
              <Input
                value={row.balance}
                onChange={(e) =>
                  setAccounts((cur) =>
                    cur.map((a) => (a.id === row.id ? { ...a, balance: e.target.value } : a)),
                  )
                }
                inputMode="decimal"
                className="font-mono tabular"
                placeholder="0"
              />
              <button
                type="button"
                className="text-sm text-muted disabled:opacity-40"
                disabled={accounts.length < 2}
                onClick={() => setAccounts((cur) => cur.filter((a) => a.id !== row.id))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-sm text-fg underline-offset-4 hover:underline"
            onClick={() =>
              setAccounts((cur) => [
                ...cur,
                { id: crypto.randomUUID(), name: "", balance: "" },
              ])
            }
          >
            Add account
          </button>
          <p className="font-mono text-sm tabular text-fg">
            Total{" "}
            {formatMoney(
              toCents(
                sumAccounts(
                  accounts.map((row) => ({
                    id: row.id,
                    name: row.name || "Account",
                    balance: parseDollars(row.balance) ?? 0,
                  })),
                ),
              ),
            )}
          </p>
        </div>
        <Field label="As of date">
          <DateInput value={date} onValue={setDate} />
        </Field>
        <Field label="Default look-ahead">
          <NativeSelect
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) as ProjectionMonths)}
          >
            <option value={1}>1 month</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </NativeSelect>
        </Field>
        <Field label="Default balances view">
          <NativeSelect
            value={balanceView}
            onChange={(e) => setBalanceView(e.target.value as BalanceView)}
          >
            <option value="every_day">Every day</option>
            <option value="activity">Activity</option>
          </NativeSelect>
        </Field>
        <Field label="Warn below">
          <Input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="font-mono tabular"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </form>

      <form
        className="mt-10 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPwBusy(true);
          setPwError(null);
          void (async () => {
            try {
              const { error } = await authClient.changePassword({
                currentPassword,
                newPassword,
              });
              if (error) throw new Error(error.message ?? "Could not change password");
              const vault = await rewrapVaultPassword({
                data: { currentPassword, newPassword },
              });
              rememberVaultToken(vault.vaultToken);
              setCurrentPassword("");
              setNewPassword("");
              setPwSaved(true);
              window.setTimeout(() => setPwSaved(false), 1600);
            } catch (err) {
              setPwError(err instanceof Error ? err.message : "Could not change password");
            } finally {
              setPwBusy(false);
            }
          })();
        }}
      >
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          Password
        </h2>
        <p className="text-sm text-muted">
          Changing it also re-locks your encrypted ledger. Lost password plus no
          recovery key means this budget cannot be recovered.
        </p>
        <Field label="Current password">
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {pwError ? <p className="text-sm text-danger">{pwError}</p> : null}
        <Button type="submit" disabled={pwBusy}>
          {pwBusy ? "Updating…" : pwSaved ? "Updated" : "Change password"}
        </Button>
      </form>

      <section className="mt-10 rounded-lg border border-border bg-surface px-3 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Account</p>
        <p className="mt-2 text-sm text-fg">{user?.displayName ?? "Signed in"}</p>
        <p className="text-sm text-muted">{user?.primaryEmail}</p>
        {settings.isAdmin ? (
          <p className="mt-2 text-xs text-muted">Admin</p>
        ) : null}
        <div className="mt-3 [&_button]:h-11 [&_button]:w-full [&_button]:rounded-md [&_button]:border [&_button]:border-border [&_button]:bg-surface-2 [&_button]:text-sm">
          <UserButton showIdentity={false} />
        </div>
      </section>
    </div>
  );
}
