import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, RefreshCw, Settings as SettingsIcon, UserRound } from "lucide-react";
import { DashboardShell } from "./shell/DashboardShell";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";
import { ACCOUNT_ADMIN_NAV_ITEMS, ACCOUNT_NAV_ITEMS, NODE_NAV_ITEMS } from "./shell/nav-config";
import { useAccountData } from "./hooks/useAccountData";
import { useNodeData } from "./hooks/useNodeData";
import { useObjectBrowser } from "./hooks/useObjectBrowser";
import { useToasts } from "./hooks/useToasts";
import { controlPlaneApi, nodeApiUrl, type AccountNode, type AccountUser } from "./api/account-api";
import type { NavSection } from "./api/types";
import { AccountOverviewView } from "./views/account/AccountOverviewView";
import { NodesView } from "./views/account/NodesView";
import { UsageView } from "./views/account/UsageView";
import { AccountProfileView } from "./views/account/AccountProfileView";
import { AdminView } from "./views/account/AdminView";
import { SupportView } from "./views/account/SupportView";
import { NodeOverviewView } from "./views/node/NodeOverviewView";
import { BucketsView } from "./views/node/BucketsView";
import { KeysView } from "./views/node/KeysView";
import { ConnectionsView } from "./views/node/ConnectionsView";
import { LogsView } from "./views/node/LogsView";
import { SettingsView } from "./views/settings/SettingsView";
import type { NodeViewContext } from "./views/node/context";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

type AccountNavId = "account-overview" | "nodes" | "usage" | "account" | "admin" | "support" | "settings";
type NodeNavId = "overview" | "buckets" | "keys" | "connections" | "logs" | "settings";

const NODE_NAME_PATH = /^\/dashboard\/nodes\/([a-z0-9][a-z0-9-]{1,47})$/;

/**
 * Hosted account-level dashboard entry. Mounts the exact same DashboardShell/node-views used by
 * the standalone app — selecting a node only swaps activeNavId + the node data hooks, never the
 * shell itself, which is what replaces the old LiveNodeConsole full-page-shell-swap.
 */
