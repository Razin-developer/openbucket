import { ObjectId, type ClientSession } from "mongodb";
import { getAuthConfig } from "./config.js";
import { createSessionToken, hashPassword, keyedHash, secretMatches, verifyPassword } from "./crypto.js";
import { getAuthCollections, getAuthDatabaseContext, type AuthCollections, type UserDocument } from "./database.js";
import {
  ApiError,
  assertMethod,
  assertSameOriginPost,
  clearedSessionCookies,
  errorResponse,
  getSessionToken,
  jsonResponse,
  readJsonObject,
  requestIp,
  sessionCookie,
} from "./http.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const LOGIN_EMAIL_LIMIT = 8;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_IP_LIMIT = 5;
const SIGNUP_EMAIL_LIMIT = 3;
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
const OWNER_BOOTSTRAP_CONTROL_ID = "owner-bootstrap";
const OWNER_BOOTSTRAP_LEASE_MS = 10 * 60 * 1000;
const LOGIN_FAILURE = "Email or password is incorrect.";
const SIGNUP_FAILURE = "Owner account setup is unavailable.";
const FAKE_PASSWORD_HASH = "scrypt$v=1$n=65536,r=8,p=2$b3BlbmJ1Y2tldC1mYWtlLXNhbHQtdjEh$_bN6H6xtF0oe903HJCwA8H1W3KHsbTmZcqWwmwimHOvgCGl3Ch0H9zFVua0drEwacEERDzosya2wiopfgGniog";

export type UserRole = "admin" | "member";
export type PublicUser = { id: string; email: string; name: string | null; handle: string; role: UserRole };

const RESERVED_HANDLES = new Set(["admin", "api", "auth", "dashboard", "docs", "health", "login", "mail", "node", "nodes", "openbucket", "register", "s3", "status", "support", "usage", "www"]);

function handleStem(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return normalized.length >= 3 && !RESERVED_HANDLES.has(normalized) ? normalized : "user";
}

/** Lazily migrates existing accounts without a risky deployment-time migration. */
export async function ensureUserHandle(user: UserDocument, collections: AuthCollections): Promise<UserDocument> {
  if (typeof user.handle === "string" && /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(user.handle)) return user;
  const stem = handleStem(user.name || user.email.split("@")[0] || "user");
  const suffix = user._id.toHexString().slice(-6);
  for (const candidate of [stem, `${stem}-${suffix}`]) {
    try {
      const updated = await collections.users.findOneAndUpdate(
        { _id: user._id, handle: { $exists: false } },
        { $set: { handle: candidate, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      if (updated) return updated;
      const current = await collections.users.findOne({ _id: user._id });
      if (current?.handle) return current;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  throw new ApiError(503, "HANDLE_UNAVAILABLE", "Unable to assign an account handle. Try again.");
}

function publicUser(user: UserDocument, role: UserRole): PublicUser {
  if (!user.handle) throw new Error("User handle was not initialized.");
  return { id: user._id.toHexString(), email: user.email, name: user.name, handle: user.handle, role };
}

async function resolveUserRole(user: UserDocument, collections: AuthCollections): Promise<UserRole> {
  if (user.role === "admin" || user.role === "member") return user.role;

  const ownerControl = await collections.authControls.findOne({
    _id: OWNER_BOOTSTRAP_CONTROL_ID,
    status: "claimed",
    userId: user._id,
  });
  const role: UserRole = ownerControl ? "admin" : "member";
  await collections.users.updateOne(
    { _id: user._id, role: { $exists: false } },
    { $set: { role, updatedAt: new Date() } },
  );
  user.role = role;
  return role;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || /[\u0000-\u001f\u007f\s]/.test(email)) {
    throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1] || parts[1].length > 253) {
    throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) {
    throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(parts[1])) {
    throw new ApiError(400, "INVALID_EMAIL", "Enter a valid email address.");
  }
  return email;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_PASSWORD", "Password must contain 12-128 characters.");
  }
  const characters = Array.from(value).length;
  const bytes = Buffer.byteLength(value, "utf8");
  if (characters < 12 || characters > 128 || bytes > 1024 || value.includes("\0")) {
    throw new ApiError(400, "INVALID_PASSWORD", "Password must contain 12-128 characters.");
  }
  return value;
}

function validateName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "INVALID_NAME", "Name must contain 1-80 characters.");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || Array.from(name).length > 80 || Buffer.byteLength(name, "utf8") > 320 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError(400, "INVALID_NAME", "Name must contain 1-80 characters.");
  }
  return name;
}

