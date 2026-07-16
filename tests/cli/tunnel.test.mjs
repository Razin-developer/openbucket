import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { startQuickTunnel } from "../../dist/cli/tunnel.js";

class FakeChild extends EventEmitter {
  constructor({ stubborn = false } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = null;
    this.exitCode = null;
    this.signalCode = null;
    this.pid = 4242;
    this.kills = [];
    this.stubborn = stubborn;
  }

  kill(signal = "SIGTERM") {
    this.kills.push(signal);
    if (this.exitCode !== null || this.signalCode !== null) return false;
    if (this.stubborn && signal !== "SIGKILL") return true;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit("exit", null, signal);
      this.emit("close", null, signal);
    });
    return true;
  }
}

test("starts cloudflared without a shell, parses its canonical URL, and stops once", async () => {
  const child = new FakeChild();
  let invocation;
  const starting = startQuickTunnel({
    origin: "http://127.0.0.1:8333/",
    executable: "C:\\tools\\cloudflared.exe",
    spawn(command, args, options) {
      invocation = { command, args, options };
      queueMicrotask(() => {
        child.stderr.write("INF Your quick Tunnel has been created! Visit it at\n");
        child.stderr.write("https://bright-river.trycloudflare.com\n");
      });
      return child;
    },
  });

  const tunnel = await starting;
  assert.equal(tunnel.url, "https://bright-river.trycloudflare.com");
  assert.equal(tunnel.origin, "http://127.0.0.1:8333");
  assert.deepEqual(invocation.args, [
    "tunnel",
    "--no-autoupdate",
    "--url",
    "http://127.0.0.1:8333",
  ]);
  assert.equal(invocation.command, "C:\\tools\\cloudflared.exe");
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ["ignore", "pipe", "pipe"]);

  const firstStop = tunnel.stop();
  const secondStop = tunnel.stop();
  assert.equal(firstStop, secondStop);
  await firstStop;
  await tunnel.closed;
  assert.deepEqual(child.kills, ["SIGTERM"]);
});
test("rejects lookalike hosts and redacts sensitive early-exit diagnostics", async () => {
  const child = new FakeChild();
  await assert.rejects(
    startQuickTunnel({
      origin: "http://localhost:7272",
      spawn() {
        queueMicrotask(() => {
          child.stderr.write(
            "token=do-not-print https://safe.trycloudflare.com.attacker.example/path?signature=secret\n",
          );
          child.exitCode = 1;
          child.emit("exit", 1, null);
          child.emit("close", 1, null);
        });
        return child;
      },
    }),
    (error) => {
      assert.match(error.message, /exited before publishing a URL \(code 1\)/);
      assert.doesNotMatch(error.message, /do-not-print|signature=secret/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});

test("reports a missing cloudflared executable with an actionable message", async () => {
  const child = new FakeChild();
  await assert.rejects(
    startQuickTunnel({
      origin: "http://127.0.0.1:8333",
      executable: "missing-cloudflared",
      spawn() {
        queueMicrotask(() => {
          const error = new Error("spawn ENOENT");
          error.code = "ENOENT";
          child.emit("error", error);
        });
        return child;
      },
    }),
    /cloudflared was not found.*OPENBUCKET_CLOUDFLARED_PATH/,
  );
});

test("times out startup and force-kills a child that ignores graceful stop", async () => {
  const child = new FakeChild({ stubborn: true });
  await assert.rejects(
    startQuickTunnel({
      origin: "http://127.0.0.1:8333",
      timeoutMs: 10,
      stopTimeoutMs: 10,
      spawn() {
        return child;
      },
    }),
    /did not publish a Quick Tunnel URL within 1s/,
  );
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"]);
});
