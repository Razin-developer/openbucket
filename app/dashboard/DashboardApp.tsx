"use client";

import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { DashboardShell } from "./shell/DashboardShell";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";
import { NODE_NAV_ITEMS } from "./shell/nav-config";
import { useNodeConnection, type InitialConnectionHint } from "./hooks/useNodeConnection";
import { useNodeData } from "./hooks/useNodeData";
import { useObjectBrowser } from "./hooks/useObjectBrowser";
import { useToasts } from "./hooks/useToasts";
import { ConnectionModal } from "./components/ConnectionModal";
import { NodeOverviewView } from "./views/node/NodeOverviewView";
import { BucketsView } from "./views/node/BucketsView";
import { KeysView } from "./views/node/KeysView";
import { ConnectionsView } from "./views/node/ConnectionsView";
import { LogsView } from "./views/node/LogsView";
import type { NodeViewContext } from "./views/node/context";

type NodeViewId = "overview" | "buckets" | "keys" | "connections" | "logs";

/**
 * Standalone local dashboard entry — served both by the daemon itself and by the Vercel static
 * build at app/page.tsx. Owns local connection bootstrap (URL params / localStorage / sessionStorage).
 */
export function DashboardApp({ initialConnection }: { initialConnection?: InitialConnectionHint } = {}) {
  const [activeNavId, setActiveNavId] = useState<NodeViewId>("overview");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const { notify } = useToasts();
  const connection = useNodeConnection(initialConnection);
  const data = useNodeData(connection.apiBase, connection.adminToken, connection.connectionGeneration);
  const objectBrowser = useObjectBrowser(data.apiFetch, connection.apiBase, connection.adminToken, notify);

  const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://github.com/Razin-developer/openbucket/tree/main/docs";

  const nodeView: NodeViewContext = {
    apiFetch: data.apiFetch,
    apiBase: connection.apiBase,
    adminToken: connection.adminToken,
    status: data.status,
    loadState: data.loadState,
    lastError: data.lastError,
    lastUpdated: data.lastUpdated,
    buckets: data.buckets,
    keys: data.keys,
    logs: data.logs,
    analytics: data.analytics,
    refresh: data.refresh,
    notify,
    objectBrowser,
    displayUrl: initialConnection?.displayUrl,
    onNavigate: (id) => setActiveNavId(id as NodeViewId),
  };

  function saveConnection(nextApi: string, nextToken: string) {
    connection.saveConnection(
      nextApi, nextToken,
      (message) => notify(message, "error"),
      () => {
        objectBrowser.reset();
        setConnectionOpen(false);
      },
    );
  }

  return (
    <>
      <DashboardShell
        navSections={[{ id: "node", items: NODE_NAV_ITEMS }]}
        activeNavId={activeNavId}
        onNavigate={(id) => setActiveNavId(id as NodeViewId)}
        workspaceSwitcher={
          <WorkspaceSwitcher
            statusDot={data.loadState === "connected" ? "online" : "offline"}
            title={data.status?.nodeName ?? "No node connected"}
            subtitle={data.status?.storageRoot ?? "OpenBucket node"}
            onSettings={() => setConnectionOpen(true)}
          />
        }
        breadcrumbs={<><span>OpenBucket</span><b>/</b><strong>{NODE_NAV_ITEMS.find((item) => item.id === activeNavId)?.label}</strong></>}
        topbarActions={<>
          <span className="ob-last-updated">{data.lastUpdated ? `Updated ${data.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not connected"}</span>
          <button className="ob-icon-button" type="button" aria-label="Refresh data" onClick={() => void data.refresh()}><RefreshCw size={15} /></button>
          <a className="ob-docs-link" href={docsUrl} target="_blank" rel="noreferrer">Docs <ExternalLink size={13} /></a>
        </>}
      >
        {activeNavId === "overview" ? <NodeOverviewView node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} /> : null}
        {activeNavId === "buckets" ? <BucketsView node={nodeView} /> : null}
        {activeNavId === "keys" ? <KeysView node={nodeView} /> : null}
        {activeNavId === "connections" ? <ConnectionsView node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} /> : null}
        {activeNavId === "logs" ? <LogsView node={nodeView} /> : null}
      </DashboardShell>
      {connectionOpen ? <ConnectionModal apiBase={connection.apiBase} adminToken={connection.adminToken} onSave={saveConnection} onClose={() => setConnectionOpen(false)} /> : null}
    </>
  );
}
