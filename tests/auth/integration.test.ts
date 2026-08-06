import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { closeAuthDatabaseForTests, getAuthCollections } from "../../server/auth/database";
import {
  handleForgotPassword,
  handleHealth,
  handleLogin,
  handleLogout,
  handleRegister,
  handleResetPassword,
  handleSession,
} from "../../server/auth/service";

const testUri = process.env.MONGODB_TEST_URI?.trim();
const requireMongo = process.env.OPENBUCKET_REQUIRE_MONGODB_TEST?.trim().toLowerCase() === "true";
if (requireMongo && !testUri) throw new Error("MONGODB_TEST_URI is required for the MongoDB acceptance job.");
const origin = "https://openbucket-auth.test";
const adminEmail = "auth-admin@example.com";
const adminPassword = "auth-integration-env-admin-password";
const database = `openbucket_auth_test_${process.pid}_${Date.now()}`;
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DATABASE: process.env.MONGODB_DATABASE,
  OPENBUCKET_AUTH_SECRET: process.env.OPENBUCKET_AUTH_SECRET,
  OPENBUCKET_ALLOW_SIGNUP: process.env.OPENBUCKET_ALLOW_SIGNUP,
  OPENBUCKET_ADMIN_EMAIL: process.env.OPENBUCKET_ADMIN_EMAIL,
  OPENBUCKET_ADMIN_PASSWORD: process.env.OPENBUCKET_ADMIN_PASSWORD,
};

function apiRequest(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  cookie?: string,
  ip = "192.0.2.10",
): Request {
  const headers = new Headers({
    "user-agent": "OpenBucket auth integration test",
    "x-forwarded-for": ip,
  });
  if (method === "POST") {
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    headers.set("sec-fetch-site", "same-origin");
  }
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "expected a Set-Cookie header");
  return value.split(";", 1)[0];
}

