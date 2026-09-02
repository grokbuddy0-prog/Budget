import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, List, Settings } from "lucide-react";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Balance", icon: CalendarDays },
  { to: "/items", label: "Items", icon: List },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, isPending } = useCurrentUserState();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-sm">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
            Forward Balance
          </p>
          <p className="truncate text-sm text-fg">
            {isPending ? " " : (user?.displayName ?? user?.primaryEmail ?? "Checking")}
          </p>
        </div>
        <div className="shrink-0 [&_button]:h-9 [&_button]:rounded-md [&_button]:border [&_button]:border-border [&_button]:bg-surface [&_button]:px-3 [&_button]:text-xs [&_button]:text-fg">
          {isPending ? (
            <div className="h-9 w-16 animate-pulse rounded-md bg-surface-2" />
          ) : (
            <UserButton />
          )}
        </div>
      </header>
      <main className="flex-1 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-border bg-surface/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <ul className="grid grid-cols-3">
          {NAV.map((item) => {
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                    active ? "text-fg" : "text-muted",
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg px-4 pt-10">
      <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
      <div className="mt-6 h-10 w-48 animate-pulse rounded bg-surface-2" />
      <div className="mt-2 h-4 w-36 animate-pulse rounded bg-surface-2" />
      <div className="mt-8 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}

/** Wait briefly for the session, then send unsigned visitors to sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [giveUp, setGiveUp] = useState(false);

  useEffect(() => {
    if (!isPending) {
      setGiveUp(false);
      return;
    }
    const t = window.setTimeout(() => setGiveUp(true), 3500);
    return () => window.clearTimeout(t);
  }, [isPending]);

  if (isPending && !giveUp) return <PageSkeleton />;
  if (!user) return <RedirectToSignIn />;
  return <>{children}</>;
}
