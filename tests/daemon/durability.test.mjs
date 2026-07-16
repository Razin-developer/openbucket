import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DiskStore } from "../../dist/daemon/store.js";

test("failed state persistence rolls back bucket visibility and credential mutations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-durability-"));
  const { store } = await DiskStore.open(root, "durability-node");
  t.after(async () => {
    await store.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  await store.createBucket("private-data", false);
  const removable = await store.createCredential("removable");
  const credentialCount = store.listCredentials().length;

  await rm(store.statePath, { force: true });
  await mkdir(store.statePath);

  await assert.rejects(store.setBucketPublic("private-data", true));
  assert.equal((await store.requireBucket("private-data")).public, false);

  await assert.rejects(store.deleteBucket("private-data", true));
  assert.equal((await store.requireBucket("private-data")).name, "private-data");

  await assert.rejects(store.createCredential("never-committed"));
  assert.equal(store.listCredentials().length, credentialCount);

  await assert.rejects(store.deleteCredential(removable.id));
  assert.equal(store.listCredentials().some((credential) => credential.id === removable.id), true);
});

test("a lock from a previous process instance with the same PID is reclaimed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-restart-lock-"));
  const internal = join(root, ".openbucket");
  await mkdir(internal, { recursive: true });
  await writeFile(join(internal, "daemon.lock"), `${JSON.stringify({
    pid: process.pid,
    hostname: hostname(),
    processInstanceId: "previous-container-instance",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    nonce: "stale-lock",
  })}\n`);

  const { store } = await DiskStore.open(root, "restart-node");
  t.after(async () => {
    await store.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(store.nodeName, "restart-node");
});
