import {
  addDays,
  addMonths,
  clampDay,
  parseIso,
  toIso,
  weekdayUtc,
  type IsoDate,
} from "./dates";
import type { CashflowItem, OccurrenceOverride } from "./types";

const MAX_OCCURRENCES = 800;

function inRange(
  iso: IsoDate,
  start: IsoDate,
  rangeEnd: IsoDate,
  itemEnd: IsoDate | null,
): boolean {
  if (iso < start) return false;
  if (iso > rangeEnd) return false;
  if (itemEnd && iso > itemEnd) return false;
  return true;
}

function snapToWeekday(from: IsoDate, weekday: number): IsoDate {
  let d = from;
  for (let i = 0; i < 7; i += 1) {
    if (weekdayUtc(d) === weekday) return d;
    d = addDays(d, 1);
  }
  return from;
}

function everyNDays(
  first: IsoDate,
  step: number,
  start: IsoDate,
  rangeEnd: IsoDate,
  itemEnd: IsoDate | null,
): IsoDate[] {
  const dates: IsoDate[] = [];
  let d = first;
  while (d < start) d = addDays(d, step);
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    if (d > rangeEnd) break;
    if (itemEnd && d > itemEnd) break;
    if (d >= start) dates.push(d);
    d = addDays(d, step);
  }
  return dates;
}

function monthlyLike(
  start: IsoDate,
  dueDay: number,
  stepMonths: number,
  rangeEnd: IsoDate,
  itemEnd: IsoDate | null,
): IsoDate[] {
  const s = parseIso(start);
  let y = s.y;
  let m = s.m;
  const dates: IsoDate[] = [];
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    const day = clampDay(y, m, dueDay);
    const iso = toIso(y, m, day);
    if (iso > rangeEnd) break;
    if (itemEnd && iso > itemEnd) break;
    if (iso >= start) dates.push(iso);
    const next = addMonths(toIso(y, m, 1), stepMonths);
    const n = parseIso(next);
    y = n.y;
    m = n.m;
  }
  return dates;
}

function semimonthly(
  start: IsoDate,
  dayA: number,
  dayB: number,
  rangeEnd: IsoDate,
  itemEnd: IsoDate | null,
): IsoDate[] {
  const a = Math.min(dayA, dayB);
  const b = Math.max(dayA, dayB);
  const s = parseIso(start);
  let y = s.y;
  let m = s.m;
  const dates: IsoDate[] = [];
  for (let i = 0; i < 240; i += 1) {
    for (const due of [a, b]) {
      const iso = toIso(y, m, clampDay(y, m, due));
      if (!inRange(iso, start, rangeEnd, itemEnd)) continue;
      dates.push(iso);
      if (dates.length >= MAX_OCCURRENCES) return dates;
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (toIso(y, m, 1) > rangeEnd) break;
  }
  return dates;
}

function dueDayFor(item: CashflowItem): number {
  if (item.dueDay && item.dueDay >= 1 && item.dueDay <= 31) return item.dueDay;
  return parseIso(item.startDate).d;
}

function weekdayFor(item: CashflowItem): number {
  if (item.weekday != null && item.weekday >= 0 && item.weekday <= 6) {
    return item.weekday;
  }
  return weekdayUtc(item.anchorDate ?? item.startDate);
}

/**
 * Occurrence calendar dates for one item, inclusive of rangeEnd,
 * on or after the item start, on or before an optional item end.
 */
export function occurrencesForItem(
  item: CashflowItem,
  rangeEnd: IsoDate,
): IsoDate[] {
  if (item.paused) return [];
  const start = item.startDate;
  const itemEnd = item.endDate;
  if (itemEnd && itemEnd < start) return [];
  if (start > rangeEnd) return [];

  switch (item.frequency) {
    case "one_time":
      return inRange(start, start, rangeEnd, itemEnd) ? [start] : [];
    case "weekly":
      return everyNDays(
        snapToWeekday(start, weekdayFor(item)),
        7,
        start,
        rangeEnd,
        itemEnd,
      );
    case "biweekly": {
      const anchor = item.anchorDate ?? start;
      const first = snapToWeekday(anchor, weekdayFor(item));
      return everyNDays(first, 14, start, rangeEnd, itemEnd);
    }
    case "semimonthly": {
      const d1 = item.semiDay1 && item.semiDay1 >= 1 ? item.semiDay1 : 1;
      const d2 = item.semiDay2 && item.semiDay2 >= 1 ? item.semiDay2 : 15;
      return semimonthly(start, d1, d2, rangeEnd, itemEnd);
    }
    case "monthly":
      return monthlyLike(start, dueDayFor(item), 1, rangeEnd, itemEnd);
    case "quarterly":
      return monthlyLike(start, dueDayFor(item), 3, rangeEnd, itemEnd);
    case "yearly":
      return monthlyLike(start, dueDayFor(item), 12, rangeEnd, itemEnd);
    default:
      return [];
  }
}

export function nextOccurrence(
  item: CashflowItem,
  onOrAfter: IsoDate,
  rangeEnd: IsoDate,
): IsoDate | null {
  const dates = occurrencesForItem(item, rangeEnd);
  for (const d of dates) {
    if (d >= onOrAfter) return d;
  }
  return null;
}

export type SeriesHit = {
  date: IsoDate;
  originalDate: IsoDate;
  amount: number;
  overridden: boolean;
  skipped: boolean;
};

/** Upcoming postings for one series, including skipped dates. */
export function seriesHits(
  item: CashflowItem,
  overrides: OccurrenceOverride[],
  fromDate: IsoDate,
  toDate: IsoDate,
): SeriesHit[] {
  const byOriginal = new Map<string, OccurrenceOverride>();
  for (const o of overrides) {
    if (o.itemId === item.id) byOriginal.set(o.originalDate, o);
  }
  const out: SeriesHit[] = [];
  for (const originalDate of occurrencesForItem(item, toDate)) {
    if (originalDate < fromDate) continue;
    const o = byOriginal.get(originalDate);
    if (!o) {
      out.push({
        date: originalDate,
        originalDate,
        amount: item.amount,
        overridden: false,
        skipped: false,
      });
      continue;
    }
    if (o.kind === "skip") {
      out.push({
        date: originalDate,
        originalDate,
        amount: item.amount,
        overridden: true,
        skipped: true,
      });
      continue;
    }
    out.push({
      date: o.kind === "move" ? (o.movedDate ?? originalDate) : originalDate,
      originalDate,
      amount: o.amount ?? item.amount,
      overridden: true,
      skipped: false,
    });
  }
  return out;
}

export const FREQUENCY_LABEL: Record<CashflowItem["frequency"], string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  one_time: "One time",
};
