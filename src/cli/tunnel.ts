import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTIC_LENGTH = 8_192;
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com(?=[/\s"'<>]|$)/gi;

export type TunnelSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface QuickTunnelOptions {
  origin: string;
  executable?: string;
  timeoutMs?: number;
  stopTimeoutMs?: number;
  spawn?: TunnelSpawn;
  env?: NodeJS.ProcessEnv;
}

export interface QuickTunnelHandle {
  readonly origin: string;
  readonly url: string;
  readonly process: ChildProcess;
  readonly closed: Promise<void>;
  stop(): Promise<void>;
}

function validateOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("A Cloudflare Tunnel origin must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("A Cloudflare Tunnel origin cannot contain credentials, query, or fragment data.");
  }
  return url.toString().replace(/\/$/, "");
}

function appendBounded(current: string, chunk: string): string {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_DIAGNOSTIC_LENGTH
    ? combined
    : combined.slice(-MAX_DIAGNOSTIC_LENGTH);
}

function redactDiagnostics(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:token|secret|password|signature)\s*[:=]\s*)[^\s"']+/gi, "$1[redacted]")
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, "$1?[redacted]")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
}

function parseQuickTunnelUrl(value: string): string | undefined {
  QUICK_TUNNEL_URL.lastIndex = 0;
  for (const match of value.matchAll(QUICK_TUNNEL_URL)) {
    try {
      const parsed = new URL(match[0]);
      if (
        parsed.protocol === "https:" &&
        parsed.port === "" &&
        parsed.pathname === "/" &&
        parsed.hostname.endsWith(".trycloudflare.com")
      ) {
        return parsed.origin;
      }
    } catch {
      // Ignore log text that only resembles a URL.
    }
  }
  return undefined;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      child.removeListener("close", onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("close", onExit);
  });
}

/** Start and supervise a zero-account Cloudflare Quick Tunnel. */
export async function startQuickTunnel(
  options: QuickTunnelOptions,
): Promise<QuickTunnelHandle> {
  const origin = validateOrigin(options.origin);
  const executable = options.executable?.trim() || "cloudflared";
  const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Cloudflare Tunnel startup timeout must be positive.");
  }
  if (!Number.isFinite(stopTimeoutMs) || stopTimeoutMs <= 0) {
    throw new Error("Cloudflare Tunnel stop timeout must be positive.");
  }

  const spawnProcess = options.spawn ?? nodeSpawn;
  let child: ChildProcess;
  try {
    child = spawnProcess(
      executable,
      ["tunnel", "--no-autoupdate", "--url", origin],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        env: options.env ?? sanitizeQuickTunnelEnvironment(),
      },
    );
  } catch (error) {
    throw new Error(
      `Could not start cloudflared (${executable}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let diagnostics = "";
  let startupSettled = false;
  const publicUrl = await new Promise<string>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };
    const fail = (message: string): void => {
      if (startupSettled) return;
      startupSettled = true;
      cleanup();
      const detail = redactDiagnostics(diagnostics);
      reject(new Error(detail ? `${message}\ncloudflared: ${detail}` : message));
    };
    const onData = (chunk: Buffer | string): void => {
      const text = String(chunk);
      diagnostics = appendBounded(diagnostics, text);
      const url = parseQuickTunnelUrl(text) ?? parseQuickTunnelUrl(diagnostics);
      if (!url || startupSettled) return;
      startupSettled = true;
      cleanup();
      child.stdout?.resume();
      child.stderr?.resume();
      resolve(url);
    };
    const onError = (error: Error): void => {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      fail(
        missing
          ? `cloudflared was not found at '${executable}'. Install cloudflared or set OPENBUCKET_CLOUDFLARED_PATH.`
          : `cloudflared could not start: ${error.message}`,
      );
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      fail(
        `cloudflared exited before publishing a URL (${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}).`,
      );
    };
    const timer = setTimeout(() => {
      fail(`cloudflared did not publish a Quick Tunnel URL within ${Math.ceil(timeoutMs / 1_000)}s.`);
    }, timeoutMs);
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  }).catch(async (error) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    if (!(await waitForExit(child, stopTimeoutMs)) && child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, stopTimeoutMs);
    }
    throw error;
  });

  const closed = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("close", () => resolve());
  });
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      if (!(await waitForExit(child, stopTimeoutMs)) && child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, stopTimeoutMs);
      }
    })();
    return stopPromise;
  };

  return { origin, url: publicUrl, process: child, closed, stop };
}

const QUICK_TUNNEL_ENVIRONMENT_KEYS = new Set([
  "ALL_PROXY",
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
]);

/** Keep the tunnel child functional without leaking application credentials. */
export function sanitizeQuickTunnelEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && QUICK_TUNNEL_ENVIRONMENT_KEYS.has(name.toUpperCase())) {
      sanitized[name] = value;
    }
  }
  return sanitized;
}
