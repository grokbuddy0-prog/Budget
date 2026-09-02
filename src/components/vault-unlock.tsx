import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { rememberVaultToken } from "@/lib/crypto/client";
import { unlockVault } from "@/lib/server/vault";

export function VaultUnlock({ onUnlocked }: { onUnlocked: (recoveryKey: string | null) => void }) {
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await unlockVault({
        data: { password: password || undefined, recoveryKey: recoveryKey || undefined },
      });
      rememberVaultToken(res.vaultToken);
      onUnlocked(res.recoveryKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-medium tracking-tight">Unlock ledger</h1>
      <p className="mt-1 text-sm text-muted">
        Your balances are encrypted. Enter the same password you signed in with,
        or a recovery key.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </Field>
        <Field label="Recovery key">
          <Input
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            autoComplete="off"
            placeholder="If you lost the password"
          />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}

export function RecoveryKeyCard({
  recoveryKey,
  onDone,
}: {
  recoveryKey: string;
  onDone: () => void;
}) {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-medium tracking-tight">Save this recovery key</h1>
      <p className="mt-1 text-sm text-muted">
        Shown once. If you lose your password and this key, this ledger cannot
        be recovered.
      </p>
      <p className="mt-4 break-all rounded-md bg-surface px-3 py-3 font-mono text-sm text-fg">
        {recoveryKey}
      </p>
      <Button className="mt-4" onClick={onDone}>
        I saved it
      </Button>
    </div>
  );
}
