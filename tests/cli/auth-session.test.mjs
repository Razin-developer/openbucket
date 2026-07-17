import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AuthenticatedControlPlane,
  createNodeControlPlane,
  findNodeCredential,
  loginHostedAccount,
  readHostedSession,
  rotateSavedNodeCredential,
  resolveAuthPaths,
  resolveControlPlaneUrl,
  writeHostedSession,
  writeNodeCredential,
} from "../../dist/cli/auth-session.js";
import {
  hostedTunnelAdvertisement,
  parseCLIArgs,
  runCLI,
  supervisePublicQuickTunnel,
} from "../../dist/cli/main.js";

const TEST_SESSION = {
  version: 1,
  controlPlaneUrl: "https://control.example.test",
  token: "s".repeat(43),
  cookieName: "__Host-openbucket_session",
  user: {
    id: "user-1",
    email: "owner@example.test",
    name: "Owner",
    role: "admin",
  },
  createdAt: "2026-07-17T00:00:00.000Z",
};

function captureWriter() {
  let output = "";
  return {
    writer: { write(chunk) { output += String(chunk); } },
    value() { return output; },
  };
}

test("auth commands parse without accepting a password process argument", () => {
  const login = parseCLIArgs([
    "login",
    "--email",
    "owner@example.test",
    "--password-stdin",
    "--control-plane-url",
    "https://control.example.test",
  ]);
  assert.equal(login.command, "login");
  assert.deepEqual(login.options, {
    email: "owner@example.test",
    passwordStdin: true,
    controlPlaneUrl: "https://control.example.test",
  });
  assert.equal(parseCLIArgs(["logout"]).command, "logout");
  assert.equal(parseCLIArgs(["whoami", "--json"]).options.json, true);
  assert.throws(() => parseCLIArgs(["login", "--password", "visible"]), /Unknown option/);
});

test("control-plane credentials require HTTPS except for explicit loopback development URLs", async () => {
  assert.equal(
    resolveControlPlaneUrl({ OPENBUCKET_CONTROL_PLANE_URL: "http://localhost:7272/" }),
    "http://localhost:7272",
  );
  assert.equal(
    resolveControlPlaneUrl({ OPENBUCKET_CONTROL_PLANE_URL: "http://127.0.0.42:7272" }),
    "http://127.0.0.42:7272",
  );
  assert.equal(
    resolveControlPlaneUrl({ OPENBUCKET_CONTROL_PLANE_URL: "http://[::1]:7272" }),
    "http://[::1]:7272",
  );
  assert.throws(
    () => resolveControlPlaneUrl({ OPENBUCKET_CONTROL_PLANE_URL: "http://example.com" }),
    /must use HTTPS unless it points to a loopback address/,
  );
  assert.throws(
    () => new AuthenticatedControlPlane(
      { ...TEST_SESSION, controlPlaneUrl: "http://example.com" },
      async () => Response.json({}),
    ),
    /must use HTTPS/,
  );
  assert.throws(
    () => createNodeControlPlane({
      controlPlaneUrl: "http://localhost.attacker.example",
      nodeToken: "n".repeat(32),
      fetch: async () => Response.json({}),
    }),
    /must use HTTPS/,
  );

  let fetched = false;
  await assert.rejects(
    loginHostedAccount({
      controlPlaneUrl: "http://example.com",
      email: "owner@example.test",
      password: "not-sent",
      fetch: async () => {
        fetched = true;
        return Response.json({});
      },
    }),
    /must use HTTPS/,
  );
  assert.equal(fetched, false);
});

test("hosted login uses same-origin JSON and extracts the HttpOnly session cookie", async () => {
  let request;
  const session = await loginHostedAccount({
    controlPlaneUrl: "https://control.example.test/",
    email: "owner@example.test",
    password: "correct horse battery staple",
    fetch: async (url, init) => {
      request = { url: String(url), init };
      return Response.json(
        { user: { id: "user-1", email: "owner@example.test", name: null, role: "admin" } },
        { headers: { "set-cookie": `__Host-openbucket_session=${"a".repeat(43)}; Path=/; HttpOnly; Secure` } },
      );
    },
  });

  assert.equal(request.url, "https://control.example.test/api/auth/login");
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("origin"), "https://control.example.test");
  assert.equal(headers.get("sec-fetch-site"), "none");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(request.init.body), {
    email: "owner@example.test",
    password: "correct horse battery staple",
  });
  assert.equal(session.user.name, null);
  assert.equal(session.token, "a".repeat(43));
});

