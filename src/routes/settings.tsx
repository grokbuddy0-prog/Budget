import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageSkeleton, RequireAuth } from "@/components/app-shell";
import { BudgetProvider, useBudget } from "@/components/budget-provider";
import { Onboarding } from "@/components/onboarding";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input, NativeSelect } from "@/components/ui/input";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { parseDollars, type BalanceView, type ProjectionMonths } from "@/lib/cashflow";

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
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState("");
  const [months, setMonths] = useState<ProjectionMonths>(6);
  const [balanceView, setBalanceView] = useState<BalanceView>("every_day");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBalance(String(settings.startingBalance));
    setDate(settings.startingBalanceDate);
    setMonths(settings.projectionMonths);
    setBalanceView(settings.balanceView);
  }, [settings]);

  if (loading) return <PageSkeleton />;
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (!settings) return <Onboarding />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseDollars(balance);
    if (amount == null) return;
    const asOf = date || settings?.startingBalanceDate;
    if (!asOf) return;
    setBusy(true);
    try {
      await saveUserSettings({
        startingBalance: amount,
        startingBalanceDate: asOf,
        projectionMonths: months,
        balanceView,
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
        Update the as-of balance whenever you check the bank. Everything after
        that date is a projection.
      </p>

      <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => void save(e)}>
        <Field label="Starting balance">
          <Input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            className="font-mono tabular"
          />
        </Field>
        <Field label="As of date">
          <DateInput value={date} onValue={setDate} />
        </Field>
        <Field label="Default look-ahead">
          <NativeSelect
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) as ProjectionMonths)}
          >
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
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : saved ? "Saved" : "Save"}
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
