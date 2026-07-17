import { ObjectId } from "mongodb";
import { getAuthConfig } from "./config.js";
import { createSessionToken, hashPassword, keyedHash, secretMatches, verifyPassword } from "./crypto.js";
import { getAuthCollections, type AuthCollections, type UserDocument } from "./database.js";
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
const LOGIN_FAILURE = "Email or password is incorrect.";
const SIGNUP_FAILURE = "Owner account setup is unavailable.";
const FAKE_PASSWORD_HASH = "scrypt$v=1$n=65536,r=8,p=2$b3BlbmJ1Y2tldC1mYWtlLXNhbHQtdjEh$_bN6H6xtF0oe903HJCwA8H1W3KHsbTmZcqWwmwimHOvgCGl3Ch0H9zFVua0drEwacEERDzosya2wiopfgGniog";

export type PublicUser = { id: string; email: string; name: string | null };

function publicUser(user: UserDocument): PublicUser {
  return { id: user._id.toHexString(), email: user.email, name: user.name };
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
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const config = getAuthConfig();
  const { sessions } = await getAuthCollections();
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
  });
  return { id, token, expiresAt };
}

export async function authenticateRequest(request: Request): Promise<PublicUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const config = getAuthConfig();
  const { sessions, users } = await getAuthCollections();
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
  return publicUser(user);
}

type OwnerBootstrapClaim = {
  claimId: string;
  collections: AuthCollections;
};

function signupUnavailable(): ApiError {
  return new ApiError(403, "SIGNUP_UNAVAILABLE", SIGNUP_FAILURE);
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown }).code === 11000;
}

async function finalizeOwnerBootstrap(claim: OwnerBootstrapClaim, userId: ObjectId): Promise<void> {
  await claim.collections.authControls.updateOne(
    { _id: OWNER_BOOTSTRAP_CONTROL_ID },
    {
      $set: { status: "claimed", claimedAt: new Date(), userId },
      $setOnInsert: { createdAt: new Date() },
      $unset: { claimId: "" },
    },
    { upsert: true },
  );
}

async function claimOwnerBootstrap(): Promise<OwnerBootstrapClaim> {
  const collections = await getAuthCollections();
  const claimId = createSessionToken();
  try {
    await collections.authControls.insertOne({
      _id: OWNER_BOOTSTRAP_CONTROL_ID,
      status: "claiming",
      claimId,
      createdAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw signupUnavailable();
    throw error;
  }

  const existing = await collections.users.findOne({}, { projection: { _id: 1 } });
  if (existing) {
    await finalizeOwnerBootstrap({ claimId, collections }, existing._id);
    throw signupUnavailable();
  }
  return { claimId, collections };
}

async function rollbackOwnerBootstrap(claim: OwnerBootstrapClaim, userId: ObjectId): Promise<void> {
  try {
    const deleted = await claim.collections.users.deleteOne({ _id: userId });
    if (!deleted.acknowledged) return;
  } catch {
    console.error("OpenBucket owner bootstrap rollback could not remove the unfinished user.");
    return;
  }
  try {
    await claim.collections.sessions.deleteMany({ userId });
  } catch {
    console.error("OpenBucket owner bootstrap rollback could not remove unfinished sessions.");
  }
  try {
    await claim.collections.authControls.deleteOne({
      _id: OWNER_BOOTSTRAP_CONTROL_ID,
      status: "claiming",
      claimId: claim.claimId,
    });
  } catch {
    console.error("OpenBucket owner bootstrap remains closed after an incomplete rollback.");
  }
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
      passwordHash,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const claim = await claimOwnerBootstrap();
    const { users } = claim.collections;
    try {
      await users.insertOne(user);
    } catch (error) {
      if (isDuplicateKey(error)) {
        const existing = await users.findOne({ emailNormalized: email }, { projection: { _id: 1 } });
        if (existing) {
          await finalizeOwnerBootstrap(claim, existing._id);
          throw signupUnavailable();
        }
      }
      await rollbackOwnerBootstrap(claim, user._id);
      throw error;
    }
    let session: Awaited<ReturnType<typeof createSession>>;
    try {
      session = await createSession(request, user._id);
    } catch (error) {
      await rollbackOwnerBootstrap(claim, user._id);
      throw error;
    }
    await finalizeOwnerBootstrap(claim, user._id);
    const response = jsonResponse({ user: publicUser(user) }, 201);
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
    const { users } = await getAuthCollections();
    const user = await users.findOne({ emailNormalized: email });
    const passwordHash = user?.passwordHash ?? FAKE_PASSWORD_HASH;
    const matches = await verifyPassword(password, passwordHash);
    if (!user || !matches || user.status !== "active") {
      throw new ApiError(401, "INVALID_CREDENTIALS", LOGIN_FAILURE);
    }
    const config = getAuthConfig();
    const session = await createSession(request, user._id);
    const response = jsonResponse({ user: publicUser(user) });
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
