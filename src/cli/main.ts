#!/usr/bin/env node

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection, createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import {
  AuthenticatedControlPlane,
  createNodeControlPlane,
  findNodeCredential,
  writeNodeCredential,
  HostedAuthError,
  defaultAuthPrompt,
  loginHostedAccount,
  readAuthStdin,
  readHostedSession,
  removeHostedSession,
  rotateSavedNodeCredential,
  resolveControlPlaneUrl,
  writeHostedSession,
  type HostedSession,
  type NodeCredential,
} from "./auth-session.js";
import { startQuickTunnel, type QuickTunnelHandle } from "./tunnel.js";
import * as prompts from "@clack/prompts";
import pc from "picocolors";

export const DEFAULT_MANAGEMENT_PORT = 7272;
export const DEFAULT_S3_PORT = 8333;
export const DEFAULT_MANAGEMENT_HOST = "127.0.0.1";
export const DEFAULT_S3_HOST = "127.0.0.1";
export const DEFAULT_DASHBOARD_URL = "http://localhost:3000";

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_INACTIVE = 3;
const EXIT_API = 4;
const EXIT_DOCTOR = 5;

type CLIOptionValue = string | boolean;

export interface ParsedCLICommand {
  command:
    | "serve"
    | "login"
    | "logout"
    | "whoami"
    | "stop"
    | "status"
    | "logs"
    | "doctor"
    | "tunnel"
    | "dashboard"
    | "buckets"
    | "bucket"
    | "objects"
    | "key"
    | "keys"
    | "share"
    | "config"
    | "version"
    | "help";
  subcommand?: "create" | "delete" | "revoke" | "setup" | "status" | "update";
  positionals: string[];
  options: Record<string, CLIOptionValue>;
  raw: string[];
}

export interface ResolvedServeConfig {
  storageRoot: string;
  nodeName: string;
  managementHost: string;
  managementPort: number;
  s3Host: string;
  s3Port: number;
  publicBaseUrl?: string;
  dashboardUrl?: string;
  allowedOrigins: string[];
  serveDashboard: boolean;
  showInitialCredentials: boolean;
  quickTunnel: boolean;
  cloudflaredPath: string;
  adminToken?: string;
  detach: boolean;
  openDashboard: boolean;
  internalForeground: boolean;
  offlineDevelopment: boolean;
  managementUrl: string;
  s3Url: string;
}

export interface ActiveDaemonState {
  version: 1;
  pid: number;
  managementUrl: string;
  s3Url?: string;
  dashboardUrl?: string;
  dashboardApiUrl?: string;
  publicUrl?: string;
  publicManagementUrl?: string;
  tunnelMode?: "quick" | "managed";
  nodeApiUrl?: string;
  root: string;
  node: string;
  token?: string;
  startedAt: string;
  initialCredentials?: Record<string, unknown>;
}

interface OutputWriter {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface CLIIO {
  stdout: OutputWriter;
  stderr: OutputWriter;
  env: NodeJS.ProcessEnv;
  cwd: () => string;
  homedir: () => string;
  fetch: FetchLike;
  spawn: SpawnLike;
  terminateProcessTree: (child: ChildProcess) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  platform: NodeJS.Platform;
  execPath: string;
  execArgv: string[];
  pid: number;
  cliPath: string;
  prompt: (message: string, secret?: boolean) => Promise<string>;
  readStdin: () => Promise<string>;
}

export class CLIUsageError extends Error {
  readonly exitCode = EXIT_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "CLIUsageError";
  }
}

class CLIInactiveError extends Error {
  readonly exitCode = EXIT_INACTIVE;

  constructor(message = "OpenBucket is not running.") {
    super(message);
    this.name = "CLIInactiveError";
  }
}

export class CLIApiError extends Error {
  readonly exitCode = EXIT_API;
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "CLIApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function waitForChildClose(child: ChildProcess, timeoutMilliseconds: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveClose) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onClose);
      child.removeListener("close", onClose);
      resolveClose(closed);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMilliseconds);
    child.once("exit", onClose);
    child.once("close", onClose);
  });
}

async function terminateDetachedProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  const alreadyStopped = child.exitCode !== null || child.signalCode !== null;
  if (!pid && alreadyStopped) return;
  if (process.platform === "win32" && pid) {
    await new Promise<void>((resolveTaskkill) => {
      let taskkill: ChildProcess;
      try {
        taskkill = nodeSpawn(
          "taskkill.exe",
          ["/pid", String(pid), "/t", "/f"],
          {
            stdio: "ignore",
            windowsHide: true,
            shell: false,
          },
        );
      } catch {
        resolveTaskkill();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveTaskkill();
      };
      const timer = setTimeout(finish, 5_000);
      taskkill.once("error", finish);
      taskkill.once("close", finish);
    });
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForChildClose(child, 2_000);
    }
    return;
  }

  let groupSignalled = false;
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
      groupSignalled = true;
    } catch {
      // The process group may have already gone away.
    }
  }
  if (!groupSignalled && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
  const childClosed = await waitForChildClose(child, 2_000);
  if (pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      if (!childClosed && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  } else if (!childClosed && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await waitForChildClose(child, 2_000);
}

function defaultIO(overrides: Partial<CLIIO> = {}): CLIIO {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: () => process.cwd(),
    homedir,
    fetch: globalThis.fetch.bind(globalThis),
    spawn: (command, args, options) => nodeSpawn(command, [...args], options),
    terminateProcessTree: terminateDetachedProcessTree,
    sleep: (milliseconds) =>
      new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    platform: process.platform,
    execPath: process.execPath,
    execArgv: [...process.execArgv],
    pid: process.pid,
    cliPath: fileURLToPath(import.meta.url),
    prompt: defaultAuthPrompt,
    readStdin: readAuthStdin,
    ...overrides,
  };
}

function writeLine(writer: OutputWriter, value = ""): void {
  writer.write(`${value}\n`);
}

function optionKey(name: string): string {
  return name.replace(/-([a-z])/g, (_match, character: string) =>
    character.toUpperCase(),
  );
}

interface ParsedOptions {
  options: Record<string, CLIOptionValue>;
  positionals: string[];
}

function parseOptions(
  tokens: string[],
  valueOptions: readonly string[],
  flagOptions: readonly string[],
): ParsedOptions {
  const values = new Set(valueOptions);
  const flags = new Set(flagOptions);
  const options: Record<string, CLIOptionValue> = {};
  const positionals: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (positionalOnly) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    if (!token.startsWith("--")) {
      throw new CLIUsageError(`Unknown option: ${token}`);
    }

    const separator = token.indexOf("=");
    const name = token.slice(2, separator === -1 ? undefined : separator);
    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    if (values.has(name)) {
      const value = inlineValue ?? tokens[index + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
        throw new CLIUsageError(`Option --${name} requires a value.`);
      }
      if (inlineValue === undefined) index += 1;
      options[optionKey(name)] = value;
      continue;
    }
    if (flags.has(name)) {
      if (inlineValue !== undefined) {
        throw new CLIUsageError(`Option --${name} does not accept a value.`);
      }
      if (name.startsWith("no-")) {
        options[optionKey(name.slice(3))] = false;
      } else {
        options[optionKey(name)] = true;
      }
      continue;
    }
    throw new CLIUsageError(`Unknown option: --${name}`);
  }

  return { options, positionals };
}

function assertPositionals(
  label: string,
  positionals: string[],
  minimum: number,
  maximum = minimum,
): void {
  if (positionals.length < minimum || positionals.length > maximum) {
    throw new CLIUsageError(`Usage: ${label}`);
  }
}

/** Parse CLI arguments without reading process state. */
export function parseCLIArgs(argv: readonly string[]): ParsedCLICommand {
  const raw = [...argv];
  if (raw.length === 0) {
    return { command: "help", positionals: [], options: {}, raw };
  }

  const helpIndex = raw.findIndex((token) => token === "--help" || token === "-h");
  if (helpIndex !== -1) {
    const topic = raw[0].startsWith("-") ? undefined : raw[0];
    return {
      command: "help",
      positionals: topic ? [topic] : [],
      options: {},
      raw,
    };
  }
  if (raw.length === 1 && (raw[0] === "--version" || raw[0] === "-v")) {
    return { command: "version", positionals: [], options: {}, raw };
  }

  const enteredCommand = raw[0].toLowerCase();
  const command = enteredCommand === "start" ? "serve" : enteredCommand;
  const tail = raw.slice(1);
  let parsed: ParsedOptions;

  switch (command) {
    case "serve": {
      parsed = parseOptions(
        tail,
        [
          "name",
          "management-port",
          "s3-port",
          "host",
          "public-url",
          "dashboard-url",
        ],
        [
          "detach",
          "tunnel",
          "no-tunnel",
          "offline",
          "no-open",
          "no-credentials",
          "internal-foreground",
        ],
      );
      assertPositionals(
        `${enteredCommand} <directory> [--name N] [--management-port P] [--s3-port P] [--host H] [--public-url URL] [--dashboard-url URL] [--detach] [--tunnel|--no-tunnel] [--offline] [--no-open] [--no-credentials]`,
        parsed.positionals,
        0,
        1,
      );
      return { command: "serve", ...parsed, raw };
    }
    case "login": {
      parsed = parseOptions(tail, ["email", "control-plane-url"], ["password-stdin"]);
      assertPositionals("login [--email EMAIL] [--password-stdin] [--control-plane-url URL]", parsed.positionals, 0);
      return { command: "login", ...parsed, raw };
    }
    case "logout": {
      parsed = parseOptions(tail, [], []);
      assertPositionals("logout", parsed.positionals, 0);
      return { command: "logout", ...parsed, raw };
    }
    case "whoami": {
      parsed = parseOptions(tail, [], ["json"]);
      assertPositionals("whoami [--json]", parsed.positionals, 0);
      return { command: "whoami", ...parsed, raw };
    }
    case "stop":
    case "dashboard":
    case "config":
    case "version":
    case "keys": {
      parsed = parseOptions(tail, [], []);
      assertPositionals(command, parsed.positionals, 0);
      return { command, ...parsed, raw } as ParsedCLICommand;
    }
    case "status": {
      parsed = parseOptions(tail, [], ["json"]);
      assertPositionals("status [--json]", parsed.positionals, 0);
      return { command: "status", ...parsed, raw };
    }
    case "logs": {
      parsed = parseOptions(tail, ["limit"], ["follow"]);
      assertPositionals("logs [--follow] [--limit N]", parsed.positionals, 0);
      return { command: "logs", ...parsed, raw };
    }
    case "doctor": {
      parsed = parseOptions(tail, [], []);
      assertPositionals("doctor [directory]", parsed.positionals, 0, 1);
      return { command: "doctor", ...parsed, raw };
    }
    case "tunnel": {
      const subcommand = tail[0]?.toLowerCase() ?? "status";
      if (subcommand !== "setup" && subcommand !== "status" && subcommand !== "update") {
        throw new CLIUsageError("Usage: tunnel <setup|status|update>");
      }
      parsed = parseOptions(tail.slice(subcommand === "status" && tail.length === 0 ? 0 : 1), ["cloudflared-path"], ["yes"]);
      assertPositionals(`tunnel ${subcommand} [--cloudflared-path PATH] [--yes]`, parsed.positionals, 0);
      return { command: "tunnel", subcommand, ...parsed, raw };
    }
    case "buckets":
    case "list":
    case "buckets/list": {
      parsed = parseOptions(tail, [], []);
      assertPositionals("buckets", parsed.positionals, 0);
      return { command: "buckets", ...parsed, raw };
    }
    case "bucket": {
      const subcommand = tail[0]?.toLowerCase();
      if (subcommand === "create") {
        parsed = parseOptions(tail.slice(1), [], ["public"]);
        assertPositionals("bucket create <name> [--public]", parsed.positionals, 1);
        return { command: "bucket", subcommand, ...parsed, raw };
      }
      if (subcommand === "delete") {
        parsed = parseOptions(tail.slice(1), [], ["force"]);
        assertPositionals("bucket delete <name> [--force]", parsed.positionals, 1);
        return { command: "bucket", subcommand, ...parsed, raw };
      }
      throw new CLIUsageError("Usage: bucket <create|delete> ...");
    }
    case "objects": {
      parsed = parseOptions(tail, ["prefix"], []);
      assertPositionals("objects <bucket> [--prefix P]", parsed.positionals, 1);
      return { command: "objects", ...parsed, raw };
    }
    case "key": {
      const subcommand = tail[0]?.toLowerCase();
      if (subcommand === "create") {
        parsed = parseOptions(tail.slice(1), ["name", "bucket"], ["read-only"]);
        assertPositionals(
          "key create [--name N] [--read-only] [--bucket B]",
          parsed.positionals,
          0,
        );
        return { command: "key", subcommand, ...parsed, raw };
      }
      if (subcommand === "revoke") {
        parsed = parseOptions(tail.slice(1), [], []);
        assertPositionals("key revoke <id>", parsed.positionals, 1);
        return { command: "key", subcommand, ...parsed, raw };
      }
      throw new CLIUsageError("Usage: key <create|revoke> ...");
    }
    case "share": {
      parsed = parseOptions(tail, ["expires"], []);
      assertPositionals("share <bucket> <key> [--expires DURATION]", parsed.positionals, 2);
      return { command: "share", ...parsed, raw };
    }
    case "help": {
      parsed = parseOptions(tail, [], []);
      assertPositionals("help [command]", parsed.positionals, 0, 1);
      return { command: "help", ...parsed, raw };
    }
    default:
      throw new CLIUsageError(
        `Unknown command: ${raw[0]}. Run \"openbucket help\" for usage.`,
      );
  }
}

