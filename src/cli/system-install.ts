/**
 * System-level install helpers for `openbucket install` — Node.js/npm/pnpm/cloudflared detection
 * and auto-install, plus the PATH-persistence fix (writing the install location to the user's
 * shell profile / Windows User PATH, not just the current process's environment) that
 * `scripts/install.sh`/`scripts/install.ps1`'s archive-fallback paths were missing.
 */
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as prompts from "@clack/prompts";
import type { CLIIO } from "./main.js";

const NODE_DIST_VERSION = "22.13.0";
const POSIX_PACKAGE_MANAGERS = ["brew", "apt-get", "dnf", "pacman", "apk"] as const;
const WINDOWS_PACKAGE_MANAGERS = ["winget", "choco", "scoop"] as const;

interface CapturedChild {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** npm/pnpm/cloudflared (via winget/choco/scoop shims) ship as .cmd/.ps1 on Windows — see the
 *  identical rationale on shimSafeSpawnTarget in main.ts. Duplicated locally to avoid a runtime
 *  import cycle with main.ts (which imports this module's functions). */
function shimSafeSpawnTarget(io: CLIIO, command: string, args: readonly string[]): { command: string; args: string[] } {
  if (io.platform !== "win32") return { command, args: [...args] };
  return { command: "cmd.exe", args: ["/d", "/c", command, ...args] };
}

function runCapture(io: CLIIO, command: string, args: readonly string[]): Promise<CapturedChild> {
  return new Promise((resolveChild) => {
    let child: ChildProcess;
    try {
      child = io.spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveChild({ code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => resolveChild({ code: null, stdout, stderr: stderr || (error instanceof Error ? error.message : String(error)) }));
    child.once("close", (code) => resolveChild({ code, stdout, stderr }));
  });
}

function runInherit(io: CLIIO, command: string, args: readonly string[]): Promise<number | null> {
  return new Promise((resolveChild) => {
    let child: ChildProcess;
    try {
      child = io.spawn(command, args, { stdio: "inherit", shell: false, windowsHide: true });
    } catch {
      resolveChild(null);
      return;
    }
    child.once("error", () => resolveChild(null));
    child.once("close", (code) => resolveChild(code));
  });
}

async function commandOnPath(io: CLIIO, command: string): Promise<boolean> {
  if (io.platform === "win32") {
    const result = await runCapture(io, "where.exe", [command]);
    return result.code === 0;
  }
  const result = await runCapture(io, "/bin/sh", ["-c", `command -v ${command}`]);
  return result.code === 0;
}

/** Spawns `<command> <args>` (default `--version`) and returns the first line of output, or
 *  undefined if the tool isn't on PATH / the process errored. Used by `openbucket doctor`. */
export async function toolVersion(io: CLIIO, command: string, args: readonly string[] = ["--version"]): Promise<string | undefined> {
  const target = shimSafeSpawnTarget(io, command, args);
  const result = await runCapture(io, target.command, target.args);
  if (result.code !== 0) return undefined;
  const text = (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.trim();
  return text || undefined;
}

export async function resolvePlatformPackageManager(io: CLIIO): Promise<string | undefined> {
  const candidates = io.platform === "win32" ? WINDOWS_PACKAGE_MANAGERS : POSIX_PACKAGE_MANAGERS;
  for (const candidate of candidates) {
    if (await commandOnPath(io, candidate)) return candidate;
  }
  return undefined;
}

/**
 * The PATH-persistence fix: `install.sh`/`install.ps1`'s archive-fallback branches only exported
 * PATH for their own script process and printed instructions to add it permanently — never wrote
 * anything. This actually persists it (idempotently), and also updates the current process's PATH
 * so the rest of this run sees it immediately.
 */
export async function persistPathEntry(io: CLIIO, dir: string): Promise<{ persisted: boolean; detail: string }> {
  process.env.PATH = `${dir}${io.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;

  if (io.platform === "win32") {
    const script = `$dir = ${JSON.stringify(dir)}; $current = [Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $current) { $current = '' }; if (($current -split ';') -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', "$current;$dir".Trim(';'), 'User') }`;
    const result = await runCapture(io, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return result.code === 0
      ? { persisted: true, detail: `added to your User PATH (${dir}) — new terminals will see it` }
      : { persisted: false, detail: `could not update the persistent PATH automatically — add ${dir} to your PATH yourself` };
  }

  const shell = io.env.SHELL ?? "";
  const home = io.homedir();
  const profile = shell.includes("zsh") ? join(home, ".zshrc")
    : shell.includes("bash") ? join(home, ".bashrc")
      : join(home, ".profile");
  const marker = "# openbucket: added by `openbucket install`";
  const line = `export PATH="${dir}:$PATH"`;
  try {
    let existing = "";
    try { existing = await readFile(profile, "utf8"); } catch { /* profile doesn't exist yet — will be created */ }
    if (existing.includes(line)) return { persisted: true, detail: `already present in ${profile}` };
    const suffix = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await writeFile(profile, `${existing}${suffix}${marker}\n${line}\n`, "utf8");
    return { persisted: true, detail: `added to ${profile} — open a new shell to pick it up` };
  } catch {
    return { persisted: false, detail: `could not update ${profile} automatically — add this line to your shell profile: ${line}` };
  }
}

async function downloadFile(io: CLIIO, url: string, destPath: string): Promise<void> {
  const response = await io.fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`);
  await mkdir(join(destPath, ".."), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destPath));
}

function nodeArch(): string {
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "x64") return "x64";
  return process.arch;
}

/** Package-manager cascade for Node.js, mirroring install.sh/install.ps1's ordering exactly. Each
 *  entry is a full (command, args) invocation to try in order; the first that exits 0 wins. */
async function installNodeViaPackageManager(io: CLIIO, manager: string): Promise<boolean> {
  const attempts: Record<string, Array<[string, string[]]>> = {
    brew: [["brew", ["install", "node@22"]], ["brew", ["install", "node"]]],
    pacman: [["sudo", ["pacman", "-Sy", "--noconfirm", "nodejs", "npm"]]],
    apk: [["sudo", ["apk", "add", "--no-cache", "nodejs", "npm"]]],
    winget: [["winget", ["install", "--id", "OpenJS.NodeJS.LTS", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]]],
    choco: [["choco", ["install", "nodejs-lts", "-y"]]],
    scoop: [["scoop", ["install", "nodejs-lts"]]],
  };
  if (manager === "apt-get") {
    const setup = await runInherit(io, "/bin/sh", ["-c", "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"]);
    if (setup !== 0) return false;
    return (await runInherit(io, "sudo", ["apt-get", "install", "-y", "nodejs"])) === 0;
  }
  if (manager === "dnf") {
    const setup = await runInherit(io, "/bin/sh", ["-c", "curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -"]);
    if (setup !== 0) return false;
    return (await runInherit(io, "sudo", ["dnf", "install", "-y", "nodejs"])) === 0;
  }
  for (const [command, args] of attempts[manager] ?? []) {
    if ((await runInherit(io, command, args)) === 0) return true;
  }
  return false;
}

async function installNodeFromOfficialArchive(io: CLIIO): Promise<{ ok: boolean; binDir?: string; detail: string }> {
  const home = io.homedir();
  const installRoot = join(home, ".openbucket", "node");
  try {
    if (io.platform === "win32") {
      const arch = nodeArch();
      const archive = `node-v${NODE_DIST_VERSION}-win-${arch}`;
      const url = `https://nodejs.org/dist/v${NODE_DIST_VERSION}/${archive}.zip`;
      const zipPath = join(installRoot, `${archive}.zip`);
      await downloadFile(io, url, zipPath);
      const extractScript = `Expand-Archive -Path ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(installRoot)} -Force`;
      const result = await runCapture(io, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", extractScript]);
      if (result.code !== 0) return { ok: false, detail: `could not extract the downloaded Node.js archive: ${result.stderr.trim()}` };
      return { ok: true, binDir: join(installRoot, archive), detail: `installed Node.js v${NODE_DIST_VERSION} to ${join(installRoot, archive)}` };
    }
    const platform = io.platform === "darwin" ? "darwin" : "linux";
    const arch = nodeArch();
    const archive = `node-v${NODE_DIST_VERSION}-${platform}-${arch}`;
    const url = `https://nodejs.org/dist/v${NODE_DIST_VERSION}/${archive}.tar.gz`;
    const tarPath = join(installRoot, `${archive}.tar.gz`);
    await downloadFile(io, url, tarPath);
    const extract = await runCapture(io, "tar", ["-xzf", tarPath, "-C", installRoot]);
    if (extract.code !== 0) return { ok: false, detail: `could not extract the downloaded Node.js archive: ${extract.stderr.trim()}` };
    return { ok: true, binDir: join(installRoot, archive, "bin"), detail: `installed Node.js v${NODE_DIST_VERSION} to ${join(installRoot, archive, "bin")}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** If the running Node doesn't meet the minimum version, cascades through the OS package manager
 *  then a direct nodejs.org archive download — a running process can't hot-swap its own
 *  interpreter, so this only prepares Node for the *next* shell/run, and says so. */
export async function ensureNodeVersion(io: CLIIO, supportsCurrentNode: (version: string) => boolean): Promise<{ ok: boolean; detail: string }> {
  if (supportsCurrentNode(process.versions.node)) return { ok: true, detail: `v${process.versions.node}` };
  const manager = await resolvePlatformPackageManager(io);
  if (manager && (await installNodeViaPackageManager(io, manager))) {
    return { ok: true, detail: `installed a supported Node.js via ${manager} — open a new shell and re-run \`openbucket install\`` };
  }
  const archiveResult = await installNodeFromOfficialArchive(io);
  if (archiveResult.ok && archiveResult.binDir) {
    const persisted = await persistPathEntry(io, archiveResult.binDir);
    return { ok: true, detail: `${archiveResult.detail}; ${persisted.detail} — open a new shell and re-run \`openbucket install\`` };
  }
  return { ok: false, detail: `could not install a supported Node.js automatically (${archiveResult.detail}). Install Node.js 22.13+ yourself from https://nodejs.org/` };
}

async function installCloudflaredViaPackageManager(io: CLIIO, manager: string): Promise<boolean> {
  const commands: Record<string, string[][]> = {
    brew: [["install", "cloudflared"]],
    winget: [["install", "--id", "Cloudflare.cloudflared", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]],
    choco: [["install", "cloudflared", "-y"]],
    scoop: [["install", "cloudflared"]],
  };
  if (manager === "apt-get") {
    const keyring = await runInherit(io, "/bin/sh", [
      "-c",
      "curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main' | sudo tee /etc/apt/sources.list.d/cloudflared.list",
    ]);
    if (keyring !== 0) return false;
    const update = await runInherit(io, "sudo", ["apt-get", "update"]);
    if (update !== 0) return false;
    return (await runInherit(io, "sudo", ["apt-get", "install", "-y", "cloudflared"])) === 0;
  }
  if (manager === "dnf") {
    const repo = await runInherit(io, "/bin/sh", ["-c", "curl -fsSL https://pkg.cloudflare.com/cloudflared.repo | sudo tee /etc/yum.repos.d/cloudflared.repo"]);
    if (repo !== 0) return false;
    return (await runInherit(io, "sudo", ["dnf", "install", "-y", "cloudflared"])) === 0;
  }
  if (manager === "pacman") return (await runInherit(io, "sudo", ["pacman", "-Sy", "--noconfirm", "cloudflared"])) === 0;
  if (manager === "apk") return (await runInherit(io, "sudo", ["apk", "add", "--no-cache", "cloudflared"])) === 0;
  const argSets = commands[manager] ?? [];
  for (const args of argSets) {
    if ((await runInherit(io, manager, args)) === 0) return true;
  }
  return false;
}

async function installCloudflaredFromRelease(io: CLIIO): Promise<{ ok: boolean; binDir?: string; detail: string }> {
  const home = io.homedir();
  const installRoot = join(home, ".openbucket", "bin");
  try {
    const arch = nodeArch();
    if (io.platform === "win32") {
      const url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
      const dest = join(installRoot, "cloudflared.exe");
      await downloadFile(io, url, dest);
      return { ok: true, binDir: installRoot, detail: `downloaded cloudflared to ${dest}` };
    }
    if (io.platform === "darwin") {
      const url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";
      const tgzPath = join(installRoot, "cloudflared.tgz");
      await downloadFile(io, url, tgzPath);
      const extract = await runCapture(io, "tar", ["-xzf", tgzPath, "-C", installRoot]);
      if (extract.code !== 0) return { ok: false, detail: `could not extract the downloaded cloudflared archive: ${extract.stderr.trim()}` };
      await runCapture(io, "chmod", ["+x", join(installRoot, "cloudflared")]);
      return { ok: true, binDir: installRoot, detail: `downloaded cloudflared to ${installRoot}` };
    }
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch === "arm64" ? "arm64" : "amd64"}`;
    const dest = join(installRoot, "cloudflared");
    await downloadFile(io, url, dest);
    await runCapture(io, "chmod", ["+x", dest]);
    return { ok: true, binDir: installRoot, detail: `downloaded cloudflared to ${dest}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Non-fatal — cloudflared is optional (the public tunnel already degrades gracefully without it,
 *  per the v0.1.24 fix), so a failure here is a warning with manual instructions, never an error. */
export async function ensureCloudflared(io: CLIIO): Promise<{ ok: boolean; detail: string }> {
  if (await toolVersion(io, io.env.OPENBUCKET_CLOUDFLARED_PATH || "cloudflared")) {
    return { ok: true, detail: "already installed" };
  }
  const manager = await resolvePlatformPackageManager(io);
  if (manager && (await installCloudflaredViaPackageManager(io, manager))) {
    return { ok: true, detail: `installed via ${manager}` };
  }
  const archiveResult = await installCloudflaredFromRelease(io);
  if (archiveResult.ok && archiveResult.binDir) {
    const persisted = await persistPathEntry(io, archiveResult.binDir);
    return { ok: true, detail: `${archiveResult.detail}; ${persisted.detail}` };
  }
  return { ok: false, detail: `could not install cloudflared automatically (${archiveResult.detail}). Install it from https://developers.cloudflare.com/tunnel/downloads/ — OpenBucket still works fully locally without it` };
}

/**
 * Arrow-key yes/no picker (same @clack/prompts.select widget as pickPackageManager, not the
 * bracket-style confirm prompt) asked only when cloudflared isn't already on PATH — no point
 * asking about something that's already there. `--yes`/OPENBUCKET_SKIP_CLOUDFLARED_PROMPT=1 and
 * non-interactive runs keep the previous default (install it), matching install.sh/install.ps1's
 * own "attempt automatically" behavior for the optional tunnel dependency.
 */
export async function ensureCloudflaredWithConsent(io: CLIIO, skipPrompt: boolean): Promise<{ ok: boolean; detail: string }> {
  const existing = await toolVersion(io, io.env.OPENBUCKET_CLOUDFLARED_PATH || "cloudflared");
  if (existing) return { ok: true, detail: `already installed (${existing})` };
  if (!skipPrompt && io.stdout.isTTY) {
    const choice = await prompts.select({
      message: "cloudflared powers the public tunnel (openbucket serve --tunnel). Install it now?",
      options: [
        { value: true, label: "Yes", hint: "install cloudflared" },
        { value: false, label: "No", hint: "skip — the tunnel feature won't be available" },
      ],
    });
    const wantsCloudflared = !prompts.isCancel(choice) && choice === true;
    if (!wantsCloudflared) return { ok: true, detail: "skipped — run `openbucket install` again later to add it" };
  }
  return ensureCloudflared(io);
}

export type PackageManager = "npm" | "pnpm" | "bun";
const PACKAGE_MANAGERS: PackageManager[] = ["npm", "pnpm", "bun"];

/**
 * If this process was itself launched by `npx`/`pnpm dlx`/`bunx` (or any plain `npm exec`/`yarn
 * dlx` invocation), npm/pnpm/yarn/bun all set `npm_config_user_agent` on the child's environment
 * to identify themselves — that's the standard mechanism tools like create-vite/create-next-app
 * use to detect "which package manager ran me". When it names one of our three, there is nothing
 * to ask: the user already told us which package manager to use by choosing how to invoke this.
 */
export function detectInvokingPackageManager(io: CLIIO): PackageManager | undefined {
  const agent = io.env.npm_config_user_agent;
  if (!agent) return undefined;
  const name = agent.split("/")[0]?.trim();
  return PACKAGE_MANAGERS.find((pm) => pm === name);
}

async function installPnpmViaPackageManager(io: CLIIO, manager: string): Promise<boolean> {
  const attempts: Record<string, Array<[string, string[]]>> = {
    brew: [["brew", ["install", "pnpm"]]],
    winget: [["winget", ["install", "--id", "pnpm.pnpm", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]]],
    scoop: [["scoop", ["install", "pnpm"]]],
  };
  for (const [command, args] of attempts[manager] ?? []) {
    if ((await runInherit(io, command, args)) === 0) return true;
  }
  return false;
}

async function installBunViaPackageManager(io: CLIIO, manager: string): Promise<boolean> {
  const attempts: Record<string, Array<[string, string[]]>> = {
    brew: [["brew", ["install", "oven-sh/bun/bun"]]],
    winget: [["winget", ["install", "--id", "Oven-sh.Bun", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"]]],
    scoop: [["scoop", ["install", "bun"]]],
  };
  for (const [command, args] of attempts[manager] ?? []) {
    if ((await runInherit(io, command, args)) === 0) return true;
  }
  return false;
}

/** Ensures the given package manager is actually installed, using the same
 *  cascade-then-download-fallback shape as ensureNodeVersion/ensureCloudflared. Called when a
 *  user picks a package manager the picker showed as "not installed". */
export async function ensurePackageManager(io: CLIIO, pm: PackageManager): Promise<{ ok: boolean; detail: string }> {
  if (await toolVersion(io, pm)) return { ok: true, detail: "already installed" };

  if (pm === "npm") {
    // npm ships bundled with Node.js — if it's missing despite Node being present, that's a
    // broken/incomplete Node install, not something to separately "install".
    return { ok: false, detail: "npm ships with Node.js — reinstall Node.js to restore it" };
  }

  const manager = await resolvePlatformPackageManager(io);
  if (pm === "pnpm") {
    if (manager && (await installPnpmViaPackageManager(io, manager))) return { ok: true, detail: `installed via ${manager}` };
    const corepackEnable = await runInherit(io, "corepack", ["enable"]);
    if (corepackEnable === 0 && (await runInherit(io, "corepack", ["prepare", "pnpm@latest", "--activate"])) === 0) {
      return { ok: true, detail: "installed via corepack" };
    }
    return { ok: false, detail: "could not install pnpm automatically. Install it from https://pnpm.io/installation" };
  }

  // pm === "bun"
  if (manager && (await installBunViaPackageManager(io, manager))) return { ok: true, detail: `installed via ${manager}` };
  const home = io.homedir();
  const binDir = join(home, ".bun", "bin");
  const script = io.platform === "win32"
    ? await runCapture(io, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "irm bun.sh/install.ps1 | iex"])
    : await runCapture(io, "/bin/sh", ["-c", "curl -fsSL https://bun.sh/install | bash"]);
  if (script.code === 0) {
    const persisted = await persistPathEntry(io, binDir);
    return { ok: true, detail: `installed via the official bun.sh script; ${persisted.detail}` };
  }
  return { ok: false, detail: "could not install bun automatically. Install it from https://bun.sh" };
}

/**
 * Arrow-key picker (reuses the same @clack/prompts.select pattern already used for the login
 * flow), showing npm/pnpm/bun with their install status, when none of them was auto-detected from
 * how this process was invoked and a human is at a TTY. Picking one that isn't installed installs
 * it first (see ensurePackageManager) before using it. Falls back to npm non-interactively.
 */
export async function pickPackageManager(io: CLIIO, explicit?: string): Promise<PackageManager> {
  if (explicit === "npm" || explicit === "pnpm" || explicit === "bun") return explicit;
  const envChoice = io.env.OPENBUCKET_PACKAGE_MANAGER;
  if (envChoice === "npm" || envChoice === "pnpm" || envChoice === "bun") return envChoice;
  const invoking = detectInvokingPackageManager(io);
  if (invoking) return invoking;

  const versions = await Promise.all(PACKAGE_MANAGERS.map((pm) => toolVersion(io, pm)));
  const installed = PACKAGE_MANAGERS.filter((_, index) => versions[index]);
  if (!io.stdout.isTTY) return installed[0] ?? "npm";

  const choice = await prompts.select({
    message: "Which package manager should install openbucket?",
    options: PACKAGE_MANAGERS.map((pm, index) => ({
      value: pm,
      label: pm,
      hint: versions[index] ? `installed · ${versions[index]}` : "not installed — will download from the web",
    })),
  });
  if (prompts.isCancel(choice)) return installed[0] ?? "npm";
  const picked = choice as PackageManager;
  if (!versions[PACKAGE_MANAGERS.indexOf(picked)]) {
    const result = await ensurePackageManager(io, picked);
    if (!result.ok) throw new Error(`Could not install ${picked}: ${result.detail}`);
  }
  return picked;
}

export async function installOpenBucketGlobally(io: CLIIO, manager: PackageManager, spec: string): Promise<number | null> {
  if (manager === "pnpm") {
    const target = shimSafeSpawnTarget(io, "pnpm", ["add", "--global", spec]);
    return runInheritSpawn(io, target.command, target.args);
  }
  if (manager === "bun") {
    const target = shimSafeSpawnTarget(io, "bun", ["add", "--global", spec]);
    return runInheritSpawn(io, target.command, target.args);
  }
  const target = shimSafeSpawnTarget(io, "npm", ["install", "--global", "--no-audit", "--no-fund", spec]);
  return runInheritSpawn(io, target.command, target.args);
}

function runInheritSpawn(io: CLIIO, command: string, args: readonly string[]): Promise<number | null> {
  return new Promise((resolveInstall) => {
    const child = io.spawn(command, args, { stdio: "inherit", shell: false, windowsHide: true });
    child.once("error", () => resolveInstall(null));
    child.once("close", (code) => resolveInstall(code));
  });
}
