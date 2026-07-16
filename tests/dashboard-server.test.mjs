import assert from "node:assert/strict";
import test from "node:test";

import { startDashboardServer } from "../dist/dashboard/server.js";

function assertDashboardSecurityHeaders(response) {
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /(?:^|; )default-src 'self'(?:;|$)/);
  assert.match(csp, /(?:^|; )connect-src 'self' http: https:(?:;|$)/);
  assert.match(csp, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(csp, /(?:^|; )object-src 'none'(?:;|$)/);
  assert.match(csp, /(?:^|; )script-src 'self' 'unsafe-inline'(?:;|$)/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
}

test("the packaged CLI dashboard server renders the app and static assets", async () => {
  const dashboard = await startDashboardServer({ url: "http://127.0.0.1:0" });
  try {
    const response = await fetch(`${dashboard.url}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/i);
    assertDashboardSecurityHeaders(response);
    const html = await response.text();
    assert.match(html, /OpenBucket/);
    assert.match(html, /Connect your first disk/);
    assert.match(html, new RegExp(`${dashboard.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/og\\.png`));
    assert.doesNotMatch(html, /https:\/\/127\.0\.0\.1:\d+\/og\.png/);
    const assetPath = html.match(/href="(\/assets\/[^\"]+\.css)"/)?.[1];
    assert.ok(assetPath, "rendered HTML should reference the production stylesheet");
    const asset = await fetch(`${dashboard.url}${assetPath}`);
    assert.equal(asset.status, 200, `stylesheet ${assetPath} should be served`);
    assert.match(asset.headers.get("content-type") ?? "", /^text\/css/i);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
    assertDashboardSecurityHeaders(asset);
    const social = await fetch(`${dashboard.url}/og.png`);
    assert.equal(social.status, 200);
    assert.equal(social.headers.get("content-type"), "image/png");
  } finally {
    await dashboard.stop();
  }
});
