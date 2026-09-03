import assert from "node:assert/strict";
import { test } from "node:test";
import { occurrencesForItem } from "./schedule.ts";
import { projectCashflow } from "./project.ts";
import type { CashflowItem } from "./types.ts";

function item(partial: Partial<CashflowItem> & Pick<CashflowItem, "id" | "name" | "type" | "amount" | "frequency" | "startDate">): CashflowItem {
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

test("monthly 31st clamps to end of February", () => {
  const rent = item({
    id: "rent",
    name: "Rent",
    type: "bill",
    amount: 1200,
    frequency: "monthly",
    startDate: "2026-01-31",
    dueDay: 31,
  });
  const dates = occurrencesForItem(rent, "2026-04-30");
  assert.deepEqual(dates, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("monthly due day before start date skips that month", () => {
  const car = item({
    id: "car",
    name: "Car",
    type: "bill",
    amount: 400,
    frequency: "monthly",
    startDate: "2026-01-20",
    dueDay: 5,
  });
  const dates = occurrencesForItem(car, "2026-03-31");
  assert.deepEqual(dates, ["2026-02-05", "2026-03-05"]);
});

test("semimonthly 1 and 15", () => {
  const pay = item({
    id: "pay",
    name: "Paycheck",
    type: "income",
    amount: 1800,
    frequency: "semimonthly",
    startDate: "2026-09-01",
    semiDay1: 1,
    semiDay2: 15,
  });
  const dates = occurrencesForItem(pay, "2026-10-15");
  assert.deepEqual(dates, ["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15"]);
});

test("biweekly from Friday anchor", () => {
  const pay = item({
    id: "pay",
    name: "Paycheck",
    type: "income",
    amount: 1842,
    frequency: "biweekly",
    startDate: "2026-09-04",
    weekday: 5,
    anchorDate: "2026-09-04",
  });
  const dates = occurrencesForItem(pay, "2026-10-16");
  assert.deepEqual(dates, ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"]);
});

test("one-time and end_date stop a series", () => {
  const once = item({
    id: "once",
    name: "Laptop",
    type: "bill",
    amount: 900,
    frequency: "one_time",
    startDate: "2026-09-10",
  });
  assert.deepEqual(occurrencesForItem(once, "2026-12-31"), ["2026-09-10"]);

  const ins = item({
    id: "ins",
    name: "Insurance",
    type: "bill",
    amount: 110,
    frequency: "monthly",
    startDate: "2026-01-15",
    endDate: "2026-03-01",
    dueDay: 15,
  });
  assert.deepEqual(occurrencesForItem(ins, "2026-06-30"), ["2026-01-15", "2026-02-15"]);
});

test("projection applies income then bills and tracks the min", () => {
  const items: CashflowItem[] = [
    item({
      id: "pay",
      name: "Paycheck",
      type: "income",
      amount: 2000,
      frequency: "one_time",
      startDate: "2026-09-02",
    }),
    item({
      id: "rent",
      name: "Rent",
      type: "bill",
      amount: 1500,
      frequency: "one_time",
      startDate: "2026-09-02",
    }),
    item({
      id: "car",
      name: "Car",
      type: "bill",
      amount: 800,
      frequency: "one_time",
      startDate: "2026-09-04",
    }),
  ];
  const proj = projectCashflow({
    startingBalance: 500,
    startingDate: "2026-09-01",
    items,
    overrides: [],
    fromDate: "2026-09-01",
    toDate: "2026-09-04",
  });
  assert.equal(proj.days[0]?.endingCents, 50000);
  assert.equal(proj.days[1]?.endingCents, 100000);
  assert.equal(proj.days[1]?.events[0]?.name, "Paycheck");
  assert.equal(proj.days[3]?.endingCents, 20000);
  assert.equal(proj.min?.cents, 20000);
  assert.equal(proj.min?.date, "2026-09-04");
});

test("skip override removes a posting; amount override changes it", () => {
  const rent = item({
    id: "rent",
    name: "Rent",
    type: "bill",
    amount: 1000,
    frequency: "monthly",
    startDate: "2026-01-01",
    dueDay: 1,
  });
  const proj = projectCashflow({
    startingBalance: 3000,
    startingDate: "2026-01-01",
    items: [rent],
    overrides: [
      {
        id: "o1",
        itemId: "rent",
        originalDate: "2026-02-01",
        kind: "skip",
        amount: null,
        movedDate: null,
      },
      {
        id: "o2",
        itemId: "rent",
        originalDate: "2026-03-01",
        kind: "amount",
        amount: 1200,
        movedDate: null,
      },
    ],
    fromDate: "2026-01-01",
    toDate: "2026-03-01",
  });
  const jan = proj.days.find((d) => d.date === "2026-01-01");
  const feb = proj.days.find((d) => d.date === "2026-02-01");
  const mar = proj.days.find((d) => d.date === "2026-03-01");
  assert.equal(jan?.events.length, 1);
  assert.equal(feb?.events.length, 0);
  assert.equal(mar?.events[0]?.amountCents, -120000);
  assert.equal(mar?.endingCents, 80000);
});

test("move override posts a bill on the new date only", () => {
  const rent = item({
    id: "rent",
    name: "Rent",
    type: "bill",
    amount: 1000,
    frequency: "monthly",
    startDate: "2026-01-01",
    dueDay: 1,
  });
  const proj = projectCashflow({
    startingBalance: 3000,
    startingDate: "2026-01-01",
    items: [rent],
    overrides: [
      {
        id: "o1",
        itemId: "rent",
        originalDate: "2026-02-01",
        kind: "move",
        amount: null,
        movedDate: "2026-01-28",
      },
    ],
    fromDate: "2026-01-01",
    toDate: "2026-02-01",
  });
  const jan1 = proj.days.find((d) => d.date === "2026-01-01");
  const jan28 = proj.days.find((d) => d.date === "2026-01-28");
  const feb1 = proj.days.find((d) => d.date === "2026-02-01");
  assert.equal(jan1?.events.length, 1);
  assert.equal(jan28?.events[0]?.name, "Rent");
  assert.equal(jan28?.events[0]?.originalDate, "2026-02-01");
  assert.equal(jan28?.endingCents, 100000);
  assert.equal(feb1?.events.length, 0);
});
