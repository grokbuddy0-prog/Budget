import { addDays, addMonths, maxIso, type IsoDate } from "./dates";
import { toCents } from "./money";
import { occurrencesForItem } from "./schedule";
import type {
  CashflowItem,
  DayEvent,
  DayProjection,
  OccurrenceOverride,
  Projection,
  ProjectionMonths,
} from "./types";

function signedCents(type: CashflowItem["type"], dollars: number): number {
  const cents = toCents(dollars);
  return type === "income" ? cents : -cents;
}

type Posted = {
  item: CashflowItem;
  date: IsoDate;
  originalDate: IsoDate;
  amount: number;
  overridden: boolean;
};

function postingsForItem(
  item: CashflowItem,
  rangeEnd: IsoDate,
  overrides: OccurrenceOverride[],
): Posted[] {
  const dates = occurrencesForItem(item, rangeEnd);
  const byOriginal = new Map<string, OccurrenceOverride>();
  for (const o of overrides) {
    if (o.itemId === item.id) byOriginal.set(o.originalDate, o);
  }

  const posted: Posted[] = [];
  for (const originalDate of dates) {
    const o = byOriginal.get(originalDate);
    if (!o) {
      posted.push({
        item,
        date: originalDate,
        originalDate,
        amount: item.amount,
        overridden: false,
      });
      continue;
    }
    if (o.kind === "skip") continue;
    if (o.kind === "move") {
      const moved = o.movedDate ?? originalDate;
      posted.push({
        item,
        date: moved,
        originalDate,
        amount: o.amount ?? item.amount,
        overridden: true,
      });
      continue;
    }
    posted.push({
      item,
      date: originalDate,
      originalDate,
      amount: o.amount ?? item.amount,
      overridden: true,
    });
  }
  return posted;
}

function eventFrom(p: Posted): DayEvent {
  return {
    itemId: p.item.id,
    name: p.item.name,
    type: p.item.type,
    accountLabel: p.item.accountLabel,
    amountCents: signedCents(p.item.type, p.amount),
    originalDate: p.originalDate,
    overridden: p.overridden,
    skipped: false,
  };
}

function sortEvents(a: DayEvent, b: DayEvent): number {
  if (a.type !== b.type) return a.type === "income" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Walk the calendar from the as-of date, applying every item.
 * `fromDate`/`toDate` slice what the UI shows; the running balance
 * always starts at `startingBalance` on `startingDate`.
 */
export function projectCashflow(args: {
  startingBalance: number;
  startingDate: IsoDate;
  items: CashflowItem[];
  overrides: OccurrenceOverride[];
  fromDate: IsoDate;
  toDate: IsoDate;
}): Projection {
  const { startingBalance, startingDate, items, overrides } = args;
  const fromDate = maxIso(args.fromDate, startingDate);
  const toDate = args.toDate < fromDate ? fromDate : args.toDate;
  const computeEnd = toDate;

  const buckets = new Map<IsoDate, DayEvent[]>();
  for (const item of items) {
    if (item.paused) continue;
    for (const p of postingsForItem(item, computeEnd, overrides)) {
      if (p.date < startingDate || p.date > computeEnd) continue;
      const list = buckets.get(p.date) ?? [];
      list.push(eventFrom(p));
      buckets.set(p.date, list);
    }
  }
  for (const list of buckets.values()) list.sort(sortEvents);

  let bal = toCents(startingBalance);
  const openingCents = bal;
  const days: DayProjection[] = [];
  let min: Projection["min"] = null;
  let firstNegative: Projection["firstNegative"] = null;
  let inflowCents = 0;
  let outflowCents = 0;

  let cursor = startingDate;
  while (cursor <= computeEnd) {
    const events = buckets.get(cursor) ?? [];
    for (const e of events) {
      bal += e.amountCents;
      if (cursor >= fromDate) {
        if (e.amountCents > 0) inflowCents += e.amountCents;
        else outflowCents += e.amountCents;
      }
    }
    if (cursor >= fromDate) {
      days.push({ date: cursor, events, endingCents: bal });
      if (!min || bal < min.cents) min = { date: cursor, cents: bal };
      if (bal < 0 && !firstNegative) firstNegative = { date: cursor, cents: bal };
    }
    cursor = addDays(cursor, 1);
    if (days.length > 800) break;
  }

  return {
    days,
    openingCents,
    endingCents: days.length ? (days[days.length - 1]?.endingCents ?? bal) : bal,
    min,
    firstNegative,
    inflowCents,
    outflowCents,
  };
}

export function windowEnd(fromDate: IsoDate, months: ProjectionMonths): IsoDate {
  return addDays(addMonths(fromDate, months), -1);
}
