#!/usr/bin/env node

import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BOOTSTRAP_USAGE = `Create the first OpenBucket owner through a short-lived registration window.

Usage:
  node scripts/bootstrap-owner.mjs --email EMAIL --url HTTPS_ORIGIN [--name NAME]

Options:
  --email EMAIL  Owner email address (required)
  --name NAME    Owner display name (optional)
  --url URL      Exact production OpenBucket origin (required, HTTPS)
  --signup-token-stdin  Read an existing one-time signup token from a hidden prompt
  --manage-vercel       Create, deploy, close, and remove the temporary Vercel signup window
  -h, --help     Show this help

The password is requested twice in a hidden interactive prompt. This helper
never accepts a password or signup token on the command line or in an
environment variable. Vercel deployment management is off by default.`;

const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

function optionValue(argv, index, option) {
  const argument = argv[index];
  const prefix = `${option}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 0 };
  if (argument !== option) return null;
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return { value: argv[index + 1], consumed: 1 };
}

export function parseBootstrapArguments(argv) {
  const result = {
    email: undefined,
    name: undefined,
    url: undefined,
    manageVercel: false,
    signupTokenStdin: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      result.help = true;
      continue;
    }
    if (argument === "--manage-vercel") {
      if (result.manageVercel) throw new Error("--manage-vercel may be supplied only once.");
      result.manageVercel = true;
      continue;
    }
    if (argument === "--signup-token-stdin") {
      if (result.signupTokenStdin) throw new Error("--signup-token-stdin may be supplied only once.");
      result.signupTokenStdin = true;
      continue;
    }
    if (argument === "--password" || argument.startsWith("--password=")) {
      throw new Error(
        "Passwords are accepted only through the hidden interactive prompt.",
      );
    }
    let matched = false;
    for (const [option, key] of [
      ["--email", "email"],
      ["--name", "name"],
      ["--url", "url"],
    ]) {
      const parsed = optionValue(argv, index, option);
      if (!parsed) continue;
      if (result[key] !== undefined)
        throw new Error(`${option} may be supplied only once.`);
      result[key] = parsed.value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`Unknown option: ${argument}`);
  }
  if (result.manageVercel && result.signupTokenStdin) {
    throw new Error("Use either --manage-vercel or --signup-token-stdin, not both.");
  }
  return result;
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new Error("--email is required.");
  const email = value.normalize("NFKC").trim().toLowerCase();
  const parts = email.split("@");
  if (email.length > 254 || parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Enter a valid owner email address.");
  }
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(parts[1])) {
    throw new Error("Enter a valid owner email address.");
  }
  return email;
}

function normalizeName(value) {
  if (value === undefined) return null;
  const name = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    !name ||
    Array.from(name).length > 80 ||
    Buffer.byteLength(name, "utf8") > 320 ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new Error("--name must contain 1-80 printable characters.");
  }
  return name;
}

function normalizeSignupToken(value) {
  if (value === undefined || value === null) return null;
  const token = String(value).trim();
  if (!token || Buffer.byteLength(token, "utf8") < 32 || Buffer.byteLength(token, "utf8") > 1024 || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error("The one-time signup token is invalid.");
  }
  return token;
}

export function normalizeBootstrapUrl(value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("--url is required.");
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("--url must be a valid HTTPS origin.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "--url must be an HTTPS origin without credentials, a path, query, or fragment.",
    );
  }
  return parsed.origin;
}

export function validateBootstrapOptions(options) {
  const password = options.password;
  const passwordCharacters =
    typeof password === "string" ? Array.from(password).length : 0;
  if (
    passwordCharacters < 12 ||
    passwordCharacters > 128 ||
    Buffer.byteLength(password || "", "utf8") > 1024 ||
    password?.includes("\0")
  ) {
    throw new Error("The owner password must contain 12-128 characters.");
  }
  const manageVercel = options.manageVercel === true;
  const signupToken = normalizeSignupToken(options.signupToken);
  if (manageVercel && signupToken) {
    throw new Error("--manage-vercel creates its own one-time signup token.");
  }
  if (!manageVercel && !signupToken) {
    throw new Error("Vercel deployment management is off. Use --signup-token-stdin for an existing registration window or --manage-vercel to create one.");
  }
  return {
    email: normalizeEmail(options.email),
    name: normalizeName(options.name),
    url: normalizeBootstrapUrl(options.url),
    password,
    manageVercel,
    signupToken,
  };
}

export function generateSignupToken(randomBytes = nodeRandomBytes) {
  const value = randomBytes(48);
  if (!(value instanceof Uint8Array) || value.byteLength < 32) {
    throw new Error("The secure random source did not return enough bytes.");
  }
  return Buffer.from(value).toString("base64url");
}

export function redactSecrets(value, secrets) {
  let redacted = String(value ?? "");
  const candidates = new Set();
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    candidates.add(secret);
    candidates.add(encodeURIComponent(secret));
    candidates.add(JSON.stringify(secret).slice(1, -1));
  }
  for (const candidate of [...candidates].sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(candidate).join("[REDACTED]");
  }
  return redacted;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function vercelInvocation(
  env = process.env,
  platform = process.platform,
) {
  const explicit = env.OPENBUCKET_VERCEL_CLI?.trim();
  if (explicit) {
    if (explicit.includes("\0") || /[\r\n]/.test(explicit))
      throw new Error("OPENBUCKET_VERCEL_CLI contains invalid characters.");
    return { command: explicit, prefix: [] };
  }
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      prefix: ["/d", "/s", "/c", "npx.cmd --yes vercel@latest"],
    };
  }
  return {
    command: "npx",
    prefix: ["--yes", "vercel@latest"],
  };
}

export function runSpawned(
  command,
  args,
  {
    input = "",
    cwd = PROJECT_ROOT,
    env = process.env,
    secrets = [],
    spawnImpl = nodeSpawn,
    maximumOutputBytes = OUTPUT_LIMIT_BYTES,
  } = {},
) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawnImpl(command, [...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      rejectPromise(new Error(redactSecrets(`Could not start the Vercel CLI: ${errorMessage(error)}`, secrets)));
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    const collect = (target) => (chunk) => {
      const value = Buffer.from(chunk);
      outputBytes += value.byteLength;
      if (outputBytes > maximumOutputBytes) {
        child.kill?.();
        rejectOnce(new Error("The Vercel CLI produced too much output and was stopped."));
        return;
      }
      target.push(value);
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", (error) => {
      rejectOnce(new Error(redactSecrets(`Vercel CLI failed to start: ${errorMessage(error)}`, secrets)));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      const standardOutput = redactSecrets(Buffer.concat(stdout).toString("utf8"), secrets);
      const standardError = redactSecrets(Buffer.concat(stderr).toString("utf8"), secrets);
      if (code === 0) {
        settled = true;
        resolvePromise({ stdout: standardOutput, stderr: standardError });
        return;
      }
      const detail = standardError.trim() || standardOutput.trim();
      const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      rejectOnce(new Error(`Vercel CLI failed with ${status}.${detail ? ` ${detail}` : ""}`));
    });

    if (!child.stdin) {
      rejectOnce(new Error("The Vercel CLI did not provide a standard-input stream."));
      child.kill?.();
      return;
    }
    child.stdin.once("error", (error) => {
      rejectOnce(new Error(redactSecrets(`Could not send input to the Vercel CLI: ${errorMessage(error)}`, secrets)));
    });
    child.stdin.end(input);
  });
}

export function createVercelRunner({
  env = process.env,
  platform = process.platform,
  cwd = PROJECT_ROOT,
  spawnImpl = nodeSpawn,
} = {}) {
  const invocation = vercelInvocation(env, platform);
  return (args, options = {}) => runSpawned(
    invocation.command,
    [...invocation.prefix, "--no-color", ...args],
    { ...options, cwd, env, spawnImpl },
  );
}

async function registerOwner(options, signupToken, fetchImpl) {
  const endpoint = new URL("/api/auth/register", `${options.url}/`);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: options.url,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({
      email: options.email,
      password: options.password,
      name: options.name,
      signupToken,
    }),
  });
  const responseText = (await response.text()).slice(0, 64 * 1024);
  let payload = {};
  try {
    payload = JSON.parse(responseText || "{}");
  } catch {
    // A non-JSON error is converted to a generic status message below.
  }
  if (response.status !== 201 || !payload?.user?.id) {
    const detail = payload?.error?.message || `Registration returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return payload.user;
}

