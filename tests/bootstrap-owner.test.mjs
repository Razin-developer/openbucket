import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  bootstrapOwner,
  generateSignupToken,
  normalizeBootstrapUrl,
  parseBootstrapArguments,
  runSpawned,
  vercelInvocation,
} from "../scripts/bootstrap-owner.mjs";

const password = "correct horse battery staple";
const random = () => Buffer.alloc(48, 7);
const expectedToken = Buffer.alloc(48, 7).toString("base64url");

test("uses cmd.exe to launch the Windows npx command shim for Vercel", () => {
  assert.deepEqual(vercelInvocation({}, "win32"), {
    command: "cmd.exe",
    prefix: ["/d", "/s", "/c", "npx.cmd --yes vercel@latest"],
  });
  assert.deepEqual(vercelInvocation({}, "linux"), {
    command: "npx",
    prefix: ["--yes", "vercel@latest"],
  });
});

test("parses only non-secret bootstrap arguments", () => {
  assert.deepEqual(
    parseBootstrapArguments(["--email", "Owner@Example.com", "--name=Razin", "--url", "https://openbucket-eight.vercel.app"]),
    {
      email: "Owner@Example.com",
      name: "Razin",
      url: "https://openbucket-eight.vercel.app",
      manageVercel: false,
      signupTokenStdin: false,
      help: false,
    },
  );
  assert.throws(
    () => parseBootstrapArguments(["--manage-vercel", "--signup-token-stdin"]),
    /not both/,
  );
  assert.throws(() => parseBootstrapArguments(["--password", "secret"]), /hidden interactive prompt/);
  assert.throws(() => parseBootstrapArguments(["--email"]), /requires a value/);
  assert.equal(normalizeBootstrapUrl("https://example.com"), "https://example.com");
  assert.throws(() => normalizeBootstrapUrl("http://example.com"), /HTTPS origin/);
  assert.equal(generateSignupToken(random), expectedToken);
  assert.match(expectedToken, /^[A-Za-z0-9_-]{64}$/);
});

test("successful bootstrap opens, registers, and always closes the window", async () => {
  const commands = [];
  const requests = [];
  const logs = [];
  const result = await bootstrapOwner({
    email: "Owner@Example.com",
    name: "Razin",
    url: "https://openbucket-eight.vercel.app",
    password,
    manageVercel: true,
  }, {
    randomBytes: random,
    runVercel: async (args, options) => commands.push({ args: [...args], input: options.input }),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ user: { id: "user-1", email: "owner@example.com", name: "Razin", role: "admin" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
    log: (message) => logs.push(message),
  });

  assert.equal(result.user.role, "admin");
  assert.deepEqual(commands.map(({ args }) => args), [
    ["env", "add", "OPENBUCKET_SIGNUP_TOKEN", "production", "--sensitive", "--force"],
    ["env", "add", "OPENBUCKET_ALLOW_SIGNUP", "production", "--force"],
    ["deploy", "--prod", "--yes"],
    ["env", "add", "OPENBUCKET_ALLOW_SIGNUP", "production", "--force"],
    ["deploy", "--prod", "--yes"],
    ["env", "rm", "OPENBUCKET_SIGNUP_TOKEN", "production", "--yes"],
    ["deploy", "--prod", "--yes"],
  ]);
  assert.deepEqual(commands.map(({ input }) => input), [`${expectedToken}\n`, "true\n", "", "false\n", "", "", ""]);
  assert.equal(requests[0].url, "https://openbucket-eight.vercel.app/api/auth/register");
  assert.equal(requests[0].init.headers.origin, "https://openbucket-eight.vercel.app");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    email: "owner@example.com",
    password,
    name: "Razin",
    signupToken: expectedToken,
  });
  assert.ok(commands.every(({ args }) => !args.join(" ").includes(expectedToken) && !args.join(" ").includes(password)));
  assert.ok(logs.every((line) => !line.includes(expectedToken) && !line.includes(password)));
});

