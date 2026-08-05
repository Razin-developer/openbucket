import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

const h = React.createElement;

export interface TuiApi {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  version: string;
  home: string;
  env: Record<string, string | undefined>;
}

interface StatusPayload {
  online?: boolean;
  node?: { name?: string; id?: string; uptimeSeconds?: number };
  version?: string;
  storage?: { root?: string; managedBytes?: number; bytes?: number; buckets?: number; objects?: number };
  endpoints?: { management?: string; s3?: string; dashboard?: string; public?: string };
}
interface BucketRow { name: string; public?: boolean; objects?: number; bytes?: number; createdAt?: string }
interface ObjectRow { key: string; size?: number; lastModified?: string; etag?: string }
interface KeyRow { id: string; name?: string; accessKeyId?: string; bucket?: string; readOnly?: boolean; createdAt?: string }
interface LogRow { timestamp?: string; method?: string; path?: string; status?: number; durationMs?: number }

function humanBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
  return `${scaled.toFixed(1)} ${units[index]}`;
}
function humanDuration(seconds: number | undefined): string {
  if (!seconds || seconds < 1) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

// ---- Reusable primitives -------------------------------------------------

function TextField({ label, value, onChange, mask }: { label: string; value: string; onChange: (v: string) => void; mask?: boolean }) {
  useInput((input, key) => {
    if (key.backspace || key.delete) { onChange(value.slice(0, -1)); return; }
    if (key.return || key.upArrow || key.downArrow || key.tab || key.escape) return;
    if (input && !key.ctrl && !key.meta) onChange(value + input);
  });
  const shown = mask ? "•".repeat(value.length) : value;
  return h(Box, null, h(Text, { dimColor: true }, `${label}: `), h(Text, null, shown), h(Text, { color: "cyan" }, "▏"));
}

function Toggle({ label, value }: { label: string; value: boolean }) {
  return h(Text, null, `${label}: `, h(Text, { color: value ? "green" : undefined }, value ? "[x]" : "[ ]"));
}

function StatusBar({ text }: { text: string }) {
  return h(Text, { dimColor: true }, text);
}

// ---- Screens ---------------------------------------------------------

function HomeScreen({ status, onNavigate }: { status: StatusPayload | null; onNavigate: (screen: Screen) => void }) {
  const items: { label: string; screen: Screen; hint: string }[] = [
    { label: "Buckets", screen: { kind: "buckets" }, hint: "List, create, delete, browse objects" },
    { label: "API keys", screen: { kind: "keys" }, hint: "List, create, revoke" },
    { label: "Logs", screen: { kind: "logs" }, hint: "Tail recent requests" },
    { label: "Tunnel", screen: { kind: "tunnel" }, hint: "S3 and management tunnel state" },
    { label: "Server", screen: { kind: "server" }, hint: "Status, start, stop" },
    { label: "Config & environment", screen: { kind: "config" }, hint: "Effective endpoints and variables" },
  ];
  const [selected, setSelected] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setSelected((v) => (v - 1 + items.length) % items.length);
    if (key.downArrow) setSelected((v) => (v + 1) % items.length);
    if (key.return) onNavigate(items[selected].screen);
  });
  const storage = status?.storage ?? {};
  return h(
    Box,
    { flexDirection: "column" },
    h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: status ? "cyan" : "gray", paddingX: 1, marginBottom: 1 },
      status
        ? h(
            Box,
            { flexDirection: "column" },
            h(Text, { color: "green" }, "● Daemon online"),
            h(Text, { dimColor: true }, `Node ${status.node?.name ?? status.node?.id ?? "—"}  ·  v${status.version ?? "—"}  ·  up ${humanDuration(status.node?.uptimeSeconds)}`),
            h(Text, { dimColor: true }, `${storage.buckets ?? 0} bucket(s)  ·  ${storage.objects ?? 0} object(s)  ·  ${humanBytes(storage.managedBytes ?? storage.bytes)} managed`),
          )
        : h(Text, { color: "yellow" }, "○ Connecting to the local daemon…"),
    ),
    h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: "gray", paddingX: 1, marginBottom: 1 },
      ...items.map((item, index) =>
        h(
          Box,
          { key: item.label, justifyContent: "space-between" },
          h(Text, { color: index === selected ? "cyan" : undefined, bold: index === selected }, `${index === selected ? "❯ " : "  "}${item.label}`),
          h(Text, { dimColor: true }, item.hint),
        ),
      ),
    ),
    h(StatusBar, { text: "↑↓ navigate   enter open   q quit" }),
  );
}

