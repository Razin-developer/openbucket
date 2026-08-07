import { ObjectId } from "mongodb";
import { getAuthConfig } from "./config.js";
import { createOpaqueToken, createSessionToken, hashPassword, keyedHash, secretMatches, verifyPassword } from "./crypto.js";
import {
  buildGoogleAuthorizationUrl,
  clearedOAuthStateCookie,
  createPkcePair,
  decodeOAuthState,
  encodeOAuthState,
  exchangeGoogleCode,
  isGoogleSignInConfigured,
  oAuthStateCookie,
  readOAuthStateCookie,
} from "./google.js";
import { sendPasswordResetEmail } from "./mailer.js";
import { getAuthCollections, type AuthCollections, type UserDocument } from "./database.js";
import {
  ApiError,
  assertMethod,
  assertSameOriginPost,
  clearedSessionCookies,
  errorResponse,
  getSessionToken,
  jsonResponse,
  parseWithSchema,
  readJsonObject,
  requestIp,
  sessionCookie,
  signedInHintCookie,
} from "./http.js";
import {
  emailSchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  nameSchema,
  passwordSchema,
  registerBodySchema,
  resetPasswordBodySchema,
  resetTokenSchema,
} from "./schemas.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const LOGIN_EMAIL_LIMIT = 8;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_IP_LIMIT = 5;
const SIGNUP_EMAIL_LIMIT = 3;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_IP_LIMIT = 8;
const RESET_EMAIL_LIMIT = 3;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
const LOGIN_FAILURE = "Email or password is incorrect.";
const RESET_GENERIC_OK = "If an account exists for that email, a reset link is on its way.";
const FAKE_PASSWORD_HASH = "scrypt$v=1$n=65536,r=8,p=2$b3BlbmJ1Y2tldC1mYWtlLXNhbHQtdjEh$_bN6H6xtF0oe903HJCwA8H1W3KHsbTmZcqWwmwimHOvgCGl3Ch0H9zFVua0drEwacEERDzosya2wiopfgGniog";

export type UserRole = "admin" | "member";
export type PublicUser = { id: string; email: string; name: string | null; handle: string; role: UserRole };

const RESERVED_HANDLES = new Set(["admin", "api", "auth", "dashboard", "docs", "health", "login", "mail", "node", "nodes", "openbucket", "register", "s3", "status", "support", "usage", "www"]);
const ENV_ADMIN_HANDLE = "admin";

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

function publicUser(user: UserDocument): PublicUser {
  if (!user.handle) throw new Error("User handle was not initialized.");
  // Admin is decided exclusively by OPENBUCKET_ADMIN_EMAIL/OPENBUCKET_ADMIN_PASSWORD (see publicAdminUser
  // below) — any legacy `role: "admin"` left over on a database user document is never honored here.
  return { id: user._id.toHexString(), email: user.email, name: user.name, handle: user.handle, role: "member" };
}

function publicAdminUser(email: string): PublicUser {
  return { id: "env-admin", email, name: "Admin", handle: ENV_ADMIN_HANDLE, role: "admin" };
}

function normalizeEmail(value: unknown): string {
  return parseWithSchema(emailSchema, value, "INVALID_EMAIL", "Enter a valid email address.");
}

function validatePassword(value: unknown): string {
  return parseWithSchema(passwordSchema, value, "INVALID_PASSWORD", "Password must contain 12-128 characters.");
}

