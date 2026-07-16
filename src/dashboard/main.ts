#!/usr/bin/env node

import { startDashboardServer } from "./server.js";

const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}

const dashboard = await startDashboardServer({
  url: `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`,
  maxPortAttempts: 1,
  allowNonLoopback: true,
});

process.stdout.write(`OpenBucket dashboard listening at ${dashboard.url}\n`);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void dashboard.stop().then(() => process.exit(0), (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