function BucketsScreen({ api, onBack, onOpenBucket }: { api: TuiApi; onBack: () => void; onOpenBucket: (name: string) => void }) {
  const [buckets, setBuckets] = useState<BucketRow[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "create" | "confirm-delete">("list");
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [field, setField] = useState<0 | 1>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const payload = await api.request<{ buckets?: BucketRow[] }>("/v1/buckets");
    setBuckets(Array.isArray(payload.buckets) ? payload.buckets : []);
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, not a synchronous setState
  useEffect(() => { void reload(); }, []);

  useInput((input, key) => {
    if (busy) return;
    if (mode === "list") {
      if (key.escape) { onBack(); return; }
      if (!buckets) return;
      if (key.upArrow) setSelected((v) => (v - 1 + Math.max(buckets.length, 1)) % Math.max(buckets.length, 1));
      if (key.downArrow) setSelected((v) => (v + 1) % Math.max(buckets.length, 1));
      if (key.return && buckets[selected]) onOpenBucket(buckets[selected].name);
      if (input === "n") { setMode("create"); setName(""); setIsPublic(false); setField(0); setError(null); }
      if (input === "d" && buckets[selected]) setMode("confirm-delete");
      return;
    }
    if (mode === "create") {
      if (key.escape) { setMode("list"); return; }
      if (key.tab || key.downArrow || key.upArrow) { setField((f) => (f === 0 ? 1 : 0)); return; }
      if (input === " " && field === 1) { setIsPublic((v) => !v); return; }
      if (key.return) {
        if (!name.trim()) { setError("Bucket name is required."); return; }
        setBusy(true);
        api.request("/v1/buckets", { method: "POST", body: JSON.stringify({ name: name.trim(), public: isPublic }) })
          .then(() => { setMode("list"); setBusy(false); void reload(); })
          .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); });
      }
      return;
    }
    if (mode === "confirm-delete") {
      if (input === "y" && buckets?.[selected]) {
        setBusy(true);
        api.request(`/v1/buckets/${encodeURIComponent(buckets[selected].name)}`, { method: "DELETE" })
          .then(() => { setMode("list"); setBusy(false); void reload(); })
          .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); setMode("list"); });
      } else {
        setMode("list");
      }
    }
  });

  if (mode === "create") {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
      h(Text, { bold: true }, "Create bucket"),
      field === 0 ? h(TextField, { label: "Name", value: name, onChange: setName }) : h(Text, { dimColor: true }, `Name: ${name}`),
      field === 1 ? h(Toggle, { label: "Public reads (space to toggle)", value: isPublic }) : h(Toggle, { label: "Public reads", value: isPublic }),
      error ? h(Text, { color: "red" }, error) : null,
      h(StatusBar, { text: "tab switch field   enter create   esc cancel" }),
    );
  }
  if (mode === "confirm-delete" && buckets?.[selected]) {
    return h(Box, { flexDirection: "column", borderStyle: "round", borderColor: "red", paddingX: 1 }, h(Text, { color: "red" }, `Delete bucket "${buckets[selected].name}"? (y/n)`));
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Buckets"),
    !buckets
      ? h(Text, { dimColor: true }, "Loading…")
      : buckets.length === 0
        ? h(Text, { dimColor: true }, "No buckets yet. Press \"n\" to create one.")
        : h(
            Box,
            { flexDirection: "column", marginTop: 1 },
            ...buckets.map((bucket, index) =>
              h(
                Box,
                { key: bucket.name, justifyContent: "space-between" },
                h(Text, { color: index === selected ? "cyan" : undefined, bold: index === selected }, `${index === selected ? "❯ " : "  "}${bucket.name}`),
                h(Text, { dimColor: true }, `${bucket.public ? "public" : "private"}  ${bucket.objects ?? 0} obj  ${humanBytes(bucket.bytes)}`),
              ),
            ),
          ),
    error ? h(Text, { color: "red" }, error) : null,
    h(StatusBar, { text: "↑↓ select   enter open   n new   d delete   esc back" }),
  );
}