export async function bootstrapOwner(rawOptions, dependencies = {}) {
  const options = validateBootstrapOptions(rawOptions);
  const signupToken = options.signupToken || generateSignupToken(dependencies.randomBytes || nodeRandomBytes);
  const secrets = [options.password, signupToken];
  const runVercel = options.manageVercel
    ? dependencies.runVercel || createVercelRunner(dependencies.vercel)
    : null;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const log = dependencies.log || console.log;
  const runStep = async (label, args, input = "") => {
    if (!runVercel) throw new Error("Vercel deployment management is disabled.");
    log(label);
    await runVercel(args, { input, secrets });
  };

  let user;
  let primaryError = null;
  try {
    if (options.manageVercel) {
      await runStep(
        "Setting the temporary sensitive signup token…",
        [
          "env",
          "add",
          "OPENBUCKET_SIGNUP_TOKEN",
          "production",
          "--sensitive",
          "--force",
        ],
        `${signupToken}\n`,
      );
      await runStep(
        "Opening the one-time production signup window…",
        ["env", "add", "OPENBUCKET_ALLOW_SIGNUP", "production", "--force"],
        "true\n",
      );
      await runStep("Deploying the temporary owner-registration window…", [
        "deploy",
        "--prod",
        "--yes",
      ]);
    }
    log(options.manageVercel ? "Creating the owner through the production same-origin API…" : "Creating the owner through the existing production registration window…");
    user = await registerOwner(options, signupToken, fetchImpl);
  } catch (error) {
    primaryError = new Error(redactSecrets(errorMessage(error), secrets));
  }

  const cleanupErrors = [];
  let signupDisabled = false;
  let closedDeployment = false;
  if (options.manageVercel) {
  const cleanupSteps = [
    [
      "Closing production signup…",
      ["env", "add", "OPENBUCKET_ALLOW_SIGNUP", "production", "--force"],
      "false\n",
    ],
    [
      "Removing the temporary signup token…",
      ["env", "rm", "OPENBUCKET_SIGNUP_TOKEN", "production", "--yes"],
      "",
    ],
    [
      "Deploying the closed registration state…",
      ["deploy", "--prod", "--yes"],
      "",
    ],
  ];
  for (const [label, args, input] of cleanupSteps) {
    const removesToken =
      args[0] === "env" &&
      args[1] === "rm" &&
      args[2] === "OPENBUCKET_SIGNUP_TOKEN";
    const deploys = args[0] === "deploy";
    if (removesToken || (deploys && !signupDisabled)) continue;
    try {
      await runStep(label, args, input);
      if (
        args[0] === "env" &&
        args[1] === "add" &&
        args[2] === "OPENBUCKET_ALLOW_SIGNUP"
      ) {
        signupDisabled = true;
      }
      if (deploys) closedDeployment = true;
    } catch (error) {
      cleanupErrors.push(redactSecrets(errorMessage(error), secrets));
    }
  }

  if (closedDeployment) {
    let tokenRemoved = false;
    try {
      await runStep("Removing the temporary signup token...", [
        "env",
        "rm",
        "OPENBUCKET_SIGNUP_TOKEN",
        "production",
        "--yes",
      ]);
      tokenRemoved = true;
    } catch (error) {
      cleanupErrors.push(redactSecrets(errorMessage(error), secrets));
    }
    if (tokenRemoved) {
      try {
        await runStep("Deploying the token-free closed state...", [
          "deploy",
          "--prod",
          "--yes",
        ]);
      } catch (error) {
        cleanupErrors.push(redactSecrets(errorMessage(error), secrets));
      }
    }
  }
  }

  if (primaryError || cleanupErrors.length) {
    const parts = [];
    if (primaryError)
      parts.push(`Owner bootstrap failed: ${primaryError.message}`);
    if (cleanupErrors.length)
      parts.push(
        `Registration cleanup requires attention: ${cleanupErrors.join(" | ")}`,
      );
    throw new Error(parts.join(" "));
  }

  log(options.manageVercel
    ? `Owner account created for ${user.email}. Production signup is closed.`
    : `Owner account created for ${user.email}. Close the existing Vercel signup window and remove its token.`);
  return { user };
}

