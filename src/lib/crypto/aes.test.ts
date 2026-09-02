import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptCents,
  decryptString,
  encryptCents,
  encryptString,
  isCiphertext,
  kdfFromPassword,
  makeRecoveryKey,
  newDek,
  newSalt,
  unwrapKey,
  wrapKey,
} from "./aes.ts";

test("AES-GCM round-trips text and rejects tampering", () => {
  const dek = newDek();
  const blob = encryptString(dek, "Rent");
  assert.equal(isCiphertext(blob), true);
  assert.equal(decryptString(dek, blob), "Rent");
  assert.throws(() => decryptString(dek, `${blob}x`));
});

test("money is stored as cents", () => {
  const dek = newDek();
  const blob = encryptCents(dek, 12.34);
  assert.equal(decryptCents(dek, blob), 12.34);
});

test("password KDF wraps a DEK", async () => {
  const dek = newDek();
  const salt = newSalt();
  const kek = await kdfFromPassword("correct horse", salt);
  const wrapped = wrapKey(kek, dek);
  const other = await kdfFromPassword("correct horse", salt);
  assert.equal(unwrapKey(other, wrapped).toString("hex"), dek.toString("hex"));
  const wrong = await kdfFromPassword("wrong", salt);
  assert.throws(() => unwrapKey(wrong, wrapped));
});

test("recovery key is high-entropy", () => {
  const a = makeRecoveryKey();
  const b = makeRecoveryKey();
  assert.match(a, /^fbrec_/);
  assert.notEqual(a, b);
});
