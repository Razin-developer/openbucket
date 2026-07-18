import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CLIUsageError,
  dashboardLaunchUrl,
  parseCLIArgs,
  parseDuration,
  resolveServeConfig,
  resolveStatePaths,
  runCLI,
} from "../../dist/cli/main.js";

function captureWriter() {
  let output = "";
  return {
    writer: {
      write(chunk) {
        output += String(chunk);
      },
    },
    value() {
      return output;
    },
  };
}

test("parseCLIArgs accepts serve flags in any position and normalizes the start alias", () => {
  const parsed = parseCLIArgs([
    "start",
    "--name",
    "archive-node",
    "D:\\Archive",
    "--management-port=7273",
    "--s3-port",
    "9000",
    "--host",
    "0.0.0.0",
    "--detach",
    "--tunnel",
    "--no-open",
    "--no-credentials",
  ]);

  assert.equal(parsed.command, "serve");
  assert.deepEqual(parsed.positionals, ["D:\\Archive"]);
  assert.deepEqual(parsed.options, {
    name: "archive-node",
    managementPort: "7273",
    s3Port: "9000",
    host: "0.0.0.0",
    detach: true,
    tunnel: true,
    open: false,
    credentials: false,
  });
});

test("parseCLIArgs covers bucket, key, object, and list command forms", () => {
  assert.deepEqual(parseCLIArgs(["buckets/list"]).command, "buckets");
  assert.deepEqual(parseCLIArgs(["list"]).command, "buckets");
  assert.deepEqual(parseCLIArgs(["dashboard"]).command, "dashboard");

  const createBucket = parseCLIArgs(["bucket", "create", "photos", "--public"]);
  assert.equal(createBucket.subcommand, "create");
  assert.equal(createBucket.options.public, true);

  const createKey = parseCLIArgs([
    "key",
    "create",
    "--name=backups",
    "--read-only",
    "--bucket",
    "archive",
  ]);
  assert.deepEqual(createKey.options, {
    name: "backups",
    readOnly: true,
    bucket: "archive",
  });

  const objects = parseCLIArgs(["objects", "photos", "--prefix", "2026/"]);
  assert.deepEqual(objects.positionals, ["photos"]);
  assert.equal(objects.options.prefix, "2026/");
});

test("parseCLIArgs rejects unknown flags and incomplete commands", () => {
  assert.throws(
    () => parseCLIArgs(["status", "--yaml"]),
    (error) => error instanceof CLIUsageError && /Unknown option/.test(error.message),
  );
  assert.throws(
    () => parseCLIArgs(["share", "photos"]),
    (error) => error instanceof CLIUsageError && /Usage: share/.test(error.message),
  );
  assert.throws(
    () => parseCLIArgs(["bucket", "remove", "photos"]),
    (error) => error instanceof CLIUsageError && /create\|delete/.test(error.message),
  );
});

test("parseDuration returns whole seconds for supported human durations", () => {
  assert.equal(parseDuration("5m"), 300);
  assert.equal(parseDuration("1h"), 3_600);
  assert.equal(parseDuration("1d"), 86_400);
  assert.equal(parseDuration("7d"), 604_800);
  assert.equal(parseDuration("1w"), 604_800);
  assert.throws(() => parseDuration("90"), CLIUsageError);
  assert.throws(() => parseDuration("0m"), CLIUsageError);
  assert.throws(() => parseDuration("2w"), CLIUsageError);
});

test("dashboard launch credentials use a fragment and replace stale dashboard query parameters", () => {
  const launch = new URL(dashboardLaunchUrl(
    "http://localhost:3000/?api=https%3A%2F%2Fold.example.test%2F&unused=value#old-token",
    "http://127.0.0.1:7272/",
    "dashboard-admin-token",
  ));
  assert.equal(launch.searchParams.get("api"), "http://127.0.0.1:7272");
  assert.equal(launch.searchParams.get("unused"), null);
  assert.equal(new URLSearchParams(launch.hash.slice(1)).get("token"), "dashboard-admin-token");
  assert.equal(launch.toString().includes("?token="), false);
});