function BucketObjectsScreen({ api, bucket, onBack }: { api: TuiApi; bucket: string; onBack: () => void }) {
  const [objects, setObjects] = useState<ObjectRow[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const payload = await api.request<{ objects?: ObjectRow[] }>(`/v1/buckets/${encodeURIComponent(bucket)}/objects`);
    setObjects(Array.isArray(payload.objects) ? payload.objects : []);
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, not a synchronous setState
  useEffect(() => { void reload(); }, [bucket]);

  useInput((input, key) => {
    if (busy) return;
    if (key.escape) { onBack(); return; }
    if (!objects || objects.length === 0) return;
    if (key.upArrow) setSelected((v) => (v - 1 + objects.length) % objects.length);
    if (key.downArrow) setSelected((v) => (v + 1) % objects.length);
    const object = objects[selected];
    if (input === "d" && object) {
      setBusy(true);
      const path = object.key.split("/").map(encodeURIComponent).join("/");
      api.request(`/v1/buckets/${encodeURIComponent(bucket)}/objects/${path}`, { method: "DELETE" })
        .then(() => { setMessage("Object deleted."); setBusy(false); void reload(); })
        .catch((err: unknown) => { setMessage(err instanceof Error ? err.message : String(err)); setBusy(false); });
    }
    if (input === "s" && object) {
      setBusy(true);
      api.request<{ url?: string }>(`/v1/buckets/${encodeURIComponent(bucket)}/share`, { method: "POST", body: JSON.stringify({ key: object.key, expiresIn: 3_600 }) })
        .then((result) => { setMessage(`Share URL (1h): ${result.url ?? "—"}`); setBusy(false); })
        .catch((err: unknown) => { setMessage(err instanceof Error ? err.message : String(err)); setBusy(false); });
    }
  });

  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, `Bucket · ${bucket}`),
    !objects
      ? h(Text, { dimColor: true }, "Loading…")
      : objects.length === 0
        ? h(Text, { dimColor: true }, "This bucket is empty.")
        : h(
            Box,
            { flexDirection: "column", marginTop: 1 },
            ...objects.map((object, index) =>
              h(
                Box,
                { key: object.key, justifyContent: "space-between" },
                h(Text, { color: index === selected ? "cyan" : undefined, bold: index === selected }, `${index === selected ? "❯ " : "  "}${object.key}`),
                h(Text, { dimColor: true }, humanBytes(object.size)),
              ),
            ),
          ),
    message ? h(Text, { color: "yellow" }, message) : null,
    h(StatusBar, { text: "↑↓ select   d delete   s share link (1h)   esc back" }),
  );
}

