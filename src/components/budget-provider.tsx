import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  projectCashflow,
  todayLocalIso,
  windowEnd,
  type CashflowItem,
  type OccurrenceOverride,
  type Projection,
  type ProjectionMonths,
  type UserSettings,
} from "@/lib/cashflow";
import {
  clearOverride,
  deleteItem,
  getBudget,
  saveSettings,
  upsertItem,
  upsertOverride,
} from "@/lib/server/budget";

export type ItemDraft = Omit<CashflowItem, "id"> & { id?: string };

type BudgetContextValue = {
  loading: boolean;
  error: string | null;
  settings: UserSettings | null;
  items: CashflowItem[];
  overrides: OccurrenceOverride[];
  months: ProjectionMonths;
  setMonths: (m: ProjectionMonths) => void;
  today: string;
  projection: Projection;
  refresh: () => Promise<void>;
  saveUserSettings: (s: {
    startingBalance: number;
    startingBalanceDate: string;
    projectionMonths: ProjectionMonths;
    balanceView?: UserSettings["balanceView"];
    alertThreshold?: number;
    claimAdmin?: boolean;
  }) => Promise<void>;
  saveItem: (draft: ItemDraft) => Promise<string>;
  removeItem: (id: string) => Promise<void>;
  setOverride: (o: {
    itemId: string;
    originalDate: string;
    kind: OccurrenceOverride["kind"];
    amount: number | null;
    movedDate: string | null;
  }) => Promise<void>;
  removeOverride: (itemId: string, originalDate: string) => Promise<void>;
};

const BudgetContext = createContext<BudgetContextValue | null>(null);

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [items, setItems] = useState<CashflowItem[]>([]);
  const [overrides, setOverrides] = useState<OccurrenceOverride[]>([]);
  const [months, setMonths] = useState<ProjectionMonths>(6);
  const today = todayLocalIso();

  const refresh = useCallback(async () => {
    try {
      const data = await getBudget();
      setSettings(data.settings);
      setItems(data.items);
      setOverrides(data.overrides);
      if (data.settings) setMonths(data.settings.projectionMonths);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load budget";
      if (message === "Unauthorized") {
        setError("Unauthorized");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projection = useMemo(() => {
    const startDate = settings?.startingBalanceDate ?? today;
    const startBal = settings?.startingBalance ?? 0;
    const fromDate = startDate > today ? startDate : today;
    const toDate = windowEnd(fromDate, months);
    return projectCashflow({
      startingBalance: startBal,
      startingDate: startDate,
      items,
      overrides,
      fromDate,
      toDate,
    });
  }, [settings, items, overrides, months, today]);

  const saveUserSettings = useCallback(
    async (s: {
      startingBalance: number;
      startingBalanceDate: string;
      projectionMonths: ProjectionMonths;
      balanceView?: UserSettings["balanceView"];
      alertThreshold?: number;
      claimAdmin?: boolean;
    }) => {
      const prev = settings;
      const balanceView = s.balanceView ?? prev?.balanceView ?? "every_day";
      const alertThreshold = s.alertThreshold ?? prev?.alertThreshold ?? 0;
      setSettings({
        startingBalance: s.startingBalance,
        startingBalanceDate: s.startingBalanceDate,
        currency: "USD",
        projectionMonths: s.projectionMonths,
        balanceView,
        alertThreshold,
        isAdmin: prev?.isAdmin ?? false,
      });
      setMonths(s.projectionMonths);
      try {
        const res = await saveSettings({
          data: { ...s, balanceView, alertThreshold },
        });
        setSettings((cur) =>
          cur ? { ...cur, isAdmin: res.isAdmin || cur.isAdmin } : cur,
        );
      } catch (err) {
        setSettings(prev);
        toast.error(err instanceof Error ? err.message : "Could not save");
        throw err;
      }
    },
    [settings],
  );

  const saveItem = useCallback(async (draft: ItemDraft) => {
    const id = draft.id ?? crypto.randomUUID();
    const next: CashflowItem = { ...draft, id };
    setItems((cur) => {
      const idx = cur.findIndex((i) => i.id === id);
      if (idx === -1) return [...cur, next];
      const copy = cur.slice();
      copy[idx] = next;
      return copy;
    });
    try {
      const res = await upsertItem({ data: { ...draft, id } });
      return res.id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save item");
      await refresh();
      throw err;
    }
  }, [refresh]);

  const removeItem = useCallback(
    async (id: string) => {
      const prevItems = items;
      const prevOverrides = overrides;
      setItems((cur) => cur.filter((i) => i.id !== id));
      setOverrides((cur) => cur.filter((o) => o.itemId !== id));
      try {
        await deleteItem({ data: { id } });
      } catch (err) {
        setItems(prevItems);
        setOverrides(prevOverrides);
        toast.error(err instanceof Error ? err.message : "Could not delete");
        throw err;
      }
    },
    [items, overrides],
  );

  const setOverride = useCallback(
    async (o: {
      itemId: string;
      originalDate: string;
      kind: OccurrenceOverride["kind"];
      amount: number | null;
      movedDate: string | null;
    }) => {
      const id = crypto.randomUUID();
      const next: OccurrenceOverride = { id, ...o };
      setOverrides((cur) => {
        const rest = cur.filter(
          (x) => !(x.itemId === o.itemId && x.originalDate === o.originalDate),
        );
        return [...rest, next];
      });
      try {
        await upsertOverride({ data: o });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update");
        await refresh();
        throw err;
      }
    },
    [refresh],
  );

  const removeOverride = useCallback(
    async (itemId: string, originalDate: string) => {
      setOverrides((cur) =>
        cur.filter((x) => !(x.itemId === itemId && x.originalDate === originalDate)),
      );
      try {
        await clearOverride({ data: { itemId, originalDate } });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not clear");
        await refresh();
        throw err;
      }
    },
    [refresh],
  );

  const value = useMemo<BudgetContextValue>(
    () => ({
      loading,
      error,
      settings,
      items,
      overrides,
      months,
      setMonths,
      today,
      projection,
      refresh,
      saveUserSettings,
      saveItem,
      removeItem,
      setOverride,
      removeOverride,
    }),
    [
      loading,
      error,
      settings,
      items,
      overrides,
      months,
      today,
      projection,
      refresh,
      saveUserSettings,
      saveItem,
      removeItem,
      setOverride,
      removeOverride,
    ],
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
