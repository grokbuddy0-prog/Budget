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
import { rememberVaultToken } from "@/lib/crypto/client";
import { RecoveryKeyCard, VaultUnlock } from "@/components/vault-unlock";

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
  alertProjection: Projection;
  refresh: () => Promise<void>;
  saveUserSettings: (s: {
    startingBalance: number;
    startingBalanceDate: string;
    projectionMonths: ProjectionMonths;
    balanceView?: UserSettings["balanceView"];
    alertThreshold?: number;
    accounts?: UserSettings["accounts"];
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
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
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
      } else if (message.includes("VaultLocked")) {
        setError("VaultLocked");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("fb.recovery-once");
      if (pending) setRecoveryKey(pending);
    } catch {
      /* private mode */
    }
    void refresh();
  }, [refresh]);

  const alertProjection = useMemo(() => {
    const startDate = settings?.startingBalanceDate ?? today;
    const startBal = settings?.startingBalance ?? 0;
    const fromDate = startDate > today ? startDate : today;
    return projectCashflow({
      startingBalance: startBal,
      startingDate: startDate,
      items,
      overrides,
      fromDate,
      toDate: windowEnd(fromDate, 12),
    });
  }, [settings, items, overrides, today]);

  const projection = useMemo(() => {
    if (months === 12) return alertProjection;
    const startDate = settings?.startingBalanceDate ?? today;
    const startBal = settings?.startingBalance ?? 0;
    const fromDate = startDate > today ? startDate : today;
    return projectCashflow({
      startingBalance: startBal,
      startingDate: startDate,
      items,
      overrides,
      fromDate,
      toDate: windowEnd(fromDate, months),
    });
  }, [alertProjection, settings, items, overrides, months, today]);

  const saveUserSettings = useCallback(
    async (s: {
      startingBalance: number;
      startingBalanceDate: string;
      projectionMonths: ProjectionMonths;
      balanceView?: UserSettings["balanceView"];
      alertThreshold?: number;
      accounts?: UserSettings["accounts"];
      claimAdmin?: boolean;
    }) => {
      const prev = settings;
      const balanceView = s.balanceView ?? prev?.balanceView ?? "every_day";
      const alertThreshold = s.alertThreshold ?? prev?.alertThreshold ?? 0;
      const accounts = s.accounts ?? prev?.accounts ?? [];
      setSettings({
        startingBalance: s.startingBalance,
        startingBalanceDate: s.startingBalanceDate,
        currency: "USD",
        projectionMonths: s.projectionMonths,
        balanceView,
        alertThreshold,
        accounts,
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
      alertProjection,
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
      alertProjection,
      refresh,
      saveUserSettings,
      saveItem,
      removeItem,
      setOverride,
      removeOverride,
    ],
  );

  if (error === "VaultLocked") {
    return (
      <div className="mx-auto min-h-dvh w-full max-w-lg bg-bg">
        <VaultUnlock
          onUnlocked={(key) => {
            if (key) setRecoveryKey(key);
            setLoading(true);
            void refresh();
          }}
        />
      </div>
    );
  }

  if (recoveryKey) {
    return (
      <div className="mx-auto min-h-dvh w-full max-w-lg bg-bg">
        <RecoveryKeyCard
          recoveryKey={recoveryKey}
          onDone={() => {
            try {
              sessionStorage.removeItem("fb.recovery-once");
            } catch {
              /* private mode */
            }
            setRecoveryKey(null);
          }}
        />
      </div>
    );
  }

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
