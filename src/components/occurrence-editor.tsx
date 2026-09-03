import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input } from "@/components/ui/input";
import { formatLongDate, formatSigned, type CashflowItem, type DayEvent } from "@/lib/cashflow";
import { cn } from "@/lib/utils";

export function OccurrenceEditor({
  event,
  date,
  item,
  onClose,
  onEditSeries,
  onSkip,
  onSave,
  onClear,
}: {
  event: DayEvent;
  date: string;
  item?: CashflowItem;
  onClose: () => void;
  onEditSeries: () => void;
  onSkip: () => Promise<void>;
  onSave: (amount: number, payDate: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(Math.abs(event.amountCents) / 100));
  const [payDate, setPayDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const kind = event.type === "income" ? "paycheck" : "bill";
  const moved = date !== event.originalDate;

  return (
    <div className="flex flex-col gap-3 pb-2">
      <p className="text-sm text-muted">
        {formatLongDate(date)}
        {item ? ` · ${item.accountLabel}` : null}
      </p>
      <p className="text-sm text-muted">
        Changes only this {kind}. The rest of the series stays the same.
      </p>
      {moved ? (
        <p className="text-sm text-muted">
          Series date {formatLongDate(event.originalDate)}
        </p>
      ) : null}
      <p
        className={cn(
          "font-mono text-2xl tabular",
          event.amountCents >= 0 ? "text-income" : "text-bill",
        )}
      >
        {formatSigned(event.amountCents)}
      </p>
      <Field label="Date this time only">
        <DateInput value={payDate} onValue={setPayDate} />
      </Field>
      <Field label="Amount this date only">
        <Input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="font-mono tabular"
        />
      </Field>
      <Button
        disabled={busy}
        onClick={() => {
          const n = Number(amount.replace(/[$,]/g, ""));
          if (!Number.isFinite(n) || n <= 0) return;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return;
          setBusy(true);
          void onSave(n, payDate).finally(() => setBusy(false));
        }}
      >
        Save this date only
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => void onSkip()}>
        Skip this date
      </Button>
      {event.overridden ? (
        <Button variant="ghost" disabled={busy} onClick={() => void onClear()}>
          Restore series
        </Button>
      ) : null}
      {item && item.frequency !== "one_time" ? (
        <Button variant="secondary" onClick={onEditSeries}>
          Edit the whole series
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
