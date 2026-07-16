#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { startDaemon } from "../dist/daemon/index.js";

const command = process.env.AWS_CLI ?? (process.platform === "win32" ? "aws.cmd" : "aws");
const timeoutMs = 120_000;

async function runAws(args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error("Unable to start AWS CLI command " + command + ": " + error.message));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        "AWS CLI failed (" + args.join(" ") + ") with exit code " + String(code) + ":\n" +
        (stderr || stdout).trim(),
      ));
    });
  });
}

async function fileRows(root, current = root, rows = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      await fileRows(root, path, rows);
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await readFile(path);
    rows.push({
      path: relative(root, path).split(sep).join("/"),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "openbucket-aws-cli-"));
const storageRoot = join(temporaryRoot, "storage");
const sourceRoot = join(temporaryRoot, "source");
const downloadRoot = join(temporaryRoot, "download");
const secondDownloadRoot = join(temporaryRoot, "download-after-delete");
let daemon;

try {
  await mkdir(join(sourceRoot, "nested"), { recursive: true });
  await writeFile(join(sourceRoot, "small.txt"), "OpenBucket AWS CLI acceptance\n");
  await writeFile(join(sourceRoot, "nested", "space name.txt"), "path-style object\n");
  await writeFile(join(sourceRoot, "large.bin"), Buffer.alloc(9 * 1024 * 1024 + 123, 0x5a));

  daemon = await startDaemon({
    storageRoot,
    managementPort: 0,
    s3Port: 0,
    adminToken: "aws-cli-sync-ci-management-token",
  });
  assert.ok(daemon.initialCredentials, "A new daemon must return bootstrap S3 credentials.");

  const awsConfig = join(temporaryRoot, "aws-config");
  await writeFile(awsConfig, "[default]\nregion = us-east-1\ns3 =\n    addressing_style = path\n");
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: daemon.initialCredentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: daemon.initialCredentials.secretAccessKey,
    AWS_DEFAULT_REGION: "us-east-1",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CONFIG_FILE: awsConfig,
    AWS_SHARED_CREDENTIALS_FILE: join(temporaryRoot, "unused-credentials"),
  };
  const endpoint = ["--endpoint-url", daemon.config.s3Url];
  const bucket = "aws-cli-e2e-" + process.pid + "-" + Date.now().toString(36);
  const bucketUrl = "s3://" + bucket;
  const prefixUrl = bucketUrl + "/fixture/";
  const versionResult = await runAws(["--version"], env);
  const version = (versionResult.stdout || versionResult.stderr).trim();

  await runAws([...endpoint, "s3", "mb", bucketUrl], env);
  await runAws([...endpoint, "s3", "sync", sourceRoot, prefixUrl, "--no-progress", "--only-show-errors"], env);
  await mkdir(downloadRoot, { recursive: true });
  await runAws([...endpoint, "s3", "sync", prefixUrl, downloadRoot, "--no-progress", "--only-show-errors"], env);
  const initialRows = await fileRows(sourceRoot);
  assert.deepEqual(await fileRows(downloadRoot), initialRows, "Initial AWS CLI sync download must preserve every byte.");

  await rm(join(sourceRoot, "nested", "space name.txt"));
  await writeFile(join(sourceRoot, "changed.txt"), "sync --delete replacement\n");
  await runAws([...endpoint, "s3", "sync", sourceRoot, prefixUrl, "--delete", "--no-progress", "--only-show-errors"], env);
  await mkdir(secondDownloadRoot, { recursive: true });
  await runAws([...endpoint, "s3", "sync", prefixUrl, secondDownloadRoot, "--no-progress", "--only-show-errors"], env);
  const finalRows = await fileRows(sourceRoot);
  assert.deepEqual(await fileRows(secondDownloadRoot), finalRows, "AWS CLI sync --delete result must round-trip.");

  const requestLines = (await readFile(join(storageRoot, ".openbucket", "requests.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const multipartPath = "/" + bucket + "/fixture/large.bin?";
  const uploadedParts = requestLines.filter((entry) =>
    entry.method === "PUT" && entry.status === 200 && entry.path.startsWith(multipartPath) && entry.path.includes("partNumber=")
  );
  const completedUploads = requestLines.filter((entry) =>
    entry.method === "POST" && entry.status === 200 && entry.path.startsWith(multipartPath) && entry.path.includes("uploadId=")
  );
  assert.ok(uploadedParts.length >= 2, "The >8 MiB fixture must exercise AWS CLI multipart upload.");
  assert.ok(completedUploads.length >= 1, "AWS CLI multipart completion must succeed.");

  await runAws([...endpoint, "s3", "rm", bucketUrl, "--recursive", "--only-show-errors"], env);
  await runAws([...endpoint, "s3", "rb", bucketUrl], env);

  const totalBytes = finalRows.reduce((sum, row) => sum + row.size, 0);
  console.log("AWS CLI sync acceptance passed: " + version + "; " + finalRows.length + " files; " + totalBytes + " bytes; " + uploadedParts.length + " multipart parts.");
} finally {
  if (daemon) await daemon.stop();
  await rm(temporaryRoot, { recursive: true, force: true });
}
