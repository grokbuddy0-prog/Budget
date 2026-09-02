import { createFileRoute } from "@tanstack/react-router";
import { AppShell, RequireAuth } from "@/components/app-shell";
import { BudgetProvider, useBudget } from "@/components/budget-provider";
import { DailyLedger } from "@/components/daily-ledger";
import { Onboarding } from "@/components/onboarding";
import { RedirectToSignIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <RequireAuth>
      <BudgetProvider>
        <AppShell>
          <HomeBody />
        </AppShell>
      </BudgetProvider>
    </RequireAuth>
  );
}

function HomeBody() {
  const { loading, error, settings } = useBudget();
  if (loading) {
    return (
      <div className="px-4 pt-6 space-y-2">
        <div className="h-10 w-48 animate-pulse rounded bg-surface-2" />
        <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (error === "Unauthorized") return <RedirectToSignIn />;
  if (error) {
    return <p className="px-4 pt-6 text-sm text-danger">{error}</p>;
  }
  if (!settings) return <Onboarding />;
  return <DailyLedger />;
}
