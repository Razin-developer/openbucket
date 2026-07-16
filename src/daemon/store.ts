import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  open as openFile,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface BucketRecord {
  name: string;
  createdAt: string;
  public: boolean;
}

export interface CredentialRecord {
  id: string;
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  createdAt: string;
  readOnly: boolean;
  bucket?: string;
}

export interface ObjectRecord {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface RequestLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  bytesIn: number;
  bytesOut: number;
  ip: string;
  userAgent: string;
  accessKeyId?: string;
  service: "management" | "s3" | "files";
}

interface PersistedState {
  version: 1;
  nodeId: string;
  nodeName: string;
  createdAt: string;
  shareSecret: string;
  buckets: Record<string, BucketRecord>;
  credentials: CredentialRecord[];
}

interface MultipartManifest {
  uploadId: string;
  bucket: string;
  key: string;
  createdAt: string;
}

export interface StorageStats {
  bucketCount: number;
  objectCount: number;
  usedBytes: number;
  filesystemUsedBytes: number;
  capacityBytes: number;
  availableBytes: number;
}

export interface BucketStats extends BucketRecord {
  objectCount: number;
  sizeBytes: number;
}

export interface LogAnalytics {
  requests: number;
  requestsToday: number;
  totalBytesIn: number;
  totalBytesOut: number;
  averageLatencyMs: number;
  errors: number;
  statusCodes: Record<string, number>;
  methods: Record<string, number>;
  recentDaily: Array<{ date: string; requests: number; bytesIn: number; bytesOut: number }>;
}

export class StoreError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

const BUCKET_PATTERN = /^(?!\d{1,3}(?:\.\d{1,3}){3}$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?!-)(?!.*-$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PROCESS_INSTANCE_ID = randomBytes(18).toString("base64url");
const ACTIVE_LOCKS = new Set<string>();

export function validateBucketName(name: string): string {
  if (!BUCKET_PATTERN.test(name)) {
    throw new StoreError(
      "InvalidBucketName",
      "Bucket names must be 3-63 lowercase letters, numbers, dots, or hyphens.",
    );
  }
  if (name === ".openbucket" || name.startsWith(".openbucket.")) {
    throw new StoreError("InvalidBucketName", "That bucket name is reserved.");
  }
  return name;
}

export function validateObjectKey(key: string): string {
  if (!key || Buffer.byteLength(key, "utf8") > 1024) {
    throw new StoreError("InvalidObjectName", "Object keys must contain 1-1024 UTF-8 bytes.");
  }
  if (key.includes("\\") || key.includes("\0")) {
    throw new StoreError("InvalidObjectName", "Object keys cannot contain backslashes or NUL bytes.");
  }
  const segments = key.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".openbucket")) {
    throw new StoreError("InvalidObjectName", "Object keys contain an unsafe path segment.");
  }
  if (process.platform === "win32" && segments.some((part) =>
    /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)
  )) {
    throw new StoreError("InvalidObjectName", "The object key cannot be represented safely on this filesystem.");
  }
  return key;
}

function isPathInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

