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
export type ProjectionMonths = 1 | 3 | 6 | 12;
export type BalanceView = "every_day" | "activity";

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

export type BankAccount = {
  id: string;
  name: string;
  balance: number;
};

export type UserSettings = {
  startingBalance: number;
  startingBalanceDate: IsoDate;
  currency: string;
  projectionMonths: ProjectionMonths;
  balanceView: BalanceView;
  alertThreshold: number;
  accounts: BankAccount[];
  isAdmin: boolean;
};

export function sumAccounts(accounts: BankAccount[]): number {
  return accounts.reduce((n, a) => n + Math.round(a.balance * 100), 0) / 100;
}

export function defaultAccounts(startingBalance: number): BankAccount[] {
  return [{ id: "checking", name: "Checking", balance: startingBalance }];
}

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