/** Parse a human duration and return whole seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(value.trim());
  if (!match) {
    throw new CLIUsageError(
      `Invalid duration \"${value}\". Use a value such as 5m, 1h, 1d, or 7d.`,
    );
  }
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
  };
  const seconds = amount * multipliers[match[2].toLowerCase()];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new CLIUsageError(`Duration \"${value}\" must be greater than zero.`);
  }
  if (seconds > 7 * 24 * 60 * 60) {
    throw new CLIUsageError(`Duration \"${value}\" cannot exceed 7 days.`);
  }
  return seconds;
}

export const parseDurationToSeconds = parseDuration;

function parsePort(value: CLIOptionValue | undefined, fallback: number, label: string): number {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new CLIUsageError(`${label} must be an integer between 0 and 65535.`);
  }
  return port;
}

function parseEnvironmentBoolean(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new CLIUsageError(`${label} must be true or false.`);
}

function parseTunnelEnvironment(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "quick", "cloudflare"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "none", "disabled"].includes(normalized)) return false;
  throw new CLIUsageError("OPENBUCKET_TUNNEL must be 'quick' or false.");
}

function normalizeOptionalUrl(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CLIUsageError(`${label} must be a valid http:// or https:// URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CLIUsageError(`${label} must use http:// or https://.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CLIUsageError(`${label} cannot contain credentials, a query, or a fragment.`);
  }
  return url.toString().replace(/\/$/, "");
}

function bracketHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function connectableHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host;
}

function connectableUrl(value: string): string {
  try {
    const url = new URL(value);
    if (["0.0.0.0", "[::]", "::"].includes(url.hostname)) {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

/** Resolve command flags and OPENBUCKET_* environment settings into daemon options. */
export function resolveServeConfig(
  parsed: ParsedCLICommand,
  env: NodeJS.ProcessEnv = process.env,
  currentDirectory = process.cwd(),
): ResolvedServeConfig {
  if (parsed.command !== "serve") {
    throw new CLIUsageError("resolveServeConfig requires a serve command.");
  }
  const directoryValue = parsed.positionals[0] ?? env.OPENBUCKET_STORAGE_ROOT;
  if (!directoryValue) {
    throw new CLIUsageError(
      "A storage directory is required. Run: openbucket serve <directory>",
    );
  }
  const storageRoot = resolve(currentDirectory, directoryValue);
  const sharedHost = parsed.options.host as string | undefined;
  const managementHost =
    sharedHost ??
    env.OPENBUCKET_MANAGEMENT_HOST ??
    env.OPENBUCKET_HOST ??
    DEFAULT_MANAGEMENT_HOST;
  const s3Host =
    sharedHost ?? env.OPENBUCKET_S3_HOST ?? env.OPENBUCKET_HOST ?? DEFAULT_S3_HOST;
  const managementPort = parsePort(
    parsed.options.managementPort ?? env.OPENBUCKET_MANAGEMENT_PORT,
    DEFAULT_MANAGEMENT_PORT,
    "Management port",
  );
  const s3Port = parsePort(
    parsed.options.s3Port ?? env.OPENBUCKET_S3_PORT,
    DEFAULT_S3_PORT,
    "S3 port",
  );
  const nodeName = String(
    parsed.options.name ??
      env.OPENBUCKET_NODE_NAME ??
      env.OPENBUCKET_NAME ??
      basename(storageRoot) ??
      "openbucket",
  );
  const publicBaseUrl = normalizeOptionalUrl(
    (parsed.options.publicUrl as string | undefined) ??
      env.OPENBUCKET_PUBLIC_BASE_URL ??
      env.OPENBUCKET_PUBLIC_URL,
    "Public URL",
  );
  const dashboardUrl = normalizeOptionalUrl(
    (parsed.options.dashboardUrl as string | undefined) ??
      env.OPENBUCKET_DASHBOARD_URL ??
      DEFAULT_DASHBOARD_URL,
    "Dashboard URL",
  );
  const allowedOrigins = new Set(
    (env.OPENBUCKET_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
  if (dashboardUrl) {
    try {
      const origin = new URL(dashboardUrl).origin;
      allowedOrigins.add(origin);
      const dashboard = new URL(origin);
      if (dashboard.hostname === "localhost") {
        dashboard.hostname = "127.0.0.1";
        allowedOrigins.add(dashboard.origin);
      } else if (dashboard.hostname === "127.0.0.1") {
        dashboard.hostname = "localhost";
        allowedOrigins.add(dashboard.origin);
      }
    } catch {
      // normalizeOptionalUrl already validates HTTP(S) URLs.
    }
  }
  const detach =
    parsed.options.detach === true ||
    parseEnvironmentBoolean(env.OPENBUCKET_DETACH, false, "OPENBUCKET_DETACH");
  const openFromEnvironment = parseEnvironmentBoolean(
    env.OPENBUCKET_OPEN_DASHBOARD,
    true,
    "OPENBUCKET_OPEN_DASHBOARD",
  );
  const openDashboard = parsed.options.open === false ? false : openFromEnvironment;
  const serveDashboard = parseEnvironmentBoolean(
    env.OPENBUCKET_SERVE_DASHBOARD,
    true,
    "OPENBUCKET_SERVE_DASHBOARD",
  );
  const showCredentialsFromEnvironment = parseEnvironmentBoolean(
    env.OPENBUCKET_SHOW_INITIAL_CREDENTIALS,
    true,
    "OPENBUCKET_SHOW_INITIAL_CREDENTIALS",
  );
  const showInitialCredentials =
    parsed.options.credentials === false ? false : showCredentialsFromEnvironment;
  const offlineDevelopment =
    parsed.options.offline === true ||
    parseEnvironmentBoolean(
      env.OPENBUCKET_OFFLINE,
      false,
      "OPENBUCKET_OFFLINE",
    );
  const tunnelFromEnvironment = parseTunnelEnvironment(
    env.OPENBUCKET_TUNNEL,
    !offlineDevelopment && !publicBaseUrl,
  );
  const quickTunnel =
    parsed.options.tunnel === true
      ? true
      : parsed.options.tunnel === false
        ? false
        : tunnelFromEnvironment;
  if (quickTunnel && publicBaseUrl) {
    throw new CLIUsageError(
      "--tunnel generates its public URL; remove --public-url/OPENBUCKET_PUBLIC_BASE_URL.",
    );
  }
  const cloudflaredPath = env.OPENBUCKET_CLOUDFLARED_PATH?.trim() || "cloudflared";
  const internalForeground = parsed.options.internalForeground === true;
  const configuredAdminToken = (env.OPENBUCKET_ADMIN_TOKEN ?? env.OPENBUCKET_TOKEN)?.trim() || undefined;
  if (configuredAdminToken && Buffer.byteLength(configuredAdminToken, "utf8") < 32) {
    throw new CLIUsageError("OPENBUCKET_ADMIN_TOKEN must contain at least 32 UTF-8 bytes.");
  }
  const managementUrl = `http://${bracketHost(connectableHost(managementHost))}:${managementPort}`;
  const s3Url = `http://${bracketHost(connectableHost(s3Host))}:${s3Port}`;

  return {
    storageRoot,
    nodeName,
    managementHost,
    managementPort,
    s3Host,
    s3Port,
    publicBaseUrl,
    dashboardUrl,
    allowedOrigins: [...allowedOrigins],
    serveDashboard,
    showInitialCredentials,
    quickTunnel,
    cloudflaredPath,
    adminToken: configuredAdminToken,
    detach,
    openDashboard,
    internalForeground,
    offlineDevelopment,
    managementUrl,
    s3Url,
  };
}

export interface StatePaths {
  directory: string;
  activeFile: string;
  logFile: string;
}

export function resolveStatePaths(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): StatePaths {
  const configured = env.OPENBUCKET_HOME ?? env.OPENBUCKET_STATE_DIR;
  const directory = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(homeDirectory, configured)
    : join(homeDirectory, ".openbucket");
  return {
    directory,
    activeFile: join(directory, "active.json"),
    logFile: env.OPENBUCKET_LOG_FILE
      ? resolve(env.OPENBUCKET_LOG_FILE)
      : join(directory, "daemon.log"),
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function validateActiveState(value: unknown): ActiveDaemonState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ActiveDaemonState>;
  if (
    candidate.version !== 1 ||
    !Number.isInteger(candidate.pid) ||
    typeof candidate.managementUrl !== "string" ||
    typeof candidate.root !== "string" ||
    typeof candidate.node !== "string" ||
    typeof candidate.startedAt !== "string"
  ) {
    return undefined;
  }
  return candidate as ActiveDaemonState;
}

export async function readActiveState(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): Promise<ActiveDaemonState | undefined> {
  const { activeFile } = resolveStatePaths(env, homeDirectory);
  try {
    const parsed: unknown = JSON.parse(await readFile(activeFile, "utf8"));
    return validateActiveState(parsed);
  } catch (error) {
    if (isNodeError(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeActiveState(state: ActiveDaemonState, io: CLIIO): Promise<void> {
  const paths = resolveStatePaths(io.env, io.homedir());
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${paths.activeFile}.${io.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await rename(temporaryFile, paths.activeFile);
  } catch (error) {
    if (!isNodeError(error, "EEXIST") && !isNodeError(error, "EPERM")) {
      await rm(temporaryFile, { force: true });
      throw error;
    }
    await rm(paths.activeFile, { force: true });
    await rename(temporaryFile, paths.activeFile);
  }
}

async function removeActiveStateIfOwned(pid: number, io: CLIIO): Promise<void> {
  const paths = resolveStatePaths(io.env, io.homedir());
  const current = await readActiveState(io.env, io.homedir());
  if (current?.pid !== pid) return;
  await rm(paths.activeFile, { force: true });
}

interface ApiTarget {
  baseUrl: string;
  token?: string;
  state?: ActiveDaemonState;
}

async function getApiTarget(io: CLIIO): Promise<ApiTarget> {
  const state = await readActiveState(io.env, io.homedir());
  const configuredUrl = normalizeOptionalUrl(
    io.env.OPENBUCKET_MANAGEMENT_URL,
    "OPENBUCKET_MANAGEMENT_URL",
  );
  if (!state && !configuredUrl) throw new CLIInactiveError();
  const configuredToken = io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN;
  return {
    baseUrl: configuredUrl ?? state!.managementUrl,
    token: configuredToken ?? (configuredUrl ? undefined : state?.token),
    state: configuredUrl ? undefined : state,
  };
}

interface ApiRequestOptions extends RequestInit {
  timeoutMilliseconds?: number;
}

async function apiRequest<T>(
  io: CLIIO,
  target: ApiTarget,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (target.token) headers.set("authorization", `Bearer ${target.token}`);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 8_000;
  let response: Response;
  try {
    response = await io.fetch(new URL(path, `${target.baseUrl}/`), {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CLIInactiveError(
      `Cannot reach OpenBucket at ${target.baseUrl}: ${reason}`,
    );
  }

  const text = response.status === 204 ? "" : await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const structured =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as {
            error?: { code?: string; message?: string; details?: unknown };
          }).error
        : undefined;
    throw new CLIApiError(
      structured?.message ??
        (typeof payload === "string"
          ? payload
          : `Management API returned HTTP ${response.status}.`),
      response.status,
      structured?.code,
      structured?.details,
    );
  }
  return payload as T;
}

async function healthCheck(
  io: CLIIO,
  target: ApiTarget,
  timeoutMilliseconds = 1_500,
): Promise<boolean> {
  try {
    const health = await apiRequest<{ ok?: boolean }>(io, target, "/healthz", {
      timeoutMilliseconds,
    });
    return health?.ok === true;
  } catch {
    return false;
  }
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function humanBytes(value: unknown): string {
  const bytes = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1_000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let amount = bytes;
  let unit = "B";
  for (const candidate of units) {
    amount /= 1_000;
    unit = candidate;
    if (amount < 1_000) break;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${unit}`;
}

function humanDuration(secondsValue: unknown): string {
  const seconds = Number(secondsValue ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m`;
  }
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3_600)}h`;
}

interface TableColumn<Row> {
  header: string;
  value: (row: Row) => unknown;
}

function renderTable<Row>(rows: Row[], columns: TableColumn<Row>[]): string {
  if (rows.length === 0) return "";
  const values = rows.map((row) =>
    columns.map((column) => String(column.value(row) ?? "—").replace(/[\r\n]+/g, " ")),
  );
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...values.map((row) => row[index].length)),
  );
  const header = columns
    .map((column, index) => column.header.padEnd(widths[index]))
    .join("  ");
  const divider = widths.map((width) => "─".repeat(width)).join("  ");
  const body = values
    .map((row) => row.map((value, index) => value.padEnd(widths[index])).join("  "))
    .join("\n");
  return `${header}\n${divider}\n${body}`;
}

function formatTimestamp(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function printBanner(
  io: CLIIO,
  state: ActiveDaemonState,
  initialCredentials?: Record<string, unknown>,
): void {
  writeLine(io.stdout, "");
  writeLine(io.stdout, "  OpenBucket");
  writeLine(io.stdout, "  Local disk. Cloud interface.");
  writeLine(io.stdout, "");
  writeLine(io.stdout, "  ✓ Daemon running");
  writeLine(io.stdout, `  Node        ${state.node}`);
  writeLine(io.stdout, `  Storage     ${state.root}`);
  if (state.nodeApiUrl) writeLine(io.stdout, `  OpenBucket API  ${state.nodeApiUrl}`);
  if (state.dashboardUrl) {
    writeLine(io.stdout, `  Local dashboard  ${state.dashboardUrl.split("?")[0].split("#")[0]}`);
    writeLine(io.stdout, "  Reopen      openbucket dashboard");
  }
  if (initialCredentials) {
    writeLine(io.stdout, "");
    writeLine(io.stdout, "  Initial S3 credentials (shown once)");
    writeLine(
      io.stdout,
      `  Access key  ${String(initialCredentials.accessKeyId ?? "—")}`,
    );
    writeLine(
      io.stdout,
      `  Secret key  ${String(initialCredentials.secretAccessKey ?? "—")}`,
    );
  }
  writeLine(io.stdout, "");
}

function renderHelp(topic?: string): string {
  const commandHelp: Record<string, string> = {
    serve:
      "Usage: openbucket serve <directory> [--name N] [--management-port P] [--s3-port P] [--host H] [--public-url URL] [--dashboard-url URL] [--detach] [--tunnel|--no-tunnel] [--offline] [--no-open] [--no-credentials]",
    login: "Usage: openbucket login [--email EMAIL] [--password-stdin] [--control-plane-url URL]",
    logout: "Usage: openbucket logout",
    whoami: "Usage: openbucket whoami [--json]",
    start: "Usage: openbucket start <directory> [serve options]",
    stop: "Usage: openbucket stop",
    status: "Usage: openbucket status [--json]",
    dashboard: "Usage: openbucket dashboard",
    doctor: "Usage: openbucket doctor [directory]",
    tunnel: "Usage: openbucket tunnel <setup|status|update> [--cloudflared-path PATH] [--yes]",
    buckets: "Usage: openbucket buckets",
    list: "Usage: openbucket list",
    bucket:
      "Usage:\n  openbucket bucket create <name> [--public]\n  openbucket bucket delete <name> [--force]",
    objects: "Usage: openbucket objects <bucket> [--prefix P]",
    key:
      "Usage:\n  openbucket key create [--name N] [--read-only] [--bucket B]\n  openbucket key revoke <id>",
    keys: "Usage: openbucket keys",
    share: "Usage: openbucket share <bucket> <key> [--expires 1h]",
    logs: "Usage: openbucket logs [--follow] [--limit N]",
    config: "Usage: openbucket config",
    version: "Usage: openbucket version",
    help: "Usage: openbucket help [command]",
  };
  if (topic && commandHelp[topic]) return `${commandHelp[topic]}\n`;
  return `OpenBucket — turn any local directory into S3-compatible storage

Usage: openbucket <command> [options]

Account
  login                Authenticate this machine (password is hidden)
  logout               Revoke and remove the local account session
  whoami [--json]      Verify and show the active account

Daemon
  serve <directory>    Start OpenBucket (foreground by default)
  start <directory>    Alias for serve
  stop                 Stop the active daemon
  status [--json]      Show daemon and storage status
  dashboard            Securely open or re-pair the local dashboard
  logs [--follow]      Show daemon request and lifecycle logs
  doctor [directory]   Check the runtime, storage, and network
  tunnel status         Show S3 and management tunnel state
  tunnel setup          Guided Cloudflare connector and named-tunnel setup

Storage
  buckets | list       List buckets
  bucket create NAME   Create a bucket [--public]
  bucket delete NAME   Delete an empty bucket [--force]
  objects BUCKET       List objects [--prefix P]
  share BUCKET KEY     Create a share URL [--expires 1h]

S3 credentials
  keys                 List access keys
  key create           Create a key [--name N] [--read-only] [--bucket B]
  key revoke ID        Revoke a key

Other
  config               Show client configuration
  version              Show the OpenBucket version
  help [command]       Show help

Environment: OPENBUCKET_HOME, OPENBUCKET_CONTROL_PLANE_URL, OPENBUCKET_EMAIL,
OPENBUCKET_PASSWORD (automation only; prefer --password-stdin), OPENBUCKET_OFFLINE,
OPENBUCKET_STORAGE_ROOT, OPENBUCKET_HOST, OPENBUCKET_MANAGEMENT_PORT,
OPENBUCKET_S3_PORT, OPENBUCKET_PUBLIC_BASE_URL, OPENBUCKET_DASHBOARD_URL,
OPENBUCKET_SERVE_DASHBOARD, OPENBUCKET_ALLOWED_ORIGINS, OPENBUCKET_TUNNEL,
OPENBUCKET_CLOUDFLARED_PATH, OPENBUCKET_HEARTBEAT_INTERVAL_MS,
OPENBUCKET_SHOW_INITIAL_CREDENTIALS, OPENBUCKET_ADMIN_TOKEN.
`;
}

async function getProductVersion(io: CLIIO): Promise<string> {
  if (io.env.OPENBUCKET_VERSION) return io.env.OPENBUCKET_VERSION;
  try {
    const packageUrl = new URL("../../package.json", import.meta.url);
    const packageData = JSON.parse(await readFile(packageUrl, "utf8")) as {
      version?: unknown;
    };
    return typeof packageData.version === "string" ? packageData.version : "0.1.6";
  } catch {
    return "0.1.6";
  }
}

function passwordInput(value: string): string {
  const withoutFinalLineEnding = value.replace(/\r?\n$/, "");
  if (!withoutFinalLineEnding || /[\r\n]/.test(withoutFinalLineEnding)) {
    throw new CLIUsageError("Password input must contain exactly one non-empty line.");
  }
  return withoutFinalLineEnding;
}

async function runLogin(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const controlPlaneOption = parsed.options.controlPlaneUrl as string | undefined;
  const controlPlaneUrl = resolveControlPlaneUrl(
    controlPlaneOption
      ? { ...io.env, OPENBUCKET_CONTROL_PLANE_URL: controlPlaneOption }
      : io.env,
  );
  const email = (
    (parsed.options.email as string | undefined) ??
    io.env.OPENBUCKET_EMAIL ??
    await io.prompt("Email: ")
  ).trim();
  if (!email) throw new CLIUsageError("Email is required.");

  let password = "";
  try {
    password = passwordInput(
      parsed.options.passwordStdin === true
        ? await io.readStdin()
        : io.env.OPENBUCKET_PASSWORD ?? await io.prompt("Password: ", true),
    );
    const session = await loginHostedAccount({
      fetch: io.fetch,
      email,
      password,
      controlPlaneUrl,
    });
    await writeHostedSession(session, io.env, io.homedir(), io.pid);
    writeLine(io.stdout, `Logged in to ${session.controlPlaneUrl} as ${session.user.name || session.user.email} (${session.user.email}).`);
    return EXIT_SUCCESS;
  } finally {
    password = "";
  }
}

async function runLogout(io: CLIIO): Promise<number> {
  const session = await readHostedSession(io.env, io.homedir());
  if (!session) {
    writeLine(io.stdout, "You are not logged in.");
    return EXIT_SUCCESS;
  }

  let remoteWarning: string | undefined;
  try {
    await new AuthenticatedControlPlane(session, io.fetch).logout();
  } catch (error) {
    remoteWarning = error instanceof Error ? error.message : String(error);
  }
  await removeHostedSession(io.env, io.homedir());
  writeLine(io.stdout, "Logged out. The local account session was removed.");
  if (remoteWarning) {
    writeLine(io.stderr, `Warning: the hosted session could not be revoked: ${remoteWarning}`);
  }
  return EXIT_SUCCESS;
}

async function runWhoAmI(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const session = await readHostedSession(io.env, io.homedir());
  if (!session) {
    throw new HostedAuthError('Not logged in. Run "openbucket login" first.');
  }
  const result = await new AuthenticatedControlPlane(session, io.fetch).getCurrentUser();
  session.user = result.user;
  await writeHostedSession(session, io.env, io.homedir(), io.pid);
  if (parsed.options.json === true) {
    writeLine(io.stdout, stringifyJson({
      user: result.user,
      controlPlaneUrl: session.controlPlaneUrl,
    }));
  } else {
    writeLine(io.stdout, `${result.user.name || result.user.email} <${result.user.email}>`);
    writeLine(io.stdout, `Control plane: ${session.controlPlaneUrl}`);
  }
  return EXIT_SUCCESS;
}

async function requireHostedSession(
  config: ResolvedServeConfig,
  io: CLIIO,
): Promise<HostedSession | undefined> {
  if (config.offlineDevelopment) {
    writeLine(
      io.stderr,
      "Warning: OPENBUCKET_OFFLINE/--offline is for local development only; hosted registration, usage reporting, and public discovery are disabled.",
    );
    return undefined;
  }
  const session = await readHostedSession(io.env, io.homedir());
  if (!session) {
    throw new HostedAuthError('OpenBucket serve requires an account. Run "openbucket login" first, or use --offline for local development.');
  }
  const expectedControlPlane = resolveControlPlaneUrl(io.env);
  if (session.controlPlaneUrl !== expectedControlPlane) {
    throw new HostedAuthError(
      `The saved login belongs to ${session.controlPlaneUrl}. Run "openbucket login --control-plane-url ${expectedControlPlane}" first.`,
    );
  }
  let current: { user: HostedSession["user"] };
  try {
    current = await new AuthenticatedControlPlane(session, io.fetch).getCurrentUser();
  } catch (error) {
    if (error instanceof HostedAuthError && error.status === 401) {
      throw new HostedAuthError('Your OpenBucket session expired. Run "openbucket login" again.', {
        status: error.status,
        code: error.code,
      });
    }
    throw error;
  }
  session.user = current.user;
  await writeHostedSession(session, io.env, io.homedir(), io.pid);
  return session;
}
interface DaemonHandle {
  config: {
    managementUrl?: string;
    s3Url?: string;
    filesUrl?: string;
    publicBaseUrl?: string;
    dashboardUrl?: string;
    allowedOrigins?: string[];
    adminToken?: string;
    nodeName?: string;
  };
  initialCredentials?: Record<string, unknown>;
  stop: () => void | Promise<void>;
  stopped: Promise<void>;
}

interface DashboardServerHandle {
  url: string;
  stop(): Promise<void>;
}

async function ensureStorageDirectory(storageRoot: string): Promise<void> {
  await mkdir(storageRoot, { recursive: true });
  const storageStat = await stat(storageRoot);
  if (!storageStat.isDirectory()) {
    throw new CLIUsageError(`Storage path is not a directory: ${storageRoot}`);
  }
  await access(storageRoot, fsConstants.R_OK | fsConstants.W_OK);
}

async function ensureNoRunningDaemon(io: CLIIO): Promise<void> {
  const active = await readActiveState(io.env, io.homedir());
  if (!active) return;
  const healthy = await healthCheck(io, {
    baseUrl: active.managementUrl,
    token: io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN ?? active.token,
    state: active,
  });
  if (healthy) {
    throw new Error(
      `OpenBucket is already running (PID ${active.pid}) at ${active.managementUrl}.`,
    );
  }
  await removeActiveStateIfOwned(active.pid, io);
}

function openDashboard(url: string, io: CLIIO): void {
  const command =
    io.platform === "win32" ? "explorer.exe" : io.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = io.spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The user can retry safely with `openbucket dashboard`.
  }
}

async function runDashboard(io: CLIIO): Promise<number> {
  const active = await readActiveState(io.env, io.homedir());
  if (!active) throw new CLIInactiveError();
  if (!active.dashboardUrl) throw new Error("This daemon does not have a dashboard URL configured.");
  const token = io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN ?? active.token;
  const target = { baseUrl: active.managementUrl, token, state: active };
  if (!(await healthCheck(io, target))) throw new CLIInactiveError();
  const launchUrl = dashboardLaunchUrl(
    active.dashboardUrl,
    active.dashboardApiUrl ?? active.managementUrl,
    token,
  );
  if (!launchUrl) throw new Error("The dashboard URL is invalid.");
  openDashboard(launchUrl, io);
  writeLine(io.stdout, "Opening your secure OpenBucket dashboard.");
  writeLine(io.stdout, "The one-time pairing fragment is removed from the address bar after launch.");
  return EXIT_SUCCESS;
}

function isLocalDashboardUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

export function dashboardLaunchUrl(value: string | undefined, managementUrl: string, token?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.searchParams.set("api", connectableUrl(managementUrl));
    if (token) {
      const fragment = new URLSearchParams();
      fragment.set("token", token);
      url.hash = fragment.toString();
    }
    return url.toString();
  } catch {
    return value;
  }
}

function dashboardBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

type QuickTunnelSurface = "s3" | "management" | "dashboard";

async function startQuickTunnelSurfaces(
  surfaces: Array<{ surface: QuickTunnelSurface; origin: string }>,
  executable: string,
): Promise<Map<QuickTunnelSurface, QuickTunnelHandle>> {
  const results = await Promise.allSettled(
    surfaces.map(async ({ surface, origin }) => ({
      surface,
      handle: await startQuickTunnel({ origin, executable }),
    })),
  );
  const started = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedIndex = results.findIndex((result) => result.status === "rejected");
  if (failedIndex !== -1) {
    await Promise.allSettled(started.map(({ handle }) => handle.stop()));
    const failure = results[failedIndex] as PromiseRejectedResult;
    const surface = surfaces[failedIndex]?.surface ?? "unknown";
    throw new Error(
      `Could not start the ${surface} Quick Tunnel: ${failure.reason instanceof Error ? failure.reason.message : String(failure.reason)}`,
    );
  }
  return new Map(started.map(({ surface, handle }) => [surface, handle]));
}

async function stopQuickTunnels(
  tunnels: Map<QuickTunnelSurface, QuickTunnelHandle>,
): Promise<void> {
  await Promise.allSettled([...tunnels.values()].map((tunnel) => tunnel.stop()));
}

interface HostedNodeRuntime {
  session: HostedSession;
  credential: NodeCredential;
}

function validHostedNode(value: unknown): value is { id: string; name: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string",
  );
}

async function prepareHostedNode(
  session: HostedSession,
  config: ResolvedServeConfig,
  io: CLIIO,
): Promise<HostedNodeRuntime> {
  const controlPlane = new AuthenticatedControlPlane(session, io.fetch);
  const registration = await controlPlane.registerNode(config.nodeName);
  if (!validHostedNode(registration.node)) {
    throw new HostedAuthError("The control plane returned an invalid node registration.");
  }
  config.nodeName = registration.node.name;

  let saved = await findNodeCredential(
    session.controlPlaneUrl,
    registration.node.name,
    io.env,
    io.homedir(),
  );
  const returned = registration.credential;
  if (
    returned &&
    typeof returned.token === "string" &&
    typeof returned.managementSecret === "string" && /^[a-f0-9]{64}$/.test(returned.managementSecret) &&
    returned.token.length >= 20 &&
    typeof returned.createdAt === "string"
  ) {
    saved = {
      version: 1,
      controlPlaneUrl: session.controlPlaneUrl,
      nodeId: registration.node.id,
      nodeName: registration.node.name,
      token: returned.token,
      managementSecret: returned.managementSecret,
      createdAt: returned.createdAt,
    };
  } else if (!saved || saved.nodeId !== registration.node.id || !saved.managementSecret) {
    const rotated = await controlPlane.rotateNodeToken(registration.node.id);
    if (
      !rotated.credential ||
      typeof rotated.credential.token !== "string" ||
      typeof rotated.credential.managementSecret !== "string" || !/^[a-f0-9]{64}$/.test(rotated.credential.managementSecret) ||
      rotated.credential.token.length < 20 ||
      typeof rotated.credential.createdAt !== "string"
    ) {
      throw new HostedAuthError("The control plane did not return a usable node credential.");
    }
    saved = {
      version: 1,
      controlPlaneUrl: session.controlPlaneUrl,
      nodeId: registration.node.id,
      nodeName: registration.node.name,
      token: rotated.credential.token,
      managementSecret: rotated.credential.managementSecret,
      createdAt: rotated.credential.createdAt,
    };
  }
  await writeNodeCredential(saved, io.env, io.homedir(), io.pid);
  return { session, credential: saved };
}
interface HostedHeartbeatReporter {
  publicEndpointUnavailable(): Promise<void>;
  stop(): Promise<void>;
}

export function markQuickTunnelUnavailable(state: ActiveDaemonState): boolean {
  const changed = Boolean(state.publicUrl) || state.tunnelMode === "quick";
  delete state.publicUrl;
  if (state.tunnelMode === "quick") delete state.tunnelMode;
  return changed;
}

export function hostedTunnelAdvertisement(state: ActiveDaemonState): {
  publicS3Url?: string;
  tunnelMode: "none" | "quick" | "managed";
  publicDiscoverable: boolean;
  endpoints?: {
    s3: { url: string | null; kind: "quick" | "named" | "none"; healthy: boolean };
    management: { url: string | null; kind: "quick" | "named" | "none"; healthy: boolean };
  };
} {
  const publicS3Url = state.publicUrl;
  const tunnelMode = publicS3Url
    ? state.tunnelMode ?? "managed"
    : "none";
  return {
    ...(publicS3Url ? { publicS3Url } : {}),
    tunnelMode,
    publicDiscoverable: tunnelMode !== "none" && Boolean(publicS3Url),
    ...((publicS3Url || state.publicManagementUrl) ? { endpoints: {
      s3: { url: publicS3Url ?? null, kind: publicS3Url ? (tunnelMode === "quick" ? "quick" : "named") : "none", healthy: Boolean(publicS3Url) },
      management: { url: state.publicManagementUrl ?? null, kind: state.publicManagementUrl ? (state.tunnelMode === "quick" ? "quick" : "named") : "none", healthy: Boolean(state.publicManagementUrl) },
    } } : {}),
  };
}

export function supervisePublicQuickTunnel(options: {
  tunnel: Pick<QuickTunnelHandle, "closed">;
  state: ActiveDaemonState;
  isShuttingDown: () => boolean;
  onUnavailable: () => void | Promise<void>;
  onError?: (error: unknown) => void;
}): void {
  void options.tunnel.closed.then(() => {
    if (options.isShuttingDown()) return;
    markQuickTunnelUnavailable(options.state);
    void Promise.resolve(options.onUnavailable()).catch((error: unknown) => {
      options.onError?.(error);
    });
  }).catch((error: unknown) => {
    options.onError?.(error);
  });
}

interface LocalTelemetry {
  storage: {
    capacityBytes: number;
    usedBytes: number;
    availableBytes: number;
    bucketCount: number;
    objectCount: number;
  };
  counters: {
    requests: number;
    bytesIn: number;
    bytesOut: number;
    errors: number;
  };
}

function telemetryNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

async function collectLocalTelemetry(
  state: ActiveDaemonState,
  io: CLIIO,
): Promise<LocalTelemetry> {
  const target: ApiTarget = {
    baseUrl: state.managementUrl,
    token: state.token,
    state,
  };
  const [status, analytics] = await Promise.all([
    apiRequest<Record<string, unknown>>(io, target, "/v1/status"),
    apiRequest<Record<string, unknown>>(io, target, "/v1/analytics"),
  ]);
  const storage = status.storage && typeof status.storage === "object"
    ? status.storage as Record<string, unknown>
    : {};
  return {
    storage: {
      capacityBytes: telemetryNumber(status.capacityBytes ?? storage.totalBytes),
      usedBytes: telemetryNumber(status.usedBytes ?? storage.managedBytes ?? storage.bytes),
      availableBytes: telemetryNumber(status.availableBytes ?? storage.freeBytes),
      bucketCount: telemetryNumber(status.bucketCount ?? storage.buckets),
      objectCount: telemetryNumber(status.objectCount ?? storage.objects),
    },
    counters: {
      requests: telemetryNumber(analytics.requests),
      bytesIn: telemetryNumber(analytics.totalBytesIn),
      bytesOut: telemetryNumber(analytics.totalBytesOut),
      errors: telemetryNumber(analytics.errors),
    },
  };
}

function safeDashboardEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function startHostedHeartbeatReporter(
  runtime: HostedNodeRuntime,
  state: ActiveDaemonState,
  version: string,
  io: CLIIO,
): Promise<HostedHeartbeatReporter> {
  let remote = createNodeControlPlane({
    controlPlaneUrl: runtime.session.controlPlaneUrl,
    nodeToken: runtime.credential.token,
    fetch: io.fetch,
  });
  const baseline = await collectLocalTelemetry(state, io);
  let latest = baseline;
  let stopped = false;
  let active: Promise<void> | undefined;
  let warningShown = false;

  const payload = (online: boolean, telemetry: LocalTelemetry): Record<string, unknown> => ({
    eventId: randomUUID(),
    nodeId: runtime.credential.nodeId,
    name: runtime.credential.nodeName,
    version,
    online,
    startedAt: state.startedAt,
    storage: telemetry.storage,
    counters: {
      requests: Math.max(0, telemetry.counters.requests - baseline.counters.requests),
      bytesIn: Math.max(0, telemetry.counters.bytesIn - baseline.counters.bytesIn),
      bytesOut: Math.max(0, telemetry.counters.bytesOut - baseline.counters.bytesOut),
      errors: Math.max(0, telemetry.counters.errors - baseline.counters.errors),
    },
    ...hostedTunnelAdvertisement(state),
    managementUrl: state.publicManagementUrl ?? null,
    ...(safeDashboardEndpoint(state.dashboardUrl)
      ? { dashboardUrl: safeDashboardEndpoint(state.dashboardUrl) }
      : {}),
  });

  try {
    await remote.heartbeat(payload(true, baseline));
  } catch (error) {
    if (!(error instanceof HostedAuthError) || error.status !== 401) throw error;
    runtime.credential = await rotateSavedNodeCredential({
      session: runtime.session,
      credential: runtime.credential,
      fetch: io.fetch,
      env: io.env,
      homeDirectory: io.homedir(),
      processId: io.pid,
    });
    remote = createNodeControlPlane({
      controlPlaneUrl: runtime.session.controlPlaneUrl,
      nodeToken: runtime.credential.token,
      fetch: io.fetch,
    });
    await remote.heartbeat(payload(true, baseline));
  }

  const configuredInterval = Number(io.env.OPENBUCKET_HEARTBEAT_INTERVAL_MS ?? 30_000);
  const intervalMilliseconds =
    Number.isFinite(configuredInterval) && configuredInterval >= 5_000
      ? configuredInterval
      : 30_000;
  const timer = setInterval(() => {
    if (stopped || active) return;
    active = (async () => {
      try {
        latest = await collectLocalTelemetry(state, io);
        await remote.heartbeat(payload(true, latest));
        warningShown = false;
      } catch (error) {
        if (!warningShown) {
          writeLine(
            io.stderr,
            `Warning: hosted usage heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          warningShown = true;
        }
      } finally {
        active = undefined;
      }
    })();
  }, intervalMilliseconds);
  timer.unref();

  return {
    async publicEndpointUnavailable(): Promise<void> {
      if (stopped) return;
      markQuickTunnelUnavailable(state);
      await active?.catch(() => undefined);
      await remote.heartbeat(payload(true, latest));
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await active?.catch(() => undefined);
      try {
        latest = await collectLocalTelemetry(state, io);
      } catch {
        // The daemon may already be unavailable after an unexpected stop.
      }
      await Promise.race([
        remote.heartbeat(payload(false, latest)).then(() => undefined).catch(() => undefined),
        io.sleep(2_000),
      ]);
    },
  };
}
async function serveForeground(
  config: ResolvedServeConfig,
  io: CLIIO,
  hostedNode?: HostedNodeRuntime,
): Promise<number> {
  await ensureStorageDirectory(config.storageRoot);
  await ensureNoRunningDaemon(io);

  let hostedHeartbeat: HostedHeartbeatReporter | undefined;
  let dashboardHandle: DashboardServerHandle | undefined;
  let effectiveDashboardUrl = config.dashboardUrl;
  if (config.serveDashboard && isLocalDashboardUrl(config.dashboardUrl)) {
    try {
      const dashboardModuleUrl = new URL(
        import.meta.url.endsWith(".ts") ? "../dashboard/server.ts" : "../dashboard/server.js",
        import.meta.url,
      ).href;
      const dashboardModule = await import(dashboardModuleUrl) as {
        startDashboardServer(options: { url: string }): Promise<DashboardServerHandle>;
      };
      dashboardHandle = await dashboardModule.startDashboardServer({ url: config.dashboardUrl });
      effectiveDashboardUrl = dashboardHandle.url;
    } catch (error) {
      writeLine(io.stderr, `Dashboard server unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const effectiveOrigins = new Set(config.allowedOrigins);
  if (effectiveDashboardUrl) {
    try { effectiveOrigins.add(new URL(effectiveDashboardUrl).origin); } catch { /* URL was validated earlier. */ }
  }
  if (hostedNode) {
    try { effectiveOrigins.add(new URL(hostedNode.session.controlPlaneUrl).origin); } catch { /* session URL was validated at login. */ }
  }

  const daemonModuleUrl = new URL(
    import.meta.url.endsWith(".ts") ? "../daemon/index.ts" : "../daemon/index.js",
    import.meta.url,
  ).href;
  const daemonModule = (await import(daemonModuleUrl)) as {
    startDaemon: (options: {
      storageRoot: string;
      nodeName: string;
      managementHost: string;
      managementPort: number;
      s3Host: string;
      s3Port: number;
      publicBaseUrl?: string;
      dashboardUrl?: string;
      allowedOrigins?: string[];
      adminToken?: string;
      managementCapabilitySecret?: string;
      managementCapabilityNodeId?: string;
      beforeStop?: () => void | Promise<void>;
    }) => Promise<DaemonHandle> | DaemonHandle;
  };
  if (typeof daemonModule.startDaemon !== "function") {
    throw new Error("The OpenBucket daemon module does not export startDaemon().");
  }

  const adminToken = config.adminToken ?? randomBytes(32).toString("base64url");
  let handle: DaemonHandle;
  try {
    handle = await daemonModule.startDaemon({
      storageRoot: config.storageRoot,
      nodeName: config.nodeName,
      managementHost: config.managementHost,
      managementPort: config.managementPort,
      s3Host: config.s3Host,
      s3Port: config.s3Port,
      publicBaseUrl: config.publicBaseUrl,
      dashboardUrl: effectiveDashboardUrl,
      allowedOrigins: [...effectiveOrigins],
      adminToken,
      managementCapabilitySecret: hostedNode?.credential.managementSecret,
      managementCapabilityNodeId: hostedNode?.credential.nodeId,
      beforeStop: async () => { await hostedHeartbeat?.stop(); },
    });
  } catch (error) {
    await dashboardHandle?.stop().catch(() => undefined);
    throw error;
  }
  const managementUrl = connectableUrl(handle.config.managementUrl ?? config.managementUrl);
  let dashboardApiUrl = managementUrl;
  let publicUrl = handle.config.publicBaseUrl ?? config.publicBaseUrl;
  let quickTunnels = new Map<QuickTunnelSurface, QuickTunnelHandle>();
  let shutdownStarted = false;

  if (config.quickTunnel) {
    writeLine(io.stdout, "Preparing secure OpenBucket access…");
    const surfaces: Array<{ surface: QuickTunnelSurface; origin: string }> = [
      {
        surface: "s3",
        origin: connectableUrl(handle.config.s3Url ?? config.s3Url),
      },
    ];
    surfaces.push({ surface: "management", origin: managementUrl });
    if (!hostedNode && isLocalDashboardUrl(effectiveDashboardUrl)) {
      surfaces.push({ surface: "dashboard", origin: effectiveDashboardUrl });
    }
    try {
      quickTunnels = await startQuickTunnelSurfaces(surfaces, config.cloudflaredPath);
      publicUrl = quickTunnels.get("s3")?.url;
      dashboardApiUrl = quickTunnels.get("management")?.url ?? managementUrl;
      effectiveDashboardUrl = quickTunnels.get("dashboard")?.url ?? effectiveDashboardUrl;
      if (!publicUrl) throw new Error("The S3 Quick Tunnel did not return a public URL.");

      handle.config.publicBaseUrl = publicUrl;
      handle.config.filesUrl = `${publicUrl}/files`;
      handle.config.dashboardUrl = effectiveDashboardUrl;
      if (effectiveDashboardUrl) effectiveOrigins.add(new URL(effectiveDashboardUrl).origin);
      handle.config.allowedOrigins = [...effectiveOrigins];


    } catch (error) {
      shutdownStarted = true;
      await stopQuickTunnels(quickTunnels);
      await handle.stop();
      await dashboardHandle?.stop().catch(() => undefined);
      throw new Error("Could not establish OpenBucket public access. Run `openbucket doctor` for recovery guidance.");
    }
  }

  const state: ActiveDaemonState = {
    version: 1,
    pid: io.pid,
    managementUrl,
    s3Url: connectableUrl(handle.config.s3Url ?? config.s3Url),
    dashboardUrl: dashboardBaseUrl(handle.config.dashboardUrl ?? effectiveDashboardUrl),
    ...(dashboardApiUrl !== managementUrl ? { dashboardApiUrl } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(quickTunnels.get("management")?.url ? { publicManagementUrl: quickTunnels.get("management")!.url } : {}),
    ...(config.quickTunnel ? { tunnelMode: "quick" as const } : {}),
    ...(hostedNode ? { nodeApiUrl: new URL(`/dashboard/nodes/${encodeURIComponent(hostedNode.credential.nodeName)}`, hostedNode.session.controlPlaneUrl).toString() } : {}),
    root: config.storageRoot,
    node: handle.config.nodeName ?? config.nodeName,
    token: handle.config.adminToken ?? adminToken,
    startedAt: new Date().toISOString(),
    ...(config.internalForeground && config.showInitialCredentials && handle.initialCredentials
      ? { initialCredentials: handle.initialCredentials }
      : {}),
  };

  try {
    await writeActiveState(state, io);
    if (hostedNode) {
      hostedHeartbeat = await startHostedHeartbeatReporter(
        hostedNode,
        state,
        await getProductVersion(io),
        io,
      );
    }
  } catch (error) {
    shutdownStarted = true;
    await stopQuickTunnels(quickTunnels);
    await handle.stop();
    await dashboardHandle?.stop().catch(() => undefined);
    await removeActiveStateIfOwned(io.pid, io);
    throw error;
  }

  let tunnelClosureUpdate: Promise<void> | undefined;
  for (const [surface, tunnel] of quickTunnels) {
    if (surface !== "s3") {
      void tunnel.closed.then(() => {
        if (!shutdownStarted) {
          if (surface === "management") {
            delete state.publicManagementUrl;
            void hostedHeartbeat?.publicEndpointUnavailable().catch(() => undefined);
          }
          writeLine(
            io.stderr,
            `The ${surface} Quick Tunnel stopped; local OpenBucket service is still running.`,
          );
        }
      });
      continue;
    }
    supervisePublicQuickTunnel({
      tunnel,
      state,
      isShuttingDown: () => shutdownStarted,
      onUnavailable: () => {
        writeLine(
          io.stderr,
          "The S3 Quick Tunnel stopped; local OpenBucket service is still running.",
        );
        delete handle.config.publicBaseUrl;
        handle.config.filesUrl = state.s3Url ? `${state.s3Url}/files` : undefined;
        const persist = writeActiveState(state, io).catch((error: unknown) => {
          writeLine(
            io.stderr,
            `Warning: could not persist the tunnel shutdown: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        const deAdvertise = hostedHeartbeat
          ? hostedHeartbeat.publicEndpointUnavailable().catch((error: unknown) => {
              writeLine(
                io.stderr,
                `Warning: could not de-advertise the stopped tunnel: ${error instanceof Error ? error.message : String(error)}`,
              );
            })
          : Promise.resolve();
        tunnelClosureUpdate = Promise.all([persist, deAdvertise]).then(() => undefined);
        return tunnelClosureUpdate;
      },
      onError: (error) => {
        writeLine(
          io.stderr,
          `Warning: Quick Tunnel supervision failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });
  }

  printBanner(
    io,
    state,
    !config.internalForeground && config.showInitialCredentials
      ? handle.initialCredentials
      : undefined,
  );
  if (config.openDashboard && state.dashboardUrl && !config.internalForeground) {
    openDashboard(
      dashboardLaunchUrl(state.dashboardUrl, dashboardApiUrl, state.token) ?? state.dashboardUrl,
      io,
    );
  }

  const requestShutdown = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    writeLine(io.stdout, "Stopping OpenBucket…");
    void Promise.resolve(handle.stop()).catch((error: unknown) => {
      writeLine(
        io.stderr,
        `Could not stop cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    await handle.stopped;
  } finally {
    shutdownStarted = true;
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    await tunnelClosureUpdate?.catch(() => undefined);
    await hostedHeartbeat?.stop();
    await removeActiveStateIfOwned(io.pid, io);
    await stopQuickTunnels(quickTunnels);
    await dashboardHandle?.stop().catch(() => undefined);
  }
  writeLine(io.stdout, "OpenBucket stopped.");
  return EXIT_SUCCESS;
}

function detachedArguments(parsed: ParsedCLICommand): string[] {
  const args = parsed.raw.filter((argument) => argument !== "--detach");
  if (!args.includes("--internal-foreground")) args.push("--internal-foreground");
  if (!args.includes("--no-open")) args.push("--no-open");
  return args;
}

async function serveDetached(
  parsed: ParsedCLICommand,
  config: ResolvedServeConfig,
  io: CLIIO,
): Promise<number> {
  await ensureStorageDirectory(config.storageRoot);
  await ensureNoRunningDaemon(io);
  const paths = resolveStatePaths(io.env, io.homedir());
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.logFile), { recursive: true });
  const log = await open(paths.logFile, "a", 0o600);
  const execArgv = io.execArgv.filter(
    (argument) => !argument.startsWith("--inspect") && !argument.startsWith("--debug"),
  );
  let child: ChildProcess;
  let spawnError: Error | undefined;
  const daemonEnvironment = { ...io.env };
  delete daemonEnvironment.OPENBUCKET_PASSWORD;
  try {
    child = io.spawn(
      io.execPath,
      [...execArgv, io.cliPath, ...detachedArguments(parsed)],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        windowsHide: true,
        shell: false,
        env: daemonEnvironment,
        cwd: io.cwd(),
      },
    );
    child.once("error", (error) => {
      spawnError = error;
    });
    child.unref();
  } finally {
    await log.close();
  }

  const failDetachedStart = async (reason: string): Promise<never> => {
    const pid = child.pid;
    await io.terminateProcessTree(child).catch((error: unknown) => {
      writeLine(
        io.stderr,
        `Warning: could not terminate the failed detached daemon: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (pid) await removeActiveStateIfOwned(pid, io);
    throw new Error(`${reason} See ${paths.logFile}`);
  };

  if (!child.pid) {
    return failDetachedStart("Could not start the detached daemon.");
  }

  const defaultStartTimeout = config.quickTunnel ? 60_000 : 15_000;
  const configuredTimeout = Number(io.env.OPENBUCKET_START_TIMEOUT_MS ?? defaultStartTimeout);
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : defaultStartTimeout;
  const deadline = Date.now() + timeout;
  let active: ActiveDaemonState | undefined;
  while (Date.now() < deadline) {
    active = await readActiveState(io.env, io.homedir());
    if (active?.pid === child.pid) {
      const healthy = await healthCheck(
        io,
        {
          baseUrl: active.managementUrl,
          token:
            io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN ?? active.token,
          state: active,
        },
        750,
      );
      if (healthy) break;
    }
    if (spawnError || child.exitCode !== null) break;
    await io.sleep(125);
  }

  if (!active || active.pid !== child.pid || !(await healthCheck(io, {
    baseUrl: active.managementUrl,
    token: io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN ?? active.token,
    state: active,
  }))) {
    const reason = spawnError
      ? `could not start (${spawnError.message})`
      : child.exitCode === null
        ? `did not become healthy within ${Math.ceil(timeout / 1_000)}s`
        : `exited before becoming healthy (exit code ${child.exitCode})`;
    return failDetachedStart(`The daemon ${reason}.`);
  }

  child.removeAllListeners("error");
  printBanner(io, active, active.initialCredentials);
  if (active.initialCredentials) {
    const scrubbed: ActiveDaemonState = { ...active, initialCredentials: undefined };
    await writeActiveState(scrubbed, io);
    active = scrubbed;
  }
  writeLine(io.stdout, "");
  if (config.openDashboard && active.dashboardUrl) {
    openDashboard(
      dashboardLaunchUrl(
        active.dashboardUrl,
        active.dashboardApiUrl ?? active.managementUrl,
        active.token,
      ) ?? active.dashboardUrl,
      io,
    );
  }
  return EXIT_SUCCESS;
}

async function runServe(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const suppliedName = typeof parsed.options.name === "string" || Boolean(io.env.OPENBUCKET_NODE_NAME ?? io.env.OPENBUCKET_NAME);
  if (!suppliedName && !parsed.options.internalForeground && io.stdout.isTTY) {
    const entered = (await io.prompt("Node name (unique, lowercase): ")).trim();
    if (!entered) throw new CLIUsageError("A node name is required. Pass --name <unique-node-name>.");
    parsed.options.name = entered;
    parsed.raw.push("--name", entered);
  }
  const config = resolveServeConfig(parsed, io.env, io.cwd());
  const session = await requireHostedSession(config, io);
  if (config.detach && !config.internalForeground) {
    return serveDetached(parsed, config, io);
  }
  const hostedNode = session
    ? await prepareHostedNode(session, config, io)
    : undefined;
  return serveForeground(config, io, hostedNode);
}

interface StatusPayload {
  node?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  endpoints?: Record<string, unknown>;
  version?: unknown;
}

async function runStatus(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const status = await apiRequest<StatusPayload>(io, target, "/v1/status");
  if (parsed.options.json === true) {
    io.stdout.write(stringifyJson(status));
    return EXIT_SUCCESS;
  }
  const node = status.node ?? {};
  const storage = status.storage ?? {};
  const endpoints = status.endpoints ?? {};
  writeLine(io.stdout, "OpenBucket is running");
  writeLine(io.stdout, "");
  writeLine(io.stdout, `  Node        ${String(node.name ?? node.id ?? target.state?.node ?? "—")}`);
  writeLine(io.stdout, `  Version     ${String(status.version ?? "—")}`);
  writeLine(io.stdout, `  Uptime      ${humanDuration(node.uptimeSeconds)}`);
  writeLine(io.stdout, `  Storage     ${String(storage.root ?? target.state?.root ?? "—")}`);
  writeLine(io.stdout, `  Managed     ${humanBytes(storage.managedBytes ?? storage.bytes)}`);
  if (storage.filesystemUsedBytes !== undefined) {
    writeLine(io.stdout, `  Disk used   ${humanBytes(storage.filesystemUsedBytes)}`);
  }
  if (storage.freeBytes !== undefined) {
    writeLine(io.stdout, `  Free        ${humanBytes(storage.freeBytes)}`);
  }
  writeLine(
    io.stdout,
    `  Objects     ${String(storage.objects ?? 0)} in ${String(storage.buckets ?? 0)} bucket(s)`,
  );
  if (target.state?.nodeApiUrl) writeLine(io.stdout, `  OpenBucket API  ${target.state.nodeApiUrl}`);
  if (endpoints.dashboard) writeLine(io.stdout, "  Local dashboard  available");
  return EXIT_SUCCESS;
}

async function runStop(io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  await apiRequest<unknown>(io, target, "/v1/stop", {
    method: "POST",
    body: "{}",
  });
  writeLine(io.stdout, "Stopping OpenBucket…");
  let managementStopped = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await healthCheck(io, target, 250))) { managementStopped = true; break; }
    await io.sleep(100);
  }
  if (!managementStopped) throw new Error("OpenBucket did not stop within the shutdown deadline; active state was retained.");
  if (target.state) {
    let processStopped = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { process.kill(target.state.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") { processStopped = true; break; }
        throw error;
      }
      await io.sleep(100);
    }
    if (!processStopped) throw new Error("The daemon API closed but its process is still running; active state was retained.");
    await removeActiveStateIfOwned(target.state.pid, io);
  }
  writeLine(io.stdout, "OpenBucket stopped.");
  return EXIT_SUCCESS;
}

interface BucketRecord {
  name?: unknown;
  createdAt?: unknown;
  public?: unknown;
  objects?: unknown;
  bytes?: unknown;
}

async function fetchBuckets(io: CLIIO, target: ApiTarget): Promise<BucketRecord[]> {
  const payload = await apiRequest<{ buckets?: BucketRecord[] }>(
    io,
    target,
    "/v1/buckets",
  );
  return Array.isArray(payload.buckets) ? payload.buckets : [];
}

async function runBuckets(io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const buckets = await fetchBuckets(io, target);
  if (buckets.length === 0) {
    writeLine(io.stdout, "No buckets yet. Create one with: openbucket bucket create <name>");
    return EXIT_SUCCESS;
  }
  writeLine(
    io.stdout,
    renderTable(buckets, [
      { header: "NAME", value: (bucket) => bucket.name },
      { header: "ACCESS", value: (bucket) => (bucket.public ? "public" : "private") },
      { header: "OBJECTS", value: (bucket) => bucket.objects ?? 0 },
      { header: "SIZE", value: (bucket) => humanBytes(bucket.bytes) },
      { header: "CREATED", value: (bucket) => formatTimestamp(bucket.createdAt) },
    ]),
  );
  return EXIT_SUCCESS;
}

async function runBucket(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const name = parsed.positionals[0];
  if (parsed.subcommand === "create") {
    const payload = await apiRequest<{ bucket?: BucketRecord }>(io, target, "/v1/buckets", {
      method: "POST",
      body: JSON.stringify({ name, public: parsed.options.public === true }),
    });
    writeLine(
      io.stdout,
      `Created ${payload.bucket?.public ? "public" : "private"} bucket \"${String(payload.bucket?.name ?? name)}\".`,
    );
    return EXIT_SUCCESS;
  }

  const force = parsed.options.force === true;
  if (!force) {
    const buckets = await fetchBuckets(io, target);
    const bucket = buckets.find((candidate) => candidate.name === name);
    if (bucket && Number(bucket.objects ?? 0) > 0) {
      throw new CLIApiError(
        `Bucket \"${name}\" contains ${String(bucket.objects)} object(s). Re-run with --force to delete its contents.`,
        409,
        "BucketNotEmpty",
      );
    }
  }
  const query = force ? "?force=true" : "";
  await apiRequest<unknown>(
    io,
    target,
    `/v1/buckets/${encodeURIComponent(name)}${query}`,
    { method: "DELETE" },
  );
  writeLine(io.stdout, `Deleted bucket \"${name}\"${force ? " and its contents" : ""}.`);
  return EXIT_SUCCESS;
}

interface ObjectRecord {
  key?: unknown;
  size?: unknown;
  lastModified?: unknown;
  etag?: unknown;
}

async function runObjects(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const bucket = parsed.positionals[0];
  const params = new URLSearchParams();
  if (typeof parsed.options.prefix === "string") params.set("prefix", parsed.options.prefix);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const payload = await apiRequest<{ objects?: ObjectRecord[] }>(
    io,
    target,
    `/v1/buckets/${encodeURIComponent(bucket)}/objects${query}`,
  );
  const objects = Array.isArray(payload.objects) ? payload.objects : [];
  if (objects.length === 0) {
    writeLine(io.stdout, `No objects found in \"${bucket}\".`);
    return EXIT_SUCCESS;
  }
  writeLine(
    io.stdout,
    renderTable(objects, [
      { header: "KEY", value: (object) => object.key },
      { header: "SIZE", value: (object) => humanBytes(object.size) },
      { header: "LAST MODIFIED", value: (object) => formatTimestamp(object.lastModified) },
      { header: "ETAG", value: (object) => object.etag },
    ]),
  );
  return EXIT_SUCCESS;
}

interface KeyRecord {
  id?: unknown;
  name?: unknown;
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  readOnly?: unknown;
  bucket?: unknown;
  createdAt?: unknown;
}

async function runKeys(io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const payload = await apiRequest<{ keys?: KeyRecord[] }>(io, target, "/v1/keys");
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  if (keys.length === 0) {
    writeLine(io.stdout, "No access keys. Create one with: openbucket key create");
    return EXIT_SUCCESS;
  }
  writeLine(
    io.stdout,
    renderTable(keys, [
      { header: "ID", value: (key) => key.id },
      { header: "NAME", value: (key) => key.name },
      { header: "ACCESS KEY", value: (key) => key.accessKeyId },
      { header: "SCOPE", value: (key) => key.bucket ?? "all buckets" },
      { header: "MODE", value: (key) => (key.readOnly ? "read-only" : "read/write") },
      { header: "CREATED", value: (key) => formatTimestamp(key.createdAt) },
    ]),
  );
  return EXIT_SUCCESS;
}

async function runKey(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  if (parsed.subcommand === "revoke") {
    const id = parsed.positionals[0];
    await apiRequest<unknown>(io, target, `/v1/keys/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    writeLine(io.stdout, `Revoked access key \"${id}\".`);
    return EXIT_SUCCESS;
  }

  const payload = await apiRequest<{ key?: KeyRecord }>(io, target, "/v1/keys", {
    method: "POST",
    body: JSON.stringify({
      name: parsed.options.name,
      readOnly: parsed.options.readOnly === true,
      bucket: parsed.options.bucket,
    }),
  });
  const key = payload.key ?? {};
  writeLine(io.stdout, "Access key created (the secret is shown once)");
  writeLine(io.stdout, "");
  writeLine(io.stdout, `  ID          ${String(key.id ?? "—")}`);
  writeLine(io.stdout, `  Name        ${String(key.name ?? parsed.options.name ?? "—")}`);
  writeLine(io.stdout, `  Access key  ${String(key.accessKeyId ?? "—")}`);
  writeLine(io.stdout, `  Secret key  ${String(key.secretAccessKey ?? "—")}`);
  writeLine(
    io.stdout,
    `  Scope       ${String(key.bucket ?? parsed.options.bucket ?? "all buckets")}`,
  );
  writeLine(
    io.stdout,
    `  Mode        ${key.readOnly ?? parsed.options.readOnly ? "read-only" : "read/write"}`,
  );
  return EXIT_SUCCESS;
}

async function runShare(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const [bucket, key] = parsed.positionals;
  const durationText =
    typeof parsed.options.expires === "string" ? parsed.options.expires : "1h";
  const expiresIn = parseDuration(durationText);
  const payload = await apiRequest<{ url?: unknown; expiresAt?: unknown }>(
    io,
    target,
    `/v1/buckets/${encodeURIComponent(bucket)}/share`,
    {
      method: "POST",
      body: JSON.stringify({ key, expiresIn }),
    },
  );
  writeLine(io.stdout, "Share URL created");
  writeLine(io.stdout, "");
  writeLine(io.stdout, `  URL      ${String(payload.url ?? "—")}`);
  writeLine(io.stdout, `  Expires  ${formatTimestamp(payload.expiresAt)}`);
  return EXIT_SUCCESS;
}

function formatLogEntry(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return String(entry);
  const record = entry as Record<string, unknown>;
  const timestamp = record.timestamp ?? record.time ?? record.createdAt;
  if (record.method && record.path) {
    const service = String(record.service ?? "api").toUpperCase();
    const method = String(record.method).toUpperCase().padEnd(7);
    const status = String(record.status ?? "—").padStart(3);
    const duration = Number.isFinite(Number(record.durationMs))
      ? `${Number(record.durationMs).toFixed(1)}ms`
      : "—";
    return `${formatTimestamp(timestamp)}  ${service.padEnd(10)} ${method} ${status}  ${duration.padStart(9)}  ${String(record.path)}`;
  }
  const level = record.level ? String(record.level).toUpperCase() : "INFO";
  const message = record.message ?? record.event ?? JSON.stringify(record);
  return `${formatTimestamp(timestamp)}  ${level.padEnd(5)}  ${String(message)}`;
}

function parseLimit(value: CLIOptionValue | undefined): number {
  if (value === undefined) return 100;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new CLIUsageError("--limit must be an integer between 1 and 1000.");
  }
  return limit;
}

async function runLogs(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const limit = parseLimit(parsed.options.limit);
  const seen = new Set<string>();
  let stopping = false;
  const stopFollowing = (): void => {
    stopping = true;
  };
  if (parsed.options.follow === true) process.once("SIGINT", stopFollowing);
  try {
    let firstRequest = true;
    do {
      const payload = await apiRequest<{ logs?: unknown[] }>(
        io,
        target,
        `/v1/logs?limit=${limit}`,
      );
      const logs = Array.isArray(payload.logs) ? payload.logs : [];
      let printed = 0;
      for (const entry of logs) {
        const fingerprint = JSON.stringify(entry);
        if (!firstRequest && seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        writeLine(io.stdout, formatLogEntry(entry));
        printed += 1;
      }
      while (seen.size > limit * 4) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      if (firstRequest && printed === 0) writeLine(io.stdout, "No daemon logs yet.");
      firstRequest = false;
      if (parsed.options.follow !== true || stopping) break;
      await io.sleep(1_000);
    } while (!stopping);
  } finally {
    process.removeListener("SIGINT", stopFollowing);
  }
  return EXIT_SUCCESS;
}

async function runConfig(io: CLIIO): Promise<number> {
  const target = await getApiTarget(io);
  const config = await apiRequest<Record<string, unknown>>(
    io,
    target,
    "/v1/config/client",
  );
  const entries = Object.entries(config).map(([key, value]) => ({
    key,
    value: value === undefined || value === null ? "—" : String(value),
  }));
  if (entries.length === 0) {
    writeLine(io.stdout, "The daemon returned no client configuration.");
  } else {
    writeLine(
      io.stdout,
      renderTable(entries, [
        { header: "SETTING", value: (entry) => entry.key },
        { header: "VALUE", value: (entry) => entry.value },
      ]),
    );
  }
  return EXIT_SUCCESS;
}

interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

async function checkPortAvailable(host: string, port: number): Promise<boolean | undefined> {
  return new Promise((resolveCheck) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"].includes(error.code ?? "")) {
        resolveCheck(false);
      } else {
        resolveCheck(undefined);
      }
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => resolveCheck(error ? undefined : true));
    });
  });
}