test("resolveServeConfig applies flags over OPENBUCKET environment values", () => {
  const parsed = parseCLIArgs([
    "serve",
    "./flag-storage",
    "--host",
    "::1",
    "--management-port",
    "7001",
    "--name",
    "flag-node",
    "--public-url",
    "https://storage.example.test/",
    "--no-open",
  ]);
  const config = resolveServeConfig(
    parsed,
    {
      OPENBUCKET_STORAGE_ROOT: "./environment-storage",
      OPENBUCKET_HOST: "127.0.0.2",
      OPENBUCKET_MANAGEMENT_PORT: "7002",
      OPENBUCKET_S3_PORT: "9001",
      OPENBUCKET_NODE_NAME: "environment-node",
      OPENBUCKET_PUBLIC_BASE_URL: "https://ignored-by-flag.example.test/",
      OPENBUCKET_DASHBOARD_URL: "https://dashboard.example.test/",
      OPENBUCKET_ALLOWED_ORIGINS: "https://admin.example.test, https://tools.example.test/",
      OPENBUCKET_ADMIN_TOKEN: "local-admin-token-at-least-32-bytes",
      OPENBUCKET_DETACH: "true",
    },
    "C:\\workspace",
  );

  assert.equal(config.storageRoot, resolve("C:\\workspace", "./flag-storage"));
  assert.equal(config.nodeName, "flag-node");
  assert.equal(config.managementHost, "::1");
  assert.equal(config.s3Host, "::1");
  assert.equal(config.managementPort, 7001);
  assert.equal(config.s3Port, 9001);
  assert.equal(config.managementUrl, "http://[::1]:7001");
  assert.equal(config.s3Url, "http://[::1]:9001");
  assert.equal(config.publicBaseUrl, "https://storage.example.test");
  assert.equal(config.dashboardUrl, "https://dashboard.example.test");
  assert.equal(config.adminToken, "local-admin-token-at-least-32-bytes");
  assert.equal(config.serveDashboard, true);
  assert.equal(config.showInitialCredentials, true);
  assert.deepEqual(config.allowedOrigins, [
    "https://admin.example.test",
    "https://tools.example.test",
    "https://dashboard.example.test",
  ]);
  assert.equal(config.detach, true);
  assert.equal(config.openDashboard, false);
});

test("resolveServeConfig can be driven entirely through OPENBUCKET environment", () => {
  const config = resolveServeConfig(
    parseCLIArgs(["serve"]),
    {
      OPENBUCKET_STORAGE_ROOT: "storage",
      OPENBUCKET_OPEN_DASHBOARD: "false",
      OPENBUCKET_SERVE_DASHBOARD: "false",
      OPENBUCKET_SHOW_INITIAL_CREDENTIALS: "false",
      OPENBUCKET_TUNNEL: "quick",
      OPENBUCKET_CLOUDFLARED_PATH: "/opt/cloudflared",
    },
    "/workspace",
  );
  assert.equal(config.storageRoot, resolve("/workspace", "storage"));
  assert.equal(config.openDashboard, false);
  assert.equal(config.serveDashboard, false);
  assert.equal(config.showInitialCredentials, false);
  assert.equal(config.quickTunnel, true);
  assert.equal(config.cloudflaredPath, "/opt/cloudflared");
});

test("blank management tokens are treated as unset so serve generates a secure token", () => {
  const config = resolveServeConfig(
    parseCLIArgs(["serve", "storage"]),
    { OPENBUCKET_ADMIN_TOKEN: "   " },
    "/workspace",
  );
  assert.equal(config.adminToken, undefined);
  assert.throws(
    () => resolveServeConfig(parseCLIArgs(["serve", "storage"]), { OPENBUCKET_ADMIN_TOKEN: "too-short" }, "/workspace"),
    /at least 32 UTF-8 bytes/,
  );
  assert.throws(
    () => resolveServeConfig(
      parseCLIArgs(["serve", "storage", "--tunnel", "--public-url", "https://storage.example.test"]),
      {},
      "/workspace",
    ),
    /--tunnel generates its public URL/,
  );
});

test("serve endpoint URLs reject embedded secrets", () => {
  for (const unsafeUrl of [
    "https://user:password@storage.example.test",
    "https://storage.example.test?token=secret",
    "https://storage.example.test#secret",
  ]) {
    assert.throws(
      () => resolveServeConfig(
        parseCLIArgs(["serve", "storage", "--public-url", unsafeUrl]),
        {},
        "/workspace",
      ),
      /cannot contain credentials, a query, or a fragment/,
    );
  }
});

test("resolveStatePaths isolates state under OPENBUCKET_HOME", () => {
  const absoluteState = resolve("ob-state");
  const absoluteHome = resolve("home-dev");
  assert.deepEqual(resolveStatePaths({ OPENBUCKET_HOME: absoluteState }, absoluteHome), {
    directory: absoluteState,
    activeFile: join(absoluteState, "active.json"),
    logFile: join(absoluteState, "daemon.log"),
  });
  assert.equal(
    resolveStatePaths({ OPENBUCKET_HOME: "state" }, absoluteHome).directory,
    resolve(absoluteHome, "state"),
  );
});

