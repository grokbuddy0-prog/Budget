import type { IsoDate } from "./dates";

export const FREQUENCIES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
] as const;

export type Frequency = (typeof FREQUENCIES)[number];
export type ItemType = "income" | "bill";
export type OverrideKind = "skip" | "amount" | "move";
export type ProjectionMonths = 3 | 6 | 12;

export type CashflowItem = {
  id: string;
  name: string;
  type: ItemType;
  /** Always a positive dollar amount. */
  amount: number;
  frequency: Frequency;
  startDate: IsoDate;
  endDate: IsoDate | null;
  dueDay: number | null;
  semiDay1: number | null;
  semiDay2: number | null;
  weekday: number | null;
  anchorDate: IsoDate | null;
  accountLabel: string;
  paused: boolean;
};

export type OccurrenceOverride = {
  id: string;
  itemId: string;
  originalDate: IsoDate;
  kind: OverrideKind;
  amount: number | null;
  movedDate: IsoDate | null;
};

export type UserSettings = {
  startingBalance: number;
  startingBalanceDate: IsoDate;
  currency: string;
  projectionMonths: ProjectionMonths;
  isAdmin: boolean;
};

export type DayEvent = {
  itemId: string;
  name: string;
  type: ItemType;
  accountLabel: string;
  /** Signed cents: income positive, bills negative. */
  amountCents: number;
  originalDate: IsoDate;
  overridden: boolean;
  skipped: boolean;
};

export type DayProjection = {
  date: IsoDate;
  events: DayEvent[];
  endingCents: number;
};

export type Projection = {
  days: DayProjection[];
  openingCents: number;
  endingCents: number;
  min: { date: IsoDate; cents: number } | null;
  firstNegative: { date: IsoDate; cents: number } | null;
  inflowCents: number;
  outflowCents: number;
};