function KeysScreen({ api, onBack }: { api: TuiApi; onBack: () => void }) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"list" | "create" | "revealed">("list");
  const [name, setName] = useState("");
  const [bucketScope, setBucketScope] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [field, setField] = useState<0 | 1 | 2>(0);
  const [revealed, setRevealed] = useState<{ accessKeyId?: string; secretAccessKey?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const payload = await api.request<{ keys?: KeyRow[] }>("/v1/keys");
    setKeys(Array.isArray(payload.keys) ? payload.keys : []);
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch, not a synchronous setState
  useEffect(() => { void reload(); }, []);

  useInput((input, key) => {
    if (busy) return;
    if (mode === "revealed") { if (key.return || key.escape) setMode("list"); return; }
    if (mode === "list") {
      if (key.escape) { onBack(); return; }
      if (!keys) return;
      if (key.upArrow) setSelected((v) => (v - 1 + Math.max(keys.length, 1)) % Math.max(keys.length, 1));
      if (key.downArrow) setSelected((v) => (v + 1) % Math.max(keys.length, 1));
      if (input === "n") { setMode("create"); setName(""); setBucketScope(""); setReadOnly(false); setField(0); setError(null); }
      if (input === "r" && keys[selected]) {
        setBusy(true);
        api.request(`/v1/keys/${encodeURIComponent(keys[selected].id)}`, { method: "DELETE" })
          .then(() => { setBusy(false); void reload(); })
          .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); });
      }
      return;
    }
    if (mode === "create") {
      if (key.escape) { setMode("list"); return; }
      if (key.tab) { setField((f) => ((f + 1) % 3) as 0 | 1 | 2); return; }
      if (input === " " && field === 2) { setReadOnly((v) => !v); return; }
      if (key.return) {
        setBusy(true);
        api.request<{ key?: KeyRow & { accessKeyId?: string; secretAccessKey?: string } }>("/v1/keys", {
          method: "POST",
          body: JSON.stringify({ name: name.trim() || "API key", readOnly, bucket: bucketScope.trim() || undefined }),
        })
          .then((result) => {
            setRevealed({ accessKeyId: result.key?.accessKeyId, secretAccessKey: (result.key as { secretAccessKey?: string } | undefined)?.secretAccessKey });
            setMode("revealed");
            setBusy(false);
            void reload();
          })
          .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); });
      }
    }
  });

  if (mode === "revealed" && revealed) {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
      h(Text, { bold: true, color: "yellow" }, "Secret is shown once — save it now"),
      h(Text, null, `Access key: ${revealed.accessKeyId ?? "—"}`),
      h(Text, null, `Secret key: ${revealed.secretAccessKey ?? "—"}`),
      h(StatusBar, { text: "enter / esc continue" }),
    );
  }
  if (mode === "create") {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
      h(Text, { bold: true }, "Create API key"),
      field === 0 ? h(TextField, { label: "Name", value: name, onChange: setName }) : h(Text, { dimColor: true }, `Name: ${name || "(default)"}`),
      field === 1 ? h(TextField, { label: "Bucket scope (blank = all)", value: bucketScope, onChange: setBucketScope }) : h(Text, { dimColor: true }, `Bucket scope: ${bucketScope || "all buckets"}`),
      h(Toggle, { label: "Read-only (space to toggle)", value: readOnly }),
      error ? h(Text, { color: "red" }, error) : null,
      h(StatusBar, { text: "tab switch field   enter create   esc cancel" }),
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "API keys"),
    !keys
      ? h(Text, { dimColor: true }, "Loading…")
      : keys.length === 0
        ? h(Text, { dimColor: true }, "No access keys yet. Press \"n\" to create one.")
        : h(
            Box,
            { flexDirection: "column", marginTop: 1 },
            ...keys.map((key, index) =>
              h(
                Box,
                { key: key.id, justifyContent: "space-between" },
                h(Text, { color: index === selected ? "cyan" : undefined, bold: index === selected }, `${index === selected ? "❯ " : "  "}${key.name ?? key.id}`),
                h(Text, { dimColor: true }, `${key.bucket ?? "all buckets"}  ${key.readOnly ? "read-only" : "read/write"}`),
              ),
            ),
          ),
    error ? h(Text, { color: "red" }, error) : null,
    h(StatusBar, { text: "↑↓ select   n new   r revoke   esc back" }),
  );
}

