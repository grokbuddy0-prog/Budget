import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  FREQUENCY_LABEL,
  FREQUENCIES,
  parseDollars,
  todayLocalIso,
  weekdayUtc,
  type CashflowItem,
  type Frequency,
  type ItemType,
} from "@/lib/cashflow";
import type { ItemDraft } from "@/components/budget-provider";

const WEEKDAYS = [
  { v: 0, l: "Sunday" },
  { v: 1, l: "Monday" },
  { v: 2, l: "Tuesday" },
  { v: 3, l: "Wednesday" },
  { v: 4, l: "Thursday" },
  { v: 5, l: "Friday" },
  { v: 6, l: "Saturday" },
];

export const NAME_PRESETS = [
  { name: "Paycheck", type: "income" as const, frequency: "biweekly" as const },
  { name: "Rent", type: "bill" as const, frequency: "monthly" as const },
  { name: "Car", type: "bill" as const, frequency: "monthly" as const },
  { name: "Insurance", type: "bill" as const, frequency: "monthly" as const },
  { name: "Tithe", type: "bill" as const, frequency: "biweekly" as const },
  { name: "Groceries", type: "bill" as const, frequency: "weekly" as const },
];

function emptyDraft(preset?: Partial<ItemDraft>): ItemDraft {
  const today = todayLocalIso();
  const type: ItemType = preset?.type ?? "bill";
  const frequency: Frequency = preset?.frequency ?? "monthly";
  return {
    name: preset?.name ?? "",
    type,
    amount: preset?.amount ?? 0,
    frequency,
    startDate: preset?.startDate ?? today,
    endDate: preset?.endDate ?? null,
    dueDay: preset?.dueDay ?? Number(today.slice(8, 10)),
    semiDay1: preset?.semiDay1 ?? 1,
    semiDay2: preset?.semiDay2 ?? 15,
    weekday: preset?.weekday ?? weekdayUtc(today),
    anchorDate: preset?.anchorDate ?? today,
    accountLabel: preset?.accountLabel ?? "Checking",
    paused: preset?.paused ?? false,
    id: preset?.id,
  };
}

export function ItemForm({
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  initial?: Partial<CashflowItem>;
  onSave: (draft: ItemDraft) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft(initial));
  const [amountText, setAmountText] = useState(
    initial?.amount ? String(initial.amount) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...p }));

  const needsDue = draft.frequency === "monthly" || draft.frequency === "quarterly" || draft.frequency === "yearly";
  const needsSemi = draft.frequency === "semimonthly";
  const needsWeek = draft.frequency === "weekly" || draft.frequency === "biweekly";

  const canSave = useMemo(() => {
    const amount = parseDollars(amountText);
    return draft.name.trim().length > 0 && amount != null && amount > 0;
  }, [draft.name, amountText]);

  async function submit() {
    const amount = parseDollars(amountText);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...draft,
        name: draft.name.trim(),
        amount,
        accountLabel: draft.accountLabel.trim() || "Checking",
        endDate: draft.endDate || null,
        dueDay: needsDue ? Number(draft.startDate.slice(8, 10)) : null,
        semiDay1: needsSemi ? draft.semiDay1 : null,
        semiDay2: needsSemi ? draft.semiDay2 : null,
        weekday: needsWeek ? draft.weekday : null,
        anchorDate: draft.frequency === "biweekly" ? draft.anchorDate ?? draft.startDate : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => patch({ type: "bill" })}
          className={`h-11 rounded-md border text-sm font-medium ${
            draft.type === "bill"
              ? "border-bill bg-bill/15 text-bill"
              : "border-border text-muted"
          }`}
        >
          Bill
        </button>
        <button
          type="button"
          onClick={() => patch({ type: "income" })}
          className={`h-11 rounded-md border text-sm font-medium ${
            draft.type === "income"
              ? "border-income bg-income/15 text-income"
              : "border-border text-muted"
          }`}
        >
          Income
        </button>
      </div>

      <Field label="Name">
        <Input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Rent, Paycheck, Tithe…"
          autoComplete="off"
          required
        />
      </Field>

      <Field label="Amount">
        <Input
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="font-mono tabular"
          required
        />
      </Field>

      <Field label="Frequency">
        <NativeSelect
          value={draft.frequency}
          onChange={(e) => patch({ frequency: e.target.value as Frequency })}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {FREQUENCY_LABEL[f]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label={draft.frequency === "one_time" ? "Date" : "Starts / first due"}>
        <DateInput
          value={draft.startDate}
          onValue={(startDate) => {
            const day = Number(startDate.slice(8, 10));
            patch({
              startDate,
              dueDay: Number.isFinite(day) ? day : draft.dueDay,
              weekday: startDate ? weekdayUtc(startDate) : draft.weekday,
              anchorDate: draft.frequency === "biweekly" ? startDate : draft.anchorDate,
            });
          }}
          required
        />
      </Field>

      {needsSemi ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="First day">
            <Input
              type="number"
              min={1}
              max={31}
              value={draft.semiDay1 ?? 1}
              onChange={(e) => patch({ semiDay1: Number(e.target.value) })}
            />
          </Field>
          <Field label="Second day">
            <Input
              type="number"
              min={1}
              max={31}
              value={draft.semiDay2 ?? 15}
              onChange={(e) => patch({ semiDay2: Number(e.target.value) })}
            />
          </Field>
        </div>
      ) : null}

      {needsWeek ? (
        <>
          <Field label="Weekday">
            <NativeSelect
              value={draft.weekday ?? 5}
              onChange={(e) => patch({ weekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((w) => (
                <option key={w.v} value={w.v}>
                  {w.l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {draft.frequency === "biweekly" ? (
            <Field label="Anchor date">
              <DateInput
                value={draft.anchorDate ?? draft.startDate}
                onValue={(anchorDate) => patch({ anchorDate })}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {draft.frequency !== "one_time" ? (
        <Field label="End date (optional)">
          <DateInput
            value={draft.endDate ?? ""}
            onValue={(endDate) => patch({ endDate: endDate || null })}
          />
        </Field>
      ) : null}

      <Field label="Account">
        <Input
          value={draft.accountLabel}
          onChange={(e) => patch({ accountLabel: e.target.value })}
          placeholder="Checking"
        />
      </Field>

      <div className="flex h-11 items-center justify-between rounded-md border border-border bg-surface-2 px-3">
        <span className="text-sm">Paused</span>
        <Switch
          checked={draft.paused}
          onCheckedChange={(v) => patch({ paused: v })}
        />
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-col gap-2 pt-1">
        <Button type="submit" disabled={!canSave || busy}>
          {busy ? "Saving…" : draft.id ? "Save changes" : "Add to ledger"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {onDelete && draft.id ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}
