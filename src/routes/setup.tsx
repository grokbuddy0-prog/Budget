import { useEffect, useState } from "react";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { emailSignUp } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput, Input } from "@/components/ui/input";
import { parseDollars, todayLocalIso } from "@/lib/cashflow";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getBootstrapState, saveSettings } from "@/lib/server/budget";

export const Route = createFileRoute("/setup")({ component: Setup });

function Setup() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(todayLocalIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getBootstrapState()
      .then((s) => {
        if (!s.needsSetup) setBlocked(true);
      })
      .catch(() => {
        /* allow first-account form if we cannot check */
      });
  }, []);

  if (!isPending && user && blocked) return <Navigate to="/" />;

  if (blocked) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5">
        <h1 className="text-2xl font-medium">Setup already done</h1>
        <p className="mt-2 text-sm text-muted">
          An admin account exists. Sign in or create your own account.
        </p>
        <Button asChild className="mt-6">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseDollars(balance);
    if (amount == null) {
      setError("Enter the checking balance.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await emailSignUp(name.trim() || email, email.trim(), password);
      await saveSettings({
        data: {
          startingBalance: amount,
          startingBalanceDate: date,
          projectionMonths: 6,
          claimAdmin: true,
        },
      });
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center bg-bg px-5 py-10">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        Forward Balance
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-fg">First account</h1>
      <p className="mt-2 text-sm leading-snug text-muted">
        Creates the admin. After this, friends can sign up and only see their own
        money.
      </p>
      <form className="mt-8 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Current checking balance">
          <Input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="2847.12"
            className="font-mono tabular"
            required
          />
        </Field>
        <Field label="As of">
          <DateInput value={date} onValue={setDate} />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || !authEnabled} className="mt-1">
          {busy ? "Working…" : "Create admin"}
        </Button>
      </form>
      <p className="mt-8 text-sm text-muted">
        Already set up?{" "}
        <Link to="/login" className="text-fg underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}