function LogsScreen({ api, onBack }: { api: TuiApi; onBack: () => void }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await api.request<{ logs?: LogRow[] }>("/v1/logs?limit=20");
        if (!cancelled) setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      } catch { /* ignore transient poll errors */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useInput((_input, key) => { if (key.escape) onBack(); });
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Recent requests"),
    logs.length === 0
      ? h(Text, { dimColor: true }, "No requests logged yet.")
      : h(Box, { flexDirection: "column", marginTop: 1 }, ...logs.map((log, index) =>
          h(Text, { key: `${log.timestamp}-${index}`, dimColor: true }, `${String(log.method ?? "—").padEnd(6)} ${String(log.status ?? "—").padStart(3)}  ${log.path ?? ""}`),
        )),
    h(StatusBar, { text: "live · updates every 2s   esc back" }),
  );
}

function TunnelScreen({ status, onBack }: { status: StatusPayload | null; onBack: () => void }) {
  useInput((_input, key) => { if (key.escape) onBack(); });
  const endpoints = status?.endpoints ?? {};
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Tunnel & endpoints"),
    h(Box, { flexDirection: "column", marginTop: 1 },
      h(Text, null, `Management  ${endpoints.management ?? "—"}`),
      h(Text, null, `S3          ${endpoints.s3 ?? "—"}`),
      h(Text, null, `Public      ${endpoints.public ?? "not exposed"}`),
      h(Text, null, `Dashboard   ${endpoints.dashboard ?? "—"}`),
    ),
    h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, "Run \"openbucket tunnel setup\" outside the console for guided Cloudflare connector setup.")),
    h(StatusBar, { text: "esc back" }),
  );
}

function ServerScreen({ api, status, onBack, onExitWithCommand }: { api: TuiApi; status: StatusPayload | null; onBack: () => void; onExitWithCommand: (command: string) => void }) {
  const [mode, setMode] = useState<"idle" | "start-form" | "stopping">("idle");
  const [directory, setDirectory] = useState("");
  const [name, setName] = useState("home-node");
  const [field, setField] = useState<0 | 1>(0);
  const [message, setMessage] = useState<string | null>(null);

  useInput((input, key) => {
    if (mode === "idle") {
      if (key.escape) { onBack(); return; }
      if (input === "s" && status) { setMode("stopping"); void api.request("/v1/stop", { method: "POST", body: "{}" }).then(() => setMessage("Stop requested.")).catch((err: unknown) => setMessage(err instanceof Error ? err.message : String(err))).finally(() => setMode("idle")); }
      if (input === "n" && !status) { setMode("start-form"); setDirectory(""); setField(0); }
      return;
    }
    if (mode === "start-form") {
      if (key.escape) { setMode("idle"); return; }
      if (key.tab) { setField((f) => (f === 0 ? 1 : 0)); return; }
      if (key.return) {
        if (!directory.trim()) { setMessage("Storage directory is required."); return; }
        onExitWithCommand(`openbucket serve ${directory.trim()} --name ${name.trim() || "home-node"} --detach --no-open`);
      }
    }
  });

  if (mode === "start-form") {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
      h(Text, { bold: true }, "Start a node"),
      field === 0 ? h(TextField, { label: "Storage directory", value: directory, onChange: setDirectory }) : h(Text, { dimColor: true }, `Directory: ${directory}`),
      field === 1 ? h(TextField, { label: "Node name", value: name, onChange: setName }) : h(Text, { dimColor: true }, `Name: ${name}`),
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, "This exits the console and runs the equivalent serve command.")),
      h(StatusBar, { text: "tab switch field   enter start   esc cancel" }),
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Server"),
    status
      ? h(Box, { flexDirection: "column", marginTop: 1 }, h(Text, { color: "green" }, "● Running"), h(Text, { dimColor: true }, `Uptime ${humanDuration(status.node?.uptimeSeconds)}`))
      : h(Text, { color: "yellow" }, "○ Not running"),
    message ? h(Text, { color: "yellow" }, message) : null,
    h(StatusBar, { text: status ? "s stop   esc back" : "n start a node   esc back" }),
  );
}

