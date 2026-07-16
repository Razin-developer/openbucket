import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const [fileArgument, bucketArgument, keyArgument] = process.argv.slice(2);
if (!fileArgument || !bucketArgument) {
  console.error("Usage: node upload.mjs <file> <bucket> [key]");
  process.exit(2);
}

const file = resolve(fileArgument);
const bucket = bucketArgument;
const key = keyArgument || basename(file);
const endpoint = process.env.OPENBUCKET_S3_ENDPOINT?.replace(/\/$/, "") ||
  "http://127.0.0.1:8333";
const region = process.env.OPENBUCKET_REGION?.trim() || "auto";
const source = await readFile(file);

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: requiredEnvironment("OPENBUCKET_ACCESS_KEY"),
    secretAccessKey: requiredEnvironment("OPENBUCKET_SECRET_KEY"),
  },
});

const put = await s3.send(new PutObjectCommand({
  Bucket: bucket,
  Key: key,
  Body: source,
  ContentLength: source.length,
}));
const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
const get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
if (!get.Body) throw new Error("OpenBucket returned an empty GetObject body.");
const downloaded = Buffer.from(await get.Body.transformToByteArray());

if (!downloaded.equals(source)) {
  throw new Error(`Byte verification failed for s3://${bucket}/${key}.`);
}
if (Number(head.ContentLength) !== source.length) {
  throw new Error(`HeadObject reported ${head.ContentLength} bytes; expected ${source.length}.`);
}

console.log(JSON.stringify({
  ok: true,
  endpoint,
  bucket,
  key,
  bytes: source.length,
  etag: head.ETag ?? put.ETag ?? null,
  verified: true,
}, null, 2));
