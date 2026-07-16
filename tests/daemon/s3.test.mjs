import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AWS_V4_ALGORITHM,
  canonicalizePath,
  canonicalizeQuery,
  formatAmzDate,
  sha256Hex,
  signV4String,
} from "../../dist/daemon/auth.js";
import { startDaemon } from "../../dist/daemon/index.js";

async function signedFetch(
  input,
  method,
  credential,
  body = "",
  extraHeaders = {},
  payloadToSign = body,
) {
  const url = new URL(input);
  const date = new Date();
  const amzDate = formatAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payloadToSign);
  const headers = {
    ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value])),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const canonicalValues = { host: url.host, ...headers };
  const signedHeaderNames = Object.keys(canonicalValues).sort();
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${canonicalValues[name].trim()}\n`).join("");
  const canonicalRequest = [
    method,
    canonicalizePath(url.pathname),
    canonicalizeQuery(url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/us-east-1/s3/aws4_request`;
  const stringToSign = [AWS_V4_ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = signV4String(credential.secretAccessKey, dateStamp, "us-east-1", "s3", stringToSign);
  headers.authorization = `${AWS_V4_ALGORITHM} Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || (body.length === 0 && method === "DELETE") ? {} : { body }),
  });
}

function xmlTag(xml, tag) {
  const match = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  assert.ok(match, `missing ${tag} in ${xml}`);
  return match[1];
}

test("S3 API supports signed CRUD, copy, ranges, multipart, public reads, and key policy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "openbucket-s3-"));
  const daemon = await startDaemon({ storageRoot: root, managementPort: 0, s3Port: 0, adminToken: "s3-management-token-0123456789abcdef" });
  t.after(async () => {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  });
  const credential = daemon.initialCredentials;
  const s3 = daemon.config.s3Url;
  const management = daemon.config.managementUrl;

  const createBucket = await signedFetch(`${s3}/sdk-bucket`, "PUT", credential);
  assert.equal(createBucket.status, 200, await createBucket.clone().text());
  const bucketsXml = await (await signedFetch(`${s3}/`, "GET", credential)).text();
  assert.match(bucketsXml, /<Name>sdk-bucket<\/Name>/);
  const location = await signedFetch(`${s3}/sdk-bucket?location`, "GET", credential);
  assert.equal(location.status, 200);
  assert.match(await location.text(), /<LocationConstraint/);

  const put = await signedFetch(`${s3}/sdk-bucket/greeting.txt`, "PUT", credential, "hello world");
  assert.equal(put.status, 200, await put.clone().text());
  assert.match(put.headers.get("etag") ?? "", /^"[a-f0-9]{32}"$/);

  const mismatchedPayload = await signedFetch(
    `${s3}/sdk-bucket/mismatched.txt`,
    "PUT",
    credential,
    "bytes changed after signing",
    {},
    "original signed bytes",
  );
  assert.equal(mismatchedPayload.status, 400);
  assert.match(await mismatchedPayload.text(), /<Code>XAmzContentSHA256Mismatch<\/Code>/);
  assert.equal((await signedFetch(`${s3}/sdk-bucket/mismatched.txt`, "GET", credential)).status, 404);

  const range = await signedFetch(`${s3}/sdk-bucket/greeting.txt`, "GET", credential, "", { range: "bytes=6-10" });
  assert.equal(range.status, 206, await range.clone().text());
  assert.equal(range.headers.get("content-range"), "bytes 6-10/11");
  assert.equal(await range.text(), "world");
  const invalidRange = await signedFetch(`${s3}/sdk-bucket/greeting.txt`, "GET", credential, "", { range: "bytes=99-100" });
  assert.equal(invalidRange.status, 416);
  assert.match(await invalidRange.text(), /<Code>InvalidRange<\/Code>/);

  const copy = await signedFetch(
    `${s3}/sdk-bucket/copied.txt`,
    "PUT",
    credential,
    "",
    { "x-amz-copy-source": "/sdk-bucket/greeting.txt" },
  );
  assert.equal(copy.status, 200, await copy.clone().text());
  assert.equal(await (await signedFetch(`${s3}/sdk-bucket/copied.txt`, "GET", credential)).text(), "hello world");

  const list = await signedFetch(`${s3}/sdk-bucket?list-type=2&prefix=greet`, "GET", credential);
  const listXml = await list.text();
  assert.equal(list.status, 200);
  assert.match(listXml, /<Key>greeting\.txt<\/Key>/);
  assert.match(listXml, /<KeyCount>1<\/KeyCount>/);

  const initiate = await signedFetch(`${s3}/sdk-bucket/combined.bin?uploads`, "POST", credential);
  assert.equal(initiate.status, 200, await initiate.clone().text());
  const uploadId = xmlTag(await initiate.text(), "UploadId");
  const part1 = await signedFetch(`${s3}/sdk-bucket/combined.bin?partNumber=1&uploadId=${encodeURIComponent(uploadId)}`, "PUT", credential, "first-");
  const part2 = await signedFetch(`${s3}/sdk-bucket/combined.bin?partNumber=2&uploadId=${encodeURIComponent(uploadId)}`, "PUT", credential, "second");
  assert.equal(part1.status, 200, await part1.clone().text());
  assert.equal(part2.status, 200, await part2.clone().text());
  const completionBody = `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${part1.headers.get("etag")}</ETag></Part><Part><PartNumber>2</PartNumber><ETag>${part2.headers.get("etag")}</ETag></Part></CompleteMultipartUpload>`;
  const complete = await signedFetch(`${s3}/sdk-bucket/combined.bin?uploadId=${encodeURIComponent(uploadId)}`, "POST", credential, completionBody);
  assert.equal(complete.status, 200, await complete.clone().text());
  assert.equal(await (await signedFetch(`${s3}/sdk-bucket/combined.bin`, "GET", credential)).text(), "first-second");

  const awsCliObjectUrl = s3 + "/sdk-bucket/aws-cli-order.bin";
  const awsCliInitiate = await signedFetch(awsCliObjectUrl + "?uploads", "POST", credential);
  assert.equal(awsCliInitiate.status, 200, await awsCliInitiate.clone().text());
  const awsCliUploadId = xmlTag(await awsCliInitiate.text(), "UploadId");
  const awsCliUploadQuery = "uploadId=" + encodeURIComponent(awsCliUploadId);
  const awsCliPart1 = await signedFetch(awsCliObjectUrl + "?partNumber=1&" + awsCliUploadQuery, "PUT", credential, "aws-");
  const awsCliPart2 = await signedFetch(awsCliObjectUrl + "?partNumber=2&" + awsCliUploadQuery, "PUT", credential, "cli");
  assert.equal(awsCliPart1.status, 200, await awsCliPart1.clone().text());
  assert.equal(awsCliPart2.status, 200, await awsCliPart2.clone().text());
  const awsCliCompletionBody = "<CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Part><ETag>" + awsCliPart1.headers.get("etag") + "</ETag><PartNumber>1</PartNumber></Part><Part><ETag>" + awsCliPart2.headers.get("etag") + "</ETag><PartNumber>2</PartNumber></Part></CompleteMultipartUpload>";
  const awsCliComplete = await signedFetch(awsCliObjectUrl + "?" + awsCliUploadQuery, "POST", credential, awsCliCompletionBody);
  assert.equal(awsCliComplete.status, 200, await awsCliComplete.clone().text());
  assert.equal(await (await signedFetch(awsCliObjectUrl, "GET", credential)).text(), "aws-cli");

  const abortInitiate = await signedFetch(`${s3}/sdk-bucket/aborted.bin?uploads`, "POST", credential);
  const abortedUploadId = xmlTag(await abortInitiate.text(), "UploadId");
  const abort = await signedFetch(`${s3}/sdk-bucket/aborted.bin?uploadId=${encodeURIComponent(abortedUploadId)}`, "DELETE", credential);
  assert.equal(abort.status, 204);
  const uploadAfterAbort = await signedFetch(`${s3}/sdk-bucket/aborted.bin?partNumber=1&uploadId=${encodeURIComponent(abortedUploadId)}`, "PUT", credential, "part");
  assert.equal(uploadAfterAbort.status, 404);
  assert.match(await uploadAfterAbort.text(), /<Code>NoSuchUpload<\/Code>/);

  const publicUpdate = await fetch(`${management}/v1/buckets/sdk-bucket`, {
    method: "PATCH",
    headers: { authorization: "Bearer s3-management-token-0123456789abcdef", "content-type": "application/json" },
    body: JSON.stringify({ public: true }),
  });
  assert.equal(publicUpdate.status, 200);
  assert.equal(await (await fetch(`${s3}/sdk-bucket/greeting.txt`)).text(), "hello world");
  assert.equal((await fetch(`${s3}/sdk-bucket`)).status, 403, "public buckets expose objects, not listings");

  assert.equal((await fetch(`${management}/v1/buckets`, {
    method: "POST",
    headers: { authorization: "Bearer s3-management-token-0123456789abcdef", "content-type": "application/json" },
    body: JSON.stringify({ name: "other-bucket" }),
  })).status, 201);
  const keyResponse = await fetch(`${management}/v1/keys`, {
    method: "POST",
    headers: { authorization: "Bearer s3-management-token-0123456789abcdef", "content-type": "application/json" },
    body: JSON.stringify({ name: "read only", readOnly: true, bucket: "sdk-bucket" }),
  });
  const scopedCredential = (await keyResponse.json()).key;
  const deniedWrite = await signedFetch(`${s3}/sdk-bucket/denied.txt`, "PUT", scopedCredential, "nope");
  assert.equal(deniedWrite.status, 403);
  assert.match(await deniedWrite.text(), /<Code>AccessDenied<\/Code>/);
  assert.equal((await signedFetch(`${s3}/other-bucket/anything`, "GET", scopedCredential)).status, 403);

  for (const key of ["greeting.txt", "copied.txt", "combined.bin", "aws-cli-order.bin"]) {
    assert.equal((await signedFetch(`${s3}/sdk-bucket/${key}`, "DELETE", credential)).status, 204);
  }
  assert.equal((await signedFetch(`${s3}/sdk-bucket`, "DELETE", credential)).status, 204);
});