test("existing signup windows do not invoke Vercel automation", async () => {
  let vercelCalled = false;
  const result = await bootstrapOwner({
    email: "owner@example.com",
    url: "https://example.com",
    password,
    signupToken: expectedToken,
  }, {
    runVercel: async () => {
      vercelCalled = true;
      throw new Error("Vercel must not run in default mode");
    },
    fetchImpl: async () => new Response(JSON.stringify({
      user: { id: "user-1", email: "owner@example.com", name: null, role: "admin" },
    }), { status: 201, headers: { "content-type": "application/json" } }),
    log() {},
  });
  assert.equal(result.user.email, "owner@example.com");
  assert.equal(vercelCalled, false);
});

test("registration failure is redacted and still runs every cleanup step", async () => {
  const commands = [];
  await assert.rejects(
    bootstrapOwner({ email: "owner@example.com", url: "https://example.com", password, manageVercel: true }, {
      randomBytes: random,
      runVercel: async (args, options) => commands.push({ args: [...args], input: options.input }),
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: `rejected ${password} ${expectedToken}` } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
      log() {},
    }),
    (error) => {
      assert.match(error.message, /Owner bootstrap failed/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, new RegExp(password));
      assert.doesNotMatch(error.message, new RegExp(expectedToken));
      return true;
    },
  );
  assert.deepEqual(commands.slice(-4).map(({ args }) => args.slice(0, 3)), [
    ["env", "add", "OPENBUCKET_ALLOW_SIGNUP"],
    ["deploy", "--prod", "--yes"],
    ["env", "rm", "OPENBUCKET_SIGNUP_TOKEN"],
    ["deploy", "--prod", "--yes"],
  ]);
});

test("a failed signup close keeps the guard token and skips deployment", async () => {
  const commands = [];
  await assert.rejects(
    bootstrapOwner({ email: "owner@example.com", url: "https://example.com", password, manageVercel: true }, {
      randomBytes: random,
      runVercel: async (args) => {
        commands.push([...args]);
        if (args[0] === "env" && args[1] === "add" && args[2] === "OPENBUCKET_ALLOW_SIGNUP" && commands.length > 3) {
          throw new Error("cleanup failed");
        }
      },
      fetchImpl: async () => new Response(JSON.stringify({ user: { id: "user-1", email: "owner@example.com", role: "admin" } }), { status: 201 }),
      log() {},
    }),
    /Registration cleanup requires attention: cleanup failed/,
  );
  assert.deepEqual(commands.at(-1).slice(0, 3), ["env", "add", "OPENBUCKET_ALLOW_SIGNUP"]);
  assert.equal(commands.some((args) => args[0] === "env" && args[1] === "rm"), false);
  assert.equal(commands.slice(3).some((args) => args[0] === "deploy"), false);
});

test("a failed closed-state deploy keeps the guard token configured", async () => {
  const commands = [];
  let deployments = 0;
  await assert.rejects(
    bootstrapOwner({ email: "owner@example.com", url: "https://example.com", password, manageVercel: true }, {
      randomBytes: random,
      runVercel: async (args) => {
        commands.push([...args]);
        if (args[0] === "deploy" && ++deployments === 2) throw new Error("closed deploy failed");
      },
      fetchImpl: async () => new Response(JSON.stringify({ user: { id: "user-1", email: "owner@example.com", role: "admin" } }), { status: 201 }),
      log() {},
    }),
    /Registration cleanup requires attention: closed deploy failed/,
  );
  assert.equal(commands.some((args) => args[0] === "env" && args[1] === "rm"), false);
});

test("spawn runner uses argument arrays, shell false, and stdin for secret values", async () => {
  const captured = { input: "" };
  const spawnImpl = (command, args, options) => {
    captured.command = command;
    captured.args = args;
    captured.options = options;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin.on("data", (chunk) => { captured.input += chunk.toString("utf8"); });
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };

  await runSpawned("vercel", ["env", "add", "SECRET", "production"], {
    input: "not-on-command-line\n",
    spawnImpl,
  });
  assert.equal(captured.command, "vercel");
  assert.equal(captured.options.shell, false);
  assert.deepEqual(captured.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.doesNotMatch(captured.args.join(" "), /not-on-command-line/);
  assert.equal(captured.input, "not-on-command-line\n");
});