test("saved sessions are atomic, private, and contain no password", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-auth-test-"));
  const env = { OPENBUCKET_HOME: "state" };
  try {
    await writeHostedSession(TEST_SESSION, env, home, 1234);
    const paths = resolveAuthPaths(env, home);
    const serialized = await readFile(paths.sessionFile, "utf8");
    assert.equal(serialized.includes("password"), false);
    assert.deepEqual(await readHostedSession(env, home), TEST_SESSION);
    if (process.platform !== "win32") {
      assert.equal((await stat(paths.sessionFile)).mode & 0o777, 0o600);
      assert.equal((await stat(paths.directory)).mode & 0o777, 0o700);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a backup left by an interrupted Windows replacement is recovered under the file lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-auth-recovery-test-"));
  const env = { OPENBUCKET_HOME: "state" };
  try {
    await writeHostedSession(TEST_SESSION, env, home, 1_234);
    const paths = resolveAuthPaths(env, home);
    await rename(paths.sessionFile, `${paths.sessionFile}.bak`);
    assert.deepEqual(await readHostedSession(env, home), TEST_SESSION);
    await assert.rejects(readFile(`${paths.sessionFile}.bak`), { code: "ENOENT" });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("concurrent node credential writes preserve the existing aggregate store format", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-node-lock-test-"));
  const env = { OPENBUCKET_HOME: "state" };
  const credentials = Array.from({ length: 10 }, (_, index) => ({
    version: 1,
    controlPlaneUrl: "https://control.example.test",
    nodeId: `node-${index}`,
    nodeName: `node-${index}`,
    token: `obn_${String(index).padStart(2, "0")}_${"x".repeat(32)}`,
    createdAt: "2026-07-17T00:00:00.000Z",
  }));
  try {
    await Promise.all(
      credentials.map((credential, index) =>
        writeNodeCredential(credential, env, home, 2_000 + index)),
    );
    const paths = resolveAuthPaths(env, home);
    const serialized = JSON.parse(await readFile(paths.nodesFile, "utf8"));
    assert.equal(serialized.version, 1);
    assert.equal(serialized.credentials.length, credentials.length);
    for (const credential of credentials) {
      assert.deepEqual(
        await findNodeCredential(credential.controlPlaneUrl, credential.nodeName, env, home),
        credential,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a rejected saved node token rotates once and persists its replacement", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-node-rotation-test-"));
  const env = { OPENBUCKET_HOME: "state" };
  const stale = {
    version: 1,
    controlPlaneUrl: TEST_SESSION.controlPlaneUrl,
    nodeId: "node-1",
    nodeName: "primary",
    token: `obn_stale_${"x".repeat(32)}`,
    createdAt: "2026-07-17T00:00:00.000Z",
  };
  try {
    await writeNodeCredential(stale, env, home, 3_000);
    const replacement = await rotateSavedNodeCredential({
      session: TEST_SESSION,
      credential: stale,
      env,
      homeDirectory: home,
      processId: 3_001,
      fetch: async (url, init) => {
        assert.equal(String(url), "https://control.example.test/api/nodes/node-1/rotate-token");
        assert.equal(init.method, "POST");
        return Response.json({
          node: { id: "node-1", name: "primary" },
          credential: { token: `obn_replacement_${"y".repeat(32)}`, createdAt: "2026-07-17T01:00:00.000Z" },
        });
      },
    });
    assert.notEqual(replacement.token, stale.token);
    assert.deepEqual(
      await findNodeCredential(TEST_SESSION.controlPlaneUrl, "primary", env, home),
      replacement,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a closed Quick Tunnel immediately removes its hosted public advertisement", async () => {
  let closeTunnel;
  const closed = new Promise((resolveClose) => {
    closeTunnel = resolveClose;
  });
  const state = {
    version: 1,
    pid: 42,
    managementUrl: "http://127.0.0.1:7272",
    s3Url: "http://127.0.0.1:8333",
    publicUrl: "https://quick.trycloudflare.com",
    tunnelMode: "quick",
    root: "C:\\storage",
    node: "primary",
    startedAt: "2026-07-17T00:00:00.000Z",
  };
  let advertised;
  const unavailable = new Promise((resolveUnavailable, rejectUnavailable) => {
    supervisePublicQuickTunnel({
      tunnel: { closed },
      state,
      isShuttingDown: () => false,
      onUnavailable() {
        advertised = hostedTunnelAdvertisement(state);
        resolveUnavailable();
      },
      onError: rejectUnavailable,
    });
  });

  closeTunnel();
  await unavailable;
  assert.equal(state.publicUrl, undefined);
  assert.equal(state.tunnelMode, undefined);
  assert.deepEqual(advertised, {
    tunnelMode: "none",
    publicDiscoverable: false,
  });
});

test("account requests use the session cookie while node heartbeats use only node Bearer auth", async () => {
  const accountRequests = [];
  const account = new AuthenticatedControlPlane(TEST_SESSION, async (url, init) => {
    accountRequests.push({ url: String(url), init });
    return Response.json({
      created: true,
      node: { id: "node-1", name: "primary" },
      credential: { token: "obn_node_secret", createdAt: "2026-07-17T00:00:00.000Z" },
    }, { status: 201 });
  });
  await account.registerNode("primary");
  const accountHeaders = new Headers(accountRequests[0].init.headers);
  assert.equal(accountHeaders.get("cookie"), `__Host-openbucket_session=${TEST_SESSION.token}`);
  assert.equal(accountHeaders.get("authorization"), null);
  assert.equal(accountHeaders.get("origin"), "https://control.example.test");
  assert.equal(accountHeaders.get("sec-fetch-site"), "none");
  assert.deepEqual(JSON.parse(accountRequests[0].init.body), { name: "primary" });

  let heartbeatRequest;
  const node = createNodeControlPlane({
    controlPlaneUrl: "https://control.example.test",
    nodeToken: "obn_node_secret_value",
    fetch: async (url, init) => {
      heartbeatRequest = { url: String(url), init };
      return Response.json({ accepted: true, duplicate: false });
    },
  });
  await node.heartbeat({ eventId: "event-1", online: true });
  const heartbeatHeaders = new Headers(heartbeatRequest.init.headers);
  assert.equal(heartbeatRequest.url, "https://control.example.test/api/node/heartbeat");
  assert.equal(heartbeatHeaders.get("authorization"), "Bearer obn_node_secret_value");
  assert.equal(heartbeatHeaders.get("cookie"), null);
});

test("CLI login persists only the session, whoami verifies it, and logout removes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-login-test-"));
  const stdout = captureWriter();
  const stderr = captureWriter();
  const secretPassword = "correct horse battery staple";
  const secretToken = "z".repeat(43);
  try {
    const loginCode = await runCLI([
      "login",
      "--email",
      "owner@example.test",
      "--password-stdin",
    ], {
      stdout: stdout.writer,
      stderr: stderr.writer,
      env: {
        OPENBUCKET_HOME: "state",
        OPENBUCKET_CONTROL_PLANE_URL: "https://control.example.test",
      },
      homedir: () => home,
      readStdin: async () => `${secretPassword}\n`,
      fetch: async (_url, init) => {
        assert.equal(JSON.parse(init.body).password, secretPassword);
        return Response.json(
          { user: TEST_SESSION.user },
          { headers: { "set-cookie": `__Host-openbucket_session=${secretToken}; Path=/; HttpOnly; Secure` } },
        );
      },
    });
    assert.equal(loginCode, 0);
    assert.equal(stdout.value().includes(secretPassword), false);
    assert.equal(stdout.value().includes(secretToken), false);
    assert.equal(stderr.value(), "");
    const authPath = resolveAuthPaths({ OPENBUCKET_HOME: "state" }, home).sessionFile;
    assert.equal((await readFile(authPath, "utf8")).includes(secretPassword), false);

    let whoamiCookie;
    const whoamiOut = captureWriter();
    const whoamiCode = await runCLI(["whoami", "--json"], {
      stdout: whoamiOut.writer,
      stderr: captureWriter().writer,
      env: { OPENBUCKET_HOME: "state" },
      homedir: () => home,
      fetch: async (_url, init) => {
        whoamiCookie = new Headers(init.headers).get("cookie");
        return Response.json({ user: TEST_SESSION.user });
      },
    });
    assert.equal(whoamiCode, 0);
    assert.equal(whoamiCookie, `__Host-openbucket_session=${secretToken}`);
    assert.equal(whoamiOut.value().includes(secretToken), false);

    const logoutCode = await runCLI(["logout"], {
      stdout: captureWriter().writer,
      stderr: captureWriter().writer,
      env: { OPENBUCKET_HOME: "state" },
      homedir: () => home,
      fetch: async () => Response.json({ ok: true }),
    });
    assert.equal(logoutCode, 0);
    assert.equal(await readHostedSession({ OPENBUCKET_HOME: "state" }, home), undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("serve is account-gated unless the explicit offline development mode is selected", async () => {
  const home = await mkdtemp(join(tmpdir(), "openbucket-gate-test-"));
  const stderr = captureWriter();
  try {
    const code = await runCLI(["serve", join(home, "storage"), "--no-tunnel"], {
      stdout: captureWriter().writer,
      stderr: stderr.writer,
      env: { OPENBUCKET_HOME: "state" },
      homedir: () => home,
    });
    assert.equal(code, 4);
    assert.match(stderr.value(), /requires an account/i);
    assert.match(stderr.value(), /openbucket login/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
