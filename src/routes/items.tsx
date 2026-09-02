import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AppShell, PageSkeleton, RequireAuth } from "@/components/app-shell";
import { BudgetProvider, useBudget } from "@/components/budget-provider";
import { ItemForm } from "@/components/item-form";
import { Onboarding } from "@/components/onboarding";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { RedirectToSignIn } from "@/lib/auth/gates";
import {
  addMonths,
  formatShortDate,
  formatSigned,
  FREQUENCY_LABEL,
  nextOccurrence,
  toCents,
  todayLocalIso,
  type CashflowItem,
} from "@/lib/cashflow";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/items")({ component: ItemsPage });

function ItemsPage() {
  return (
    <RequireAuth>
      <BudgetProvider>
        <AppShell>
          <ItemsBody />
        </AppShell>
      </BudgetProvider>
    </RequireAuth>
  );
}

function ItemsBody() {
  const { loading, error, settings, items, saveItem, removeItem } = useBudget();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CashflowItem | null>(null);
  const today = todayLocalIso();
  const horizon = addMonths(today, settings?.projectionMonths ?? 6);

  const groups = useMemo(() => {
    const income = items.filter((i) => i.type === "income" && !i.paused);
    const bills = items.filter((i) => i.type === "bill" && !i.paused);
    const paused = items.filter((i) => i.paused);
    const byNext = (a: CashflowItem, b: CashflowItem) => {
      const na = nextOccurrence(a, today, horizon) ?? "9999-99-99";
      const nb = nextOccurrence(b, today, horizon) ?? "9999-99-99";
      return na.localeCompare(nb) || a.name.localeCompare(b.name);
    };
    income.sort(byNext);
    bills.sort(byNext);
    paused.sort((a, b) => a.name.localeCompare(b.name));
    return { income, bills, paused };
  }, [items, today, horizon]);

  if (loading) return <PageSkeleton />;
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (!settings) return <Onboarding />;

  return (
    <div className="px-4 py-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Paydays & bills</h1>
          <p className="mt-1 text-sm text-muted">
            Change an amount or date and the daily balance updates immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-fg"
          aria-label="Add"
        >
          <Plus className="size-5" />
        </button>
      </div>

      <Section title="Income" empty="No paydays yet.">
        {groups.income.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            today={today}
            horizon={horizon}
            onClick={() => {
              setEditing(item);
              setOpen(true);
            }}
          />
        ))}
      </Section>
      <Section title="Bills" empty="No bills yet.">
        {groups.bills.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            today={today}
            horizon={horizon}
            onClick={() => {
              setEditing(item);
              setOpen(true);
            }}
          />
        ))}
      </Section>
      {groups.paused.length ? (
        <Section title="Paused" empty="">
          {groups.paused.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              today={today}
              horizon={horizon}
              onClick={() => {
                setEditing(item);
                setOpen(true);
              }}
            />
          ))}
        </Section>
      ) : null}

      <Drawer
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
      >
        <DrawerContent title={editing ? "Edit item" : "Add item"}>
          <ItemForm
            initial={editing ?? undefined}
            onCancel={() => setOpen(false)}
            onSave={async (draft) => {
              await saveItem(draft);
              setOpen(false);
            }}
            onDelete={
              editing
                ? async () => {
                    await removeItem(editing.id);
                    setOpen(false);
                  }
                : undefined
            }
          />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <section className="mt-6">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</h2>
      <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
        {count ? children : <p className="px-3 py-3 text-sm text-muted">{empty}</p>}
      </div>
    </section>
  );
}

function ItemRow({
  item,
  today,
  horizon,
  onClick,
}: {
  item: CashflowItem;
  today: string;
  horizon: string;
  onClick: () => void;
}) {
  const next = nextOccurrence(item, today, horizon);
  const cents = item.type === "income" ? toCents(item.amount) : -toCents(item.amount);
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{item.name}</p>
        <p className="mt-0.5 text-xs text-muted">
          {FREQUENCY_LABEL[item.frequency]}
          {next ? ` · next ${formatShortDate(next)}` : ""}
          {item.paused ? " · paused" : ""}
        </p>
      </div>
      <p
        className={cn(
          "font-mono text-sm tabular",
          item.type === "income" ? "text-income" : "text-bill",
        )}
      >
        {formatSigned(cents)}
      </p>
    </button>
  );
}
