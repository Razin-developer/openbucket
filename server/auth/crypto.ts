import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_VERSION = 1;
const SCRYPT_N = 2 ** 16;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 96 * 1024 * 1024;
const SALT_LENGTH = 24;
const PASSWORD_HASH_PATTERN = /^scrypt\$v=(\d+)\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function derivePassword(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, { N: n, r, p, maxmem: SCRYPT_MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await derivePassword(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$v=${SCRYPT_VERSION}$n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = PASSWORD_HASH_PATTERN.exec(encoded);
  if (!match) return false;

  const version = Number(match[1]);
  const n = Number(match[2]);
  const r = Number(match[3]);
  const p = Number(match[4]);
  const salt = Buffer.from(match[5], "base64url");
  const expected = Buffer.from(match[6], "base64url");
  if (
    version !== SCRYPT_VERSION ||
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n < SCRYPT_N ||
    n > SCRYPT_N ||
    r !== SCRYPT_R ||
    p !== SCRYPT_P ||
    salt.byteLength !== SALT_LENGTH ||
    expected.byteLength !== SCRYPT_KEY_LENGTH
  ) {
    return false;
  }

  try {
    const actual = await derivePassword(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function keyedHash(secret: Buffer, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(purpose).update("\0").update(value).digest("hex");
}

export function secretMatches(secret: Buffer, purpose: string, supplied: string, expected: Buffer): boolean {
  const suppliedDigest = createHmac("sha256", secret).update(purpose).update("\0").update(supplied).digest();
  const expectedDigest = createHmac("sha256", secret).update(purpose).update("\0").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export const passwordParameters = Object.freeze({
  version: SCRYPT_VERSION,
  n: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  saltBytes: SALT_LENGTH,
  keyBytes: SCRYPT_KEY_LENGTH,
});
