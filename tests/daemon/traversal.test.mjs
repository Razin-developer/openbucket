import assert from "node:assert/strict";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DiskStore,
  StoreError,
  startDaemon,
  validateBucketName,
  validateObjectKey,
} from "../../dist/daemon/index.js";

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

test("bucket and object validation rejects traversal and reserved metadata paths", () => {
  for (const name of ["ab", "Uppercase", "-leading", "trailing-", "a..b", "192.168.1.1", ".openbucket"]) {
    assert.throws(() => validateBucketName(name), StoreError, name);
  }
  assert.equal(validateBucketName("valid-bucket.123"), "valid-bucket.123");

  for (const key of ["", "../escape", "folder/../escape", "./escape", "folder//file", ".openbucket/state.json", "folder\\..\\escape", "nul\0byte"]) {
    assert.throws(() => validateObjectKey(key), StoreError, key);
  }
  assert.equal(validateObjectKey("nested/path/object.bin"), "nested/path/object.bin");
});

test("disk and HTTP operations cannot escape the selected root, including through symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-traversal-"));
  const outside = await mkdtemp(join(tmpdir(), "openbucket-outside-"));
  const daemon = await startDaemon({ storageRoot: root, managementPort: 0, s3Port: 0, adminToken: "traversal-management-token-0123456789abcdef" });
  t.after(async () => {
    await daemon.stop();
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  });

  const base = daemon.config.managementUrl;
  assert.equal((await fetch(`${base}/v1/buckets`, {
    method: "POST",
    headers: { authorization: "Bearer traversal-management-token-0123456789abcdef", "content-type": "application/json" },
    body: JSON.stringify({ name: "safe-bucket" }),
  })).status, 201);

  const attacks = [
    "..%2F..%2Fescaped.txt",
    "%2E%2E%2Fescaped.txt",
    "%5C..%5Cescaped.txt",
    ".openbucket/state.json",
  ];
  for (const attack of attacks) {
    const response = await fetch(`${base}/v1/buckets/safe-bucket/objects/${attack}`, { method: "PUT", headers: { authorization: "Bearer traversal-management-token-0123456789abcdef" }, body: "attack" });
    assert.ok(response.status >= 400, `${attack} returned ${response.status}`);
  }
  const rawTraversalStatus = await new Promise((resolve, reject) => {
    const target = new URL(base);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      method: "PUT",
      path: "/v1/buckets/safe-bucket/objects/nested/%2e%2e/escaped.txt",
      headers: { authorization: "Bearer traversal-management-token-0123456789abcdef" },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end("attack");
  });
  assert.equal(rawTraversalStatus, 400);
  assert.equal(await exists(join(root, "escaped.txt")), false);
  assert.equal(await exists(join(outside, "escaped.txt")), false);

  try {
    await symlink(outside, join(root, "safe-bucket", "link"), "dir");
    const response = await fetch(`${base}/v1/buckets/safe-bucket/objects/link/escaped.txt`, { method: "PUT", headers: { authorization: "Bearer traversal-management-token-0123456789abcdef" }, body: "attack" });
    assert.equal(response.status, 403);
    assert.equal(await exists(join(outside, "escaped.txt")), false);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    t.diagnostic("symlink creation is unavailable to this Windows user; lexical traversal checks still ran");
  }

});

test("a pre-existing .openbucket symlink is rejected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-metadata-link-"));
  const outside = await mkdtemp(join(tmpdir(), "openbucket-metadata-outside-"));
  t.after(async () => {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  });
  try {
    await symlink(outside, join(root, ".openbucket"), "dir");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("symlink creation is unavailable to this Windows user");
      return;
    }
    throw error;
  }
  await assert.rejects(DiskStore.open(root), (error) => error instanceof StoreError && error.code === "UnsafeStorageRoot");
});
