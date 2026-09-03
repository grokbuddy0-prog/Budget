import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AppShell, PageSkeleton, RequireAuth } from "@/components/app-shell";
import { BudgetProvider, useBudget } from "@/components/budget-provider";
import { ItemForm } from "@/components/item-form";
import { OccurrenceEditor } from "@/components/occurrence-editor";
import { Onboarding } from "@/components/onboarding";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { RedirectToSignIn } from "@/lib/auth/gates";
import {
  addMonths,
  formatLongDate,
  formatShortDate,
  formatSigned,
  FREQUENCY_LABEL,
  nextOccurrence,
  seriesHits,
  toCents,
  todayLocalIso,
  type CashflowItem,
  type DayEvent,
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

function hitToEvent(item: CashflowItem, hit: ReturnType<typeof seriesHits>[number]): DayEvent {
  const signed = item.type === "income" ? toCents(hit.amount) : -toCents(hit.amount);
  return {
    itemId: item.id,
    name: item.name,
    type: item.type,
    accountLabel: item.accountLabel,
    amountCents: hit.skipped ? 0 : signed,
    originalDate: hit.originalDate,
    overridden: hit.overridden,
    skipped: hit.skipped,
  };
}

function ItemsBody() {
  const { loading, error, settings, items, overrides, saveItem, removeItem, setOverride, removeOverride } =
    useBudget();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CashflowItem | null>(null);
  const [series, setSeries] = useState<CashflowItem | null>(null);
  const [one, setOne] = useState<{ item: CashflowItem; event: DayEvent; date: string } | null>(
    null,
  );
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

  function openItem(item: CashflowItem) {
    if (item.frequency === "one_time" || item.paused) {
      setSeries(null);
      setEditing(item);
      setOpen(true);
      return;
    }
    setEditing(null);
    setOpen(false);
    setSeries(item);
  }

  function openSeriesForm(item: CashflowItem) {
    setSeries(null);
    setOne(null);
    setEditing(item);
    setOpen(true);
  }

  if (loading) return <PageSkeleton />;
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (!settings) return <Onboarding />;

  const seriesDates = series ? seriesHits(series, overrides, today, horizon).slice(0, 18) : [];

  return (
    <div className="px-4 py-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Paydays & bills</h1>
          <p className="mt-1 text-sm text-muted">
            Tap a series to change one date, or the whole series.
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
            onClick={() => openItem(item)}
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
            onClick={() => openItem(item)}
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
              onClick={() => openItem(item)}
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
        <DrawerContent title={editing ? "Edit series" : "Add item"}>
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

      <Drawer open={!!series} onOpenChange={(o) => !o && setSeries(null)}>
        <DrawerContent title={series?.name ?? "Series"}>
          {series ? (
            <div className="flex flex-col gap-3 pb-2">
              <p className="text-sm text-muted">
                Tap one date to change just that {series.type === "income" ? "paycheck" : "bill"}.
                The rest of the series stays the same.
              </p>
              <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
                {seriesDates.length ? (
                  seriesDates.map((hit) => {
                    const cents = series.type === "income" ? toCents(hit.amount) : -toCents(hit.amount);
                    return (
                      <button
                        key={hit.originalDate}
                        type="button"
                        onClick={() => {
                          const item = series;
                          setSeries(null);
                          setOne({
                            item,
                            event: hitToEvent(item, hit),
                            date: hit.date,
                          });
                        }}
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-3 text-left"
                      >
                        <span className="text-sm text-fg">
                          {formatLongDate(hit.date)}
                          {hit.skipped ? (
                            <span className="ml-1 text-[10px] uppercase text-muted">skipped</span>
                          ) : hit.date !== hit.originalDate ? (
                            <span className="ml-1 text-[10px] uppercase text-muted">moved</span>
                          ) : hit.overridden ? (
                            <span className="ml-1 text-[10px] uppercase text-muted">adj</span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-sm tabular",
                            hit.skipped
                              ? "text-muted line-through"
                              : series.type === "income"
                                ? "text-income"
                                : "text-bill",
                          )}
                        >
                          {formatSigned(cents)}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-3 text-sm text-muted">No dates in this look-ahead.</p>
                )}
              </div>
              <Button variant="secondary" onClick={() => openSeriesForm(series)}>
                Edit the whole series
              </Button>
              <Button variant="ghost" onClick={() => setSeries(null)}>
                Close
              </Button>
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>

      <Drawer open={!!one} onOpenChange={(o) => !o && setOne(null)}>
        <DrawerContent title={one?.event.name ?? "This date"}>
          {one ? (
            <OccurrenceEditor
              event={one.event}
              date={one.date}
              item={one.item}
              onClose={() => setOne(null)}
              onEditSeries={() => openSeriesForm(one.item)}
              onSkip={async () => {
                await setOverride({
                  itemId: one.event.itemId,
                  originalDate: one.event.originalDate,
                  kind: "skip",
                  amount: null,
                  movedDate: null,
                });
                setOne(null);
              }}
              onSave={async (amount, payDate) => {
                const originalDate = one.event.originalDate;
                await setOverride({
                  itemId: one.event.itemId,
                  originalDate,
                  kind: payDate !== originalDate ? "move" : "amount",
                  amount,
                  movedDate: payDate !== originalDate ? payDate : null,
                });
                setOne(null);
              }}
              onClear={async () => {
                await removeOverride(one.event.itemId, one.event.originalDate);
                setOne(null);
              }}
            />
          ) : null}
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