import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { vaultMiddleware } from "@/lib/crypto/middleware";
import {
  clearVaultCookie,
  rewrapWithPassword,
  unlockWithSecret,
} from "@/lib/crypto/vault.server";

export const unlockVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        password: z.string().optional(),
        recoveryKey: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    return unlockWithSecret(context.userId, data);
  });

export const lockVault = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    clearVaultCookie();
    return { ok: true as const };
  });

export const rewrapVaultPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware, vaultMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        currentPassword: z.string().min(8),
        newPassword: z.string().min(8),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const dek = (context as { dek: Buffer }).dek;
    return rewrapWithPassword(context.userId, dek, data.currentPassword, data.newPassword);
  });
