import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

export const DEFAULT_CONTROL_PLANE_URL = "https://openbucket-eight.vercel.app";

export interface HostedUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
}

export interface HostedSession {
  version: 1;
  controlPlaneUrl: string;
  token: string;
  cookieName: string;
  user: HostedUser;
  createdAt: string;
}

export interface NodeCredential {
  version: 1;
  controlPlaneUrl: string;
  nodeId: string;
  nodeName: string;
  token: string;
  createdAt: string;
}
export interface HostedNodeSummary {
  id: string;
  name: string;
  status?: string;
  [key: string]: unknown;
}

export interface NodeRegistrationResult {
  created: boolean;
  node: HostedNodeSummary;
  credential: { token: string; createdAt: string } | null;
}

interface NodeCredentialStore {
  version: 1;
  credentials: NodeCredential[];
}

export interface AuthPaths {
  directory: string;
  sessionFile: string;
  nodesFile: string;
}

export type AuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HostedAuthError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "HostedAuthError";
    this.status = options.status;
    this.code = options.code;
  }
}
const PRIVATE_FILE_LOCK_TIMEOUT_MS = 20_000;
const PRIVATE_FILE_LOCK_STALE_MS = 15_000;
const WINDOWS_ACL_TIMEOUT_MS = 5_000;
const hardenedWindowsDirectories = new Set<string>();
let windowsPrincipalPromise: Promise<string | undefined> | undefined;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function runWindowsCommand(command: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolveCommand) => {
    try {
      execFile(
        command,
        args,
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: WINDOWS_ACL_TIMEOUT_MS,
          maxBuffer: 16 * 1024,
        },
        (error, stdout) => resolveCommand({ ok: !error, stdout: String(stdout ?? "") }),
      );
    } catch {
      resolveCommand({ ok: false, stdout: "" });
    }
  });
}

function windowsPrincipal(): Promise<string | undefined> {
  windowsPrincipalPromise ??= runWindowsCommand("whoami.exe", []).then(({ ok, stdout }) => {
    const principal = stdout.trim();
    return ok && principal && principal.length <= 512 ? principal : undefined;
  });
  return windowsPrincipalPromise;
}

/**
 * POSIX mode bits do not restrict Windows ACLs. Best-effort icacls hardening keeps
 * the current user, SYSTEM, and local administrators while removing inherited
 * access. The file still remains usable if the Windows utility is unavailable.
 */
async function hardenWindowsAcl(path: string, directory: boolean): Promise<void> {
  if (process.platform !== "win32") return;
  if (directory && hardenedWindowsDirectories.has(path)) return;
  const principal = await windowsPrincipal();
  if (!principal) return;
  const permission = directory ? "(OI)(CI)F" : "F";
  const granted = await runWindowsCommand("icacls.exe", [
    path,
    "/grant:r",
    `${principal}:${permission}`,
    `*S-1-5-18:${permission}`,
    `*S-1-5-32-544:${permission}`,
    "/Q",
  ]);
  if (!granted.ok) return;
  const inheritance = await runWindowsCommand("icacls.exe", [path, "/inheritance:r", "/Q"]);
  if (directory && inheritance.ok) hardenedWindowsDirectories.add(path);
}

export async function readAuthStdin(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) {
    value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(value, "utf8") > 16 * 1024) {
      throw new HostedAuthError("Standard input is too large.");
    }
  }
  return value;
}