function validateName(value: unknown): string | null {
  return parseWithSchema(nameSchema, value, "INVALID_NAME", "Name must contain 1-80 characters.");
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

async function applyResetRateLimits(request: Request, email: string): Promise<void> {
  await consumeRateLimit("reset-ip", requestIp(request), RESET_IP_LIMIT, RESET_WINDOW_MS);
  await consumeRateLimit("reset-email", email, RESET_EMAIL_LIMIT, RESET_WINDOW_MS);
}

async function createSession(
  request: Request,
  userId: ObjectId | null,
  options: { collections?: AuthCollections; isEnvAdmin?: boolean } = {},
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
    isEnvAdmin: options.isEnvAdmin || undefined,
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
  const collections = await getAuthCollections();
  const { sessions, users } = collections;
  const id = keyedHash(config.authSecret, "session", token);
  const now = new Date();
  const session = await sessions.findOne({ _id: id, expiresAt: { $gt: now } });
  if (!session) return null;

  if (session.isEnvAdmin) {
    if (!config.adminEmail) {
      await sessions.deleteOne({ _id: id });
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await sessions.updateOne({ _id: id, expiresAt: { $gt: now } }, { $set: { lastSeenAt: now } });
    }
    return publicAdminUser(config.adminEmail);
  }

  if (!session.userId) return null;
  const user = await users.findOne({ _id: session.userId, status: "active" });
  if (!user) {
    await sessions.deleteOne({ _id: id });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await sessions.updateOne({ _id: id, expiresAt: { $gt: now } }, { $set: { lastSeenAt: now } });
  }
  const migrated = await ensureUserHandle(user, collections);
  return publicUser(migrated);
}

function signupUnavailable(): ApiError {
  return new ApiError(403, "SIGNUP_UNAVAILABLE", "Account creation is currently unavailable.");
}

export async function handleRegister(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const config = getAuthConfig();
    if (!config.allowSignup) throw signupUnavailable();
    const body = await readJsonObject(request);
    parseWithSchema(registerBodySchema, body, "INVALID_REQUEST", "Request contains unsupported fields.");
    const email = normalizeEmail(body.email);
    if (config.adminEmail && email === config.adminEmail) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
    }
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
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const { users } = await getAuthCollections();
    try {
      await users.insertOne(user);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists.");
      }
      throw error;
    }
    const session = await createSession(request, user._id);
    const response = jsonResponse({ user: publicUser(user) }, 201);
    response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
    response.headers.append("Set-Cookie", signedInHintCookie(request, config.sessionTtlSeconds));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLogin(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const body = await readJsonObject(request);
    parseWithSchema(loginBodySchema, body, "INVALID_REQUEST", "Request contains unsupported fields.");
    const email = normalizeEmail(body.email);
    const password = validatePassword(body.password);
    await applyLoginRateLimits(request, email);
    const config = getAuthConfig();

    if (config.adminEmail && config.adminPassword) {
      const emailMatches = email === config.adminEmail;
      const passwordMatches = secretMatches(config.authSecret, "admin-password", password, config.adminPassword);
      if (emailMatches && passwordMatches) {
        const session = await createSession(request, null, { isEnvAdmin: true });
        const response = jsonResponse({ user: publicAdminUser(config.adminEmail) });
        response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
        response.headers.append("Set-Cookie", signedInHintCookie(request, config.sessionTtlSeconds));
        return response;
      }
    }

    const collections = await getAuthCollections();
    const { users } = collections;
    const user = await users.findOne({ emailNormalized: email });
    const passwordHash = user?.passwordHash ?? FAKE_PASSWORD_HASH;
    const matches = await verifyPassword(password, passwordHash);
    if (!user || !matches || user.status !== "active") {
      throw new ApiError(401, "INVALID_CREDENTIALS", LOGIN_FAILURE);
    }
    const session = await createSession(request, user._id, { collections });
    const migrated = await ensureUserHandle(user, collections);
    const response = jsonResponse({ user: publicUser(migrated) });
    response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
    response.headers.append("Set-Cookie", signedInHintCookie(request, config.sessionTtlSeconds));
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

export async function handleForgotPassword(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const body = await readJsonObject(request);
    parseWithSchema(forgotPasswordBodySchema, body, "INVALID_REQUEST", "Request contains unsupported fields.");
    const email = normalizeEmail(body.email);
    await applyResetRateLimits(request, email);

    const config = getAuthConfig();
    // Never issue a reset link for the env-admin address: it has no password reset flow, credentials
    // live only in OPENBUCKET_ADMIN_PASSWORD. Still returns the generic OK response below either way.
    if (!config.adminEmail || email !== config.adminEmail) {
      const collections = await getAuthCollections();
      const user = await collections.users.findOne({ emailNormalized: email, status: "active" });
      if (user && user.passwordHash) {
        const token = createOpaqueToken();
        const now = new Date();
        await collections.passwordResets.insertOne({
          _id: keyedHash(config.authSecret, "password-reset", token),
          userId: user._id,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        });
        const resetUrl = new URL("/reset-password", new URL(request.url).origin);
        resetUrl.searchParams.set("token", token);
        await sendPasswordResetEmail(user.email, resetUrl.toString());
      }
    }
    return jsonResponse({ ok: true, message: RESET_GENERIC_OK });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleResetPassword(request: Request): Promise<Response> {
  try {
    assertSameOriginPost(request);
    const body = await readJsonObject(request);
    parseWithSchema(resetPasswordBodySchema, body, "INVALID_REQUEST", "Request contains unsupported fields.");
    const token = parseWithSchema(resetTokenSchema, body.token, "INVALID_TOKEN", "This reset link is invalid or has expired.");
    const password = validatePassword(body.password);
    const config = getAuthConfig();
    const collections = await getAuthCollections();
    const resetId = keyedHash(config.authSecret, "password-reset", token);
    const reset = await collections.passwordResets.findOne({ _id: resetId, expiresAt: { $gt: new Date() } });
    if (!reset) throw new ApiError(400, "INVALID_TOKEN", "This reset link is invalid or has expired.");

    const passwordHash = await hashPassword(password);
    await collections.users.updateOne(
      { _id: reset.userId },
      { $set: { passwordHash, updatedAt: new Date() } },
    );
    await collections.passwordResets.deleteOne({ _id: resetId });
    // A password reset is a credible signal of account compromise recovery — kill every other
    // session for this user so a leaked cookie doesn't survive the reset.
    await collections.sessions.deleteMany({ userId: reset.userId });
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function googleRedirectUri(request: Request): string {
  return new URL("/api/auth/google/callback", new URL(request.url).origin).toString();
}

export async function handleGoogleStart(request: Request): Promise<Response> {
  try {
    assertMethod(request, "GET");
    if (!isGoogleSignInConfigured()) throw new ApiError(503, "GOOGLE_SIGNIN_UNAVAILABLE", "Google sign-in is not configured.");
    const config = getAuthConfig();
    const url = new URL(request.url);
    const next = url.searchParams.get("next");
    const { verifier, challenge } = createPkcePair();
    const state = createOpaqueToken();
    const cookieValue = encodeOAuthState(config.authSecret, { state, verifier, next: next ?? "/dashboard" });
    const authorizationUrl = buildGoogleAuthorizationUrl({ redirectUri: googleRedirectUri(request), state, codeChallenge: challenge });
    const secure = new URL(request.url).protocol === "https:";
    return new Response(null, {
      status: 302,
      headers: { Location: authorizationUrl, "Set-Cookie": oAuthStateCookie(secure, cookieValue) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGoogleCallback(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const secure = requestUrl.protocol === "https:";
  const loginError = (code: string) => {
    const redirect = new URL("/login", requestUrl.origin);
    redirect.searchParams.set("error", code);
    return new Response(null, {
      status: 302,
      headers: { Location: redirect.toString(), "Set-Cookie": clearedOAuthStateCookie(secure) },
    });
  };

  try {
    assertMethod(request, "GET");
    if (!isGoogleSignInConfigured()) throw new ApiError(503, "GOOGLE_SIGNIN_UNAVAILABLE", "Google sign-in is not configured.");
    const config = getAuthConfig();
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const cookieValue = readOAuthStateCookie(request);
    if (!code || !state || !cookieValue) return loginError("google_state_missing");
    const stored = decodeOAuthState(config.authSecret, cookieValue);
    if (!stored || stored.state !== state) return loginError("google_state_mismatch");

    const identity = await exchangeGoogleCode({ code, redirectUri: googleRedirectUri(request), codeVerifier: stored.verifier });
    if (config.adminEmail && identity.email === config.adminEmail) return loginError("google_reserved_email");

    const collections = await getAuthCollections();
    let user = await collections.users.findOne({ googleId: identity.subject });
    if (!user) {
      // Google verified this email address, so linking it to a matching existing password
      // account is safe — it's the same standard "sign in with Google" linking behavior used
      // by most apps that support both password and OAuth login on the same address.
      user = await collections.users.findOne({ emailNormalized: identity.email });
      if (user) {
        await collections.users.updateOne({ _id: user._id }, { $set: { googleId: identity.subject, updatedAt: new Date() } });
      } else {
        const now = new Date();
        const created: UserDocument = {
          _id: new ObjectId(),
          email: identity.email,
          emailNormalized: identity.email,
          name: identity.name,
          handle: handleStem(identity.name || identity.email.split("@")[0] || "user"),
          googleId: identity.subject,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
        await collections.users.insertOne(created);
        user = created;
      }
    }
    if (user.status !== "active") return loginError("google_account_disabled");

    const migrated = await ensureUserHandle(user, collections);
    const session = await createSession(request, migrated._id, { collections });
    const redirect = new URL(stored.next, requestUrl.origin);
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: redirect.toString(),
        "Set-Cookie": clearedOAuthStateCookie(secure),
      },
    });
    response.headers.append("Set-Cookie", sessionCookie(request, session.token, config.sessionTtlSeconds));
    response.headers.append("Set-Cookie", signedInHintCookie(request, config.sessionTtlSeconds));
    return response;
  } catch {
    return loginError("google_signin_failed");
  }
}
