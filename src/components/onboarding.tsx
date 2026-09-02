import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input, NativeSelect } from "@/components/ui/input";
import { parseDollars, todayLocalIso, type ProjectionMonths } from "@/lib/cashflow";
import { useBudget } from "@/components/budget-provider";

export function Onboarding() {
  const { saveUserSettings } = useBudget();
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(todayLocalIso());
  const [months, setMonths] = useState<ProjectionMonths>(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseDollars(balance);
    if (amount == null) {
      setError("Enter the amount in checking right now.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveUserSettings({
        startingBalance: amount,
        startingBalanceDate: date,
        projectionMonths: months,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-2xl font-medium tracking-tight text-fg">
        What is in checking?
      </h1>
      <p className="mt-2 text-sm leading-snug text-muted">
        That number is the as-of balance. Paydays and bills after this date
        write the daily ledger forward.
      </p>
      <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <Field label="Current checking balance">
          <Input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="2847.12"
            className="font-mono tabular text-lg"
            autoFocus
          />
        </Field>
        <Field label="As of">
          <DateInput value={date} onValue={setDate} />
        </Field>
        <Field label="Look ahead">
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
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? "Saving…" : "Show daily balance"}
        </Button>
      </form>
    </div>
  );
}
