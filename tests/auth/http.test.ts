import assert from "node:assert/strict";
import { describe, test } from "node:test";
import middleware from "../../middleware";
import {
  ApiError,
  DEVELOPMENT_SESSION_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  assertSameOriginPost,
  clearedSessionCookies,
  getSessionToken,
  readJsonObject,
  sessionCookie,
} from "../../server/auth/http";

function request(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

describe("authentication HTTP boundary", () => {
  test("accepts only same-origin JSON POST requests", () => {
    const valid = request("https://openbucket.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://openbucket.test",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    assert.doesNotThrow(() => assertSameOriginPost(valid));

    for (const invalid of [
      request("https://openbucket.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.test" },
        body: "{}",
      }),
      request("https://openbucket.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://openbucket.test" },
        body: "{}",
      }),
      request("https://openbucket.test/api/auth/login", { method: "GET" }),
    ]) {
      assert.throws(() => assertSameOriginPost(invalid), ApiError);
    }
  });

  test("bounds and validates JSON bodies", async () => {
    assert.deepEqual(
      await readJsonObject(request("https://openbucket.test", { method: "POST", body: '{"ok":true}' })),
      { ok: true },
    );
    await assert.rejects(
      readJsonObject(request("https://openbucket.test", { method: "POST", body: "[1,2,3]" })),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_REQUEST",
    );
    await assert.rejects(
      readJsonObject(request("https://openbucket.test", { method: "POST", body: `{"value":"${"x".repeat(17_000)}"}` })),
      (error: unknown) => error instanceof ApiError && error.status === 413,
    );
  });

  test("uses host-only secure cookies in production and a localhost fallback", () => {
    const token = "a".repeat(43);
    const secure = sessionCookie(request("https://openbucket.test"), token, 60);
    assert.match(secure, new RegExp(`^${PRODUCTION_SESSION_COOKIE}=`));
    assert.match(secure, /; Secure/);
    assert.match(secure, /; HttpOnly/);
    assert.match(secure, /; SameSite=Strict/);
    const cannotDowngrade = sessionCookie(
      request("https://openbucket.test", { headers: { "x-forwarded-proto": "http" } }), token, 60,
    );
    assert.match(cannotDowngrade, new RegExp(`^${PRODUCTION_SESSION_COOKIE}=`));
    assert.match(cannotDowngrade, /; Secure/);
    assert.equal(secure.includes("Domain="), false);
    assert.equal(
      getSessionToken(request("https://openbucket.test", { headers: { cookie: secure.split(";", 1)[0] } })),
      token,
    );

    const local = sessionCookie(request("http://localhost:3000"), token, 60);
    assert.match(local, new RegExp(`^${DEVELOPMENT_SESSION_COOKIE}=`));
    assert.equal(local.includes("; Secure"), false);
    assert.equal(
      getSessionToken(request("http://localhost:3000", { headers: { cookie: local.split(";", 1)[0] } })),
      token,
    );
    assert.equal(
      getSessionToken(request("https://openbucket.test", { headers: { cookie: local.split(";", 1)[0] } })),
      null,
    );
  });

  test("clears both production and local session cookie names", () => {
    const cookies = clearedSessionCookies();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], new RegExp(`^${PRODUCTION_SESSION_COOKIE}=;`));
    assert.match(cookies[0], /Max-Age=0/);
    assert.match(cookies[0], /; Secure$/);
    assert.match(cookies[1], new RegExp(`^${DEVELOPMENT_SESSION_COOKIE}=;`));
    assert.match(cookies[1], /Max-Age=0/);
  });

  test("redirects an unauthenticated dashboard request before static content", async () => {
    const response = await middleware(request("https://openbucket.test/dashboard?view=buckets"));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/dashboard?view=buckets");
  });
});
