import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createSessionToken,
  hashPassword,
  keyedHash,
  passwordParameters,
  verifyPassword,
} from "../../server/auth/crypto";

describe("authentication cryptography", () => {
  test("hashes and verifies passwords with versioned scrypt parameters", async () => {
    const password = "correct horse battery staple";
    const encoded = await hashPassword(password);
    assert.match(encoded, /^scrypt\$v=1\$n=65536,r=8,p=2\$/);
    assert.equal(encoded.includes(password), false);
    assert.equal(await verifyPassword(password, encoded), true);
    assert.equal(await verifyPassword(`${password}!`, encoded), false);
    assert.equal(await verifyPassword(password, "not-a-password-hash"), false);
    assert.deepEqual(passwordParameters, {
      version: 1,
      n: 65_536,
      r: 8,
      p: 2,
      saltBytes: 24,
      keyBytes: 64,
    });
  });

  test("generates high-entropy opaque session tokens and purpose-separated hashes", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);

    const secret = Buffer.from("unit-test-auth-secret-that-is-at-least-32-bytes", "utf8");
    assert.equal(keyedHash(secret, "session", first), keyedHash(secret, "session", first));
    assert.notEqual(keyedHash(secret, "session", first), keyedHash(secret, "rate", first));
    assert.match(keyedHash(secret, "session", first), /^[a-f0-9]{64}$/);
  });
});
