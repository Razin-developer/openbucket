import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createShareToken,
  EMPTY_SHA256,
  sha256Hex,
  verifyS3Authentication,
  verifyShareToken,
  type CredentialRecord as AuthCredentialRecord,
} from "./auth.js";
import {
  DiskStore,
  StoreError,
  type CredentialRecord,
  type ObjectRecord,
  type RequestLog,
} from "./store.js";

export const OPENBUCKET_VERSION = "0.1.4";

export interface DaemonOptions {
  storageRoot: string;
  nodeName?: string;
  managementHost?: string;
  managementPort?: number;
  s3Host?: string;
  s3Port?: number;
  publicBaseUrl?: string;
  allowedOrigins?: string[];
  adminToken?: string;
  /** Per-node verifier for short-lived hosted-console capabilities. */
  managementCapabilitySecret?: string;
  /** Hosted control-plane node identity; distinct from the local disk node ID. */
  managementCapabilityNodeId?: string;
  dashboardUrl?: string;
  beforeStop?: () => void | Promise<void>;
}

export interface DaemonConfig {
  storageRoot: string;
  nodeName: string;
  nodeId: string;
  managementHost: string;
  managementPort: number;
  managementUrl: string;
  s3Host: string;
  s3Port: number;
  s3Url: string;
  filesUrl: string;
  publicBaseUrl?: string;
  allowedOrigins: string[];
  adminToken?: string;
  managementCapabilitySecret?: string;
  managementCapabilityNodeId?: string;
  dashboardUrl?: string;
}

export interface InitialCredentials {
  id: string;
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  createdAt: string;
  readOnly: boolean;
  bucket?: string;
}

export interface DaemonHandle {
  readonly config: DaemonConfig;
  readonly initialCredentials?: InitialCredentials;
  stop(): Promise<void>;
  readonly stopped: Promise<void>;
}

interface RequestContext {
  requestId: string;
  startedAt: number;
  bytesIn: number;
  bytesOut: number;
  service: RequestLog["service"];
  accessKeyId?: string;
}

interface ApiErrorShape {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

function cleanBaseUrl(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\/+$/, "");
  return cleaned || undefined;
}

function validatePort(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new StoreError("InvalidConfiguration", `${name} must be an integer from 0 to 65535.`);
  }
  return value;
}

function hostUrl(host: string, port: number): string {
  const advertisedHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const formatted = advertisedHost.includes(":") && !advertisedHost.startsWith("[") ? `[${advertisedHost}]` : advertisedHost;
  return `http://${formatted}:${port}`;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validManagementCapability(header: string | undefined, secret: string | undefined, nodeId: string): boolean {
  if (!header?.startsWith("Bearer obm.") || !secret) return false;
  const token = header.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "obm") return false;
  const [prefix, payload, signature] = parts;
  if (!payload || !signature || prefix !== "obm") return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; nodeId?: unknown; exp?: unknown };
    return claims.v === 1 && claims.nodeId === nodeId && typeof claims.exp === "number" && Number.isSafeInteger(claims.exp) && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function xmlEscape(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function encodePath(value: string): string {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function decodePart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new StoreError("InvalidURI", `${label} contains invalid percent encoding.`);
  }
}

function rejectUnsafeRawPath(rawUrl: string | undefined): void {
  const rawPath = (rawUrl ?? "/").split("?", 1)[0] ?? "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new StoreError("InvalidURI", "The request path contains invalid percent encoding.");
  }
  const segments = decoded.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.toLowerCase() === ".openbucket")) {
    throw new StoreError("InvalidURI", "The request path contains a reserved or unsafe segment.");
  }
}

function errorShape(error: unknown): ApiErrorShape {
  if (error instanceof StoreError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof SyntaxError) {
    return { code: "InvalidJSON", message: "The request body is not valid JSON.", status: 400 };
  }
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === "ENOSPC") return { code: "InsufficientStorage", message: "The disk is full.", status: 507 };
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") return { code: "AccessDenied", message: "The storage path is not writable.", status: 403 };
  return { code: "InternalError", message: "The daemon encountered an internal error.", status: 500 };
}

function setResponseLength(res: ServerResponse, ctx: RequestContext, length: number): void {
  ctx.bytesOut = length;
  res.setHeader("content-length", String(length));
}

function sendJson(res: ServerResponse, ctx: RequestContext, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  setResponseLength(res, ctx, body.length);
  res.end(body);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader("content-length", "0");
  res.end();
}