function assertSignupToken(value: unknown, authSecret: Buffer, expected: Buffer | null): void {
  const validShape = typeof value === "string" && Buffer.byteLength(value, "utf8") <= 1024;
  const supplied = validShape ? value : "";
  const matches = expected
    ? secretMatches(authSecret, "owner-bootstrap-token", supplied, expected)
    : false;
  if (!validShape || !matches) {
    throw new ApiError(403, "SIGNUP_UNAVAILABLE", SIGNUP_FAILURE);
  }
}

function assertOnlyFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_REQUEST", "Request contains unsupported fields.");
  }
}

async function consumeRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const config = getAuthConfig();
  const { rateLimits } = await getAuthCollections();
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const id = `${scope}:${bucket}:${keyedHash(config.authSecret, `rate:${scope}`, identifier)}`;
  const bucketEnd = (bucket + 1) * windowMs;
  const result = await rateLimits.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        createdAt: new Date(now),
        expiresAt: new Date(bucketEnd + windowMs),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!result) throw new Error("Unable to update authentication rate limit.");
  if (result.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucketEnd - now) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.", {
      "Retry-After": String(retryAfter),
    });
  }
}

async function applyLoginRateLimits(request: Request, email: string): Promise<void> {
  await consumeRateLimit("login-ip", requestIp(request), LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  await consumeRateLimit("login-email", email, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
}

async function applySignupRateLimits(request: Request, email: string): Promise<void> {
  await consumeRateLimit("signup-ip", requestIp(request), SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS);
  await consumeRateLimit("signup-email", email, SIGNUP_EMAIL_LIMIT, SIGNUP_WINDOW_MS);
}

async function createSession(
  request: Request, userId: ObjectId,
  options: {
    collections?: AuthCollections;
    mongoSession?: ClientSession;
  } = {},
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const config = getAuthConfig();
  const { sessions } = options.collections ?? await getAuthCollections();
  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
  const userAgent = (request.headers.get("user-agent") ?? "unknown").slice(0, 512);
  const id = keyedHash(config.authSecret, "session", token);
  await sessions.insertOne({
    _id: id,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ipHash: keyedHash(config.authSecret, "session-ip", requestIp(request)),
    userAgentHash: keyedHash(config.authSecret, "session-agent", userAgent),
  }, options.mongoSession ? { session: options.mongoSession } : undefined);
  return { id, token, expiresAt };
}

export async function authenticateRequest(request: Request): Promise<PublicUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const config = getAuthConfig();
  const collections = await getAuthCollections();
  const { sessions, users } = collections;
  const id = keyedHash(config.authSecret, "session", token);
  const now = new Date();
  const session = await sessions.findOne({ _id: id, expiresAt: { $gt: now } });
  if (!session) return null;
  const user = await users.findOne({ _id: session.userId, status: "active" });
  if (!user) {
    await sessions.deleteOne({ _id: id });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await sessions.updateOne({ _id: id, expiresAt: { $gt: now } }, { $set: { lastSeenAt: now } });
  }
  const migrated = await ensureUserHandle(user, collections);
  const role = await resolveUserRole(migrated, collections);
  return publicUser(migrated, role);
}

function signupUnavailable(): ApiError {
  return new ApiError(403, "SIGNUP_UNAVAILABLE", SIGNUP_FAILURE);
}

export async function handleRegister(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const config = getAuthConfig();
    if (!config.allowSignup || !config.signupToken) throw signupUnavailable();
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["email", "password", "name", "signupToken"]);
    assertSignupToken(body.signupToken, config.authSecret, config.signupToken);
    const email = normalizeEmail(body.email);
    const password = validatePassword(body.password);
    const name = validateName(body.name);
    await applySignupRateLimits(request, email);
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const user: UserDocument = {
      _id: new ObjectId(),
      email,
      emailNormalized: email,
      name,
      handle: handleStem(name || email.split("@")[0] || "user"),
      passwordHash,
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const collections = await getAuthCollections();
    const { client } = await getAuthDatabaseContext();
    const mongoSession = client.startSession();
    let created = false;
    let createdSession: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      await mongoSession.withTransaction(async () => {
        created = false;
        createdSession = undefined;
        const leaseCutoff = new Date(Date.now() - OWNER_BOOTSTRAP_LEASE_MS);
        const control = await collections.authControls.findOne(
          { _id: OWNER_BOOTSTRAP_CONTROL_ID },
          { session: mongoSession },
        );
        let existing = await collections.users.findOne(
          {},
          { session: mongoSession, sort: { createdAt: 1 }, projection: { _id: 1 } },
        );

        if (control?.status === "claimed") return;
        if (control?.status === "claiming") {
          if (control.createdAt > leaseCutoff) return;
          if (existing) {
            await collections.authControls.updateOne(
              { _id: OWNER_BOOTSTRAP_CONTROL_ID, status: "claiming", createdAt: control.createdAt },
              {
                $set: { status: "claimed", claimedAt: new Date(), userId: existing._id },
                $unset: { claimId: "" },
              },
              { session: mongoSession },
            );
            return;
          }
          await collections.authControls.deleteOne(
            { _id: OWNER_BOOTSTRAP_CONTROL_ID, status: "claiming", createdAt: control.createdAt },
            { session: mongoSession },
          );
          existing = null;
        }

        if (existing) {
          await collections.authControls.updateOne(
            { _id: OWNER_BOOTSTRAP_CONTROL_ID },
            {
              $setOnInsert: {
                status: "claimed",
                createdAt: new Date(),
                claimedAt: new Date(),
                userId: existing._id,
              },
            },
            { upsert: true, session: mongoSession },
          );
          return;
        }

        await collections.authControls.insertOne({
          _id: OWNER_BOOTSTRAP_CONTROL_ID,
          status: "claimed",
          createdAt: now,
          claimedAt: now,
          userId: user._id,
        }, { session: mongoSession });
        await collections.users.insertOne(user, { session: mongoSession });
        createdSession = await createSession(request, user._id, { collections, mongoSession });
        created = true;
      }, {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      });
    } finally {
      await mongoSession.endSession();
    }
    if (!created || !createdSession) throw signupUnavailable();
    const session = createdSession;
    const response = jsonResponse({ user: publicUser(user, "admin") }, 201);
    response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogin(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const body = await readJsonObject(request);
    assertOnlyFields(body, ["email", "password"]);
    const email = normalizeEmail(body.email);
    const password = validatePassword(body.password);
    await applyLoginRateLimits(request, email);
    const collections = await getAuthCollections();
    const { users } = collections;
    const user = await users.findOne({ emailNormalized: email });
    const passwordHash = user?.passwordHash ?? FAKE_PASSWORD_HASH;
    const matches = await verifyPassword(password, passwordHash);
    if (!user || !matches || user.status !== "active") {
      throw new ApiError(401, "INVALID_CREDENTIALS", LOGIN_FAILURE);
    }
    const config = getAuthConfig();
    const session = await createSession(request, user._id);
    const migrated = await ensureUserHandle(user, collections);
    const role = await resolveUserRole(migrated, collections);
    const response = jsonResponse({ user: publicUser(migrated, role) });
    response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSession(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    const user = await authenticateRequest(request);
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
    return jsonResponse({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogout(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const token = getSessionToken(request);
    if (token) {
      const config = getAuthConfig();
      const { sessions } = await getAuthCollections();
      await sessions.deleteOne({ _id: keyedHash(config.authSecret, "session", token) });
    }
    const response = jsonResponse({ ok: true });
    for (const cookie of clearedSessionCookies()) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleHealth(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    return jsonResponse({ ok: true, service: "openbucket-web" });
  } catch (error) {
    return errorResponse(error);
  }
}