async function fileEtag(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export class DiskStore {
  readonly root: string;
  readonly internalDir: string;
  readonly statePath: string;
  readonly logPath: string;
  readonly lockPath: string;
  private state!: PersistedState;
  private mutation: Promise<unknown> = Promise.resolve();
  private logMutation: Promise<unknown> = Promise.resolve();
  private lockHandle?: FileHandle;
  private lockNonce?: string;
  private etagCache = new Map<string, { size: number; mtimeMs: number; etag: string }>();
  private bucketStatsCache?: { expiresAt: number; value: Promise<BucketStats[]> };
  private analyticsCache?: { expiresAt: number; value: Promise<LogAnalytics> };

  private constructor(storageRoot: string) {
    this.root = resolve(storageRoot);
    this.internalDir = join(this.root, ".openbucket");
    this.statePath = join(this.internalDir, "state.json");
    this.logPath = join(this.internalDir, "requests.jsonl");
    this.lockPath = join(this.internalDir, "daemon.lock");
  }

  static async open(storageRoot: string, nodeName?: string): Promise<{ store: DiskStore; initialCredentials?: CredentialRecord }> {
    if (!storageRoot.trim()) throw new StoreError("InvalidStorageRoot", "A storage root is required.");
    const requestedRoot = resolve(storageRoot);
    await mkdir(requestedRoot, { recursive: true });
    const store = new DiskStore(await realpath(requestedRoot));
    if (await pathExists(store.internalDir)) {
      const internalInfo = await lstat(store.internalDir);
      if (internalInfo.isSymbolicLink() || !internalInfo.isDirectory()) {
        throw new StoreError("UnsafeStorageRoot", ".openbucket must be a real directory inside the storage root.", 500);
      }
    }
    await mkdir(store.internalDir, { recursive: true, mode: 0o700 });
    await store.acquireLock();
    try {
      await mkdir(join(store.internalDir, "tmp"), { recursive: true, mode: 0o700 });
      await mkdir(join(store.internalDir, "multipart"), { recursive: true, mode: 0o700 });
      let initialCredentials: CredentialRecord | undefined;
      if (await pathExists(store.statePath)) {
        try {
          const parsed = JSON.parse(await readFile(store.statePath, "utf8")) as PersistedState;
          if (parsed.version !== 1 || !parsed.nodeId || !parsed.shareSecret || !parsed.buckets || !Array.isArray(parsed.credentials)) {
            throw new Error("unsupported state schema");
          }
          store.state = parsed;
          store.state.credentials = parsed.credentials.map((credential) => ({
            ...credential,
            readOnly: Boolean(credential.readOnly),
          }));
          if (nodeName && nodeName !== parsed.nodeName) {
            store.state.nodeName = nodeName;
            await store.save();
          }
        } catch (error) {
          throw new StoreError("InvalidState", `Could not read ${store.statePath}: ${(error as Error).message}`, 500);
        }
      } else {
        const now = new Date().toISOString();
        initialCredentials = DiskStore.generateCredential("default");
        store.state = {
          version: 1,
          nodeId: randomUUID(),
          nodeName: nodeName?.trim() || `openbucket-${process.env.COMPUTERNAME || process.env.HOSTNAME || "node"}`,
          createdAt: now,
          shareSecret: randomBytes(32).toString("base64url"),
          buckets: {},
          credentials: [initialCredentials],
        };
        await store.save();
      }
      await store.discoverBuckets();
      return { store, initialCredentials };
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  get nodeId(): string { return this.state.nodeId; }
  get nodeName(): string { return this.state.nodeName; }
  get createdAt(): string { return this.state.createdAt; }
  get shareSecret(): string { return this.state.shareSecret; }

  private async acquireLock(): Promise<void> {
    const nonce = randomBytes(18).toString("base64url");
    const payload = { pid: process.pid, hostname: hostname(), processInstanceId: PROCESS_INSTANCE_ID, createdAt: new Date().toISOString(), nonce };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle: FileHandle;
      try {
        handle = await openFile(this.lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          const existing = JSON.parse(await readFile(this.lockPath, "utf8")) as { pid?: number; hostname?: string; processInstanceId?: string };
          if (existing.hostname === hostname() && Number.isInteger(existing.pid) && existing.pid! > 0) {
            if (existing.pid === process.pid) {
              stale = !ACTIVE_LOCKS.has(this.lockPath) || existing.processInstanceId !== PROCESS_INSTANCE_ID;
            } else {
              try { process.kill(existing.pid!, 0); }
              catch (signalError) { stale = (signalError as NodeJS.ErrnoException).code === "ESRCH"; }
            }
          }
        } catch {
          // A malformed lock is retained so an active process can never be displaced.
        }
        if (stale) {
          await rm(this.lockPath, { force: true });
          continue;
        }
        throw new StoreError("StorageRootInUse", `Another OpenBucket daemon is using ${this.root}.`, 409);
      }
      ACTIVE_LOCKS.add(this.lockPath);
      try {
        await handle.writeFile(`${JSON.stringify(payload)}\n`, "utf8");
        await handle.sync();
        this.lockHandle = handle;
        this.lockNonce = nonce;
        return;
      } catch (error) {
        ACTIVE_LOCKS.delete(this.lockPath);
        await handle.close().catch(() => undefined);
        await rm(this.lockPath, { force: true });
        throw error;
      }
    }
    throw new StoreError("StorageRootInUse", `Another OpenBucket daemon is using ${this.root}.`, 409);
  }

  async close(): Promise<void> {
    await Promise.all([this.mutation, this.logMutation]);
    const nonce = this.lockNonce;
    this.lockNonce = undefined;
    await this.lockHandle?.close().catch(() => undefined);
    this.lockHandle = undefined;
    ACTIVE_LOCKS.delete(this.lockPath);
    if (!nonce) return;
    try {
      const current = JSON.parse(await readFile(this.lockPath, "utf8")) as { nonce?: string };
      if (current.nonce === nonce) await rm(this.lockPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(fn, fn);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async save(): Promise<void> {
    await atomicJson(this.statePath, this.state);
  }

  private invalidateStorageCaches(): void {
    this.bucketStatsCache = undefined;
  }

  private async objectRecord(path: string, key: string): Promise<ObjectRecord> {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    const cached = this.etagCache.get(path);
    let etag: string;
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      etag = cached.etag;
    } else {
      etag = await fileEtag(path);
      this.etagCache.set(path, { size: info.size, mtimeMs: info.mtimeMs, etag });
    }
    return { key, size: info.size, lastModified: info.mtime.toISOString(), etag };
  }

  private async scanBucketStats(bucket: BucketRecord): Promise<BucketStats> {
    let objectCount = 0;
    let sizeBytes = 0;
    const visit = async (path: string): Promise<void> => {
      const dir = await opendir(path);
      for await (const entry of dir) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile()) {
          const info = await stat(full);
          objectCount += 1;
          sizeBytes += info.size;
        }
      }
    };
    await visit(this.bucketPath(bucket.name));
    return { ...bucket, objectCount, sizeBytes };
  }

  async bucketStats(): Promise<BucketStats[]> {
    const now = Date.now();
    if (this.bucketStatsCache && this.bucketStatsCache.expiresAt > now) {
      return this.bucketStatsCache.value;
    }
    const value = (async () => Promise.all((await this.listBuckets()).map((bucket) => this.scanBucketStats(bucket))))();
    this.bucketStatsCache = { expiresAt: now + 5_000, value };
    try {
      return await value;
    } catch (error) {
      if (this.bucketStatsCache?.value === value) this.bucketStatsCache = undefined;
      throw error;
    }
  }

  private async discoverBuckets(): Promise<void> {
    let changed = false;
    for (const name of Object.keys(this.state.buckets)) {
      try {
        validateBucketName(name);
        const info = await lstat(this.bucketPath(name));
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("not a safe directory");
      } catch {
        delete this.state.buckets[name];
        changed = true;
      }
    }
    const dir = await opendir(this.root);
    for await (const entry of dir) {
      if (!entry.isDirectory() || entry.name === ".openbucket" || this.state.buckets[entry.name]) continue;
      try {
        validateBucketName(entry.name);
        const info = await stat(join(this.root, entry.name));
        this.state.buckets[entry.name] = { name: entry.name, createdAt: info.birthtime.toISOString(), public: false };
        changed = true;
      } catch {
        // Directories that cannot be represented safely as S3 buckets are left untouched.
      }
    }
    if (changed) {
      await this.save();
      this.invalidateStorageCaches();
    }
  }

  private bucketPath(name: string): string {
    validateBucketName(name);
    return join(this.root, name);
  }

  private async assertSafeExistingPath(bucket: string, key?: string): Promise<void> {
    const base = this.bucketPath(bucket);
    try {
      const bucketInfo = await lstat(base);
      if (bucketInfo.isSymbolicLink() || !bucketInfo.isDirectory()) {
        throw new StoreError("UnsafeStoragePath", "Bucket paths cannot be symbolic links.", 403);
      }
    } catch (error) {
      if (error instanceof StoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let current = base;
    for (const segment of key?.split("/") ?? []) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new StoreError("UnsafeStoragePath", "Object paths cannot contain symbolic links.", 403);
      } catch (error) {
        if (error instanceof StoreError) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
  }

  objectPath(bucket: string, key: string): string {
    const base = this.bucketPath(bucket);
    validateObjectKey(key);
    const target = resolve(base, ...key.split("/"));
    if (!isPathInside(base, target)) throw new StoreError("InvalidObjectName", "Object path escapes its bucket.");
    return target;
  }

  async requireBucket(name: string): Promise<BucketRecord> {
    validateBucketName(name);
    const bucket = this.state.buckets[name];
    if (!bucket || !(await pathExists(this.bucketPath(name)))) {
      throw new StoreError("NoSuchBucket", `Bucket '${name}' does not exist.`, 404);
    }
    await this.assertSafeExistingPath(name);
    return { ...bucket };
  }

  async listBuckets(): Promise<BucketRecord[]> {
    await this.discoverBuckets();
    return Object.values(this.state.buckets).sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ ...item }));
  }

  async createBucket(name: string, isPublic = false): Promise<BucketRecord> {
    validateBucketName(name);
    return this.serial(async () => {
      if (this.state.buckets[name] || await pathExists(this.bucketPath(name))) {
        throw new StoreError("BucketAlreadyExists", `Bucket '${name}' already exists.`, 409);
      }
      await mkdir(this.bucketPath(name));
      const record = { name, public: Boolean(isPublic), createdAt: new Date().toISOString() };
      this.state.buckets[name] = record;
      try {
        await this.save();
        this.invalidateStorageCaches();
      } catch (error) {
        delete this.state.buckets[name];
        await rmdir(this.bucketPath(name));
        throw error;
      }
      return { ...record };
    });
  }

  async setBucketPublic(name: string, isPublic: boolean): Promise<BucketRecord> {
    return this.serial(async () => {
      await this.requireBucket(name);
      const previous = this.state.buckets[name]!.public;
      this.state.buckets[name]!.public = Boolean(isPublic);
      try {
        await this.save();
      } catch (error) {
        this.state.buckets[name]!.public = previous;
        throw error;
      }
      return { ...this.state.buckets[name]! };
    });
  }

  async deleteBucket(name: string, force = false): Promise<void> {
    return this.serial(async () => {
      await this.requireBucket(name);
      if (!force) {
        const dir = await opendir(this.bucketPath(name));
        for await (const entry of dir) {
          if (entry) throw new StoreError("BucketNotEmpty", `Bucket '${name}' is not empty.`, 409);
        }
      }
      const originalPath = this.bucketPath(name);
      const trashPath = join(this.internalDir, "tmp", `deleted-bucket-${randomUUID()}`);
      await rename(originalPath, trashPath);
      const previous = this.state.buckets[name]!;
      delete this.state.buckets[name];
      try {
        await this.save();
      } catch (error) {
        this.state.buckets[name] = previous;
        await rename(trashPath, originalPath).catch(() => undefined);
        throw error;
      }
      this.invalidateStorageCaches();
      for (const cachedPath of this.etagCache.keys()) {
        if (cachedPath === originalPath || cachedPath.startsWith(`${originalPath}${sep}`)) this.etagCache.delete(cachedPath);
      }
      await rm(trashPath, { recursive: true, force: true }).catch(() => undefined);
    });
  }

  async listObjects(bucket: string, prefix = ""): Promise<ObjectRecord[]> {
    await this.requireBucket(bucket);
    if (prefix) {
      if (prefix.includes("\\") || prefix.includes("\0") || prefix.split("/").some((part) => part === "." || part === ".." || part.toLowerCase() === ".openbucket")) {
        throw new StoreError("InvalidPrefix", "The prefix contains an unsafe path segment.");
      }
    }
    const root = this.bucketPath(bucket);
    const results: ObjectRecord[] = [];
    const visit = async (path: string, parts: string[]): Promise<void> => {
      const dir = await opendir(path);
      for await (const entry of dir) {
        const nextParts = [...parts, entry.name];
        const full = join(path, entry.name);
        if (entry.isDirectory()) await visit(full, nextParts);
        else if (entry.isFile()) {
          const key = nextParts.join("/");
          if (!key.startsWith(prefix)) continue;
          results.push(await this.objectRecord(full, key));
        }
      }
    };
    await visit(root, []);
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  async statObject(bucket: string, key: string): Promise<ObjectRecord> {
    await this.requireBucket(bucket);
    await this.assertSafeExistingPath(bucket, key);
    const path = this.objectPath(bucket, key);
    try {
      return await this.objectRecord(path, key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as Error).message === "not a file") {
        throw new StoreError("NoSuchKey", `Object '${key}' does not exist.`, 404);
      }
      throw error;
    }
  }

  async putObject(bucket: string, key: string, input: Readable | Buffer | string, expectedSha256?: string): Promise<ObjectRecord> {
    await this.requireBucket(bucket);
    await this.assertSafeExistingPath(bucket, key);
    const target = this.objectPath(bucket, key);
    await mkdir(dirname(target), { recursive: true });
    const temp = join(this.internalDir, "tmp", `${randomUUID()}.upload`);
    const source = input instanceof Readable ? input : Readable.from([input]);
    const hash = createHash("md5");
    const sha256 = createHash("sha256");
    const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); sha256.update(chunk); callback(null, chunk); } });
    try {
      await pipeline(source, meter, createWriteStream(temp, { flags: "wx", mode: 0o600 }));
      const actualSha256 = sha256.digest("hex");
      if (expectedSha256 && expectedSha256 !== "UNSIGNED-PAYLOAD" && actualSha256 !== expectedSha256.toLowerCase()) {
        throw new StoreError("XAmzContentSHA256Mismatch", "The request body does not match x-amz-content-sha256.", 400);
      }
      try {
        await rename(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        await rm(target, { force: true });
        await rename(temp, target);
      }
      const info = await stat(target);
      const etag = hash.digest("hex");
      this.etagCache.set(target, { size: info.size, mtimeMs: info.mtimeMs, etag });
      this.invalidateStorageCaches();
      return { key, size: info.size, lastModified: info.mtime.toISOString(), etag };
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async readObject(bucket: string, key: string): Promise<{ record: ObjectRecord; stream: Readable }> {
    const record = await this.statObject(bucket, key);
    return { record, stream: createReadStream(this.objectPath(bucket, key)) };
  }

  createObjectReadStream(bucket: string, key: string, start?: number, end?: number): Readable {
    return createReadStream(this.objectPath(bucket, key), { start, end });
  }

  async deleteObject(bucket: string, key: string): Promise<boolean> {
    await this.requireBucket(bucket);
    await this.assertSafeExistingPath(bucket, key);
    const path = this.objectPath(bucket, key);
    try {
      await rm(path);
      this.etagCache.delete(path);
      this.invalidateStorageCaches();
      let parent = dirname(path);
      const base = this.bucketPath(bucket);
      while (parent !== base && isPathInside(base, parent)) {
        try { await rmdir(parent); } catch { break; }
        parent = dirname(parent);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async copyObject(sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string): Promise<ObjectRecord> {
    const source = await this.readObject(sourceBucket, sourceKey);
    return this.putObject(destinationBucket, destinationKey, source.stream);
  }

  static generateCredential(name: string): CredentialRecord {
    return {
      id: randomUUID(),
      name: name.trim() || "access key",
      accessKeyId: `OB${randomBytes(10).toString("hex").toUpperCase()}`,
      secretAccessKey: randomBytes(30).toString("base64url"),
      createdAt: new Date().toISOString(),
      readOnly: false,
    };
  }

  listCredentials(): CredentialRecord[] { return this.state.credentials.map((key) => ({ ...key })); }

  async createCredential(name = "access key", readOnly = false, bucket?: string): Promise<CredentialRecord> {
    return this.serial(async () => {
      const key = DiskStore.generateCredential(name);
      key.readOnly = Boolean(readOnly);
      if (bucket) {
        await this.requireBucket(bucket);
        key.bucket = bucket;
      }
      this.state.credentials.push(key);
      try {
        await this.save();
      } catch (error) {
        this.state.credentials.pop();
        throw error;
      }
      return { ...key };
    });
  }

  async deleteCredential(id: string): Promise<void> {
    return this.serial(async () => {
      const index = this.state.credentials.findIndex((key) => key.id === id);
      if (index < 0) throw new StoreError("NoSuchAccessKey", "Access key not found.", 404);
      if (this.state.credentials.length === 1) throw new StoreError("LastAccessKey", "The last access key cannot be deleted.", 409);
      const [removed] = this.state.credentials.splice(index, 1);
      try {
        await this.save();
      } catch (error) {
        this.state.credentials.splice(index, 0, removed!);
        throw error;
      }
    });
  }

  async appendLog(entry: RequestLog): Promise<void> {
    this.analyticsCache = undefined;
    const write = this.logMutation.then(() =>
      appendFile(this.logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 }),
    );
    this.logMutation = write.then(() => undefined, () => undefined);
    await write;
  }

  async logAnalytics(): Promise<LogAnalytics> {
    await this.logMutation;
    const now = Date.now();
    if (this.analyticsCache && this.analyticsCache.expiresAt > now) return this.analyticsCache.value;
    const value = this.computeLogAnalytics();
    this.analyticsCache = { expiresAt: now + 2_000, value };
    try {
      return await value;
    } catch (error) {
      if (this.analyticsCache?.value === value) this.analyticsCache = undefined;
      throw error;
    }
  }

  private async computeLogAnalytics(): Promise<LogAnalytics> {
    const statusCodes: Record<string, number> = {};
    const methods: Record<string, number> = {};
    const daily = new Map<string, { date: string; requests: number; bytesIn: number; bytesOut: number }>();
    let requests = 0;
    let totalBytesIn = 0;
    let totalBytesOut = 0;
    let totalDurationMs = 0;
    let errors = 0;
    try {
      const lines = createInterface({ input: createReadStream(this.logPath), crlfDelay: Infinity });
      for await (const line of lines) {
        let log: RequestLog;
        try { log = JSON.parse(line) as RequestLog; } catch { continue; }
        if (!log || typeof log.timestamp !== "string" || typeof log.status !== "number") continue;
        requests += 1;
        totalBytesIn += Number(log.bytesIn) || 0;
        totalBytesOut += Number(log.bytesOut) || 0;
        totalDurationMs += Number(log.durationMs) || 0;
        if (log.status >= 400) errors += 1;
        statusCodes[String(log.status)] = (statusCodes[String(log.status)] ?? 0) + 1;
        methods[log.method] = (methods[log.method] ?? 0) + 1;
        const date = log.timestamp.slice(0, 10);
        const point = daily.get(date) ?? { date, requests: 0, bytesIn: 0, bytesOut: 0 };
        point.requests += 1;
        point.bytesIn += Number(log.bytesIn) || 0;
        point.bytesOut += Number(log.bytesOut) || 0;
        daily.set(date, point);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const today = new Date().toISOString().slice(0, 10);
    return {
      requests,
      requestsToday: daily.get(today)?.requests ?? 0,
      totalBytesIn,
      totalBytesOut,
      averageLatencyMs: requests ? Math.round((totalDurationMs / requests) * 100) / 100 : 0,
      errors,
      statusCodes,
      methods,
      recentDaily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30),
    };
  }

  async readLogs(limit = 100): Promise<RequestLog[]> {
    await this.logMutation;
    const bounded = Math.max(1, Math.min(1000, Math.trunc(limit) || 100));
    try {
      const data = await readFile(this.logPath, "utf8");
      return data.trim().split("\n").filter(Boolean).slice(-bounded).reverse().flatMap((line) => {
        try { return [JSON.parse(line) as RequestLog]; } catch { return []; }
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async storageStats(): Promise<StorageStats> {
    const buckets = await this.bucketStats();
    const objectCount = buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0);
    const usedBytes = buckets.reduce((sum, bucket) => sum + bucket.sizeBytes, 0);
    const fs = await statfs(this.root, { bigint: true });
    const capacityBytes = Number(fs.blocks * fs.bsize);
    const availableBytes = Number(fs.bavail * fs.bsize);
    const filesystemUsedBytes = Math.max(0, capacityBytes - Number(fs.bfree * fs.bsize));
    return { bucketCount: buckets.length, objectCount, usedBytes, filesystemUsedBytes, capacityBytes, availableBytes };
  }

  private multipartPath(uploadId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(uploadId)) throw new StoreError("NoSuchUpload", "Multipart upload not found.", 404);
    return join(this.internalDir, "multipart", uploadId);
  }

  async createMultipart(bucket: string, key: string): Promise<string> {
    await this.requireBucket(bucket);
    validateObjectKey(key);
    const uploadId = randomUUID();
    const path = this.multipartPath(uploadId);
    await mkdir(path, { recursive: false, mode: 0o700 });
    await atomicJson(join(path, "manifest.json"), { uploadId, bucket, key, createdAt: new Date().toISOString() } satisfies MultipartManifest);
    return uploadId;
  }

  async getMultipart(uploadId: string, bucket: string, key: string): Promise<{ path: string; manifest: MultipartManifest }> {
    const path = this.multipartPath(uploadId);
    try {
      const manifest = JSON.parse(await readFile(join(path, "manifest.json"), "utf8")) as MultipartManifest;
      if (manifest.bucket !== bucket || manifest.key !== key) throw new Error("upload target mismatch");
      return { path, manifest };
    } catch {
      throw new StoreError("NoSuchUpload", "Multipart upload not found.", 404);
    }
  }

  async putPart(uploadId: string, bucket: string, key: string, partNumber: number, input: Readable, expectedSha256?: string): Promise<{ etag: string; size: number }> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new StoreError("InvalidPart", "Part number must be 1-10000.");
    const upload = await this.getMultipart(uploadId, bucket, key);
    const target = join(upload.path, `${partNumber}.part`);
    const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    const hash = createHash("md5");
    const sha256 = createHash("sha256");
    const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); sha256.update(chunk); callback(null, chunk); } });
    try {
      await pipeline(input, meter, createWriteStream(temp, { flags: "wx", mode: 0o600 }));
      const actualSha256 = sha256.digest("hex");
      if (expectedSha256 && expectedSha256 !== "UNSIGNED-PAYLOAD" && actualSha256 !== expectedSha256.toLowerCase()) {
        throw new StoreError("XAmzContentSHA256Mismatch", "The request body does not match x-amz-content-sha256.", 400);
      }
      try {
        await rename(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        await rm(target, { force: true });
        await rename(temp, target);
      }
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    const info = await stat(target);
    const etag = hash.digest("hex");
    await writeFile(join(upload.path, `${partNumber}.etag`), etag, "utf8");
    return { etag, size: info.size };
  }

  async completeMultipart(uploadId: string, bucket: string, key: string, parts: Array<{ partNumber: number; etag?: string }>): Promise<ObjectRecord> {
    const upload = await this.getMultipart(uploadId, bucket, key);
    if (!parts.length) throw new StoreError("InvalidPart", "At least one part is required.");
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const sources: Readable[] = [];
    for (const part of ordered) {
      const path = join(upload.path, `${part.partNumber}.part`);
      if (!(await pathExists(path))) throw new StoreError("InvalidPart", `Part ${part.partNumber} was not uploaded.`);
      if (part.etag) {
        const actual = (await readFile(join(upload.path, `${part.partNumber}.etag`), "utf8")).trim();
        if (actual !== part.etag.replaceAll('"', "")) throw new StoreError("InvalidPart", `ETag mismatch for part ${part.partNumber}.`);
      }
      sources.push(createReadStream(path));
    }
    async function* concatenate(): AsyncGenerator<Buffer> {
      for (const source of sources) for await (const chunk of source) yield chunk as Buffer;
    }
    const record = await this.putObject(bucket, key, Readable.from(concatenate()));
    await rm(upload.path, { recursive: true, force: true });
    return record;
  }

  async abortMultipart(uploadId: string, bucket: string, key: string): Promise<void> {
    const upload = await this.getMultipart(uploadId, bucket, key);
    await rm(upload.path, { recursive: true, force: true });
  }
}
