import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { closeAuthDatabaseForTests } from "../../server/auth/database";
import { handleLogin, handleRegister } from "../../server/auth/service";
import { resetControlPlaneIndexesForTests } from "../../server/control-plane/database";
import { getSupportCollections, resetSupportIndexesForTests } from "../../server/support/database";
import { handleListSupportSubmissions, handleSubmitBugReport, handleSubmitFeedback, handleSubmitHelpRequest, handleUpdateSupportStatus } from "../../server/support/service";

const testUri = process.env.MONGODB_TEST_URI?.trim();
const requireMongo = process.env.OPENBUCKET_REQUIRE_MONGODB_TEST?.trim().toLowerCase() === "true";
if (requireMongo && !testUri) throw new Error("MONGODB_TEST_URI is required for the MongoDB acceptance job.");

const origin = "https://openbucket-support.test";
const adminEmail = "support-admin@example.com";
const adminPassword = "support-env-admin-password-value";
const database = "openbucket_support_test_" + process.pid + "_" + Date.now();
const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DATABASE: process.env.MONGODB_DATABASE,
  OPENBUCKET_AUTH_SECRET: process.env.OPENBUCKET_AUTH_SECRET,
  OPENBUCKET_ALLOW_SIGNUP: process.env.OPENBUCKET_ALLOW_SIGNUP,
  OPENBUCKET_ADMIN_EMAIL: process.env.OPENBUCKET_ADMIN_EMAIL,
  OPENBUCKET_ADMIN_PASSWORD: process.env.OPENBUCKET_ADMIN_PASSWORD,
};

