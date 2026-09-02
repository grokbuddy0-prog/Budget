import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { authClient, authEnabled } from "@/lib/auth/client";
import { rememberVaultToken } from "@/lib/crypto/client";
import { unlockVault } from "@/lib/server/vault";

/** Same key the auth client reads in the live-preview iframe. */
const PREVIEW_BEARER_KEY = "grok-auth.bearer-token";

function rememberSessionToken(data: unknown) {
  if (!data || typeof data !== "object") return;
  const token = (data as { token?: unknown }).token;
  if (typeof token !== "string" || token.length === 0) return;
  try {
    sessionStorage.setItem(PREVIEW_BEARER_KEY, token);
  } catch {
    /* private mode / blocked storage */
  }
}

async function refreshSession() {
  try {
    await authClient.getSession();
  } catch {
    /* store recovers on the next useSession fetch */
  }
}

export function AuthScreen({
  mode,
  title,
  subtitle,
  footer,
  onEmail,
}: {
  mode: "signin" | "signup" | "setup";
  title: string;
  subtitle: string;
  footer?: React.ReactNode;
  onEmail: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsName = mode !== "signin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onEmail({ name: name.trim() || email, email: email.trim(), password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center bg-bg px-5 py-10">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
        Forward Balance
      </p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm leading-snug text-muted">{subtitle}</p>

      <form className="mt-8 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        {needsName ? (
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </Field>
        ) : null}
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || !authEnabled} className="mt-1">
          {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "setup" ? "Create admin" : "Create account"}
        </Button>
      </form>

      {!authEnabled ? (
        <p className="mt-4 text-sm text-muted">Sign-in is disabled.</p>
      ) : null}

      {footer ? <div className="mt-8 text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

export async function emailSignIn(email: string, password: string) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message ?? "Sign-in failed");
  rememberSessionToken(data);
  await refreshSession();
  const vault = await unlockVault({ data: { password } });
  rememberVaultToken(vault.vaultToken);
  if (vault.recoveryKey) {
    try {
      sessionStorage.setItem("fb.recovery-once", vault.recoveryKey);
    } catch {
      /* private mode */
    }
  }
}

export async function emailSignUp(name: string, email: string, password: string) {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error) throw new Error(error.message ?? "Sign-up failed");
  rememberSessionToken(data);
  await refreshSession();
  const vault = await unlockVault({ data: { password } });
  rememberVaultToken(vault.vaultToken);
  if (vault.recoveryKey) {
    try {
      sessionStorage.setItem("fb.recovery-once", vault.recoveryKey);
    } catch {
      /* private mode */
    }
  }
}
