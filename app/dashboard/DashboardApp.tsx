"use client";

import { useState, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, StaticRouter, useLocation, useNavigate } from "react-router-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { DashboardShell } from "./shell/DashboardShell";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";
import { NODE_NAV_ITEMS } from "./shell/nav-config";
import { nodeViewFromPath, nodeViewPath, type NodeViewId } from "./shell/paths";
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
import { SettingsView } from "./views/settings/SettingsView";
import type { NodeViewContext } from "./views/node/context";

/**
 * Standalone local dashboard entry — served both by the daemon itself and by the Vercel static
 * build at app/[[...slug]]/page.tsx. Owns local connection bootstrap (URL params / localStorage / sessionStorage).
 * Route-based (react-router-dom BrowserRouter): each section is a real, deep-linkable URL, served
 * for every path via the vinext optional catch-all at app/[[...slug]]/page.tsx.
 */
export function DashboardApp(props: { initialConnection?: InitialConnectionHint } = {}) {
  return (
    <IsomorphicRouter>
      <DashboardAppInner {...props} />
    </IsomorphicRouter>
  );
}

/**
 * BrowserRouter calls createBrowserHistory(), which touches `document` — fine in the browser, but
 * this component is still server-rendered once for the initial HTML shell (vinext SSRs "use client"
 * components too). StaticRouter renders the same tree without touching any DOM global; the client
 * then hydrates into a real BrowserRouter and takes over from the actual URL.
 */
function IsomorphicRouter({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <StaticRouter location="/">{children}</StaticRouter>;
  return <BrowserRouter>{children}</BrowserRouter>;
}

function DashboardAppInner({ initialConnection }: { initialConnection?: InitialConnectionHint }) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeNavId: NodeViewId = nodeViewFromPath("", location.pathname);
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
    // initialConnection.displayUrl is only ever set by a hosted launch hint; for the standalone
    // local dashboard (the only real caller — see app/[[...slug]]/page.tsx) it's always undefined,
    // which used to make ConnectionsView fall back to window.location.origin — the DASHBOARD's own
    // URL, not the management API's. connection.apiBase is the actual, correct local API URL.
    displayUrl: initialConnection?.displayUrl ?? connection.apiBase,
    s3DisplayUrl: data.status?.endpoints?.s3,
    onNavigate: (id) => navigate(nodeViewPath("", id as NodeViewId)),
    basePath: "",
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
        onNavigate={(id) => navigate(nodeViewPath("", id as NodeViewId))}
        workspaceSwitcher={
          <WorkspaceSwitcher
            statusDot={data.loadState === "connected" ? "online" : "offline"}
            title={data.status?.nodeName ?? "No node connected"}
            subtitle={data.status?.storageRoot ?? "OpenBucket node"}
            onSettings={() => setConnectionOpen(true)}
          />
        }
        breadcrumbs={[
          { label: data.status?.nodeName ?? "OpenBucket" },
          { label: NODE_NAV_ITEMS.find((item) => item.id === activeNavId)?.label ?? "", onClick: activeNavId === "buckets" && objectBrowser.selectedBucket ? () => navigate(nodeViewPath("", "buckets")) : undefined },
          ...(activeNavId === "buckets" && objectBrowser.selectedBucket ? [{ label: objectBrowser.selectedBucket }] : []),
        ]}
        topbarActions={<>
          <span className="ob-last-updated">{data.lastUpdated ? `Updated ${data.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Not connected"}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="ob-icon-button" type="button" aria-label="Refresh data" onClick={() => void data.refresh()}><RefreshCw size={15} /></button>
            </TooltipTrigger>
            <TooltipContent>Refresh data</TooltipContent>
          </Tooltip>
          <a className="ob-docs-link" href={docsUrl} target="_blank" rel="noreferrer">Docs <ExternalLink size={13} /></a>
        </>}
      >
        <Routes>
          <Route path="/" element={<NodeOverviewView node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} />} />
          <Route path="/buckets" element={<BucketsView node={nodeView} />} />
          <Route path="/buckets/:bucket/*" element={<BucketsView node={nodeView} />} />
          <Route path="/keys" element={<KeysView node={nodeView} />} />
          <Route path="/connections" element={<ConnectionsView node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} />} />
          <Route path="/logs" element={<LogsView node={nodeView} />} />
          <Route path="/settings" element={<SettingsView context="node" node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} />} />
          <Route path="*" element={<NodeOverviewView node={nodeView} onOpenConnectionSettings={() => setConnectionOpen(true)} />} />
        </Routes>
      </DashboardShell>
      {connectionOpen ? <ConnectionModal apiBase={connection.apiBase} adminToken={connection.adminToken} onSave={saveConnection} onClose={() => setConnectionOpen(false)} /> : null}
    </>
  );
}
