import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startDaemon } from "../../dist/daemon/index.js";

async function json(response) {
  return await response.json();
}

test("management API persists real buckets, objects, keys, shares, logs, and status", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-management-"));
  let daemon;
  t.after(async () => {
    await daemon?.stop();
    await rm(root, { recursive: true, force: true });
  });

  daemon = await startDaemon({
    storageRoot: root,
    nodeName: "integration-node",
    managementPort: 0,
    s3Port: 0,
    adminToken: "test-management-token-0123456789abcdef",
    allowedOrigins: ["https://dashboard.example"],
  });
  assert.ok(daemon.initialCredentials?.secretAccessKey);
  await assert.rejects(
    startDaemon({ storageRoot: root, managementPort: 0, s3Port: 0 }),
    (error) => error?.code === "StorageRootInUse",
  );
  const base = daemon.config.managementUrl;
  const auth = { authorization: "Bearer test-management-token-0123456789abcdef" };

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await json(health)).status, "healthy");
  assert.equal((await fetch(`${base}/v1/status`)).status, 401);

  const deniedPreflight = await fetch(`${base}/v1/buckets`, {
    method: "OPTIONS",
    headers: { origin: "https://untrusted.example" },
  });
  assert.equal(deniedPreflight.status, 403);
  const preflight = await fetch(`${base}/v1/buckets`, {
    method: "OPTIONS",
    headers: { origin: "https://dashboard.example" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://dashboard.example");
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /X-OpenBucket-Client/i);
  const unauthenticatedDashboard = await fetch(`${base}/v1/status`, {
    headers: { origin: "https://dashboard.example", "x-openbucket-client": "dashboard" },
  });
  assert.equal(unauthenticatedDashboard.status, 401);
  const authenticatedDashboard = await fetch(`${base}/v1/status`, {
    headers: { ...auth, origin: "https://dashboard.example", "x-openbucket-client": "dashboard" },
  });
  assert.equal(authenticatedDashboard.status, 200);
  assert.equal(authenticatedDashboard.headers.get("access-control-allow-origin"), "https://dashboard.example");
  const spoofedDashboard = await fetch(`${base}/v1/status`, {
    headers: { origin: "https://untrusted.example", "x-openbucket-client": "dashboard" },
  });
  assert.equal(spoofedDashboard.status, 401);
  const missingClientMarker = await fetch(`${base}/v1/status`, {
    headers: { origin: "https://dashboard.example" },
  });
  assert.equal(missingClientMarker.status, 401);

  const create = await fetch(`${base}/v1/buckets`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name: "project-files", public: true }),
  });
  assert.equal(create.status, 201, await create.text());

  const contents = "real bytes written by the OpenBucket daemon";
  const put = await fetch(`${base}/v1/buckets/project-files/objects/folder/hello.txt`, {
    method: "PUT",
    headers: auth,
    body: contents,
  });
  assert.equal(put.status, 201, await put.text());
  assert.equal(await readFile(join(root, "project-files", "folder", "hello.txt"), "utf8"), contents);

  const listed = await json(await fetch(`${base}/v1/buckets/project-files/objects?prefix=folder/`, { headers: auth }));
  assert.equal(listed.objects.length, 1);
  assert.deepEqual(
    { key: listed.objects[0].key, size: listed.objects[0].size },
    { key: "folder/hello.txt", size: Buffer.byteLength(contents) },
  );
  const downloaded = await fetch(`${base}/v1/buckets/project-files/objects/folder/hello.txt`, { headers: auth });
  assert.equal(await downloaded.text(), contents);
  const head = await fetch(`${base}/v1/buckets/project-files/objects/folder/hello.txt`, { method: "HEAD", headers: auth });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), Buffer.byteLength(contents));

  const shareResponse = await fetch(`${base}/v1/buckets/project-files/share`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ key: "folder/hello.txt", expiresIn: 60 }),
  });
  assert.equal(shareResponse.status, 201, await shareResponse.clone().text());
  const share = await json(shareResponse);
  const sharedDownload = await fetch(share.url);
  assert.equal(sharedDownload.status, 200);
  assert.equal(await sharedDownload.text(), contents);
  const tamperedShare = new URL(share.url);
  tamperedShare.searchParams.set("token", "A".repeat(43));
  assert.equal((await fetch(tamperedShare)).status, 403);

  const createKey = await fetch(`${base}/v1/keys`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name: "project reader", readOnly: true, bucket: "project-files" }),
  });
  const createdKey = (await json(createKey)).key;
  assert.equal(createKey.status, 201);
  assert.equal(createdKey.readOnly, true);
  assert.equal(createdKey.bucket, "project-files");
  assert.ok(createdKey.secretAccessKey);
  const keys = (await json(await fetch(`${base}/v1/keys`, { headers: auth }))).keys;
  assert.equal(keys.length, 2);
  assert.equal(keys.find((key) => key.id === createdKey.id)?.secretAccessKey, undefined);
  assert.equal((await fetch(`${base}/v1/keys/${encodeURIComponent(createdKey.id)}`, { method: "DELETE", headers: auth })).status, 200);
  const lastKeyDelete = await fetch(`${base}/v1/keys/${encodeURIComponent(daemon.initialCredentials.id)}`, { method: "DELETE", headers: auth });
  assert.equal(lastKeyDelete.status, 409, "the final S3 credential remains recoverable");

  const status = await json(await fetch(`${base}/v1/status`, { headers: auth }));
  assert.equal(status.online, true);
  assert.equal(status.nodeName, "integration-node");
  assert.equal(status.bucketCount, 1);
  assert.equal(status.objectCount, 1);
  assert.equal(status.usedBytes, Buffer.byteLength(contents));
  assert.equal(status.storage.managedBytes, Buffer.byteLength(contents));
  assert.equal(status.storage.filesystemUsedBytes, status.filesystemUsedBytes);
  assert.ok(status.filesystemUsedBytes >= status.usedBytes);
  assert.ok(status.capacityBytes > 0);
  assert.ok(status.availableBytes > 0);

  const analytics = await json(await fetch(`${base}/v1/analytics`, { headers: auth }));
  assert.ok(analytics.requests > 0);
  assert.equal(analytics.storage.objectCount, 1);
  const logs = await json(await fetch(`${base}/v1/logs?limit=50`, { headers: auth }));
  assert.ok(logs.logs.some((entry) => entry.path.includes("hello.txt")));
  assert.ok(logs.logs.every((entry) => typeof entry.durationMs === "number"));

  const protectedDelete = await fetch(`${base}/v1/buckets/project-files`, { method: "DELETE", headers: auth });
  assert.equal(protectedDelete.status, 409);
  assert.equal((await json(protectedDelete)).error.code, "BucketNotEmpty");
  assert.equal((await fetch(`${base}/v1/buckets/project-files?force=true`, { method: "DELETE", headers: auth })).status, 200);

  const state = JSON.parse(await readFile(join(root, ".openbucket", "state.json"), "utf8"));
  assert.equal(state.version, 1);
  assert.equal(state.nodeName, "integration-node");
  assert.equal(Object.keys(state.buckets).length, 0);
  assert.equal(state.credentials.length, 1);

  await daemon.stop();
  daemon = await startDaemon({ storageRoot: root, managementPort: 0, s3Port: 0 });
  assert.equal(daemon.initialCredentials, undefined, "credentials are generated only on first run");
  assert.equal(daemon.config.nodeId, state.nodeId);
});

