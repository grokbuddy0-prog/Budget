import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useBudget, type ItemDraft } from "@/components/budget-provider";
import { ItemForm, NAME_PRESETS } from "@/components/item-form";
import { OccurrenceEditor } from "@/components/occurrence-editor";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  formatLongDate,
  formatMoney,
  formatShortDate,
  formatSigned,
  monthTitle,
  parseIso,
  todayLocalIso,
  weekdayShort,
  type CashflowItem,
  type DayEvent,
  type DayProjection,
  type ProjectionMonths,
} from "@/lib/cashflow";
import { cn } from "@/lib/utils";

function todayBalance(days: DayProjection[], today: string): number | null {
  const hit = days.find((d) => d.date === today);
  if (hit) return hit.endingCents;
  return days[0]?.endingCents ?? null;
}

export function DailyLedger() {
  const {
    projection,
    months,
    setMonths,
    today,
    settings,
    items,
    saveItem,
    removeItem,
    setOverride,
    removeOverride,
  } = useBudget();
  const [activityOnly, setActivityOnly] = useState(
    () => settings?.balanceView === "activity",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CashflowItem | null>(null);
  const [event, setEvent] = useState<{ day: DayProjection; ev: DayEvent } | null>(null);
  const [preset, setPreset] = useState<Partial<ItemDraft> | undefined>();

  const visible = useMemo(
    () => (activityOnly ? projection.days.filter((d) => d.events.length > 0) : projection.days),
    [activityOnly, projection.days],
  );

  const groups = useMemo(() => {
    const out: { title: string; days: DayProjection[] }[] = [];
    for (const day of visible) {
      const title = monthTitle(day.date);
      const last = out[out.length - 1];
      if (!last || last.title !== title) out.push({ title, days: [day] });
      else last.days.push(day);
    }
    return out;
  }, [visible]);

  const heroCents = todayBalance(projection.days, today) ?? projection.endingCents;
  const heroNegative = heroCents < 0;

  function openNew(p?: Partial<ItemDraft>) {
    setEditing(null);
    setPreset(p);
    setFormOpen(true);
  }

  return (
    <div>
      <section className="px-4 pb-3 pt-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
          {settings?.startingBalanceDate === today
            ? "Today"
            : `From ${formatShortDate(settings?.startingBalanceDate ?? today)}`}
        </p>
        <p
          className={cn(
            "mt-1 font-mono text-4xl font-medium leading-none tracking-tight tabular",
            heroNegative ? "text-danger" : "text-fg",
          )}
        >
          {formatMoney(heroCents)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {projection.firstNegative ? (
            <span className="text-danger">
              Goes negative {formatLongDate(projection.firstNegative.date)}
            </span>
          ) : projection.min ? (
            <span>
              Low {formatMoney(projection.min.cents)} on {formatLongDate(projection.min.date)}
            </span>
          ) : (
            "No days in this window"
          )}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-surface px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted">In</p>
            <p className="font-mono tabular text-income">{formatSigned(projection.inflowCents)}</p>
          </div>
          <div className="rounded-md bg-surface px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted">Out</p>
            <p className="font-mono tabular text-bill">{formatSigned(projection.outflowCents)}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {([3, 6, 12] as ProjectionMonths[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonths(m)}
              className={cn(
                "h-9 rounded-md px-3 text-sm font-medium",
                months === m ? "bg-primary text-primary-fg" : "bg-surface text-muted",
              )}
            >
              {m} mo
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActivityOnly((v) => !v)}
            className={cn(
              "ml-auto h-9 rounded-md px-3 text-sm",
              activityOnly ? "bg-surface-2 text-fg" : "text-muted",
            )}
          >
            {activityOnly ? "Activity" : "Every day"}
          </button>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyLedger onPick={(p) => openNew(p)} />
      ) : (
        <div className="pb-4">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="sticky top-12 z-10 bg-bg/95 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted backdrop-blur-sm">
                {g.title}
              </h2>
              <ol>
                {g.days.map((day) => (
                  <DayRow
                    key={day.date}
                    day={day}
                    today={today}
                    onEvent={(ev) => setEvent({ day, ev })}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => openNew()}
        className="fixed bottom-24 right-[max(1rem,calc(50%-15.5rem))] z-20 flex size-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-[var(--shadow-sheet)]"
        aria-label="Add item"
      >
        <Plus className="size-6" />
      </button>

      <Drawer
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) {
            setEditing(null);
            setPreset(undefined);
          }
        }}
      >
        <DrawerContent title={editing ? "Edit item" : "Add item"}>
          <ItemForm
            initial={editing ?? preset}
            onCancel={() => setFormOpen(false)}
            onSave={async (draft) => {
              await saveItem(draft);
              setFormOpen(false);
            }}
            onDelete={
              editing
                ? async () => {
                    await removeItem(editing.id);
                    setFormOpen(false);
                  }
                : undefined
            }
          />
        </DrawerContent>
      </Drawer>

      <Drawer open={!!event} onOpenChange={(o) => !o && setEvent(null)}>
        <DrawerContent title={event?.ev.name ?? "Occurrence"}>
          {event ? (
            <OccurrenceEditor
              event={event.ev}
              date={event.day.date}
              item={items.find((i) => i.id === event.ev.itemId)}
              onClose={() => setEvent(null)}
              onEditSeries={() => {
                const it = items.find((i) => i.id === event.ev.itemId);
                setEvent(null);
                if (it) {
                  setEditing(it);
                  setFormOpen(true);
                }
              }}
              onSkip={async () => {
                await setOverride({
                  itemId: event.ev.itemId,
                  originalDate: event.ev.originalDate,
                  kind: "skip",
                  amount: null,
                  movedDate: null,
                });
                setEvent(null);
              }}
              onAmount={async (amount) => {
                await setOverride({
                  itemId: event.ev.itemId,
                  originalDate: event.ev.originalDate,
                  kind: "amount",
                  amount,
                  movedDate: null,
                });
                setEvent(null);
              }}
              onClear={async () => {
                await removeOverride(event.ev.itemId, event.ev.originalDate);
                setEvent(null);
              }}
            />
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function EmptyLedger({ onPick }: { onPick: (p: Partial<ItemDraft>) => void }) {
  return (
    <div className="px-4 py-6">
      <p className="text-sm text-muted">
        Add a paycheck and the bills that leave checking. Every future day will
        show the running balance.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {NAME_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onPick(p)}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-fg"
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function DayRow({
  day,
  today,
  onEvent,
}: {
  day: DayProjection;
  today: string;
  onEvent: (ev: DayEvent) => void;
}) {
  const isToday = day.date === today;
  const negative = day.endingCents < 0;
  const { d } = parseIso(day.date);
  const quiet = day.events.length === 0;

  return (
    <li
      className={cn(
        "border-b border-border/70 px-4 py-2",
        isToday && "bg-surface",
        negative && "bg-danger/8",
      )}
    >
      <div className="flex items-baseline gap-3">
        <div className="w-10 shrink-0">
          <p className={cn("font-mono text-base tabular leading-none", isToday ? "text-fg" : "text-muted")}>
            {d}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-subtle">
            {isToday ? "Today" : weekdayShort(day.date)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          {quiet ? (
            <p className="text-sm text-subtle">—</p>
          ) : (
            <ul className="space-y-0.5">
              {day.events.map((ev) => (
                <li key={`${ev.itemId}-${ev.originalDate}`}>
                  <button
                    type="button"
                    onClick={() => onEvent(ev)}
                    className="flex w-full items-baseline justify-between gap-2 text-left"
                  >
                    <span className="truncate text-sm text-fg">
                      {ev.name}
                      {ev.overridden ? (
                        <span className="ml-1 text-[10px] uppercase text-muted">adj</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-sm tabular",
                        ev.amountCents >= 0 ? "text-income" : "text-bill",
                      )}
                    >
                      {formatSigned(ev.amountCents)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p
          className={cn(
            "w-[6.75rem] shrink-0 text-right font-mono text-sm tabular",
            negative ? "text-danger" : "text-fg",
            quiet && "text-muted",
          )}
        >
          {formatMoney(day.endingCents)}
        </p>
      </div>
    </li>
  );
}

export { todayLocalIso };