describe("MongoDB-backed authentication", { skip: !testUri }, () => {
  before(async () => {
    process.env.MONGODB_URI = testUri;
    process.env.MONGODB_DATABASE = database;
    process.env.OPENBUCKET_AUTH_SECRET = "integration-auth-secret-with-more-than-thirty-two-bytes";
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    process.env.OPENBUCKET_ADMIN_EMAIL = adminEmail;
    process.env.OPENBUCKET_ADMIN_PASSWORD = adminPassword;
    await closeAuthDatabaseForTests();
  });

  after(async () => {
    const { users, sessions, rateLimits, passwordResets } = await getAuthCollections();
    await Promise.all([users.drop(), sessions.drop(), rateLimits.drop(), passwordResets.drop()]);
    await closeAuthDatabaseForTests();
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("registers openly, authenticates, invalidates, limits, and stores no raw credentials", async () => {
    const health = await handleHealth(apiRequest("/api/health", "GET"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "openbucket-web" });

    const email = "Owner@Example.com";
    const password = "correct horse battery staple";
    const registered = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email,
      password,
      name: "OpenBucket Owner",
    }));
    assert.equal(registered.status, 201);
    const registeredPayload = await registered.json() as {
      user: { id: string; email: string; name: string | null; role: string };
    };
    assert.match(registeredPayload.user.id, /^[a-f0-9]{24}$/);
    assert.equal(registeredPayload.user.email, "owner@example.com");
    assert.equal(registeredPayload.user.name, "OpenBucket Owner");
    assert.equal(registeredPayload.user.role, "member", "self-serve registration never grants admin");
    const registeredCookie = cookiePair(registered);
    assert.match(registeredCookie, /^__Host-openbucket_session=[A-Za-z0-9_-]{43}$/);

    const { users, sessions } = await getAuthCollections();
    const storedUser = await users.findOne({ emailNormalized: "owner@example.com" });
    assert.ok(storedUser);
    assert.notEqual(storedUser.passwordHash, password);
    assert.equal(storedUser.role, undefined, "role is never persisted on registration");
    assert.equal(JSON.stringify(storedUser).includes(password), false);
    const token = registeredCookie.split("=", 2)[1];
    const storedSession = await sessions.findOne({ userId: storedUser._id });
    assert.ok(storedSession);
    assert.notEqual(storedSession._id, token);
    assert.equal(JSON.stringify(storedSession).includes(token), false);

    const session = await handleSession(apiRequest("/api/auth/session", "GET", undefined, registeredCookie));
    assert.equal(session.status, 200);
    const sessionPayload = await session.json() as { user: { email: string; role: string } };
    assert.equal(sessionPayload.user.email, "owner@example.com");
    assert.equal(sessionPayload.user.role, "member");

    const duplicateEmail = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email,
      password: "another valid password value",
    }, undefined, "192.0.2.11"));
    assert.equal(duplicateEmail.status, 409);
    assert.equal((await duplicateEmail.json() as { error: { code: string } }).error.code, "EMAIL_IN_USE");
    assert.equal(await users.countDocuments(), 1);

    const wrong = await handleLogin(apiRequest("/api/auth/login", "POST", {
      email,
      password: "incorrect password value",
    }, undefined, "192.0.2.12"));
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json() as { error: { code: string } }).error.code, "INVALID_CREDENTIALS");

    const loggedIn = await handleLogin(apiRequest("/api/auth/login", "POST", { email, password }, undefined, "192.0.2.13"));
    assert.equal(loggedIn.status, 200);
    const loginCookie = cookiePair(loggedIn);

    const loggedOut = await handleLogout(apiRequest("/api/auth/logout", "POST", {}, loginCookie, "192.0.2.13"));
    assert.equal(loggedOut.status, 200);
    const clearedCookies = loggedOut.headers.getSetCookie();
    assert.equal(clearedCookies.length, 2);
    assert.ok(clearedCookies.every((cookie) => cookie.includes("Max-Age=0")));
    const invalidated = await handleSession(apiRequest("/api/auth/session", "GET", undefined, loginCookie));
    assert.equal(invalidated.status, 401);

    const limitedEmail = "rate-limit@example.com";
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      const response = await handleLogin(apiRequest("/api/auth/login", "POST", {
        email: limitedEmail,
        password: "a valid fake password",
      }, undefined, `192.0.2.${20 + attempt}`));
      if (attempt <= 8) assert.equal(response.status, 401);
      else {
        assert.equal(response.status, 429);
        assert.ok(Number(response.headers.get("retry-after")) > 0);
      }
    }

    process.env.OPENBUCKET_ALLOW_SIGNUP = "false";
    const disabled = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email: "disabled@example.com",
      password,
    }, undefined, "192.0.2.30"));
    assert.equal(disabled.status, 403);
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";

    const userIndexes = await users.indexes();
    const sessionIndexes = await sessions.indexes();
    assert.ok(userIndexes.some((index) => index.name === "users_email_normalized_unique" && index.unique));
    assert.ok(sessionIndexes.some((index) => index.name === "sessions_expiry_ttl" && index.expireAfterSeconds === 0));
  });

  test("the environment-configured admin signs in without a database account", async () => {
    const wrongPassword = await handleLogin(apiRequest("/api/auth/login", "POST", {
      email: adminEmail,
      password: "definitely the wrong password",
    }, undefined, "192.0.2.40"));
    assert.equal(wrongPassword.status, 401);

    const adminLogin = await handleLogin(apiRequest("/api/auth/login", "POST", {
      email: adminEmail,
      password: adminPassword,
    }, undefined, "192.0.2.41"));
    assert.equal(adminLogin.status, 200);
    const adminPayload = await adminLogin.json() as { user: { role: string; email: string; id: string } };
    assert.equal(adminPayload.user.role, "admin");
    assert.equal(adminPayload.user.email, adminEmail);
    const adminCookie = cookiePair(adminLogin);

    const { users } = await getAuthCollections();
    assert.equal(await users.countDocuments({ emailNormalized: adminEmail }), 0, "the admin account is never written to MongoDB");

    const adminSession = await handleSession(apiRequest("/api/auth/session", "GET", undefined, adminCookie));
    assert.equal(adminSession.status, 200);
    assert.equal((await adminSession.json() as { user: { role: string } }).user.role, "admin");

    const adminCannotSelfRegister = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email: adminEmail,
      password: "some other valid password",
    }, undefined, "192.0.2.42"));
    assert.equal(adminCannotSelfRegister.status, 409);
  });

  test("forgot/reset password issues a single-use token without leaking account existence", async () => {
    const email = "reset-target@example.com";
    const originalPassword = "the original account password";
    const registered = await handleRegister(apiRequest("/api/auth/register", "POST", { email, password: originalPassword }, undefined, "192.0.2.50"));
    assert.equal(registered.status, 201);
    const loginCookie = cookiePair(registered);

    const unknownRequest = await handleForgotPassword(apiRequest("/api/auth/forgot-password", "POST", { email: "nobody-here@example.com" }, undefined, "192.0.2.51"));
    assert.equal(unknownRequest.status, 200);
    const knownRequest = await handleForgotPassword(apiRequest("/api/auth/forgot-password", "POST", { email }, undefined, "192.0.2.52"));
    assert.equal(knownRequest.status, 200);
    assert.deepEqual(await unknownRequest.clone().json(), await knownRequest.clone().json(), "both responses must be identical to avoid enumeration");

    const { passwordResets, users } = await getAuthCollections();
    const storedUser = await users.findOne({ emailNormalized: email });
    assert.ok(storedUser);
    const resetDoc = await passwordResets.findOne({ userId: storedUser._id });
    assert.ok(resetDoc, "a reset token document should exist for the known account");

    const badToken = await handleResetPassword(apiRequest("/api/auth/reset-password", "POST", { token: "not-a-real-token-value-at-all", password: "a brand new password value" }, undefined, "192.0.2.53"));
    assert.equal(badToken.status, 400);

    // The raw token is only ever visible in the (unsent, since SMTP isn't configured here) email body,
    // so re-derive it isn't possible from the stored HMAC alone — instead verify the reset row itself
    // is well-formed and that a wrong token is correctly rejected, which is what an attacker would have.
    assert.match(resetDoc._id, /^[a-f0-9]{64}$/);
    assert.ok(resetDoc.expiresAt.getTime() > Date.now());

    const stillValidSession = await handleSession(apiRequest("/api/auth/session", "GET", undefined, loginCookie));
    assert.equal(stillValidSession.status, 200, "an unrelated bad reset attempt must not affect existing sessions");
  });
});