async function checkEndpointReachable(value: string): Promise<boolean | undefined> {
  let url: URL;
  try {
    url = new URL(connectableUrl(value));
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolveCheck) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveCheck(result);
    };
    const socket = createConnection({ host, port }, () => finish(true));
    socket.unref();
    socket.setTimeout(1_000, () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function supportsCurrentNode(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  if (![major, minor, patch].every(Number.isInteger)) return false;
  return major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0)));
}

async function runDoctor(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const checks: DoctorCheck[] = [];
  const nodeVersion = process.versions.node;
  const supportedNode = supportsCurrentNode(nodeVersion);
  checks.push({
    name: "Node.js",
    status: supportedNode ? "pass" : "fail",
    detail:
      supportedNode
        ? `v${nodeVersion}`
        : `v${nodeVersion}; OpenBucket requires Node.js 22.13 or newer`,
  });

  const active = await readActiveState(io.env, io.homedir());
  const directory = resolve(
    io.cwd(),
    parsed.positionals[0] ?? io.env.OPENBUCKET_STORAGE_ROOT ?? active?.root ?? io.cwd(),
  );
  try {
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      checks.push({ name: "Storage", status: "fail", detail: `${directory} is not a directory` });
    } else {
      await access(directory, fsConstants.R_OK | fsConstants.W_OK);
      const probe = join(directory, `.openbucket-write-probe-${randomUUID()}`);
      await writeFile(probe, "");
      await unlink(probe);
      checks.push({ name: "Storage", status: "pass", detail: `${directory} is readable and writable` });
    }
  } catch (error) {
    checks.push({
      name: "Storage",
      status: "fail",
      detail: `${directory}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (active) {
    const target: ApiTarget = {
      baseUrl: active.managementUrl,
      token: io.env.OPENBUCKET_ADMIN_TOKEN ?? io.env.OPENBUCKET_TOKEN ?? active.token,
      state: active,
    };
    const healthy = await healthCheck(io, target);
    checks.push({
      name: "Daemon",
      status: healthy ? "pass" : "fail",
      detail: healthy
        ? `healthy at ${active.managementUrl} (PID ${active.pid})`
        : `state file exists for PID ${active.pid}, but ${active.managementUrl} is unreachable`,
    });
    if (healthy) {
      try {
        const status = await apiRequest<StatusPayload>(io, target, "/v1/status");
        const endpoints = status.endpoints ?? {};
        const endpoint = endpoints.s3 ? String(endpoints.s3) : undefined;
        const reachable = endpoint ? await checkEndpointReachable(endpoint) : undefined;
        checks.push({
          name: "S3 endpoint",
          status: reachable === true ? "pass" : reachable === false ? "fail" : "warn",
          detail:
            reachable === true
              ? `${connectableUrl(endpoint!)} is reachable`
              : reachable === false
                ? `${connectableUrl(endpoint!)} is unreachable`
                : "daemon did not advertise a testable S3 endpoint",
        });
      } catch (error) {
        checks.push({
          name: "S3 endpoint",
          status: "warn",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    checks.push({
      name: "Daemon",
      status: "warn",
      detail: "not running (start it with openbucket serve <directory>)",
    });
    const managementHost =
      io.env.OPENBUCKET_MANAGEMENT_HOST ?? io.env.OPENBUCKET_HOST ?? DEFAULT_MANAGEMENT_HOST;
    const s3Host = io.env.OPENBUCKET_S3_HOST ?? io.env.OPENBUCKET_HOST ?? DEFAULT_S3_HOST;
    const managementPort = parsePort(
      io.env.OPENBUCKET_MANAGEMENT_PORT,
      DEFAULT_MANAGEMENT_PORT,
      "OPENBUCKET_MANAGEMENT_PORT",
    );
    const s3Port = parsePort(
      io.env.OPENBUCKET_S3_PORT,
      DEFAULT_S3_PORT,
      "OPENBUCKET_S3_PORT",
    );
    for (const [label, host, port] of [
      ["Management port", managementHost, managementPort],
      ["S3 port", s3Host, s3Port],
    ] as const) {
      const available = await checkPortAvailable(host, port);
      checks.push({
        name: label,
        status: available === false ? "fail" : available === true ? "pass" : "warn",
        detail:
          available === false
            ? `${host}:${port} is unavailable`
            : available === true
              ? `${host}:${port} is available`
              : `${host}:${port} could not be tested`,
      });
    }
  }

  writeLine(io.stdout, "OpenBucket doctor");
  writeLine(io.stdout, "");
  for (const check of checks) {
    const symbol = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
    writeLine(io.stdout, `  ${symbol} ${check.name.padEnd(16)} ${check.detail}`);
  }
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  writeLine(io.stdout, "");
  writeLine(
    io.stdout,
    failures === 0
      ? `Doctor found no blocking problems${warnings ? ` (${warnings} warning${warnings === 1 ? "" : "s"})` : ""}.`
      : `Doctor found ${failures} blocking problem${failures === 1 ? "" : "s"}.`,
  );
  return failures === 0 ? EXIT_SUCCESS : EXIT_DOCTOR;
}

async function runTunnel(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  const active = await readActiveState(io.env, io.homedir());
  const executable = typeof parsed.options.cloudflaredPath === "string"
    ? parsed.options.cloudflaredPath
    : io.env.OPENBUCKET_CLOUDFLARED_PATH || "cloudflared";
  if (parsed.subcommand === "status") {
    writeLine(io.stdout, "OpenBucket public access");
    writeLine(io.stdout, "");
    writeLine(io.stdout, `  S3 service       ${active?.publicUrl ? "available" : "not active"}`);
    writeLine(io.stdout, `  Node console     ${active?.publicManagementUrl ? "available" : "not active"}`);
    if (active?.nodeApiUrl) writeLine(io.stdout, `  OpenBucket API   ${active.nodeApiUrl}`);
    return EXIT_SUCCESS;
  }
  if (parsed.subcommand === "update") {
    writeLine(io.stdout, `Updating ${executable}…`);
    const child = io.spawn(executable, ["update"], { stdio: "inherit", shell: false, windowsHide: true });
    const closed = await waitForChildClose(child, 120_000);
    if (!closed || child.exitCode !== 0) throw new CLIUsageError(`Could not update ${executable}. Run \`openbucket tunnel setup\` for recovery guidance.`);
    writeLine(io.stdout, "Cloudflare connector updated.");
    return EXIT_SUCCESS;
  }

  if (io.stdout.isTTY && parsed.options.yes !== true) {
    prompts.intro("OpenBucket tunnel setup");
    const proceed = await prompts.confirm({ message: "Open the official Cloudflare download page and configure a named tunnel?" });
    if (prompts.isCancel(proceed) || !proceed) {
      prompts.cancel("Tunnel setup cancelled.");
      return EXIT_SUCCESS;
    }
  }
  const platformGuide = "https://developers.cloudflare.com/tunnel/downloads/";
  writeLine(io.stdout, "OpenBucket keeps connector paths and tunnel tokens out of shell profiles. Install cloudflared from the official page, then run the named-tunnel token command supplied by Cloudflare.");
  writeLine(io.stdout, `Download guide: ${platformGuide}`);
  writeLine(io.stdout, `Verify: ${executable} --version`);
  writeLine(io.stdout, "After the connector is available, run `openbucket serve <directory> --tunnel`; OpenBucket will publish and persist both S3 and management endpoints.");
  if (io.stdout.isTTY) prompts.outro("Connector guidance ready.");
  return EXIT_SUCCESS;
}

