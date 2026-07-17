#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function requireFile(relativePath) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    failures.push(`Missing release artifact: ${relativePath}`);
  }
}

const packageJson = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const daemonSource = await readFile(resolve(root, "src/daemon/index.ts"), "utf8");

if (packageJson.name !== "openbucket") failures.push("package.json name must be openbucket.");
if (packageJson.private !== false) failures.push("package.json private must be false.");
if (packageJson.publishConfig?.access !== "public") failures.push("npm publishConfig.access must be public.");
if (packageJson.repository?.url !== "https://github.com/Razin-developer/openbucket.git") {
  failures.push("package.json repository.url must match the trusted-publisher GitHub repository.");
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  failures.push(`Invalid release version: ${packageJson.version}`);
}
if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
  failures.push("package-lock.json version does not match package.json.");
}

const daemonVersion = /OPENBUCKET_VERSION\s*=\s*"([^"]+)"/.exec(daemonSource)?.[1];
if (daemonVersion !== packageJson.version) failures.push("Daemon version does not match package.json.");

try {
  const pythonProject = await readFile(resolve(root, "python/pyproject.toml"), "utf8");
  const pythonVersion = /^version\s*=\s*"([^"]+)"/m.exec(pythonProject)?.[1];
  if (pythonVersion !== packageJson.version) failures.push("Python package version does not match package.json.");
  const pythonInit = await readFile(resolve(root, "python/src/openbucket/__init__.py"), "utf8");
  const pythonRuntimeVersion = /^__version__\s*=\s*"([^"]+)"/m.exec(pythonInit)?.[1];
  if (pythonRuntimeVersion !== packageJson.version) failures.push("Python runtime version does not match package.json.");
  const pythonClient = await readFile(resolve(root, "python/src/openbucket/client.py"), "utf8");
  const pythonUserAgentVersion = /user_agent:\s*str\s*=\s*"openbucket-client\/([^"]+)"/.exec(pythonClient)?.[1];
  if (pythonUserAgentVersion !== packageJson.version) failures.push("Python client user-agent version does not match package.json.");
} catch {
  failures.push("Missing python/pyproject.toml.");
}

const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${packageJson.version}`) {
  failures.push(`Git tag ${tag} must equal v${packageJson.version}.`);
}

const requiredPackageFiles = [
  "dist/cli",
  "dist/client",
  "dist/daemon",
  "dist/dashboard",
  "dist/server",
  "docs",
  "examples",
  ".env.example",
  "README.md",
  "LICENSE",
];
for (const required of requiredPackageFiles) {
  if (!packageJson.files?.includes(required)) failures.push(`npm files list is missing ${required}.`);
}

const vercelConfig = await readJson("vercel.json");
if (vercelConfig.outputDirectory !== "vercel-dist") failures.push("Vercel outputDirectory must be vercel-dist.");
if (vercelConfig.buildCommand !== "npm run build:vercel") failures.push("Vercel buildCommand must use build:vercel.");
const spaFallback = vercelConfig.rewrites?.find((rewrite) => rewrite.destination === "/index.html");
if (spaFallback?.source !== "/((?!api(?:/|$)).*)") {
  failures.push("Vercel SPA fallback must exclude /api routes.");
}

await Promise.all([
  requireFile(".env.example"),
  requireFile("LICENSE"),
  requireFile("README.md"),
  requireFile("dist/cli/main.js"),
  requireFile("dist/server/index.js"),
  requireFile("vercel-dist/index.html"),
  requireFile(".openai/hosting.json"),
]);

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release metadata and artifacts verified for OpenBucket ${packageJson.version}.`);
}
