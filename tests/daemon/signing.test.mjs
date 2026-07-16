import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import {
  AWS_V4_ALGORITHM,
  canonicalizePath,
  canonicalizeQuery,
  createShareToken,
  verifyS3Authentication,
  verifyShareToken,
} from "../../dist/daemon/auth.js";

const credential = {
  id: "credential-1",
  accessKeyId: "OPENBUCKETEXAMPLE",
  secretAccessKey: "openbucket-test-secret-with-enough-entropy",
  createdAt: "2026-07-15T00:00:00.000Z",
  name: "integration test",
};

function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(pathname) {
  return pathname
    .split("/")
    .map((segment) => rfc3986(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(url) {
  return [...url.searchParams]
    .filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [rfc3986(name), rfc3986(value)])
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue === rightValue
          ? 0
          : leftValue < rightValue
            ? -1
            : 1
        : leftName < rightName
          ? -1
          : 1,
    )
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret, date, region) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function signature(secret, shortDate, region, stringToSign) {
  return createHmac("sha256", signingKey(secret, shortDate, region))
    .update(stringToSign)
    .digest("hex");
}

function canonicalHeaderBlock(headers, signedHeaderNames) {
  return signedHeaderNames
    .map((name) => `${name}:${headers[name].trim().replace(/[\t\n\r ]+/g, " ")}\n`)
    .join("");
}

function authorizationFor(
  method,
  url,
  headers,
  payloadHash,
  amzDate,
  region = "us-east-1",
) {
  const signedHeaderNames = Object.keys(headers).sort();
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalPath(url.pathname),
    canonicalQuery(url),
    canonicalHeaderBlock(headers, signedHeaderNames),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [AWS_V4_ALGORITHM, amzDate, scope, digest(canonicalRequest)].join("\n");
  const signed = signature(credential.secretAccessKey, shortDate, region, stringToSign);
  return `${AWS_V4_ALGORITHM} Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signed}`;
}

function presignedPath(
  origin,
  path,
  amzDate,
  expires,
  region = "us-east-1",
) {
  const url = new URL(path, origin);
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", AWS_V4_ALGORITHM);
  url.searchParams.set("X-Amz-Credential", `${credential.accessKeyId}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(expires));
  url.searchParams.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    "GET",
    canonicalPath(url.pathname),
    canonicalQuery(url),
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [AWS_V4_ALGORITHM, amzDate, scope, digest(canonicalRequest)].join("\n");
  url.searchParams.set(
    "X-Amz-Signature",
    signature(credential.secretAccessKey, shortDate, region, stringToSign),
  );
  return `${url.pathname}${url.search}`;
}

async function startVerifier(now, allowAnonymous = false) {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const result = await verifyS3Authentication(
        req,
        requestUrl,
        [credential],
        allowAnonymous,
        now,
      );
      req.resume();
      res.writeHead(result.ok ? 200 : result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      req.resume();
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          code: "TestServerError",
          message: error instanceof Error ? error.message : String(error),
          status: 500,
        }),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function send(origin, path, method = "GET", headers = {}, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.once("error", reject);
      res.once("end", () => {
        try {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

test("canonical URI and query rules encode, sort, retain duplicates, and omit signature", () => {
  const url = new URL(
    "http://openbucket.local/a%20folder/%7Eobject?z=last&a=hello+world&a=%7E&X-Amz-Signature=ignored",
  );
  assert.equal(canonicalizePath(url.pathname), "/a%20folder/~object");
  assert.equal(canonicalizeQuery(url), "a=hello%20world&a=~&z=last");
});

test("accepts a correctly header-signed live HTTP request and rejects tampering", async (t) => {
  const now = new Date("2026-07-15T12:34:56.000Z");
  const amzDate = "20260715T123456Z";
  const running = await startVerifier(now);
  t.after(running.close);

  const path = "/photos/summer%20day.jpg?part=2&prefix=hello+world&part=1";
  const url = new URL(path, running.origin);
  const body = "hello from OpenBucket";
  const payloadHash = digest(body);
  const signedHeaders = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const authorization = authorizationFor(
    "PUT",
    url,
    signedHeaders,
    payloadHash,
    amzDate,
  );
  const accepted = await send(
    running.origin,
    path,
    "PUT",
    { ...signedHeaders, authorization },
    body,
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ok, true);
  if (accepted.body.ok) {
    assert.equal(accepted.body.credential?.id, credential.id);
  }

  const tampered = await send(
    running.origin,
    `${path}&part=3`,
    "PUT",
    { ...signedHeaders, authorization },
    body,
  );
  assert.equal(tampered.status, 403);
  assert.equal(tampered.body.ok, false);
  if (!tampered.body.ok) {
    assert.equal(tampered.body.code, "SignatureDoesNotMatch");
  }
});

test("enforces the 15-minute clock window for Authorization headers", async (t) => {
  const signingDate = "20260715T120000Z";
  const running = await startVerifier(new Date("2026-07-15T12:16:00.000Z"));
  t.after(running.close);
  const url = new URL("/bucket/object", running.origin);
  const payloadHash = digest("");
  const signedHeaders = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": signingDate,
  };
  const authorization = authorizationFor(
    "GET",
    url,
    signedHeaders,
    payloadHash,
    signingDate,
  );
  const response = await send(running.origin, url.pathname, "GET", {
    ...signedHeaders,
    authorization,
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  if (!response.body.ok) {
    assert.equal(response.body.code, "RequestTimeTooSkewed");
  }
});

test("accepts presigned URLs and enforces expiry and the seven-day maximum", async (t) => {
  const signingDate = "20260715T100000Z";
  const validServer = await startVerifier(new Date("2026-07-15T10:00:59.000Z"));
  t.after(validServer.close);
  const validPath = presignedPath(validServer.origin, "/public/report.txt?download=1", signingDate, 60);
  const accepted = await send(validServer.origin, validPath);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ok, true);

  const tooLong = new URL(validPath, validServer.origin);
  tooLong.searchParams.set("X-Amz-Expires", "604801");
  const rejectedMaximum = await send(validServer.origin, `${tooLong.pathname}${tooLong.search}`);
  assert.equal(rejectedMaximum.status, 400);
  assert.equal(rejectedMaximum.body.ok, false);
  if (!rejectedMaximum.body.ok) {
    assert.equal(rejectedMaximum.body.code, "AuthorizationQueryParametersError");
  }

  const expiredServer = await startVerifier(new Date("2026-07-15T10:01:01.000Z"));
  t.after(expiredServer.close);
  const expiredPath = presignedPath(
    expiredServer.origin,
    "/public/report.txt",
    signingDate,
    60,
  );
  const expired = await send(expiredServer.origin, expiredPath);
  assert.equal(expired.status, 403);
  assert.equal(expired.body.ok, false);
  if (!expired.body.ok) {
    assert.equal(expired.body.code, "AccessDenied");
  }
});

test("anonymous access is explicit", async (t) => {
  const deniedServer = await startVerifier(new Date());
  t.after(deniedServer.close);
  const denied = await send(deniedServer.origin, "/bucket/object");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.ok, false);

  const publicServer = await startVerifier(new Date(), true);
  t.after(publicServer.close);
  const accepted = await send(publicServer.origin, "/bucket/object");
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { ok: true });
});

test("share tokens bind bucket, key, and expiry and reject tampering", () => {
  const expires = Math.floor(Date.now() / 1_000) + 60;
  const token = createShareToken("share-secret", "photos", "2026/image.jpg", expires);
  assert.equal(
    verifyShareToken("share-secret", "photos", "2026/image.jpg", expires, token),
    true,
  );
  assert.equal(
    verifyShareToken("share-secret", "private", "2026/image.jpg", expires, token),
    false,
  );
  assert.equal(
    verifyShareToken(
      "share-secret",
      "photos",
      "2026/image.jpg",
      expires,
      `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
    ),
    false,
  );

  const expired = Math.floor(Date.now() / 1_000) - 1;
  const expiredToken = createShareToken("share-secret", "photos", "old.jpg", expired);
  assert.equal(
    verifyShareToken("share-secret", "photos", "old.jpg", expired, expiredToken),
    false,
  );
});