export async function defaultAuthPrompt(message: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new HostedAuthError(
      secret
        ? "A password is required. Use --password-stdin or OPENBUCKET_PASSWORD in non-interactive environments."
        : "An email is required. Use --email or OPENBUCKET_EMAIL in non-interactive environments.",
    );
  }
  if (!secret) {
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await readline.question(message);
    } finally {
      readline.close();
    }
  }

  const input = process.stdin;
  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  process.stderr.write(message);
  input.setRawMode(true);
  input.resume();
  return new Promise<string>((resolvePrompt, rejectPrompt) => {
    let value = "";
    let escaping = false;
    const finish = (error?: Error): void => {
      input.removeListener("data", onData);
      input.setRawMode(Boolean(wasRaw));
      if (wasPaused) input.pause();
      process.stderr.write("\n");
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };
    const onData = (raw: Buffer | string): void => {
      for (const character of (Buffer.isBuffer(raw) ? raw.toString("utf8") : raw)) {
        if (escaping) {
          if (/[A-Za-z~]/.test(character)) escaping = false;
          continue;
        }
        if (character === "\u001b") {
          escaping = true;
        } else if (character === "\r" || character === "\n") {
          finish();
          return;
        } else if (character === "\u0003" || character === "\u0004") {
          finish(new HostedAuthError("Login cancelled."));
          return;
        } else if (character === "\b" || character === "\u007f") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " " && value.length < 1024) {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

function normalizeHttpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostedAuthError(`${label} must be a valid http:// or https:// URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostedAuthError(`${label} must use http:// or https://.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    Boolean(
      ipv4 &&
      Number(ipv4[1]) === 127 &&
      ipv4.slice(1).every((part) => Number(part) <= 255),
    );
  if (url.protocol === "http:" && !loopback) {
    throw new HostedAuthError(`${label} must use HTTPS unless it points to a loopback address.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HostedAuthError(`${label} cannot contain credentials, a query, or a fragment.`);
  }
  return url.toString().replace(/\/$/, "");
}

export function resolveControlPlaneUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeHttpUrl(
    env.OPENBUCKET_CONTROL_PLANE_URL?.trim() || DEFAULT_CONTROL_PLANE_URL,
    "OPENBUCKET_CONTROL_PLANE_URL",
  );
}

export function resolveAuthPaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): AuthPaths {
  const configured = env.OPENBUCKET_HOME ?? env.OPENBUCKET_STATE_DIR;
  const directory = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(homeDirectory, configured)
    : join(homeDirectory, ".openbucket");
  return {
    directory,
    sessionFile: join(directory, "auth.json"),
    nodesFile: join(directory, "nodes.json"),
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

async function recoverPrivateBackup(path: string): Promise<void> {
  const backup = `${path}.bak`;
  try {
    await stat(path);
    await rm(backup, { force: true });
    return;
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  try {
    await rename(backup, path);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function withPrivateFileLock<T>(
  path: string,
  directory: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  await hardenWindowsAcl(directory, true);
  const lock = `${path}.lock`;
  const deadline = Date.now() + PRIVATE_FILE_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      try {
        const lockStat = await stat(lock);
        if (Date.now() - lockStat.mtimeMs > PRIVATE_FILE_LOCK_STALE_MS) {
          await rmdir(lock).catch(() => undefined);
          continue;
        }
      } catch (statError) {
        if (!isNodeError(statError, "ENOENT")) throw statError;
        continue;
      }
      if (Date.now() >= deadline) {
        throw new HostedAuthError(`Timed out waiting for secure access to ${path}.`);
      }
      await wait(10 + Math.floor(Math.random() * 20));
    }
  }
  try {
    await recoverPrivateBackup(path);
    return await action();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}

async function renamePrivateFile(temporary: string, path: string): Promise<void> {
  try {
    await rename(temporary, path);
    return;
  } catch (error) {
    if (
      !isNodeError(error, "EEXIST") &&
      !isNodeError(error, "EPERM") &&
      !isNodeError(error, "EACCES")
    ) {
      throw error;
    }
  }

  const backup = `${path}.bak`;
  await rm(backup, { force: true });
  let previousMoved = false;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(path, backup);
        previousMoved = true;
        break;
      } catch (error) {
        if (isNodeError(error, "ENOENT")) break;
        if (
          (!isNodeError(error, "EPERM") && !isNodeError(error, "EACCES")) ||
          attempt === 4
        ) {
          throw error;
        }
        await wait(20 * (attempt + 1));
      }
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        if (
          (!isNodeError(error, "EPERM") && !isNodeError(error, "EACCES")) ||
          attempt === 4
        ) {
          throw error;
        }
        await wait(20 * (attempt + 1));
      }
    }
    await rm(backup, { force: true });
  } catch (error) {
    if (previousMoved) await rename(backup, path).catch(() => undefined);
    throw error;
  }
}

async function atomicPrivateWrite(
  path: string,
  value: unknown,
  processId = process.pid,
): Promise<void> {
  const temporary = `${path}.${processId}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  try {
    await renamePrivateFile(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await chmod(path, 0o600).catch(() => undefined);
  await hardenWindowsAcl(path, false);
}

function validateHostedUser(value: unknown): HostedUser | undefined {
  if (!value || typeof value !== "object") return undefined;
  const user = value as Partial<HostedUser> & { _id?: unknown };
  const id = typeof user.id === "string" ? user.id : typeof user._id === "string" ? user._id : undefined;
  if (!id || typeof user.email !== "string" || (user.name !== null && typeof user.name !== "string")) return undefined;
  return {
    id,
    email: user.email,
    name: user.name,
    ...(typeof user.role === "string" ? { role: user.role } : {}),
  };
}

function validateHostedSession(value: unknown): HostedSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const session = value as Partial<HostedSession>;
  const user = validateHostedUser(session.user);
  if (
    session.version !== 1 ||
    typeof session.controlPlaneUrl !== "string" ||
    typeof session.token !== "string" ||
    session.token.length < 20 ||
    typeof session.cookieName !== "string" ||
    !/^(__Host-openbucket_session|openbucket_session)$/.test(session.cookieName) ||
    typeof session.createdAt !== "string" ||
    !user
  ) {
    return undefined;
  }
  try {
    return { ...session, controlPlaneUrl: normalizeHttpUrl(session.controlPlaneUrl, "Saved control-plane URL"), user } as HostedSession;
  } catch {
    return undefined;
  }
}

export async function readHostedSession(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): Promise<HostedSession | undefined> {
  const paths = resolveAuthPaths(env, homeDirectory);
  return withPrivateFileLock(paths.sessionFile, paths.directory, async () => {
    try {
      const session = validateHostedSession(JSON.parse(await readFile(paths.sessionFile, "utf8")));
      if (!session) throw new HostedAuthError(`Saved login at ${paths.sessionFile} is invalid. Run "openbucket login" again.`);
      return session;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      if (error instanceof SyntaxError) {
        throw new HostedAuthError(`Saved login at ${paths.sessionFile} is invalid. Run "openbucket login" again.`);
      }
      throw error;
    }
  });
}

export async function writeHostedSession(
  session: HostedSession,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  processId = process.pid,
): Promise<void> {
  const paths = resolveAuthPaths(env, homeDirectory);
  const validated = validateHostedSession(session);
  if (!validated) throw new HostedAuthError("Refusing to save an invalid OpenBucket session.");
  await withPrivateFileLock(paths.sessionFile, paths.directory, () =>
    atomicPrivateWrite(paths.sessionFile, validated, processId));
}

export async function removeHostedSession(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): Promise<boolean> {
  const { sessionFile, directory } = resolveAuthPaths(env, homeDirectory);
  return withPrivateFileLock(sessionFile, directory, async () => {
    try {
      await rm(sessionFile);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  });
}

function validateNodeCredential(value: unknown): NodeCredential | undefined {
  if (!value || typeof value !== "object") return undefined;
  const credential = value as Partial<NodeCredential>;
  if (
    credential.version !== 1 ||
    typeof credential.controlPlaneUrl !== "string" ||
    typeof credential.nodeId !== "string" ||
    typeof credential.nodeName !== "string" ||
    typeof credential.token !== "string" ||
    credential.token.length < 20 ||
    typeof credential.createdAt !== "string"
  ) {
    return undefined;
  }
  try {
    return {
      ...credential,
      controlPlaneUrl: normalizeHttpUrl(credential.controlPlaneUrl, "Saved control-plane URL"),
    } as NodeCredential;
  } catch {
    return undefined;
  }
}

async function readNodeCredentialStore(
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): Promise<NodeCredentialStore> {
  const { nodesFile } = resolveAuthPaths(env, homeDirectory);
  try {
    const parsed = JSON.parse(await readFile(nodesFile, "utf8")) as Partial<NodeCredentialStore>;
    const credentials = Array.isArray(parsed.credentials)
      ? parsed.credentials.map(validateNodeCredential).filter((item): item is NodeCredential => Boolean(item))
      : [];
    if (parsed.version !== 1 || credentials.length !== parsed.credentials?.length) {
      throw new HostedAuthError(`Saved node credentials at ${nodesFile} are invalid.`);
    }
    return { version: 1, credentials };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { version: 1, credentials: [] };
    if (error instanceof SyntaxError) {
      throw new HostedAuthError(`Saved node credentials at ${nodesFile} are invalid.`);
    }
    throw error;
  }
}

export async function findNodeCredential(
  controlPlaneUrl: string,
  nodeName: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): Promise<NodeCredential | undefined> {
  const paths = resolveAuthPaths(env, homeDirectory);
  return withPrivateFileLock(paths.nodesFile, paths.directory, async () => {
    const store = await readNodeCredentialStore(env, homeDirectory);
    return store.credentials.find(
      (credential) => credential.controlPlaneUrl === controlPlaneUrl && credential.nodeName === nodeName,
    );
  });
}

export async function writeNodeCredential(
  credential: NodeCredential,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  processId = process.pid,
): Promise<void> {
  const paths = resolveAuthPaths(env, homeDirectory);
  const validated = validateNodeCredential(credential);
  if (!validated) throw new HostedAuthError("Refusing to save an invalid OpenBucket node credential.");
  await withPrivateFileLock(paths.nodesFile, paths.directory, async () => {
    const store = await readNodeCredentialStore(env, homeDirectory);
    store.credentials = store.credentials.filter(
      (item) =>
        item.controlPlaneUrl !== validated.controlPlaneUrl ||
        (item.nodeId !== validated.nodeId && item.nodeName !== validated.nodeName),
    );
    store.credentials.push(validated);
    await atomicPrivateWrite(paths.nodesFile, store, processId);
  });
}
interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown };
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = response.status === 204 ? "" : await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function hostedError(response: Response, payload: unknown, fallback: string): HostedAuthError {
  const envelope = payload && typeof payload === "object" ? payload as ErrorEnvelope : undefined;
  const code = typeof envelope?.error?.code === "string" ? envelope.error.code : undefined;
  const message = typeof envelope?.error?.message === "string" ? envelope.error.message : fallback;
  return new HostedAuthError(message, { status: response.status, code });
}

function authHeaders(session: Pick<HostedSession, "token" | "cookieName">): Headers {
  const headers = new Headers();
  headers.set("cookie", `${session.cookieName}=${session.token}`);
  return headers;
}

function extractSessionCookie(response: Response): { cookieName: string; token: string } | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  for (const value of values) {
    const match = /(?:^|,\s*|;\s*)(__Host-openbucket_session|openbucket_session)=([A-Za-z0-9_-]{20,})/.exec(value);
    if (match) return { cookieName: match[1], token: match[2] };
  }
  return undefined;
}

export async function loginHostedAccount(options: {
  fetch: AuthFetch;
  email: string;
  password: string;
  controlPlaneUrl: string;
}): Promise<HostedSession> {
  const controlPlaneUrl = normalizeHttpUrl(options.controlPlaneUrl, "Control-plane URL");
  let response: Response;
  try {
    response = await options.fetch(new URL("/api/auth/login", `${controlPlaneUrl}/`), {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: new URL(controlPlaneUrl).origin,
        "sec-fetch-site": "none",
      },
      body: JSON.stringify({ email: options.email, password: options.password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HostedAuthError(`Cannot reach OpenBucket at ${controlPlaneUrl}: ${reason}`);
  }
  const payload = await responsePayload(response);
  if (!response.ok) throw hostedError(response, payload, `Login failed with HTTP ${response.status}.`);
  const user = validateHostedUser(payload && typeof payload === "object" ? (payload as { user?: unknown }).user : undefined);
  const cookie = extractSessionCookie(response);
  if (!user || !cookie) {
    throw new HostedAuthError("The authentication service returned an incomplete session. Please try again.");
  }
  return {
    version: 1,
    controlPlaneUrl,
    token: cookie.token,
    cookieName: cookie.cookieName,
    user,
    createdAt: new Date().toISOString(),
  };
}

export class AuthenticatedControlPlane {
  readonly session: HostedSession;
  readonly #fetch: AuthFetch;

  constructor(session: HostedSession, fetch: AuthFetch) {
    this.session = {
      ...session,
      controlPlaneUrl: normalizeHttpUrl(session.controlPlaneUrl, "Control-plane URL"),
    };
    this.#fetch = fetch;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(path, `${this.session.controlPlaneUrl}/`);
    if (url.origin !== new URL(this.session.controlPlaneUrl).origin) {
      throw new HostedAuthError("Refusing to send an OpenBucket credential to another origin.");
    }
    const headers = new Headers(options.headers);
    const method = (options.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      if (!headers.has("origin")) headers.set("origin", new URL(this.session.controlPlaneUrl).origin);
      if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "none");
    }
    authHeaders(this.session).forEach((value, name) => {
      if (!headers.has(name)) headers.set(name, value);
    });
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await this.#fetch(url, {
        ...options,
        headers,
        redirect: "error",
        signal: options.signal ?? AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HostedAuthError(`Cannot reach OpenBucket at ${this.session.controlPlaneUrl}: ${reason}`);
    }
    const payload = await responsePayload(response);
    if (!response.ok) throw hostedError(response, payload, `OpenBucket returned HTTP ${response.status}.`);
    return payload as T;
  }

  getCurrentUser(): Promise<{ user: HostedUser }> {
    return this.request("/api/auth/session");
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request("/api/auth/logout", {
      method: "POST",
      headers: { origin: new URL(this.session.controlPlaneUrl).origin, "sec-fetch-site": "none" },
      body: "{}",
    });
  }

  registerNode(name: string): Promise<NodeRegistrationResult> {
    return this.request("/api/nodes", {
      method: "POST",
      headers: {
        origin: new URL(this.session.controlPlaneUrl).origin,
        "sec-fetch-site": "none",
      },
      body: JSON.stringify({ name }),
    });
  }

  rotateNodeToken(nodeId: string): Promise<{ node: HostedNodeSummary; credential: { token: string; createdAt: string } }> {
    return this.request(`/api/nodes/${encodeURIComponent(nodeId)}/rotate-token`, {
      method: "POST",
      headers: {
        origin: new URL(this.session.controlPlaneUrl).origin,
        "sec-fetch-site": "none",
      },
      body: "{}",
    });
  }
}

export async function rotateSavedNodeCredential(options: {
  session: HostedSession;
  credential: NodeCredential;
  fetch: AuthFetch;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  processId?: number;
}): Promise<NodeCredential> {
  const rotated = await new AuthenticatedControlPlane(options.session, options.fetch)
    .rotateNodeToken(options.credential.nodeId);
  const node = rotated?.node;
  const replacement = rotated?.credential;
  if (
    !node ||
    node.id !== options.credential.nodeId ||
    node.name !== options.credential.nodeName ||
    !replacement
  ) {
    throw new HostedAuthError("The control plane returned a mismatched replacement node credential.");
  }
  const credential = validateNodeCredential({
    version: 1,
    controlPlaneUrl: options.session.controlPlaneUrl,
    nodeId: node.id,
    nodeName: node.name,
    token: replacement.token,
    createdAt: replacement.createdAt,
  });
  if (!credential) {
    throw new HostedAuthError("The control plane did not return a usable replacement node credential.");
  }
  await writeNodeCredential(
    credential,
    options.env ?? process.env,
    options.homeDirectory ?? homedir(),
    options.processId ?? process.pid,
  );
  return credential;
}

export function createNodeControlPlane(options: {
  controlPlaneUrl: string;
  nodeToken: string;
  fetch: AuthFetch;
}): { heartbeat(input: Record<string, unknown>): Promise<Record<string, unknown>> } {
  const controlPlaneUrl = normalizeHttpUrl(options.controlPlaneUrl, "Control-plane URL");
  const request = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await options.fetch(new URL("/api/node/heartbeat", `${controlPlaneUrl}/`), {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${options.nodeToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HostedAuthError(`Cannot report to OpenBucket at ${controlPlaneUrl}: ${reason}`);
    }
    const payload = await responsePayload(response);
    if (!response.ok) throw hostedError(response, payload, `Heartbeat failed with HTTP ${response.status}.`);
    return payload as Record<string, unknown>;
  };
  return { heartbeat: request };
}