function sendManagementError(res: ServerResponse, ctx: RequestContext, error: unknown): void {
  const normalized = errorShape(error);
  sendJson(res, ctx, normalized.status, {
    error: { code: normalized.code, message: normalized.message, ...(normalized.details === undefined ? {} : { details: normalized.details }) },
    requestId: ctx.requestId,
  });
}

function sendXml(res: ServerResponse, ctx: RequestContext, status: number, xml: string, headers?: Record<string, string>): void {
  const body = Buffer.from(xml);
  res.statusCode = status;
  res.setHeader("content-type", "application/xml; charset=utf-8");
  for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
  setResponseLength(res, ctx, body.length);
  res.end(body);
}

function sendS3Error(res: ServerResponse, ctx: RequestContext, error: unknown, resource: string): void {
  const normalized = errorShape(error);
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${xmlEscape(normalized.code)}</Code><Message>${xmlEscape(normalized.message)}</Message><Resource>${xmlEscape(resource)}</Resource><RequestId>${ctx.requestId}</RequestId></Error>`;
  sendXml(res, ctx, normalized.status, body);
}

async function readBody(req: IncomingMessage, ctx: RequestContext, maxBytes = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    ctx.bytesIn = size;
    if (size > maxBytes) throw new StoreError("EntityTooLarge", `Request body exceeds ${maxBytes} bytes.`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function meteredRequest(req: IncomingMessage, ctx: RequestContext): Readable {
  ctx.bytesIn = 0;
  return req.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      ctx.bytesIn += (chunk as Buffer).length;
      callback(null, chunk);
    },
  }));
}

function expectedS3PayloadHash(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers["x-amz-content-sha256"];
  if (typeof header === "string") return header.trim();
  const query = url.searchParams.get("X-Amz-Content-Sha256");
  if (query) return query;
  return req.headers.authorization ? EMPTY_SHA256 : undefined;
}

function verifyBufferedS3Payload(req: IncomingMessage, url: URL, body: Buffer): void {
  const expected = expectedS3PayloadHash(req, url);
  if (expected && expected !== "UNSIGNED-PAYLOAD" && sha256Hex(body) !== expected.toLowerCase()) {
    throw new StoreError("XAmzContentSHA256Mismatch", "The request body does not match x-amz-content-sha256.", 400);
  }
}

async function readJson(req: IncomingMessage, ctx: RequestContext): Promise<Record<string, unknown>> {
  const body = await readBody(req, ctx);
  if (!body.length) return {};
  const value = JSON.parse(body.toString("utf8")) as unknown;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new StoreError("InvalidJSON", "The JSON body must be an object.");
  }
  return value as Record<string, unknown>;
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const wildcard = allowedOrigins.includes("*");
  const allowed = wildcard || allowedOrigins.includes(origin);
  if (allowed) {
    res.setHeader("access-control-allow-origin", wildcard ? "*" : origin);
    if (!wildcard) res.setHeader("vary", "Origin");
    res.setHeader("access-control-expose-headers", "ETag, Content-Length, Content-Range, X-Request-Id, X-Amz-Request-Id");
  }
  return allowed;
}

function handlePreflight(req: IncomingMessage, res: ServerResponse, allowedOrigins: string[]): boolean {
  if (req.method !== "OPTIONS") return false;
  if (!applyCors(req, res, allowedOrigins)) {
    res.statusCode = 403;
    res.end();
    return true;
  }
  res.setHeader("access-control-allow-methods", "GET, HEAD, PUT, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type, Range, X-OpenBucket-Client, X-Amz-Date, X-Amz-Content-Sha256, X-Amz-Copy-Source, X-Amz-Security-Token");
  res.setHeader("access-control-max-age", "86400");
  sendEmpty(res, 204);
  return true;
}

function publicCredential(key: CredentialRecord): Omit<CredentialRecord, "secretAccessKey" | "bucket"> & { bucket: string | null } {
  const { secretAccessKey, bucket, ...visible } = key;
  void secretAccessKey;
  return { ...visible, bucket: bucket ?? null };
}

function parseRange(header: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return undefined;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return undefined;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function parseS3Path(pathname: string): { bucket?: string; key?: string } {
  if (pathname === "/" || pathname === "") return {};
  const parts = pathname.slice(1).split("/");
  const bucket = decodePart(parts.shift() ?? "", "Bucket name");
  const key = parts.length ? parts.map((part) => decodePart(part, "Object key")).join("/") : undefined;
  return { bucket, key };
}

function requestContext(req: IncomingMessage, service: RequestLog["service"]): RequestContext {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  return {
    requestId: randomUUID().replaceAll("-", ""),
    startedAt: performance.now(),
    bytesIn: Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : 0,
    bytesOut: 0,
    service,
  };
}

function logSafePath(rawUrl: string | undefined): string {
  try {
    const url = new URL(rawUrl ?? "/", "http://openbucket.local");
    for (const name of [...url.searchParams.keys()]) {
      if (name.toLowerCase() === "x-amz-signature" || name.toLowerCase() === "token") {
        url.searchParams.set(name, "[REDACTED]");
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/invalid-uri";
  }
}

async function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolvePromise((server.address() as AddressInfo).port);
    });
  });
}

async function closeServer(server: Server, graceMilliseconds = 2_000): Promise<void> {
  if (!server.listening) return;
  server.closeIdleConnections();
  await new Promise<void>((resolvePromise, reject) => {
    const forceTimer = setTimeout(() => server.closeAllConnections(), graceMilliseconds);
    forceTimer.unref?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  if (!options?.storageRoot) throw new StoreError("InvalidConfiguration", "storageRoot is required.");
  const managementHost = options.managementHost?.trim() || "127.0.0.1";
  const s3Host = options.s3Host?.trim() || "127.0.0.1";
  const managementPort = validatePort(options.managementPort ?? 7272, "managementPort");
  const s3Port = validatePort(options.s3Port ?? 8333, "s3Port");
  const configuredAdminToken = options.adminToken?.trim();
  if (configuredAdminToken !== undefined && Buffer.byteLength(configuredAdminToken, "utf8") < 32) {
    throw new StoreError("InvalidConfiguration", "adminToken must contain at least 32 UTF-8 bytes.");
  }
  const adminToken = configuredAdminToken ?? randomBytes(32).toString("base64url");
  const opened = await DiskStore.open(options.storageRoot, options.nodeName);
  const store = opened.store;
  const startedAt = Date.now();
  let stopping: Promise<void> | undefined;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolvePromise) => { resolveStopped = resolvePromise; });

  const config: DaemonConfig = {
    storageRoot: store.root,
    nodeName: store.nodeName,
    nodeId: store.nodeId,
    managementHost,
    managementPort,
    managementUrl: hostUrl(managementHost, managementPort),
    s3Host,
    s3Port,
    s3Url: hostUrl(s3Host, s3Port),
    filesUrl: `${hostUrl(s3Host, s3Port)}/files`,
    publicBaseUrl: cleanBaseUrl(options.publicBaseUrl),
    allowedOrigins: [...new Set(options.allowedOrigins ?? [])],
    adminToken,
    managementCapabilitySecret: options.managementCapabilitySecret,
    managementCapabilityNodeId: options.managementCapabilityNodeId,
    dashboardUrl: cleanBaseUrl(options.dashboardUrl),
  };

  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      await Promise.resolve(options.beforeStop?.()).catch(() => undefined);
      const results = await Promise.allSettled([closeServer(managementServer), closeServer(s3Server)]);
      await store.close();
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    })().finally(resolveStopped);
    return stopping;
  };

  const registerLog = (req: IncomingMessage, res: ServerResponse, ctx: RequestContext): void => {
    res.setHeader("x-request-id", ctx.requestId);
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const log: RequestLog = {
        timestamp: new Date().toISOString(),
        requestId: ctx.requestId,
        method: req.method ?? "GET",
        path: logSafePath(req.url),
        status: res.writableFinished ? res.statusCode : 499,
        durationMs: Math.round((performance.now() - ctx.startedAt) * 100) / 100,
        bytesIn: ctx.bytesIn,
        bytesOut: ctx.bytesOut,
        ip: req.socket.remoteAddress ?? "",
        userAgent: req.headers["user-agent"] ?? "",
        ...(ctx.accessKeyId ? { accessKeyId: ctx.accessKeyId } : {}),
        service: ctx.service,
      };
      void store.appendLog(log).catch(() => undefined);
    };
    res.once("finish", record);
    res.once("close", record);
  };

  const managementRouter = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> => {
    applyCors(req, res, config.allowedOrigins);
    if (handlePreflight(req, res, config.allowedOrigins)) return;
    rejectUnsafeRawPath(req.url);
    const url = new URL(req.url ?? "/", config.managementUrl);
    const path = url.pathname;
    if (path === "/healthz" && req.method === "GET") {
      sendJson(res, ctx, 200, {
        ok: true,
        status: "healthy",
        version: OPENBUCKET_VERSION,
        nodeId: store.nodeId,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
      return;
    }
    if (config.adminToken) {
      const header = req.headers.authorization ?? "";
      if (!safeEqual(header, `Bearer ${config.adminToken}`) && !validManagementCapability(header, config.managementCapabilitySecret, config.managementCapabilityNodeId ?? store.nodeId)) {
        res.setHeader("www-authenticate", 'Bearer realm="OpenBucket management"');
        throw new StoreError("Unauthorized", "A valid management bearer token is required.", 401);
      }
    }

    if (path === "/v1/status" && req.method === "GET") {
      const [storage, analytics] = await Promise.all([store.storageStats(), store.logAnalytics()]);
      const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const requestsToday = analytics.requestsToday;
      const endpoints = {
        management: config.managementUrl,
        s3: config.s3Url,
        public: config.publicBaseUrl ?? config.s3Url,
        files: config.filesUrl,
        dashboard: config.dashboardUrl ?? null,
      };
      sendJson(res, ctx, 200, {
        online: true,
        nodeId: store.nodeId,
        nodeName: store.nodeName,
        version: OPENBUCKET_VERSION,
        storageRoot: store.root,
        capacityBytes: storage.capacityBytes,
        usedBytes: storage.usedBytes,
        filesystemUsedBytes: storage.filesystemUsedBytes,
        availableBytes: storage.availableBytes,
        bucketCount: storage.bucketCount,
        objectCount: storage.objectCount,
        requestsToday,
        uptimeSeconds,
        endpoints,
        node: { id: store.nodeId, name: store.nodeName, createdAt: store.createdAt, uptimeSeconds },
        storage: { root: store.root, buckets: storage.bucketCount, objects: storage.objectCount, bytes: storage.usedBytes, managedBytes: storage.usedBytes, filesystemUsedBytes: storage.filesystemUsedBytes, totalBytes: storage.capacityBytes, freeBytes: storage.availableBytes },
      });
      return;
    }

    if (path === "/v1/config/client" && req.method === "GET") {
      sendJson(res, ctx, 200, {
        nodeId: store.nodeId,
        nodeName: store.nodeName,
        managementUrl: config.managementUrl,
        s3Url: config.s3Url,
        publicBaseUrl: config.publicBaseUrl ?? null,
        filesUrl: config.filesUrl,
        dashboardUrl: config.dashboardUrl ?? null,
        storageRoot: store.root,
      });
      return;
    }

    if (path === "/v1/buckets" && req.method === "GET") {
      const buckets = (await store.bucketStats()).map((bucket) => ({
        ...bucket,
        objects: bucket.objectCount,
        bytes: bucket.sizeBytes,
      }));
      sendJson(res, ctx, 200, { buckets });
      return;
    }

    if (path === "/v1/buckets" && req.method === "POST") {
      const body = await readJson(req, ctx);
      if (typeof body.name !== "string") throw new StoreError("InvalidBucketName", "A bucket name is required.");
      const bucket = await store.createBucket(body.name, body.public === true);
      sendJson(res, ctx, 201, { bucket: { ...bucket, objectCount: 0, sizeBytes: 0, objects: 0, bytes: 0 } });
      return;
    }

    const bucketMatch = /^\/v1\/buckets\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (bucketMatch) {
      const bucket = decodePart(bucketMatch[1]!, "Bucket name");
      const tail = bucketMatch[2];
      if (!tail && req.method === "DELETE") {
        await store.deleteBucket(bucket, url.searchParams.get("force") === "true");
        sendJson(res, ctx, 200, { deleted: true, bucket });
        return;
      }
      if (!tail && (req.method === "PATCH" || req.method === "PUT")) {
        const body = await readJson(req, ctx);
        if (typeof body.public !== "boolean") throw new StoreError("InvalidRequest", "The public field must be a boolean.");
        const updated = await store.setBucketPublic(bucket, body.public);
        sendJson(res, ctx, 200, { bucket: updated });
        return;
      }
      if (tail === "objects" && req.method === "GET") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const objects = (await store.listObjects(bucket, prefix)).map((object) => ({
          ...object,
          url: `${config.s3Url}/${encodeURIComponent(bucket)}/${encodePath(object.key)}`,
        }));
        sendJson(res, ctx, 200, { bucket, prefix, objects });
        return;
      }
      if (tail?.startsWith("objects/")) {
        const rawKey = tail.slice("objects/".length);
        const key = rawKey.split("/").map((part) => decodePart(part, "Object key")).join("/");
        if (req.method === "PUT") {
          const object = await store.putObject(bucket, key, meteredRequest(req, ctx));
          sendJson(res, ctx, 201, { object });
          return;
        }
        if (req.method === "GET" || req.method === "HEAD") {
          const object = await store.statObject(bucket, key);
          res.statusCode = 200;
          res.setHeader("content-type", "application/octet-stream");
          res.setHeader("etag", `"${object.etag}"`);
          res.setHeader("last-modified", new Date(object.lastModified).toUTCString());
          res.setHeader("accept-ranges", "bytes");
          setResponseLength(res, ctx, object.size);
          if (req.method === "HEAD") { ctx.bytesOut = 0; res.end(); }
          else await pipeline(store.createObjectReadStream(bucket, key), res);
          return;
        }
        if (req.method === "DELETE") {
          const deleted = await store.deleteObject(bucket, key);
          sendJson(res, ctx, 200, { deleted, bucket, key });
          return;
        }
      }
      if (tail === "share" && req.method === "POST") {
        const body = await readJson(req, ctx);
        if (typeof body.key !== "string") throw new StoreError("InvalidObjectName", "An object key is required.");
        await store.statObject(bucket, body.key);
        const expiresIn = Number(body.expiresIn ?? 3600);
        if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604_800) {
          throw new StoreError("InvalidExpiry", "expiresIn must be between 1 and 604800 seconds.");
        }
        const expires = Math.floor(Date.now() / 1000) + expiresIn;
        const token = createShareToken(store.shareSecret, bucket, body.key, expires);
        const shareUrl = `${config.filesUrl}/${encodeURIComponent(bucket)}/${encodePath(body.key)}?expires=${expires}&token=${encodeURIComponent(token)}`;
        sendJson(res, ctx, 201, { url: shareUrl, expiresAt: new Date(expires * 1000).toISOString(), bucket, key: body.key });
        return;
      }
    }

    if (path === "/v1/keys" && req.method === "GET") {
      sendJson(res, ctx, 200, { keys: store.listCredentials().map(publicCredential) });
      return;
    }
    if (path === "/v1/keys" && req.method === "POST") {
      const body = await readJson(req, ctx);
      if (body.name !== undefined && typeof body.name !== "string") throw new StoreError("InvalidRequest", "name must be a string.");
      if (body.readOnly !== undefined && typeof body.readOnly !== "boolean") throw new StoreError("InvalidRequest", "readOnly must be a boolean.");
      if (body.bucket !== undefined && body.bucket !== null && typeof body.bucket !== "string") throw new StoreError("InvalidRequest", "bucket must be a string or null.");
      const key = await store.createCredential(body.name as string | undefined, body.readOnly === true, (body.bucket as string | null | undefined) ?? undefined);
      sendJson(res, ctx, 201, { key: { ...key, bucket: key.bucket ?? null } });
      return;
    }
    const keyMatch = /^\/v1\/keys\/([^/]+)$/.exec(path);
    if (keyMatch && req.method === "DELETE") {
      const id = decodePart(keyMatch[1]!, "Key id");
      await store.deleteCredential(id);
      sendJson(res, ctx, 200, { deleted: true, id });
      return;
    }

    if (path === "/v1/logs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      sendJson(res, ctx, 200, { logs: await store.readLogs(limit) });
      return;
    }

    if (path === "/v1/analytics" && req.method === "GET") {
      const [analytics, storage] = await Promise.all([store.logAnalytics(), store.storageStats()]);
      sendJson(res, ctx, 200, {
        ...analytics,
        storage: { bucketCount: storage.bucketCount, objectCount: storage.objectCount, usedBytes: storage.usedBytes },
      });
      return;
    }

    if (path === "/v1/stop" && req.method === "POST") {
      sendJson(res, ctx, 202, { stopping: true });
      setImmediate(() => { void stop(); });
      return;
    }

    throw new StoreError("NotFound", "Management endpoint not found.", 404);
  };

  const serveObject = async (
    req: IncomingMessage,
    res: ServerResponse,
    ctx: RequestContext,
    bucket: string,
    key: string,
  ): Promise<void> => {
    const object = await store.statObject(bucket, key);
    let range: { start: number; end: number } | undefined;
    if (req.headers.range) {
      range = parseRange(req.headers.range, object.size);
      if (!range) {
        res.setHeader("content-range", `bytes */${object.size}`);
        throw new StoreError("InvalidRange", "The requested range is not satisfiable.", 416);
      }
    }
    const length = range ? range.end - range.start + 1 : object.size;
    res.statusCode = range ? 206 : 200;
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("etag", `"${object.etag}"`);
    res.setHeader("last-modified", new Date(object.lastModified).toUTCString());
    res.setHeader("accept-ranges", "bytes");
    if (range) res.setHeader("content-range", `bytes ${range.start}-${range.end}/${object.size}`);
    setResponseLength(res, ctx, length);
    if (req.method === "HEAD") { ctx.bytesOut = 0; res.end(); }
    else await pipeline(store.createObjectReadStream(bucket, key, range?.start, range?.end), res);
  };

  const filesRouter = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext, url: URL): Promise<void> => {
    ctx.service = "files";
    if (req.method !== "GET" && req.method !== "HEAD") throw new StoreError("MethodNotAllowed", "Share links only support GET and HEAD.", 405);
    const path = url.pathname.slice("/files/".length);
    const parts = path.split("/");
    const bucket = decodePart(parts.shift() ?? "", "Bucket name");
    const key = parts.map((part) => decodePart(part, "Object key")).join("/");
    const expires = Number(url.searchParams.get("expires"));
    const token = url.searchParams.get("token") ?? "";
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000) || !verifyShareToken(store.shareSecret, bucket, key, expires, token)) {
      throw new StoreError("AccessDenied", "This share link is invalid or expired.", 403);
    }
    res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(key.split("/").at(-1) ?? "download")}`);
    await serveObject(req, res, ctx, bucket, key);
  };

  const authorizeS3 = async (
    req: IncomingMessage,
    url: URL,
    ctx: RequestContext,
    allowAnonymous: boolean,
    bucket?: string,
  ): Promise<AuthCredentialRecord | undefined> => {
    const result = await verifyS3Authentication(req, url, store.listCredentials() as AuthCredentialRecord[], allowAnonymous);
    if (!result.ok) throw new StoreError(result.code, result.message, result.status);
    const credential = result.credential;
    if (credential) {
      ctx.accessKeyId = credential.accessKeyId;
      const scoped = credential as AuthCredentialRecord & { bucket?: string; readOnly?: boolean };
      if (scoped.bucket && scoped.bucket !== bucket) throw new StoreError("AccessDenied", "This key is scoped to a different bucket.", 403);
      if (scoped.readOnly && req.method !== "GET" && req.method !== "HEAD") throw new StoreError("AccessDenied", "This key is read-only.", 403);
    }
    return credential;
  };

  const s3Router = async (req: IncomingMessage, res: ServerResponse, ctx: RequestContext): Promise<void> => {
    applyCors(req, res, config.allowedOrigins);
    if (handlePreflight(req, res, config.allowedOrigins)) return;
    rejectUnsafeRawPath(req.url);
    const url = new URL(req.url ?? "/", config.s3Url);
    res.setHeader("x-amz-request-id", ctx.requestId);
    if (url.pathname.startsWith("/files/")) {
      await filesRouter(req, res, ctx, url);
      return;
    }
    const { bucket, key } = parseS3Path(url.pathname);
    let allowAnonymous = false;
    if (bucket && key && (req.method === "GET" || req.method === "HEAD")) {
      try { allowAnonymous = (await store.requireBucket(bucket)).public; } catch { /* Authentication produces a consistent S3 error below. */ }
    }
    const credential = await authorizeS3(req, url, ctx, allowAnonymous, bucket);

    if (!bucket && req.method === "GET") {
      let buckets = await store.listBuckets();
      const scopedBucket = (credential as (AuthCredentialRecord & { bucket?: string }) | undefined)?.bucket;
      if (scopedBucket) buckets = buckets.filter((entry) => entry.name === scopedBucket);
      const contents = buckets.map((entry) => `<Bucket><Name>${xmlEscape(entry.name)}</Name><CreationDate>${xmlEscape(entry.createdAt)}</CreationDate></Bucket>`).join("");
      sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>${xmlEscape(store.nodeId)}</ID><DisplayName>${xmlEscape(store.nodeName)}</DisplayName></Owner><Buckets>${contents}</Buckets></ListAllMyBucketsResult>`);
      return;
    }
    if (!bucket) throw new StoreError("InvalidURI", "A bucket name is required.");

    if (!key && req.method === "PUT") {
      const created = await store.createBucket(bucket);
      res.setHeader("location", `/${encodeURIComponent(created.name)}`);
      sendEmpty(res, 200);
      return;
    }
    if (!key && req.method === "DELETE") {
      await store.deleteBucket(bucket);
      sendEmpty(res, 204);
      return;
    }
    if (!key && req.method === "HEAD") {
      await store.requireBucket(bucket);
      sendEmpty(res, 200);
      return;
    }
    if (!key && req.method === "GET" && url.searchParams.has("location")) {
      await store.requireBucket(bucket);
      sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></LocationConstraint>`);
      return;
    }
    if (!key && req.method === "GET") {
      await store.requireBucket(bucket);
      const prefix = url.searchParams.get("prefix") ?? "";
      const maxKeysRaw = Number(url.searchParams.get("max-keys") ?? 1000);
      const maxKeys = Number.isInteger(maxKeysRaw) ? Math.max(0, Math.min(1000, maxKeysRaw)) : 1000;
      let objects = await store.listObjects(bucket, prefix);
      const token = url.searchParams.get("continuation-token");
      const startAfter = url.searchParams.get("start-after");
      let cursor = startAfter ?? "";
      if (token) {
        try { cursor = Buffer.from(token, "base64url").toString("utf8"); } catch { throw new StoreError("InvalidArgument", "Invalid continuation token."); }
      }
      if (cursor) objects = objects.filter((object) => object.key > cursor);
      const page = objects.slice(0, maxKeys);
      const truncated = objects.length > page.length;
      const nextToken = truncated && page.length ? Buffer.from(page.at(-1)!.key).toString("base64url") : undefined;
      const encodingType = url.searchParams.get("encoding-type");
      const keyValue = (value: string) => encodingType === "url" ? encodeURIComponent(value).replaceAll("%2F", "/") : xmlEscape(value);
      const contents = page.map((object) => `<Contents><Key>${keyValue(object.key)}</Key><LastModified>${xmlEscape(object.lastModified)}</LastModified><ETag>&quot;${object.etag}&quot;</ETag><Size>${object.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join("");
      sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(bucket)}</Name><Prefix>${keyValue(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${truncated}</IsTruncated>${token ? `<ContinuationToken>${xmlEscape(token)}</ContinuationToken>` : ""}${nextToken ? `<NextContinuationToken>${xmlEscape(nextToken)}</NextContinuationToken>` : ""}${startAfter ? `<StartAfter>${keyValue(startAfter)}</StartAfter>` : ""}${encodingType === "url" ? "<EncodingType>url</EncodingType>" : ""}${contents}</ListBucketResult>`);
      return;
    }
    if (!key) throw new StoreError("InvalidURI", "An object key is required.");

    if (req.method === "POST" && url.searchParams.has("uploads")) {
      const uploadId = await store.createMultipart(bucket, key);
      sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>${xmlEscape(bucket)}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${xmlEscape(uploadId)}</UploadId></InitiateMultipartUploadResult>`);
      return;
    }
    const uploadId = url.searchParams.get("uploadId");
    if (req.method === "PUT" && uploadId) {
      const partNumber = Number(url.searchParams.get("partNumber"));
      const part = await store.putPart(uploadId, bucket, key, partNumber, meteredRequest(req, ctx), expectedS3PayloadHash(req, url));
      res.setHeader("etag", `"${part.etag}"`);
      sendEmpty(res, 200);
      return;
    }
    if (req.method === "POST" && uploadId) {
      const rawBody = await readBody(req, ctx, 2 * 1024 * 1024);
      verifyBufferedS3Payload(req, url, rawBody);
      const body = rawBody.toString("utf8");
      const parts: Array<{ partNumber: number; etag?: string }> = [];
      for (const match of body.matchAll(/<Part\b[^>]*>([\s\S]*?)<\/Part\s*>/gi)) {
        const partBody = match[1] ?? "";
        const partNumber = /<PartNumber\b[^>]*>\s*(\d+)\s*<\/PartNumber\s*>/i.exec(partBody)?.[1];
        const rawEtag = /<ETag\b[^>]*>\s*([\s\S]*?)\s*<\/ETag\s*>/i.exec(partBody)?.[1]?.trim();
        if (!partNumber || !rawEtag) throw new StoreError("InvalidPart", "Each completed part must include PartNumber and ETag.");
        const etag = rawEtag.replace(/^(?:&quot;|&#34;|&#x22;|")/i, "").replace(/(?:&quot;|&#34;|&#x22;|")$/i, "").trim();
        if (!etag) throw new StoreError("InvalidPart", "Each completed part must include a non-empty ETag.");
        parts.push({ partNumber: Number(partNumber), etag });
      }
      const object = await store.completeMultipart(uploadId, bucket, key, parts);
      sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>${xmlEscape(`${config.s3Url}/${bucket}/${encodePath(key)}`)}</Location><Bucket>${xmlEscape(bucket)}</Bucket><Key>${xmlEscape(key)}</Key><ETag>&quot;${object.etag}&quot;</ETag></CompleteMultipartUploadResult>`);
      return;
    }
    if (req.method === "DELETE" && uploadId) {
      await store.abortMultipart(uploadId, bucket, key);
      sendEmpty(res, 204);
      return;
    }

    if (req.method === "PUT") {
      const copySource = req.headers["x-amz-copy-source"];
      let object: ObjectRecord;
      if (typeof copySource === "string") {
        const sourcePath = copySource.split("?", 1)[0]!.replace(/^\//, "");
        const [sourceBucketRaw, ...sourceParts] = sourcePath.split("/");
        const sourceBucket = decodePart(sourceBucketRaw ?? "", "Copy source bucket");
        const sourceKey = sourceParts.map((part) => decodePart(part, "Copy source key")).join("/");
        const scopedBucket = (credential as (AuthCredentialRecord & { bucket?: string }) | undefined)?.bucket;
        if (scopedBucket && scopedBucket !== sourceBucket) {
          throw new StoreError("AccessDenied", "This key cannot read the copy source bucket.", 403);
        }
        object = await store.copyObject(sourceBucket, sourceKey, bucket, key);
        sendXml(res, ctx, 200, `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><LastModified>${xmlEscape(object.lastModified)}</LastModified><ETag>&quot;${object.etag}&quot;</ETag></CopyObjectResult>`);
        return;
      }
      object = await store.putObject(bucket, key, meteredRequest(req, ctx), expectedS3PayloadHash(req, url));
      res.setHeader("etag", `"${object.etag}"`);
      sendEmpty(res, 200);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      await serveObject(req, res, ctx, bucket, key);
      return;
    }
    if (req.method === "DELETE") {
      await store.deleteObject(bucket, key);
      sendEmpty(res, 204);
      return;
    }
    throw new StoreError("MethodNotAllowed", "That S3 operation is not supported.", 405);
  };

  const managementServer = createServer((req, res) => {
    const ctx = requestContext(req, "management");
    registerLog(req, res, ctx);
    void managementRouter(req, res, ctx).catch((error) => {
      if (!res.headersSent) sendManagementError(res, ctx, error);
      else res.destroy(error instanceof Error ? error : undefined);
    });
  });
  const s3Server = createServer((req, res) => {
    const ctx = requestContext(req, "s3");
    registerLog(req, res, ctx);
    void s3Router(req, res, ctx).catch((error) => {
      if (!res.headersSent) sendS3Error(res, ctx, error, req.url ?? "/");
      else res.destroy(error instanceof Error ? error : undefined);
    });
  });
  managementServer.keepAliveTimeout = 5_000;
  s3Server.keepAliveTimeout = 5_000;

  try {
    config.managementPort = await listen(managementServer, managementPort, managementHost);
    config.managementUrl = hostUrl(managementHost, config.managementPort);
    config.s3Port = await listen(s3Server, s3Port, s3Host);
    config.s3Url = hostUrl(s3Host, config.s3Port);
    const publicRoot = config.publicBaseUrl ?? config.s3Url;
    config.filesUrl = `${publicRoot}/files`;
  } catch (error) {
    await Promise.allSettled([closeServer(managementServer), closeServer(s3Server)]);
    await store.close();
    resolveStopped();
    throw error;
  }

  return {
    config,
    ...(opened.initialCredentials ? { initialCredentials: { ...opened.initialCredentials } } : {}),
    stop,
    stopped,
  };
}

export { DiskStore, StoreError, validateBucketName, validateObjectKey } from "./store.js";
export { createShareToken, verifyShareToken } from "./auth.js";
export type { BucketRecord, BucketStats, CredentialRecord, ObjectRecord, LogAnalytics, RequestLog, StorageStats } from "./store.js";
