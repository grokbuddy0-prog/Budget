import { VAULT_TOKEN_KEY } from "./middleware";

export function rememberVaultToken(token: string | null | undefined) {
  if (!token) return;
  try {
    sessionStorage.setItem(VAULT_TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearVaultToken() {
  try {
    sessionStorage.removeItem(VAULT_TOKEN_KEY);
  } catch {
    /* private mode */
  }
}
