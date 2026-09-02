/** Calendar dates as YYYY-MM-DD. All math is UTC so a date never shifts TZ. */

export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO.test(value);
}

export function parseIso(iso: IsoDate): { y: number; m: number; d: number } {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return { y, m, d };
}

export function toIso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayLocalIso(): IsoDate {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function clampDay(y: number, m: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(y, m));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const { y, m, d } = parseIso(iso);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const yy = dt.getUTCFullYear();
  const mm = dt.getUTCMonth() + 1;
  return toIso(yy, mm, clampDay(yy, mm, d));
}

/** 0 = Sunday … 6 = Saturday (UTC calendar). */
export function weekdayUtc(iso: IsoDate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function weekdayShort(iso: IsoDate): string {
  return WEEKDAYS[weekdayUtc(iso)] ?? "";
}

export function weekdayLong(n: number): string {
  return WEEKDAYS_LONG[((n % 7) + 7) % 7] ?? "";
}

export function monthTitle(iso: IsoDate): string {
  const { y, m } = parseIso(iso);
  return `${MONTHS[m - 1] ?? ""} ${y}`;
}

export function dayNumber(iso: IsoDate): number {
  return parseIso(iso).d;
}

export function formatShortDate(iso: IsoDate): string {
  const { m, d } = parseIso(iso);
  return `${m}/${d}`;
}

export function formatLongDate(iso: IsoDate): string {
  const { y, m, d } = parseIso(iso);
  return `${MONTHS[m - 1] ?? ""} ${d}, ${y}`;
}
