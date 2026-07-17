import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { getAuthConfig } from "../../server/auth/config";

const environmentNames = [
  "MONGODB_URI",
  "MONGODB_DATABASE",
  "OPENBUCKET_AUTH_SECRET",
  "OPENBUCKET_ALLOW_SIGNUP",
  "OPENBUCKET_SIGNUP_TOKEN",
  "NODE_ENV",
  "VERCEL_ENV",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, process.env[name]]),
) as Record<(typeof environmentNames)[number], string | undefined>;
const mutableEnvironment = process.env as Record<string, string | undefined>;

function baseline(): void {
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017";
  process.env.MONGODB_DATABASE = "openbucket_config_test";
  process.env.OPENBUCKET_AUTH_SECRET = "config-auth-secret-with-at-least-thirty-two-bytes";
  process.env.OPENBUCKET_ALLOW_SIGNUP = "false";
  delete process.env.OPENBUCKET_SIGNUP_TOKEN;
  mutableEnvironment.NODE_ENV = "test";
  delete process.env.VERCEL_ENV;
}

afterEach(() => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete mutableEnvironment[name];
    else mutableEnvironment[name] = value;
  }
});

describe("hosted authentication configuration", () => {
  test("requires an independent high-entropy token only during owner bootstrap", () => {
    baseline();
    assert.equal(getAuthConfig().signupToken, null);

    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    assert.throws(() => getAuthConfig(), /OPENBUCKET_SIGNUP_TOKEN is required/);

    process.env.OPENBUCKET_SIGNUP_TOKEN = "too-short";
    assert.throws(() => getAuthConfig(), /at least 32 UTF-8 bytes/);

    process.env.OPENBUCKET_SIGNUP_TOKEN = process.env.OPENBUCKET_AUTH_SECRET;
    assert.throws(() => getAuthConfig(), /must differ/);

    process.env.OPENBUCKET_SIGNUP_TOKEN = "config-signup-token-with-at-least-thirty-two-bytes";
    assert.equal(getAuthConfig().signupToken?.toString("utf8"), process.env.OPENBUCKET_SIGNUP_TOKEN);
  });

  test("attaches non-sensitive diagnostic codes to invalid configuration", () => {
    baseline();
    process.env.OPENBUCKET_AUTH_SECRET = "too-short";
    assert.throws(() => getAuthConfig(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AUTH_CONFIG_AUTH_SECRET_TOO_SHORT");
      return true;
    });

    baseline();
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    process.env.OPENBUCKET_SIGNUP_TOKEN = "too-short";
    assert.throws(() => getAuthConfig(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AUTH_CONFIG_SIGNUP_TOKEN_TOO_SHORT");
      return true;
    });
  });

  test("accepts common environment assignment wrappers around a MongoDB URI", () => {
    baseline();
    process.env.MONGODB_URI = 'MONGODB_URI="mongodb+srv://example.test/openbucket"';

    assert.equal(getAuthConfig().mongodbUri, "mongodb+srv://example.test/openbucket");

    process.env.MONGODB_URI = "uri:mongodb://127.0.0.1:27017/openbucket";
    assert.equal(getAuthConfig().mongodbUri, "mongodb://127.0.0.1:27017/openbucket");
  });

  test("requires TLS for non-loopback production MongoDB servers", () => {
    baseline();
    mutableEnvironment.NODE_ENV = "production";
    process.env.MONGODB_URI = "mongodb://database.example.test:27017/openbucket";
    assert.throws(() => getAuthConfig(), /must use TLS/);

    process.env.MONGODB_URI = "mongodb://database.example.test:27017/openbucket?tls=true";
    assert.equal(getAuthConfig().mongodbUri, process.env.MONGODB_URI);

    process.env.MONGODB_URI = "mongodb://[::1]:27017/openbucket";
    assert.equal(getAuthConfig().mongodbUri, process.env.MONGODB_URI);

    process.env.MONGODB_URI = "mongodb+srv://example.test/openbucket";
    assert.equal(getAuthConfig().mongodbUri, process.env.MONGODB_URI);
  });
});