export function readHiddenLine(
  prompt,
  { input = process.stdin, output = process.stderr } = {},
) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("A TTY is required for the hidden password prompt.");
  }
  output.write(prompt);
  return new Promise((resolvePromise, rejectPromise) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    const wasPaused = input.isPaused?.() ?? false;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
    };
    const finish = (error) => {
      output.write("\n");
      cleanup();
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const onEnd = () => finish(new Error("Password input ended before completion."));
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003" || character === "\u0004") {
          finish(new Error("Owner bootstrap cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (!/[\u0000-\u001f]/.test(character)) value += character;
      }
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.once("end", onEnd);
  });
}

export async function readConfirmedPassword(io) {
  const password = await readHiddenLine("Owner password: ", io);
  const confirmation = await readHiddenLine("Confirm password: ", io);
  if (password !== confirmation) throw new Error("The password confirmation did not match.");
  return password;
}

export function isDirectExecution(metaUrl = import.meta.url, argvPath = process.argv[1], platform = process.platform) {
  if (!argvPath) return false;
  try {
    const current = fileURLToPath(metaUrl);
    const invoked = resolve(argvPath);
    return platform === "win32" ? current.toLowerCase() === invoked.toLowerCase() : current === invoked;
  } catch {
    return false;
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseBootstrapArguments(argv);
  if (parsed.help) {
    (dependencies.output || process.stdout).write(`${BOOTSTRAP_USAGE}\n`);
    return;
  }
  if (!parsed.manageVercel && !parsed.signupTokenStdin) {
    throw new Error("Vercel deployment management is off. Use --signup-token-stdin for an existing registration window or --manage-vercel to create one.");
  }
  const password = await (dependencies.readPassword || readConfirmedPassword)(
    dependencies.io,
  );
  const signupToken = parsed.signupTokenStdin
    ? await readHiddenLine("Existing signup token: ", dependencies.io)
    : undefined;
  await bootstrapOwner({ ...parsed, password, signupToken }, dependencies);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`OpenBucket owner bootstrap failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
}
