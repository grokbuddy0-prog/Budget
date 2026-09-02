import {
  addDays,
  formatMoney,
  nextOccurrence,
  projectCashflow,
  toCents,
  type CashflowItem,
  type IsoDate,
  type OccurrenceOverride,
  type UserSettings,
} from "@/lib/cashflow";

export type BudgetSnapshot = {
  settings: UserSettings | null;
  items: CashflowItem[];
  overrides: OccurrenceOverride[];
};

function money(cents: number) {
  return { cents, usd: formatMoney(cents) };
}

function eventJson(e: {
  itemId: string;
  name: string;
  type: string;
  amountCents: number;
}) {
  return {
    id: e.itemId,
    name: e.name,
    type: e.type,
    amount_cents: e.amountCents,
    usd: formatMoney(e.amountCents),
  };
}

function projectFrom(
  snap: BudgetSnapshot,
  today: IsoDate,
  toDate: IsoDate,
) {
  const settings = snap.settings;
  if (!settings) {
    throw new Error("No budget set. Open Forward Balance and enter a starting balance.");
  }
  const fromDate = settings.startingBalanceDate > today ? settings.startingBalanceDate : today;
  return projectCashflow({
    startingBalance: settings.startingBalance,
    startingDate: settings.startingBalanceDate,
    items: snap.items,
    overrides: snap.overrides,
    fromDate,
    toDate,
  });
}

export function getOverviewView(snap: BudgetSnapshot, today: IsoDate) {
  const settings = snap.settings;
  if (!settings) {
    throw new Error("No budget set. Open Forward Balance and enter a starting balance.");
  }
  const end30 = addDays(today, 29);
  const proj = projectFrom(snap, today, end30);
  const todayRow = proj.days.find((d) => d.date === today) ?? proj.days[0];
  const todayCents = todayRow?.endingCents ?? toCents(settings.startingBalance);
  const min = proj.min;
  const thresholdCents = toCents(settings.alertThreshold);
  const firstBelow =
    thresholdCents > 0 ? proj.days.find((d) => d.endingCents < thresholdCents) : undefined;
  const cushionCents = min ? todayCents - min.cents : 0;
  const end7 = addDays(today, 6);
  const hits = proj.days
    .filter((d) => d.date <= end7 && d.events.length > 0)
    .map((d) => ({
      date: d.date,
      ending: money(d.endingCents),
      items: d.events.map(eventJson),
    }));
  return {
    as_of: today,
    starting_balance: money(toCents(settings.startingBalance)),
    starting_balance_date: settings.startingBalanceDate,
    today_balance: money(todayCents),
    cushion: money(cushionCents),
    alert_threshold: money(thresholdCents),
    below_threshold: firstBelow
      ? { date: firstBelow.date, ...money(firstBelow.endingCents) }
      : null,
    lowest_30: min ? { date: min.date, ...money(min.cents) } : null,
    next_7_hits: hits,
  };
}

export function listUpcomingView(snap: BudgetSnapshot, today: IsoDate, days: number) {
  const n = Math.min(Math.max(1, Math.floor(days)), 365);
  const toDate = addDays(today, n - 1);
  const proj = projectFrom(snap, today, toDate);
  return {
    as_of: today,
    days: proj.days.map((d) => ({
      date: d.date,
      ending: money(d.endingCents),
      items: d.events.map(eventJson),
    })),
  };
}

export function listRecurringView(snap: BudgetSnapshot, today: IsoDate) {
  const horizon = addDays(today, 400);
  return {
    items: snap.items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      amount_cents: toCents(item.amount),
      usd: formatMoney(toCents(item.amount)),
      frequency: item.frequency,
      next_date: nextOccurrence(item, today, horizon),
      enabled: !item.paused,
      due_day: item.dueDay,
      start_date: item.startDate,
    })),
  };
}

export function getWhatIfView(
  snap: BudgetSnapshot,
  today: IsoDate,
  recurringId: string,
  newAmount: number,
) {
  const item = snap.items.find((i) => i.id === recurringId);
  if (!item) throw new Error("recurring_id not found");
  const end30 = addDays(today, 29);
  const current = projectFrom(snap, today, end30);
  const nextItems = snap.items.map((i) =>
    i.id === recurringId ? { ...i, amount: newAmount } : i,
  );
  const next = projectFrom({ ...snap, items: nextItems }, today, end30);
  return {
    recurring_id: item.id,
    name: item.name,
    saved: false,
    current_amount: money(toCents(item.amount)),
    new_amount: money(toCents(newAmount)),
    current_lowest_30: current.min
      ? { date: current.min.date, ...money(current.min.cents) }
      : null,
    what_if_lowest_30: next.min
      ? { date: next.min.date, ...money(next.min.cents) }
      : null,
    delta_cents: (next.min?.cents ?? 0) - (current.min?.cents ?? 0),
  };
}
