/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
import { SiteShell } from "./site-shell";
import "./node-discovery.css";

type Discovery = {
  nodeName: string;
  online: boolean;
  tunnelMode: "quick" | "managed" | "unavailable";
  s3Endpoint: string | null;
  canonicalPath: string;
  futureHostname: string;
};

type DiscoveryState = { kind: "loading" } | { kind: "ready"; value: Discovery } | { kind: "error"; message: string };

function CopyDiscovery({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_400); }}>{copied ? "Copied" : label}</button>;
}

export function NodeDiscoveryPage({ nodeName, handle }: { nodeName: string; handle?: string }) {
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ name: nodeName });
      if (handle) query.set("handle", handle);
      void fetch(`/api/nodes/resolve?${query}`, { headers: { accept: "application/json" }, signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as Discovery & { error?: { message?: string } };
          if (!response.ok) throw new Error(payload.error?.message || "This node could not be discovered.");
          setState({ kind: "ready", value: payload });
        })
        .catch((error: unknown) => { if (!controller.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "This node could not be discovered." }); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [nodeName, handle]);

  return <SiteShell compact><main className="discovery-page">
    {state.kind === "loading" ? <section className="discovery-state" aria-live="polite"><span className="discovery-spinner" /><p>Looking up <strong>{nodeName}</strong>…</p></section> : null}
    {state.kind === "error" ? <section className="discovery-state error"><p className="section-kicker">NODE DISCOVERY</p><h1>Node unavailable.</h1><p>{state.message}</p><div><a className="site-button dark" href="/">OpenBucket home</a><a className="site-button light" href="/docs">Read the docs</a></div></section> : null}
    {state.kind === "ready" ? <>
      <header className="discovery-hero"><p className="section-kicker">PUBLIC NODE DISCOVERY</p><div className={`discovery-status ${state.value.online ? "online" : "offline"}`}><i />{state.value.online ? "Node heartbeat online" : "Node currently offline"}</div><h1>{state.value.nodeName}</h1><p>This page publishes connection metadata reported by the node owner. It does not proxy S3 requests, redirect traffic, or move object bytes through OpenBucket&apos;s website.</p></header>
      <section className="discovery-card">
        <div><span>Canonical discovery page</span><code>{state.value.canonicalPath}</code><CopyDiscovery value={state.value.canonicalPath} label="Copy" /></div>
        <div><span>Planned stable hostname</span><code>{state.value.futureHostname}</code><CopyDiscovery value={state.value.futureHostname} label="Copy" /></div>
        <div className={state.value.online ? "available" : "unavailable"}><span>OpenBucket API</span><code>{new URL(state.value.canonicalPath, window.location.origin).toString()}</code><CopyDiscovery value={new URL(state.value.canonicalPath, window.location.origin).toString()} label="Copy API URL" /></div>
      </section>
      <section className="discovery-notice"><strong>{state.value.online ? "Node services are available." : "Node currently offline."}</strong><p>OpenBucket keeps transport addresses private. Sign in as the owner to open the live console and manage this node.</p></section>
    </> : null}
  </main></SiteShell>;
}
