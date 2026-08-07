/**
 * Client-side upload engine for the OpenBucket dashboard's management API
 * (`/v1/buckets/:bucket/objects/:key`, bearer-token auth — see src/daemon/index.ts).
 *
 * Not the raw S3 protocol: that endpoint requires AWS SigV4 signing, which would mean
 * implementing a signer in the browser. The management API multipart endpoints
 * (`?uploads`, `?uploadId=&partNumber=`, `?uploadId=` complete/abort) mirror the S3
 * multipart shape but use the same simple bearer token the rest of the dashboard already
 * uses, so no browser-side signing is needed.
 *
 * Uses XMLHttpRequest (not fetch) specifically for `xhr.upload.onprogress`, which gives
 * real byte-level upload progress consistently across browsers.
 */

export type UploadConnection = { apiBase: string; adminToken: string };
export type UploadProgress = { loaded: number; total: number };

export type UploadOptions = {
  connection: UploadConnection;
  bucket: string;
  key: string;
  file: File | Blob;
  fileName?: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  /** Files at or above this size use chunked multipart instead of a single PUT. Default 8 MiB. */
  multipartThresholdBytes?: number;
  /** Size of each multipart chunk. Default 8 MiB. */
  partSizeBytes?: number;
  /** How many times to retry a single failed part before giving up. Default 3. */
  maxPartRetries?: number;
};

export type UploadResult = { etag?: string; size: number };

const DEFAULT_MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const DEFAULT_MAX_PART_RETRIES = 3;

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload was cancelled.");
    this.name = "UploadAbortedError";
  }
}

function objectPath(bucket: string, key: string): string {
  return `/v1/buckets/${encodeURIComponent(bucket)}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function requestUrl(apiBase: string, path: string, search?: URLSearchParams): string {
  const base = apiBase.replace(/\/$/, "");
  const query = search?.toString();
  return `${base}${path}${query ? `?${query}` : ""}`;
}

async function readErrorMessage(xhr: XMLHttpRequest, fallback: string): Promise<string> {
  try {
    const payload = JSON.parse(xhr.responseText) as { error?: { message?: string } | string };
    if (typeof payload.error === "string") return payload.error;
    if (payload.error?.message) return payload.error.message;
  } catch {
    // Response wasn't JSON — fall through to the generic message.
  }
  return fallback;
}

function xhrRequest(options: {
  method: string;
  url: string;
  connection: UploadConnection;
  body?: XMLHttpRequestBodyInit | null;
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<{ status: number; responseText: string; headers: (name: string) => string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, options.url, true);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-OpenBucket-Client", "dashboard");
    if (options.connection.adminToken) xhr.setRequestHeader("Authorization", `Bearer ${options.connection.adminToken}`);
    if (options.contentType) xhr.setRequestHeader("Content-Type", options.contentType);

    const onAbort = () => {
      xhr.abort();
      reject(new UploadAbortedError());
    };
    options.signal?.addEventListener("abort", onAbort);
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort);

    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.({ loaded: event.loaded, total: event.total });
      };
    }
    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, responseText: xhr.responseText, headers: (name) => xhr.getResponseHeader(name) });
    };
    xhr.onerror = () => { cleanup(); reject(new Error("Network error during upload.")); };
    xhr.ontimeout = () => { cleanup(); reject(new Error("Upload timed out.")); };
    xhr.send(options.body ?? null);
  });
}

async function withRetries<T>(attempts: number, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UploadAbortedError) throw error;
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed after retries.");
}

async function uploadSingle(options: UploadOptions): Promise<UploadResult> {
  const path = objectPath(options.bucket, options.key);
  const response = await xhrRequest({
    method: "PUT",
    url: requestUrl(options.connection.apiBase, path),
    connection: options.connection,
    body: options.file,
    contentType: options.file.type || "application/octet-stream",
    signal: options.signal,
    onProgress: options.onProgress,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(await readErrorMessage({ responseText: response.responseText } as XMLHttpRequest, `Upload failed (${response.status})`));
  }
  return { size: options.file.size };
}

async function uploadMultipart(options: UploadOptions): Promise<UploadResult> {
  const path = objectPath(options.bucket, options.key);
  const partSize = options.partSizeBytes ?? DEFAULT_PART_SIZE;
  const maxRetries = options.maxPartRetries ?? DEFAULT_MAX_PART_RETRIES;
  const totalSize = options.file.size;

  const initiate = await xhrRequest({
    method: "POST",
    url: requestUrl(options.connection.apiBase, path, new URLSearchParams({ uploads: "" })),
    connection: options.connection,
    signal: options.signal,
  });
  if (initiate.status < 200 || initiate.status >= 300) {
    throw new Error(await readErrorMessage({ responseText: initiate.responseText } as XMLHttpRequest, `Could not start upload (${initiate.status})`));
  }
  const { uploadId } = JSON.parse(initiate.responseText) as { uploadId: string };

  const partCount = Math.max(1, Math.ceil(totalSize / partSize));
  const partProgress = new Array<number>(partCount).fill(0);
  const reportProgress = () => {
    options.onProgress?.({ loaded: partProgress.reduce((sum, value) => sum + value, 0), total: totalSize });
  };

  const abortUpload = async () => {
    try {
      await xhrRequest({
        method: "DELETE",
        url: requestUrl(options.connection.apiBase, path, new URLSearchParams({ uploadId })),
        connection: options.connection,
      });
    } catch {
      // Best-effort cleanup — the daemon also garbage-collects orphaned multipart state.
    }
  };

  try {
    const parts: Array<{ partNumber: number; etag?: string }> = [];
    for (let index = 0; index < partCount; index += 1) {
      const partNumber = index + 1;
      const start = index * partSize;
      const chunk = options.file.slice(start, Math.min(start + partSize, totalSize));
      const etag = await withRetries(maxRetries, async () => {
        const response = await xhrRequest({
          method: "PUT",
          url: requestUrl(options.connection.apiBase, path, new URLSearchParams({ uploadId, partNumber: String(partNumber) })),
          connection: options.connection,
          body: chunk,
          contentType: "application/octet-stream",
          signal: options.signal,
          onProgress: (progress) => { partProgress[index] = progress.loaded; reportProgress(); },
        });
        if (response.status < 200 || response.status >= 300) {
          partProgress[index] = 0;
          throw new Error(await readErrorMessage({ responseText: response.responseText } as XMLHttpRequest, `Part ${partNumber} failed (${response.status})`));
        }
        partProgress[index] = chunk.size;
        reportProgress();
        return (JSON.parse(response.responseText) as { etag: string }).etag;
      });
      parts.push({ partNumber, etag });
    }

    const complete = await xhrRequest({
      method: "POST",
      url: requestUrl(options.connection.apiBase, path, new URLSearchParams({ uploadId })),
      connection: options.connection,
      body: JSON.stringify({ parts }),
      contentType: "application/json",
      signal: options.signal,
    });
    if (complete.status < 200 || complete.status >= 300) {
      throw new Error(await readErrorMessage({ responseText: complete.responseText } as XMLHttpRequest, `Could not finish upload (${complete.status})`));
    }
    const { object } = JSON.parse(complete.responseText) as { object: { etag?: string; size: number } };
    return { etag: object.etag, size: object.size };
  } catch (error) {
    if (!(error instanceof UploadAbortedError)) void abortUpload();
    throw error;
  }
}

/** Uploads a single file, choosing a plain PUT or chunked multipart based on its size. */
export async function uploadObject(options: UploadOptions): Promise<UploadResult> {
  const threshold = options.multipartThresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD;
  return options.file.size >= threshold ? uploadMultipart(options) : uploadSingle(options);
}
