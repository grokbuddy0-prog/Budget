import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, hkdfSync } from "node:crypto";

export const KDF_N = 16384;
export const KDF_R = 8;
export const KDF_P = 1;
export const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

export function isCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v1.");
}

export function encryptString(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptString(key: Buffer, blob: string): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid ciphertext");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const encrypted = Buffer.from(parts[2] ?? "", "base64url");
  const tag = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Invalid ciphertext");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function newDek(): Buffer {
  return randomBytes(KEY_LEN);
}

export function wrapKey(kek: Buffer, dek: Buffer): string {
  return encryptString(kek, dek.toString("base64url"));
}

export function unwrapKey(kek: Buffer, wrapped: string): Buffer {
  return Buffer.from(decryptString(kek, wrapped), "base64url");
}

export async function kdfFromPassword(
  password: string,
  salt: Buffer,
  n = KDF_N,
  r = KDF_R,
  p = KDF_P,
): Promise<Buffer> {
  const out = await new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
  return out;
}

export function kdfFromSecret(secret: string, info: string, salt = "fb"): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, info, KEY_LEN));
}

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function encryptCents(key: Buffer, dollars: number): string {
  const cents = Math.round(dollars * 100);
  return encryptString(key, String(cents));
}

export function decryptCents(key: Buffer, blob: string): number {
  const cents = Number(decryptString(key, blob));
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
}

export function decryptTextField(key: Buffer, enc: string | null | undefined, fallback: string): string {
  if (enc && isCiphertext(enc)) return decryptString(key, enc);
  return fallback;
}

export function decryptMoneyField(key: Buffer, enc: string | null | undefined, fallback: unknown): number {
  if (enc && isCiphertext(enc)) return decryptCents(key, enc);
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  if (typeof fallback === "string" && fallback !== "" && !isCiphertext(fallback)) {
    const n = Number(fallback);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function makeRecoveryKey(): string {
  return `fbrec_${randomBytes(24).toString("base64url")}`;
}
