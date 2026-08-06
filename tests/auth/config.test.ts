import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { getAuthConfig } from "../../server/auth/config";

const environmentNames = [
  "MONGODB_URI",
  "MONGODB_DATABASE",
  "OPENBUCKET_AUTH_SECRET",
  "OPENBUCKET_ALLOW_SIGNUP",
  "OPENBUCKET_ADMIN_EMAIL",
  "OPENBUCKET_ADMIN_PASSWORD",
  "OPENBUCKET_GOOGLE_CLIENT_ID",
  "OPENBUCKET_GOOGLE_CLIENT_SECRET",
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
  delete process.env.OPENBUCKET_ALLOW_SIGNUP;
  delete process.env.OPENBUCKET_ADMIN_EMAIL;
  delete process.env.OPENBUCKET_ADMIN_PASSWORD;
  delete process.env.OPENBUCKET_GOOGLE_CLIENT_ID;
  delete process.env.OPENBUCKET_GOOGLE_CLIENT_SECRET;
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
  test("self-serve signup is open by default and can be closed explicitly", () => {
    baseline();
    assert.equal(getAuthConfig().allowSignup, true);

    process.env.OPENBUCKET_ALLOW_SIGNUP = "false";
    assert.equal(getAuthConfig().allowSignup, false);

    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    assert.equal(getAuthConfig().allowSignup, true);
  });

  test("environment-based admin requires both email and password, and a minimum password length", () => {
    baseline();
    assert.equal(getAuthConfig().adminEmail, null);
    assert.equal(getAuthConfig().adminPassword, null);

    process.env.OPENBUCKET_ADMIN_EMAIL = "admin@example.test";
    assert.throws(() => getAuthConfig(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AUTH_CONFIG_ADMIN_CREDENTIALS_INCOMPLETE");
      return true;
    });

    process.env.OPENBUCKET_ADMIN_PASSWORD = "too-short";
    assert.throws(() => getAuthConfig(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AUTH_CONFIG_ADMIN_PASSWORD_TOO_SHORT");
      return true;
    });

    process.env.OPENBUCKET_ADMIN_PASSWORD = "at-least-twelve-characters";
    const config = getAuthConfig();
    assert.equal(config.adminEmail, "admin@example.test");
    assert.equal(config.adminPassword?.toString("utf8"), "at-least-twelve-characters");
  });

  test("Google sign-in is only enabled once both the client id and secret are set", () => {
    baseline();
    assert.equal(getAuthConfig().googleClientId, null);

    process.env.OPENBUCKET_GOOGLE_CLIENT_ID = "client-id";
    assert.equal(getAuthConfig().googleClientId, null, "requires the secret too");

    process.env.OPENBUCKET_GOOGLE_CLIENT_SECRET = "client-secret";
    const config = getAuthConfig();
    assert.equal(config.googleClientId, "client-id");
    assert.equal(config.googleClientSecret, "client-secret");
  });

  test("attaches non-sensitive diagnostic codes to invalid configuration", () => {
    baseline();
    process.env.OPENBUCKET_AUTH_SECRET = "too-short";
    assert.throws(() => getAuthConfig(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "AUTH_CONFIG_AUTH_SECRET_TOO_SHORT");
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