export function HostedDashboard({ user, onLogout }: { user: AccountUser; onLogout: () => void }) {
  const account = useAccountData(user);
  const { notify } = useToasts();
  const [selectedNode, setSelectedNode] = useState<AccountNode | null>(null);
  const [accountNavId, setAccountNavId] = useState<AccountNavId>("account-overview");
  const [nodeNavId, setNodeNavId] = useState<NodeNavId>("overview");
  const [nodeConnection, setNodeConnection] = useState<{ apiBase: string; token: string } | null>(null);
  const [nodeConnectError, setNodeConnectError] = useState("");
  const nodeGeneration = useRef(0);

  useEffect(() => {
    nodeGeneration.current += 1;
    const generation = nodeGeneration.current;
    const timer = window.setTimeout(() => {
      setNodeConnection(null);
      setNodeConnectError("");
      if (!selectedNode) return;
      void controlPlaneApi.managementSession(selectedNode.id)
        .then((value) => { if (generation === nodeGeneration.current) setNodeConnection({ apiBase: value.managementUrl, token: value.token }); })
        .catch((reason: unknown) => { if (generation === nodeGeneration.current) setNodeConnectError(reason instanceof Error ? reason.message : "Node management is unavailable."); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedNode]);

  const nodeData = useNodeData(nodeConnection?.apiBase ?? "", nodeConnection?.token ?? "", nodeGeneration, Boolean(nodeConnection));
  const objectBrowser = useObjectBrowser(nodeData.apiFetch, nodeConnection?.apiBase ?? "", nodeConnection?.token ?? "", notify);

  // Preserve the old /dashboard/nodes/:name deep-link auto-open, now driving selectedNode instead of `view`.
  useEffect(() => {
    if (!account.nodes) return;
    const match = NODE_NAME_PATH.exec(window.location.pathname);
    const requested = match?.[1];
    const node = requested ? account.nodes.find((item) => item.name === requested) : undefined;
    if (node) {
      const timer = window.setTimeout(() => { setSelectedNode(node); setNodeNavId("overview"); }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [account.nodes]);

  const openNode = useCallback((node: AccountNode) => {
    setSelectedNode(node);
    setNodeNavId("overview");
    window.history.pushState({}, "", `/dashboard/nodes/${encodeURIComponent(node.name)}`);
  }, []);
  const backToAccount = useCallback(() => {
    setSelectedNode(null);
    setAccountNavId("account-overview");
    window.history.pushState({}, "", "/dashboard");
  }, []);

  const navSections: NavSection[] = useMemo(() => {
    const sections: NavSection[] = [{
      id: "account",
      label: "Account",
      items: user.role === "admin" ? [...ACCOUNT_NAV_ITEMS, ...ACCOUNT_ADMIN_NAV_ITEMS] : ACCOUNT_NAV_ITEMS,
    }];
    if (selectedNode) sections.push({ id: "node", label: selectedNode.name, items: NODE_NAV_ITEMS });
    return sections;
  }, [selectedNode, user.role]);

  const activeNavId = selectedNode ? nodeNavId : accountNavId;

  function onNavigate(id: string) {
    if ((NODE_NAV_ITEMS as { id: string }[]).some((item) => item.id === id)) {
      if (!selectedNode) return;
      setNodeNavId(id as NodeNavId);
    } else {
      setAccountNavId(id as AccountNavId);
      // Leaving the node section back to account nav intentionally keeps selectedNode so the
      // node tab stays available; explicit "back" (openNode's counterpart) is backToAccount().
    }
  }

  const nodeView: NodeViewContext | null = selectedNode ? {
    apiFetch: nodeData.apiFetch,
    apiBase: nodeConnection?.apiBase ?? "",
    adminToken: nodeConnection?.token ?? "",
    status: nodeData.status,
    loadState: nodeConnection ? nodeData.loadState : "loading",
    lastError: nodeConnectError || nodeData.lastError,
    lastUpdated: nodeData.lastUpdated,
    buckets: nodeData.buckets,
    keys: nodeData.keys,
    logs: nodeData.logs,
    analytics: nodeData.analytics,
    refresh: nodeData.refresh,
    notify,
    objectBrowser,
    displayUrl: nodeApiUrl(selectedNode),
    onNavigate: (id) => setNodeNavId(id as NodeNavId),
  } : null;

  const breadcrumbLabel = selectedNode
    ? NODE_NAV_ITEMS.find((item) => item.id === nodeNavId)?.label
    : [...ACCOUNT_NAV_ITEMS, ...ACCOUNT_ADMIN_NAV_ITEMS].find((item) => item.id === accountNavId)?.label;

  const inBucketObjectList = selectedNode && nodeNavId === "buckets" && objectBrowser.selectedBucket;
  const breadcrumbs = [
    { label: "Home", onClick: selectedNode ? backToAccount : undefined },
    ...(selectedNode ? [{ label: selectedNode.name, onClick: inBucketObjectList ? () => { objectBrowser.setSelectedBucket(null); objectBrowser.setObjects([]); setNodeNavId("buckets"); } : undefined }] : []),
    { label: breadcrumbLabel ?? "", onClick: inBucketObjectList ? () => { objectBrowser.setSelectedBucket(null); objectBrowser.setObjects([]); } : undefined },
    ...(inBucketObjectList ? [{ label: objectBrowser.selectedBucket! }] : []),
  ];

  return (
    <>
      <DashboardShell
        navSections={navSections}
        activeNavId={activeNavId}
        onNavigate={onNavigate}
        workspaceSwitcher={
          <WorkspaceSwitcher title={user.name || user.email} subtitle="Cloud workspace">
            <Select
              value={selectedNode?.id || "__account__"}
              onValueChange={(value) => {
                const node = account.nodes?.find((item) => item.id === value);
                if (node) openNode(node); else backToAccount();
              }}
            >
              <SelectTrigger className="ob-node-select w-full">
                <SelectValue placeholder="Account overview" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__account__">Account overview</SelectItem>
                {(account.nodes ?? []).map((node) => <SelectItem key={node.id} value={node.id}>{node.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </WorkspaceSwitcher>
        }
        sidebarFooter={<button className="ob-text-button" type="button" onClick={onLogout}>Sign out</button>}
        breadcrumbs={breadcrumbs}
        topbarActions={
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="ob-icon-button" type="button" aria-label="Refresh account data" disabled={account.refreshing} onClick={() => void account.load(true)}><RefreshCw size={15} className={account.refreshing ? "is-spinning" : undefined} /></button>
            </TooltipTrigger>
            <TooltipContent>Refresh account data</TooltipContent>
          </Tooltip>
        }
        avatarStack={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ob-avatar-button" type="button" aria-label="Account menu">
                <Avatar size="sm" className="size-8">
                  <AvatarFallback className="bg-transparent text-white">{(user.name || user.email)[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => { setSelectedNode(null); setAccountNavId("account"); }}>
                <UserRound size={14} /> Account overview
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setSelectedNode(null); setAccountNavId("settings"); }}>
                <SettingsIcon size={14} /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onLogout}>
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {account.error ? (
          <Alert variant="destructive">
            <AlertTitle>Account data unavailable</AlertTitle>
            <AlertDescription>
              <p>{account.error}</p>
              <Button size="sm" variant="outline" onClick={() => void account.load(true)}>Try again</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!account.error && (!account.nodes || !account.usage) ? <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>Loading account data…</p></div> : null}
        {!account.error && account.nodes && account.usage && !selectedNode && accountNavId === "account-overview" ? <AccountOverviewView user={user} nodes={account.nodes} usage={account.usage} onView={(id) => setAccountNavId(id as AccountNavId)} onOpen={openNode} /> : null}
        {!account.error && account.nodes && !selectedNode && accountNavId === "nodes" ? <NodesView user={user} nodes={account.nodes} onOpen={openNode} /> : null}
        {!account.error && account.nodes && account.usage && !selectedNode && accountNavId === "usage" ? <UsageView usage={account.usage} nodes={account.nodes} /> : null}
        {!account.error && !selectedNode && accountNavId === "account" ? <AccountProfileView user={user} /> : null}
        {!account.error && !selectedNode && accountNavId === "settings" ? <SettingsView context="account" user={user} /> : null}
        {!account.error && !selectedNode && accountNavId === "admin" && user.role === "admin" && account.admin ? <AdminView overview={account.admin} /> : null}
        {!account.error && !selectedNode && accountNavId === "admin" && user.role === "admin" && !account.admin ? <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>Loading authorized overview…</p></div> : null}
        {!account.error && !selectedNode && accountNavId === "support" && user.role === "admin" ? <SupportView /> : null}

        {selectedNode && nodeView ? (
          nodeConnection ? (
            <>
              {nodeNavId === "overview" ? <NodeOverviewView node={nodeView} onOpenConnectionSettings={() => {}} /> : null}
              {nodeNavId === "buckets" ? <BucketsView node={nodeView} /> : null}
              {nodeNavId === "keys" ? <KeysView node={nodeView} /> : null}
              {nodeNavId === "connections" ? <ConnectionsView node={nodeView} onOpenConnectionSettings={() => {}} /> : null}
              {nodeNavId === "logs" ? <LogsView node={nodeView} /> : null}
              {nodeNavId === "settings" ? <SettingsView context="node" node={nodeView} onOpenConnectionSettings={() => {}} /> : null}
            </>
          ) : (
            <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>{nodeConnectError || `Connecting securely to ${selectedNode.name}…`}</p></div>
          )
        ) : null}
      </DashboardShell>
    </>
  );
}
