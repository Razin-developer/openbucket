import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { closeAuthDatabaseForTests, getAuthCollections } from "../../server/auth/database";
import {
  handleHealth,
  handleLogin,
  handleLogout,
  handleRegister,
  handleSession,
} from "../../server/auth/service";

const testUri = process.env.MONGODB_TEST_URI?.trim();
const requireMongo = process.env.OPENBUCKET_REQUIRE_MONGODB_TEST?.trim().toLowerCase() === "true";
if (requireMongo && !testUri) throw new Error("MONGODB_TEST_URI is required for the MongoDB acceptance job.");
const signupToken = "integration-owner-bootstrap-token-with-more-than-thirty-two-bytes";
const origin = "https://openbucket-auth.test";
const database = `openbucket_auth_test_${process.pid}_${Date.now()}`;
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DATABASE: process.env.MONGODB_DATABASE,
  OPENBUCKET_AUTH_SECRET: process.env.OPENBUCKET_AUTH_SECRET,
  OPENBUCKET_SIGNUP_TOKEN: process.env.OPENBUCKET_SIGNUP_TOKEN,
  OPENBUCKET_ALLOW_SIGNUP: process.env.OPENBUCKET_ALLOW_SIGNUP,
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
    process.env.OPENBUCKET_SIGNUP_TOKEN = signupToken;
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    await closeAuthDatabaseForTests();
  });

  after(async () => {
    const { users, sessions, rateLimits, authControls } = await getAuthCollections();
    await Promise.all([users.drop(), sessions.drop(), rateLimits.drop(), authControls.drop()]);
    await closeAuthDatabaseForTests();
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("registers, authenticates, invalidates, limits, and stores no raw credentials", async () => {
    const health = await handleHealth(apiRequest("/api/health", "GET"));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "openbucket-web" });

    const email = "Owner@Example.com";
    const password = "correct horse battery staple";
    const invalidBootstrap = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email,
      password,
      signupToken: "invalid-bootstrap-token-with-more-than-thirty-two-bytes",
    }));
    assert.equal(invalidBootstrap.status, 403);
    assert.equal((await invalidBootstrap.json() as { error: { code: string } }).error.code, "SIGNUP_UNAVAILABLE");
    const bootstrapCollections = await getAuthCollections();
    await bootstrapCollections.authControls.insertOne({
      _id: "owner-bootstrap",
      status: "claiming",
      claimId: "abandoned-bootstrap-lease",
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    const registered = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email,
      password,
      name: "OpenBucket Owner",
      signupToken,
    }));
    assert.equal(registered.status, 201);
    const registeredPayload = await registered.json() as {
      user: { id: string; email: string; name: string | null; role: string };
    };
    assert.match(registeredPayload.user.id, /^[a-f0-9]{24}$/);
    assert.equal(registeredPayload.user.email, "owner@example.com");
    assert.equal(registeredPayload.user.name, "OpenBucket Owner");
    assert.equal(registeredPayload.user.role, "admin");
    const registeredCookie = cookiePair(registered);
    assert.match(registeredCookie, /^__Host-openbucket_session=[A-Za-z0-9_-]{43}$/);

    const { users, sessions, rateLimits, authControls } = await getAuthCollections();
    const storedUser = await users.findOne({ emailNormalized: "owner@example.com" });
    assert.ok(storedUser);
    assert.notEqual(storedUser.passwordHash, password);
    assert.equal(storedUser.role, "admin");
    assert.equal(JSON.stringify(storedUser).includes(password), false);
    const token = registeredCookie.split("=", 2)[1];
    const storedSession = await sessions.findOne({ userId: storedUser._id });
    assert.ok(storedSession);
    assert.notEqual(storedSession._id, token);
    assert.equal(JSON.stringify(storedSession).includes(token), false);
    const bootstrap = await authControls.findOne({ _id: "owner-bootstrap" });
    assert.ok(bootstrap);
    assert.equal(bootstrap.status, "claimed");
    assert.equal(bootstrap.userId?.toHexString(), storedUser._id.toHexString());
    assert.equal(JSON.stringify(bootstrap).includes(signupToken), false);
    assert.equal(bootstrap.claimId, undefined);

    const session = await handleSession(apiRequest("/api/auth/session", "GET", undefined, registeredCookie));
    assert.equal(session.status, 200);
    const sessionPayload = await session.json() as { user: { email: string; role: string } };
    assert.equal(sessionPayload.user.email, "owner@example.com");
    assert.equal(sessionPayload.user.role, "admin");
    const secondOwner = await handleRegister(apiRequest("/api/auth/register", "POST", {
      email: "second-owner@example.com",
      password,
      name: "Second owner",
      signupToken,
    }, undefined, "192.0.2.11"));
    assert.equal(secondOwner.status, 403);
    assert.equal((await secondOwner.json() as { error: { code: string } }).error.code, "SIGNUP_UNAVAILABLE");
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
    }));
    assert.equal(disabled.status, 403);

    const userIndexes = await users.indexes();
    const sessionIndexes = await sessions.indexes();
    const rateLimitIndexes = await rateLimits.indexes();
    assert.ok(userIndexes.some((index) => index.name === "users_email_normalized_unique" && index.unique));
    assert.ok(sessionIndexes.some((index) => index.name === "sessions_expiry_ttl" && index.expireAfterSeconds === 0));
    assert.ok(rateLimitIndexes.some((index) => index.name === "auth_rate_limits_expiry_ttl" && index.expireAfterSeconds === 0));
  });
});
