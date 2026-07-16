import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { startDaemon } from "../../dist/daemon/index.js";

test("shutdown aborts a stalled request within the grace deadline and releases the root lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-shutdown-"));
  const daemon = await startDaemon({
    storageRoot: root,
    managementPort: 0,
    s3Port: 0,
    adminToken: "shutdown-test-token-0123456789abcdef",
  });
  let stopped = false;
  t.after(async () => {
    if (!stopped) await daemon.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  const auth = { authorization: "Bearer shutdown-test-token-0123456789abcdef", "content-type": "application/json" };
  const create = await fetch(`${daemon.config.managementUrl}/v1/buckets`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "stalled-upload" }),
  });
  assert.equal(create.status, 201, await create.text());

  const stalled = request(`${daemon.config.managementUrl}/v1/buckets/stalled-upload/objects/large.bin`, {
    method: "PUT",
    headers: {
      authorization: "Bearer shutdown-test-token-0123456789abcdef",
      "content-length": "1000000",
    },
  });
  stalled.on("error", () => undefined);
  stalled.write(Buffer.alloc(1024));
  await delay(75);

  const startedAt = Date.now();
  await daemon.stop();
  stopped = true;
  stalled.destroy();
  assert.ok(Date.now() - startedAt < 3_500, "shutdown should force-close stalled HTTP connections");
  await assert.rejects(access(join(root, ".openbucket", "daemon.lock")), { code: "ENOENT" });
});
