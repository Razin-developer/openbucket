import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

interface WorkerLike {
  fetch(
    request: Request,
    env: { ASSETS: { fetch(request: Request): Promise<Response> } },
    context: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void },
  ): Promise<Response>;
}

export interface DashboardServerHandle {
  url: string;
  stop(): Promise<void>;
}

export interface DashboardServerOptions {
  url?: string;
  maxPortAttempts?: number;
  allowNonLoopback?: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(":"));
}

async function findDashboardBuild(): Promise<{ clientRoot: string; serverEntry: string }> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDirectory, ".."), resolve(moduleDirectory, "..", "..", "dist")];
  for (const root of candidates) {
    const clientRoot = resolve(root, "client");
    const serverEntry = resolve(root, "server", "index.js");
    try {
      await Promise.all([access(clientRoot), access(serverEntry)]);
      return { clientRoot, serverEntry };
    } catch {
      // Try the next source/compiled layout.
    }
  }
  throw new Error("Dashboard build not found. Run `npm run build:web` before starting OpenBucket.");
}

function assetFetcher(clientRoot: string) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Not found", { status: 404 });
    }
    const url = new URL(request.url);
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response("Bad request", { status: 400 }); }
    const relativePath = pathname.replace(/^\/+/, "");
    const target = resolve(clientRoot, relativePath);
    if (!relativePath || !isWithin(clientRoot, target)) return new Response("Not found", { status: 404 });
    try {
      const info = await stat(target);
      if (!info.isFile()) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "content-length": String(info.size),
        "content-type": CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
        etag: `W/\"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}\"`,
      });
      if (relativePath.startsWith("assets/")) headers.set("cache-control", "public, max-age=31536000, immutable");
      else headers.set("cache-control", "public, max-age=300");
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      const body = Readable.toWeb(createReadStream(target)) as unknown as BodyInit;
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
}

function webRequest(req: IncomingMessage, baseUrl: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const base = new URL(baseUrl);
  if (!headers.has("x-forwarded-proto")) headers.set("x-forwarded-proto", base.protocol.replace(":", ""));
  if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", headers.get("host") ?? base.host);
  const init: RequestInit & { duplex?: "half" } = { method: req.method ?? "GET", headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as BodyInit;
    init.duplex = "half";
  }
  return new Request(new URL(req.url ?? "/", baseUrl), init);
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) { res.end(); return; }
  await pipeline(Readable.fromWeb(response.body as never), res);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      resolveListen(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/** Serve the production vinext dashboard bundle from the same OpenBucket process. */
export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<DashboardServerHandle> {
  const requested = new URL(options.url ?? "http://localhost:3000");
  const requestedHostname = requested.hostname.replace(/^\[|\]$/g, "");
  if (requested.protocol !== "http:" || (!options.allowNonLoopback && !["localhost", "127.0.0.1", "::1"].includes(requestedHostname))) {
    throw new Error("The embedded dashboard URL must be a local http:// URL.");
  }
  const { clientRoot, serverEntry } = await findDashboardBuild();
  const moduleUrl = pathToFileURL(serverEntry);
  moduleUrl.searchParams.set("openbucket-dashboard", `${process.pid}`);
  const imported = await import(moduleUrl.href) as { default?: WorkerLike };
  const worker = imported.default;
  if (!worker || typeof worker.fetch !== "function") throw new Error("Dashboard server bundle is invalid.");
  const fetchAsset = assetFetcher(clientRoot);
  const requestedPort = requested.port ? Number(requested.port) : 3000;
  const maxAttempts = requestedPort === 0 ? 1 : Math.max(1, options.maxPortAttempts ?? 10);
  let server: Server | undefined;
  let actualPort = requestedPort;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidatePort = requestedPort === 0 ? 0 : requestedPort + attempt;
    const candidateUrl = new URL(requested);
    candidateUrl.port = String(candidatePort);
    const pending = new Set<Promise<unknown>>();
    const candidate = createServer((req, res) => {
      void (async () => {
        try {
          const request = webRequest(req, candidateUrl.origin);
          const staticResponse = await fetchAsset(request);
          if (staticResponse.status !== 404) {
            await writeResponse(staticResponse, res);
            return;
          }
          const response = await worker.fetch(request, { ASSETS: { fetch: fetchAsset } }, {
            waitUntil(promise) { pending.add(promise); void promise.finally(() => pending.delete(promise)); },
            passThroughOnException() {},
          });
          await writeResponse(response, res);
        } catch (error) {
          if (res.headersSent) { res.destroy(error instanceof Error ? error : undefined); return; }
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("OpenBucket dashboard failed to render.");
        }
      })();
    });
    candidate.keepAliveTimeout = 5_000;
    try {
      actualPort = await listen(candidate, requestedHostname, candidatePort);
      server = candidate;
      break;
    } catch (error) {
      await closeServer(candidate).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === maxAttempts - 1) throw error;
    }
  }
  if (!server) throw new Error("Could not start the local dashboard.");
  const url = new URL(requested);
  url.port = String(actualPort);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  let stopped = false;
  return {
    url: url.toString().replace(/\/$/, ""),
    async stop() {
      if (stopped) return;
      stopped = true;
      await closeServer(server);
    },
  };
}