test("inactive status has a stable message and a distinct exit code", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "openbucket-cli-test-"));
  const stdout = captureWriter();
  const stderr = captureWriter();
  try {
    const exitCode = await runCLI(["status"], {
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {},
      homedir: () => temporaryHome,
    });
    assert.equal(exitCode, 3);
    assert.equal(stdout.value(), "");
    assert.equal(
      stderr.value(),
      "OpenBucket is not running.\nStart it with: openbucket serve <directory>\n",
    );
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("status --json writes only the management payload as JSON", async () => {
  const stdout = captureWriter();
  const stderr = captureWriter();
  const payload = {
    node: { id: "node-1", name: "primary", uptimeSeconds: 42 },
    storage: { root: "/data", buckets: 1, objects: 2, bytes: 3 },
    endpoints: { management: "http://127.0.0.1:7272", s3: "http://127.0.0.1:8333" },
    version: "0.1.0",
  };
  let authorization;
  const exitCode = await runCLI(["status", "--json"], {
    stdout: stdout.writer,
    stderr: stderr.writer,
    env: {
      OPENBUCKET_MANAGEMENT_URL: "http://127.0.0.1:7272",
      OPENBUCKET_ADMIN_TOKEN: "admin-token",
    },
    fetch: async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json(payload);
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.equal(stdout.value(), `${JSON.stringify(payload, null, 2)}\n`);
  assert.equal(authorization, "Bearer admin-token");
});

test("status distinguishes OpenBucket-managed bytes from total filesystem usage", async () => {
  const stdout = captureWriter();
  const stderr = captureWriter();
  const exitCode = await runCLI(["status"], {
    stdout: stdout.writer,
    stderr: stderr.writer,
    env: { OPENBUCKET_MANAGEMENT_URL: "http://127.0.0.1:7272" },
    fetch: async () => Response.json({
      node: { name: "primary", uptimeSeconds: 42 },
      storage: {
        root: "/data",
        buckets: 1,
        objects: 2,
        bytes: 3,
        managedBytes: 3,
        filesystemUsedBytes: 4096,
        freeBytes: 8192,
      },
      endpoints: { management: "http://127.0.0.1:7272" },
      version: "0.1.0",
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.match(stdout.value(), /Managed\s+3 B/);
  assert.match(stdout.value(), /Disk used\s+4\.10 KB/);
  assert.match(stdout.value(), /Free\s+8\.19 KB/);
  assert.doesNotMatch(stdout.value(), /\n\s*Used\s/);
});

test("an explicit remote management URL never inherits the local daemon token", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "openbucket-cli-remote-"));
  const statePaths = resolveStatePaths({ OPENBUCKET_HOME: "state" }, temporaryHome);
  await mkdir(statePaths.directory, { recursive: true });
  await writeFile(statePaths.activeFile, JSON.stringify({
    version: 1,
    pid: 1234,
    managementUrl: "http://127.0.0.1:7272",
    root: "/data",
    node: "local",
    token: "must-not-leave-this-machine",
    startedAt: new Date().toISOString(),
  }));
  let authorization;
  let requestedUrl;
  try {
    const exitCode = await runCLI(["status", "--json"], {
      stdout: captureWriter().writer,
      stderr: captureWriter().writer,
      env: {
        OPENBUCKET_HOME: "state",
        OPENBUCKET_MANAGEMENT_URL: "https://remote.example.test",
      },
      homedir: () => temporaryHome,
      fetch: async (url, init) => {
        requestedUrl = String(url);
        authorization = new Headers(init?.headers).get("authorization");
        return Response.json({ online: true });
      },
    });
    assert.equal(exitCode, 0);
    assert.equal(requestedUrl, "https://remote.example.test/v1/status");
    assert.equal(authorization, null);
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("dashboard command re-pairs through a fragment without printing the token", async () => {
  const temporaryHome = await mkdtemp(join(tmpdir(), "openbucket-cli-dashboard-"));
  const statePaths = resolveStatePaths({ OPENBUCKET_HOME: "state" }, temporaryHome);
  await mkdir(statePaths.directory, { recursive: true });
  await writeFile(statePaths.activeFile, JSON.stringify({
    version: 1,
    pid: 1234,
    managementUrl: "http://127.0.0.1:7272",
    dashboardUrl: "http://localhost:3000/?api=http%3A%2F%2F127.0.0.1%3A7272",
    dashboardApiUrl: "https://remote-api.trycloudflare.com",
    root: "/data",
    node: "local",
    token: "reopen-secret-token",
    startedAt: new Date().toISOString(),
  }));
  const stdout = captureWriter();
  const stderr = captureWriter();
  let openedUrl;
  try {
    const exitCode = await runCLI(["dashboard"], {
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: { OPENBUCKET_HOME: "state" },
      homedir: () => temporaryHome,
      fetch: async () => Response.json({ ok: true }),
      spawn: (_command, args) => {
        openedUrl = String(args[0]);
        return { on() { return this; }, unref() {} };
      },
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr.value(), "");
    assert.equal(new URLSearchParams(new URL(openedUrl).hash.slice(1)).get("token"), "reopen-secret-token");
    assert.equal(new URL(openedUrl).searchParams.get("api"), "https://remote-api.trycloudflare.com");
    assert.equal(stdout.value().includes("reopen-secret-token"), false);
    assert.equal(stdout.value().includes("remote-api.trycloudflare.com"), false);
    assert.match(stdout.value(), /one-time pairing fragment/i);
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
});

test("detached startup failures terminate the spawned process tree and leave no active state", async (context) => {
  for (const scenario of [
    { name: "missing child pid", pid: undefined, exitCode: null, expected: /Could not start the detached daemon/ },
    { name: "health timeout", pid: 54_321, exitCode: null, expected: /did not become healthy/ },
    { name: "early child exit", pid: 54_322, exitCode: 1, expected: /exited before becoming healthy/ },
  ]) {
    await context.test(scenario.name, async () => {
      const temporaryHome = await mkdtemp(join(tmpdir(), "openbucket-detached-failure-"));
      const storage = join(temporaryHome, "storage");
      const stdout = captureWriter();
      const stderr = captureWriter();
      let terminated = 0;
      class FakeDetachedChild extends EventEmitter {
        constructor() {
          super();
          this.pid = scenario.pid;
          this.exitCode = scenario.exitCode;
          this.signalCode = null;
        }
        unref() {}
        kill(signal = "SIGTERM") {
          this.signalCode = signal;
          return true;
        }
      }
      const child = new FakeDetachedChild();
      try {
        const exitCode = await runCLI([
          "serve",
          storage,
          "--offline",
          "--no-tunnel",
          "--detach",
          "--no-open",
        ], {
          stdout: stdout.writer,
          stderr: stderr.writer,
          env: {
            OPENBUCKET_HOME: "state",
            OPENBUCKET_START_TIMEOUT_MS: "1",
          },
          homedir: () => temporaryHome,
          cwd: () => temporaryHome,
          spawn: () => child,
          fetch: async () => Response.json({ ok: false }),
          sleep: async () => undefined,
          terminateProcessTree: async (spawned) => {
            assert.equal(spawned, child);
            terminated += 1;
            child.signalCode = "SIGKILL";
            child.emit("close", null, "SIGKILL");
          },
        });
        assert.equal(exitCode, 1);
        assert.equal(terminated, 1);
        assert.match(stderr.value(), scenario.expected);
        const { activeFile } = resolveStatePaths({ OPENBUCKET_HOME: "state" }, temporaryHome);
        await assert.rejects(readFile(activeFile), { code: "ENOENT" });
      } finally {
        await rm(temporaryHome, { recursive: true, force: true });
      }
    });
  }
});

test("usage errors are formatted without throwing or terminating the process", async () => {
  const stdout = captureWriter();
  const stderr = captureWriter();
  const exitCode = await runCLI(["wat"], {
    stdout: stdout.writer,
    stderr: stderr.writer,
    env: {},
  });
  assert.equal(exitCode, 2);
  assert.equal(stdout.value(), "");
  assert.match(stderr.value(), /^Error: Unknown command: wat\./);
  assert.match(stderr.value(), /openbucket help/);
});

test("structured management errors retain their code, message, and API exit code", async () => {
  const stdout = captureWriter();
  const stderr = captureWriter();
  const exitCode = await runCLI(["bucket", "create", "photos"], {
    stdout: stdout.writer,
    stderr: stderr.writer,
    env: { OPENBUCKET_MANAGEMENT_URL: "http://127.0.0.1:7272" },
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "BucketAlreadyExists",
            message: "Bucket 'photos' already exists.",
          },
        },
        { status: 409 },
      ),
  });

  assert.equal(exitCode, 4);
  assert.equal(stdout.value(), "");
  assert.equal(
    stderr.value(),
    "OpenBucket API error [BucketAlreadyExists]: Bucket 'photos' already exists.\n",
  );
});