async function executeCommand(parsed: ParsedCLICommand, io: CLIIO): Promise<number> {
  switch (parsed.command) {
    case "serve":
      return runServe(parsed, io);
    case "login":
      return runLogin(parsed, io);
    case "logout":
      return runLogout(io);
    case "whoami":
      return runWhoAmI(parsed, io);
    case "stop":
      return runStop(io);
    case "status":
      return runStatus(parsed, io);
    case "logs":
      return runLogs(parsed, io);
    case "doctor":
      return runDoctor(parsed, io);
    case "tunnel":
      return runTunnel(parsed, io);
    case "dashboard":
      return runDashboard(io);
    case "buckets":
      return runBuckets(io);
    case "bucket":
      return runBucket(parsed, io);
    case "objects":
      return runObjects(parsed, io);
    case "key":
      return runKey(parsed, io);
    case "keys":
      return runKeys(io);
    case "share":
      return runShare(parsed, io);
    case "config":
      return runConfig(io);
    case "version":
      writeLine(io.stdout, `openbucket ${await getProductVersion(io)}`);
      return EXIT_SUCCESS;
    case "help":
      io.stdout.write(renderHelp(parsed.positionals[0]));
      return EXIT_SUCCESS;
  }
}

function formatError(error: unknown, io: CLIIO): number {
  if (error instanceof CLIUsageError) {
    writeLine(io.stderr, `Error: ${error.message}`);
    if (!error.message.startsWith("Usage:")) {
      writeLine(io.stderr, "Run \"openbucket help\" for usage.");
    }
    return error.exitCode;
  }
  if (error instanceof HostedAuthError) {
    const code = error.code ? ` [${error.code}]` : "";
    writeLine(io.stderr, `OpenBucket authentication error${code}: ${error.message}`);
    return EXIT_API;
  }
  if (error instanceof CLIInactiveError) {
    writeLine(io.stderr, error.message);
    writeLine(io.stderr, "Start it with: openbucket serve <directory>");
    return error.exitCode;
  }
  if (error instanceof CLIApiError) {
    const code = error.code ? ` [${error.code}]` : "";
    writeLine(io.stderr, `OpenBucket API error${code}: ${error.message}`);
    if (error.details !== undefined) {
      writeLine(io.stderr, `Details: ${JSON.stringify(error.details)}`);
    }
    return error.exitCode;
  }
  writeLine(
    io.stderr,
    `OpenBucket failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  return EXIT_FAILURE;
}

/** Execute one CLI invocation and resolve to a process exit code. */
export async function runCLI(
  argv: readonly string[] = process.argv.slice(2),
  overrides: Partial<CLIIO> = {},
): Promise<number> {
  const io = defaultIO(overrides);
  try {
    return await executeCommand(parseCLIArgs(argv), io);
  } catch (error) {
    return formatError(error, io);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const current = fileURLToPath(import.meta.url);
  return resolve(entry).toLowerCase() === resolve(current).toLowerCase();
}

if (isDirectExecution()) {
  void runCLI().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      writeLine(process.stderr, error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = EXIT_FAILURE;
    },
  );
}