function ConfigScreen({ api, onBack }: { api: TuiApi; onBack: () => void }) {
  useInput((_input, key) => { if (key.escape) onBack(); });
  const relevant = Object.entries(api.env).filter(([key]) => key.startsWith("OPENBUCKET_"));
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { bold: true }, "Config & environment"),
    h(Box, { flexDirection: "column", marginTop: 1 },
      h(Text, null, `CLI home    ${api.home}`),
      h(Text, null, `Version     ${api.version}`),
    ),
    h(Box, { marginTop: 1 }, h(Text, { bold: true }, "OPENBUCKET_* variables in effect")),
    relevant.length === 0
      ? h(Text, { dimColor: true }, "None set.")
      : h(Box, { flexDirection: "column" }, ...relevant.map(([key, value]) =>
          h(Text, { key, dimColor: true }, `${key}=${key.includes("TOKEN") || key.includes("PASSWORD") ? "•".repeat(6) : value}`),
        )),
    h(StatusBar, { text: "esc back" }),
  );
}

// ---- App shell -------------------------------------------------------

type Screen =
  | { kind: "home" }
  | { kind: "buckets" }
  | { kind: "bucket-objects"; bucket: string }
  | { kind: "keys" }
  | { kind: "logs" }
  | { kind: "tunnel" }
  | { kind: "server" }
  | { kind: "config" };

function App({ api, onExitWithCommand }: { api: TuiApi; onExitWithCommand: (command: string | null) => void }) {
  const { exit } = useApp();
  const [stack, setStack] = useState<Screen[]>([{ kind: "home" }]);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const current = stack[stack.length - 1];

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await api.request<StatusPayload>("/v1/status");
        if (!cancelled) setStatus(payload);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 4_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api]);

  useInput((input) => {
    if (current.kind === "home" && input === "q") {
      onExitWithCommand(null);
      exit();
    }
  });

  const push = (screen: Screen) => setStack((s) => [...s, screen]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const exitWithCommand = (command: string) => { onExitWithCommand(command); exit(); };

  const body = useMemo(() => {
    switch (current.kind) {
      case "home":
        return h(HomeScreen, { status, onNavigate: push });
      case "buckets":
        return h(BucketsScreen, { api, onBack: pop, onOpenBucket: (name: string) => push({ kind: "bucket-objects", bucket: name }) });
      case "bucket-objects":
        return h(BucketObjectsScreen, { api, bucket: current.bucket, onBack: pop });
      case "keys":
        return h(KeysScreen, { api, onBack: pop });
      case "logs":
        return h(LogsScreen, { api, onBack: pop });
      case "tunnel":
        return h(TunnelScreen, { status, onBack: pop });
      case "server":
        return h(ServerScreen, { api, status, onBack: pop, onExitWithCommand: exitWithCommand });
      case "config":
        return h(ConfigScreen, { api, onBack: pop });
      default:
        return null;
    }
  }, [current, status]);

  return h(
    Box,
    { flexDirection: "column" },
    h(Box, { marginBottom: 1 }, h(Text, { bold: true, color: "cyan" }, "▲ OpenBucket"), h(Text, { dimColor: true }, `  v${api.version} · interactive console`)),
    body,
  );
}

export function runInteractiveConsole(
  api: TuiApi,
  renderOptions?: Parameters<typeof render>[1],
): Promise<string | null> {
  return new Promise((resolve) => {
    let pendingCommand: string | null = null;
    const instance = render(
      h(App, { api, onExitWithCommand: (command: string | null) => { pendingCommand = command; } }),
      renderOptions,
    );
    void instance.waitUntilExit().then(() => resolve(pendingCommand));
  });
}
