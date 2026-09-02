import { createMiddleware } from "@tanstack/react-start";

export const VAULT_TOKEN_KEY = "fb.vault-token";

/**
 * Requires authMiddleware first. Puts the unwrapped per-user DEK on context
 * for this request only. Never writes the DEK to the database.
 */
export const vaultMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let vaultToken: string | undefined;
    try {
      vaultToken = sessionStorage.getItem(VAULT_TOKEN_KEY) ?? undefined;
    } catch {
      vaultToken = undefined;
    }
    return next({ sendContext: { vaultToken } });
  })
  .server(async ({ next, context }) => {
    const { readRequestDek, VAULT_LOCKED } = await import("./vault.server");
    const userId = (context as { userId?: string }).userId;
    if (!userId) throw new Error("Unauthorized");
    const dek = readRequestDek(userId, (context as { vaultToken?: string }).vaultToken);
    if (!dek) throw new Error(VAULT_LOCKED);
    return next({ context: { userId, dek } });
  });