test("rejects short admin tokens before opening storage", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "openbucket-short-admin-token-"));
  const root = join(parent, "storage");
  t.after(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  await assert.rejects(
    startDaemon({ storageRoot: root, managementPort: 0, s3Port: 0, adminToken: `  ${"x".repeat(31)}  ` }),
    (error) => error?.code === "InvalidConfiguration"
      && error.message === "adminToken must contain at least 32 UTF-8 bytes.",
  );
  await assert.rejects(access(root), { code: "ENOENT" });
});

test("wildcard bind hosts advertise connectable loopback endpoints", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-wildcard-host-"));
  const daemon = await startDaemon({
    storageRoot: root,
    managementHost: "0.0.0.0",
    s3Host: "0.0.0.0",
    managementPort: 0,
    s3Port: 0,
    adminToken: "wildcard-test-token-0123456789abcdef",
  });
  t.after(async () => {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  });
  assert.match(daemon.config.managementUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.match(daemon.config.s3Url, /^http:\/\/127\.0\.0\.1:/);
  const status = await fetch(`${daemon.config.managementUrl}/v1/status`, {
    headers: { authorization: "Bearer wildcard-test-token-0123456789abcdef" },
  });
  const payload = await json(status);
  assert.match(payload.endpoints.management, /^http:\/\/127\.0\.0\.1:/);
  assert.match(payload.endpoints.s3, /^http:\/\/127\.0\.0\.1:/);
});
