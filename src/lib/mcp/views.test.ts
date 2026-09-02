import assert from "node:assert/strict";
import { test } from "node:test";
import type { CashflowItem } from "../cashflow/types.ts";
import { getOverviewView, getWhatIfView, listUpcomingView, type BudgetSnapshot } from "./views.ts";

function item(
  partial: Pick<CashflowItem, "id" | "name" | "type" | "amount" | "frequency" | "startDate"> &
    Partial<CashflowItem>,
): CashflowItem {
  return {
    endDate: null,
    dueDay: null,
    semiDay1: null,
    semiDay2: null,
    weekday: null,
    anchorDate: null,
    accountLabel: "Checking",
    paused: false,
    ...partial,
  };
}

const snap: BudgetSnapshot = {
  settings: {
    startingBalance: 1000,
    startingBalanceDate: "2026-09-01",
    currency: "USD",
    projectionMonths: 6,
    balanceView: "every_day",
    isAdmin: true,
  },
  items: [
    item({
      id: "rent",
      name: "Rent",
      type: "bill",
      amount: 400,
      frequency: "one_time",
      startDate: "2026-09-10",
    }),
  ],
  overrides: [],
};

test("overview uses the same projection engine and reports the 30-day low", () => {
  const view = getOverviewView(snap, "2026-09-01");
  assert.equal(view.today_balance.cents, 100000);
  assert.equal(view.lowest_30?.date, "2026-09-10");
  assert.equal(view.lowest_30?.cents, 60000);
  assert.equal(view.cushion.cents, 40000);
  assert.equal(view.next_7_hits.length, 0);
});

test("what-if changes the low without mutating the snapshot", () => {
  const before = snap.items[0]?.amount;
  const view = getWhatIfView(snap, "2026-09-01", "rent", 700);
  assert.equal(snap.items[0]?.amount, before);
  assert.equal(view.saved, false);
  assert.equal(view.current_lowest_30?.cents, 60000);
  assert.equal(view.what_if_lowest_30?.cents, 30000);
  assert.equal(view.delta_cents, -30000);
});

test("upcoming includes the hit and the ending balance", () => {
  const view = listUpcomingView(snap, "2026-09-01", 14);
  const hit = view.days.find((d) => d.date === "2026-09-10");
  assert.ok(hit);
  assert.equal(hit?.ending.cents, 60000);
  assert.equal(hit?.items[0]?.id, "rent");
  assert.equal(hit?.items[0]?.amount_cents, -40000);
});