function jsonRequest(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
  cookie?: string,
  ip = "192.0.2.100",
): Request {
  const headers = new Headers({ "user-agent": "OpenBucket support integration test", "x-forwarded-for": ip });
  if (method !== "GET") {
    headers.set("content-type", "application/json");
    headers.set("origin", origin);
    headers.set("sec-fetch-site", "same-origin");
  }
  if (cookie) headers.set("cookie", cookie);
  return new Request(origin + path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
}

function cookiePair(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

describe("support submissions", { skip: !testUri }, () => {
  before(async () => {
    process.env.MONGODB_URI = testUri;
    process.env.MONGODB_DATABASE = database;
    process.env.OPENBUCKET_AUTH_SECRET = "support-integration-auth-secret-with-more-than-32-bytes";
    process.env.OPENBUCKET_ALLOW_SIGNUP = "true";
    process.env.OPENBUCKET_ADMIN_EMAIL = adminEmail;
    process.env.OPENBUCKET_ADMIN_PASSWORD = adminPassword;
    await closeAuthDatabaseForTests();
    resetControlPlaneIndexesForTests();
    resetSupportIndexesForTests();
  });

  after(async () => {
    const { submissions } = await getSupportCollections();
    await submissions.drop().catch(() => undefined);
    await closeAuthDatabaseForTests();
    resetControlPlaneIndexesForTests();
    resetSupportIndexesForTests();
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("public feedback/bug submission is stored, listed and updated by an admin, and hidden from non-admins", async () => {
    const member = await handleRegister(jsonRequest("/api/auth/register", "POST", {
      email: "support-member@example.com",
      password: "correct horse battery staple",
      name: "Support Member",
    }, undefined, "192.0.2.101"));
    assert.equal(member.status, 201);
    const memberCookie = cookiePair(member);

    const feedback = await handleSubmitFeedback(jsonRequest("/api/feedback", "POST", {
      message: "The docs search modal is great, thank you.",
      name: "A happy user",
      path: "/feedback",
    }, undefined, "192.0.2.102"));
    assert.equal(feedback.status, 201);
    assert.deepEqual(await feedback.json(), { submitted: true });

    const bug = await handleSubmitBugReport(jsonRequest("/api/bugs", "POST", {
      title: "Rename fails on a name with trailing hyphen",
      message: "openbucket rename foo- returns INVALID_NODE_NAME but the CLI help doesn't say why.",
      severity: "medium",
      email: "reporter@example.com",
      path: "/report-bug",
    }, undefined, "192.0.2.103"));
    assert.equal(bug.status, 201);

    const missingFields = await handleSubmitFeedback(jsonRequest("/api/feedback", "POST", { message: "" }, undefined, "192.0.2.104"));
    assert.equal(missingFields.status, 400);

    const invalidSeverity = await handleSubmitBugReport(jsonRequest("/api/bugs", "POST", {
      title: "x", message: "y", severity: "extreme",
    }, undefined, "192.0.2.105"));
    assert.equal(invalidSeverity.status, 400);

    const memberDenied = await handleListSupportSubmissions(jsonRequest("/api/admin/support", "GET", undefined, memberCookie));
    assert.equal(memberDenied.status, 403);

    const anonDenied = await handleListSupportSubmissions(jsonRequest("/api/admin/support", "GET"));
    assert.equal(anonDenied.status, 401);

    const adminLogin = await handleLogin(jsonRequest("/api/auth/login", "POST", { email: adminEmail, password: adminPassword }, undefined, "192.0.2.106"));
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookiePair(adminLogin);

    const listed = await handleListSupportSubmissions(jsonRequest("/api/admin/support", "GET", undefined, adminCookie));
    assert.equal(listed.status, 200);
    const listedPayload = await listed.json() as { submissions: Array<{ id: string; kind: string; status: string; title: string | null }>; newCount: number; totalCount: number };
    assert.equal(listedPayload.totalCount, 2);
    assert.equal(listedPayload.newCount, 2);
    assert.equal(listedPayload.submissions.length, 2);
    const bugSubmission = listedPayload.submissions.find((item) => item.kind === "bug");
    assert.ok(bugSubmission);
    assert.equal(bugSubmission.title, "Rename fails on a name with trailing hyphen");

    const bugOnly = await handleListSupportSubmissions(jsonRequest("/api/admin/support?kind=bug", "GET", undefined, adminCookie));
    const bugOnlyPayload = await bugOnly.json() as { submissions: unknown[] };
    assert.equal(bugOnlyPayload.submissions.length, 1);

    const updated = await handleUpdateSupportStatus(
      jsonRequest(`/api/admin/support/${bugSubmission.id}`, "PATCH", { status: "resolved" }, adminCookie),
      bugSubmission.id,
    );
    assert.equal(updated.status, 200);
    const updatedPayload = await updated.json() as { submission: { status: string } };
    assert.equal(updatedPayload.submission.status, "resolved");

    const resolvedOnly = await handleListSupportSubmissions(jsonRequest("/api/admin/support?status=resolved", "GET", undefined, adminCookie));
    const resolvedPayload = await resolvedOnly.json() as { submissions: unknown[]; newCount: number };
    assert.equal(resolvedPayload.submissions.length, 1);
    // newCount always reflects new items within the kind filter, independent of the status
    // filter applied to the main list, so the admin sees a stable "X new" badge no matter which
    // status tab is open. One submission (the feedback item) is still untouched/"new".
    assert.equal(resolvedPayload.newCount, 1);

    const memberUpdateDenied = await handleUpdateSupportStatus(
      jsonRequest(`/api/admin/support/${bugSubmission.id}`, "PATCH", { status: "new" }, memberCookie),
      bugSubmission.id,
    );
    assert.equal(memberUpdateDenied.status, 403);
  });

  test("feedback submissions are rate-limited per IP", async () => {
    const ip = "192.0.2.110";
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const response = await handleSubmitFeedback(jsonRequest("/api/feedback", "POST", { message: `attempt ${i}` }, undefined, ip));
      lastStatus = response.status;
    }
    assert.equal(lastStatus, 429);
  });

  test("help requests are stored, listed and filterable by an admin, and still succeed without SMTP configured", async () => {
    // No OPENBUCKET_SMTP_* env vars are set in this test process, so the confirmation email send
    // inside handleSubmitHelpRequest is expected to hit the "SMTP not configured" branch and
    // log-and-return-false rather than throwing — the submission itself must still succeed (201).
    assert.equal(process.env.OPENBUCKET_SMTP_HOST, undefined);

    const missingEmail = await handleSubmitHelpRequest(jsonRequest("/api/help", "POST", {
      subject: "Can't connect boto3 to my node",
      message: "I keep getting a signature mismatch error when using the endpoint URL from the dashboard.",
    }, undefined, "192.0.2.120"));
    assert.equal(missingEmail.status, 400);

    const help = await handleSubmitHelpRequest(jsonRequest("/api/help", "POST", {
      subject: "Can't connect boto3 to my node",
      message: "I keep getting a signature mismatch error when using the endpoint URL from the dashboard.",
      email: "help-requester@example.com",
      name: "Help Requester",
      path: "/help",
    }, undefined, "192.0.2.121"));
    assert.equal(help.status, 201);
    assert.deepEqual(await help.json(), { submitted: true });

    const adminLogin = await handleLogin(jsonRequest("/api/auth/login", "POST", { email: adminEmail, password: adminPassword }, undefined, "192.0.2.122"));
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookiePair(adminLogin);

    const helpOnly = await handleListSupportSubmissions(jsonRequest("/api/admin/support?kind=help", "GET", undefined, adminCookie));
    assert.equal(helpOnly.status, 200);
    const helpOnlyPayload = await helpOnly.json() as { submissions: Array<{ id: string; kind: string; title: string | null; email: string | null; name: string | null }> };
    assert.equal(helpOnlyPayload.submissions.length, 1);
    const helpSubmission = helpOnlyPayload.submissions[0];
    assert.ok(helpSubmission);
    assert.equal(helpSubmission.kind, "help");
    assert.equal(helpSubmission.title, "Can't connect boto3 to my node");
    assert.equal(helpSubmission.email, "help-requester@example.com");
    assert.equal(helpSubmission.name, "Help Requester");

    const invalidKind = await handleListSupportSubmissions(jsonRequest("/api/admin/support?kind=bogus", "GET", undefined, adminCookie));
    assert.equal(invalidKind.status, 400);
  });

  test("help requests are rate-limited per IP", async () => {
    const ip = "192.0.2.130";
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const response = await handleSubmitHelpRequest(jsonRequest("/api/help", "POST", {
        subject: `attempt ${i}`,
        message: "repeated help request body",
        email: "rate-limit-help@example.com",
      }, undefined, ip));
      lastStatus = response.status;
    }
    assert.equal(lastStatus, 429);
  });
});
