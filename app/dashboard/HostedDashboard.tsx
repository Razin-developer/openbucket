import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { LogOut, RefreshCw, Settings as SettingsIcon, UserRound } from "lucide-react";
import { DashboardShell } from "./shell/DashboardShell";
import { WorkspaceSwitcher } from "./shell/WorkspaceSwitcher";
import { ACCOUNT_ADMIN_NAV_ITEMS, ACCOUNT_NAV_ITEMS, NODE_NAV_ITEMS } from "./shell/nav-config";
import {
  accountViewFromPath, accountViewPath, hostedNodeBasePath, hostedNodeNameFromPath,
  nodeViewFromPath, nodeViewPath, type AccountViewId, type NodeViewId,
} from "./shell/paths";
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

/**
 * Hosted account-level dashboard entry. Mounts the exact same DashboardShell/node-views used by
 * the standalone app — selecting a node only swaps the routed content + the node data hooks, never
 * the shell itself, which is what replaces the old LiveNodeConsole full-page-shell-swap.
 *
 * Route-based (react-router-dom): the URL is the single source of truth for both which node (if
 * any) is selected and which section is active — no separate useState flags to desync from it, and
 * no popstate handling to hand-roll. This is also what fixes the two previously-reported bugs: every
 * nav destination is a real, unambiguous path (no id shared between the node and account nav arrays
 * being checked against the wrong one), and clicking any account-section link while a node is open is
 * a genuine route change instead of a state update guarded by a stale "no node selected" check.
 */
export function HostedDashboard(props: { user: AccountUser; onLogout: () => void }) {
  return (
    <BrowserRouter>
      <HostedDashboardInner {...props} />
    </BrowserRouter>
  );
}

function HostedDashboardInner({ user, onLogout }: { user: AccountUser; onLogout: () => void }) {
  const account = useAccountData(user);
  const { notify } = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const nodeName = hostedNodeNameFromPath(location.pathname);
  const selectedNode = nodeName ? (account.nodes?.find((item) => item.name === nodeName) ?? null) : null;
  const nodeBasePath = selectedNode ? hostedNodeBasePath(selectedNode.name) : null;
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

  const openNode = (node: AccountNode) => navigate(hostedNodeBasePath(node.name));
  const backToAccount = () => navigate("/dashboard");

  const navSections: NavSection[] = useMemo(() => {
    // Every item's id IS its resolved path (not a bare label like "settings"), not just a lookup
    // key — this is what makes clicks unambiguous. The old bare-id scheme had "settings" defined
    // in both the account and node nav arrays; a single onNavigate(id) had to guess which one was
    // meant and got it wrong whenever a node was open (this broke both the sidebar and the Ctrl+K
    // command palette, which both ultimately just call onNavigate(item.id)).
    const accountItems = (user.role === "admin" ? [...ACCOUNT_NAV_ITEMS, ...ACCOUNT_ADMIN_NAV_ITEMS] : ACCOUNT_NAV_ITEMS)
      .map((item) => ({ ...item, id: accountViewPath(item.id as AccountViewId) }));
    const sections: NavSection[] = [{ id: "account", label: "Account", items: accountItems }];
    if (selectedNode && nodeBasePath) {
      const nodeItems = NODE_NAV_ITEMS.map((item) => ({ ...item, id: nodeViewPath(nodeBasePath, item.id as NodeViewId) }));
      sections.push({ id: "node", label: selectedNode.name, items: nodeItems });
    }
    return sections;
  }, [selectedNode, nodeBasePath, user.role]);

  const nodeNavId: NodeViewId = nodeBasePath ? nodeViewFromPath(nodeBasePath, location.pathname) : "overview";
  const accountNavId: AccountViewId = accountViewFromPath(location.pathname);
  // Matches navSections' item ids above (full paths), so Sidebar's `activeNavId === item.id`
  // highlight and the command palette both resolve to the exact same, unambiguous destination.
  const activeNavId = selectedNode && nodeBasePath ? nodeViewPath(nodeBasePath, nodeNavId) : accountViewPath(accountNavId);

  function onNavigate(id: string) {
    navigate(id);
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
    onNavigate: (id) => navigate(nodeViewPath(nodeBasePath!, id as NodeViewId)),
    basePath: nodeBasePath ?? "",
  } : null;

  const breadcrumbLabel = selectedNode
    ? NODE_NAV_ITEMS.find((item) => item.id === nodeNavId)?.label
    : [...ACCOUNT_NAV_ITEMS, ...ACCOUNT_ADMIN_NAV_ITEMS].find((item) => item.id === accountNavId)?.label;

  const inBucketObjectList = selectedNode && nodeNavId === "buckets" && objectBrowser.selectedBucket;
  const breadcrumbs = [
    { label: "Home", onClick: selectedNode ? backToAccount : undefined },
    ...(selectedNode ? [{ label: selectedNode.name, onClick: inBucketObjectList ? () => navigate(nodeViewPath(nodeBasePath!, "buckets")) : undefined }] : []),
    { label: breadcrumbLabel ?? "", onClick: inBucketObjectList ? () => navigate(nodeViewPath(nodeBasePath!, "buckets")) : undefined },
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
              <DropdownMenuItem onSelect={() => navigate(accountViewPath("account"))}>
                <UserRound size={14} /> Account overview
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(accountViewPath("settings"))}>
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
        {!account.error && account.nodes && account.usage && !selectedNode && accountNavId === "account-overview" ? <AccountOverviewView user={user} nodes={account.nodes} usage={account.usage} onView={(id) => navigate(accountViewPath(id as AccountViewId))} onOpen={openNode} /> : null}
        {!account.error && account.nodes && !selectedNode && accountNavId === "nodes" ? <NodesView user={user} nodes={account.nodes} onOpen={openNode} /> : null}
        {!account.error && account.nodes && account.usage && !selectedNode && accountNavId === "usage" ? <UsageView usage={account.usage} nodes={account.nodes} /> : null}
        {!account.error && !selectedNode && accountNavId === "account" ? <AccountProfileView user={user} /> : null}
        {!account.error && !selectedNode && accountNavId === "settings" ? <SettingsView context="account" user={user} /> : null}
        {!account.error && !selectedNode && accountNavId === "admin" && user.role === "admin" && account.admin ? <AdminView overview={account.admin} /> : null}
        {!account.error && !selectedNode && accountNavId === "admin" && user.role === "admin" && !account.admin ? <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>Loading authorized overview…</p></div> : null}
        {!account.error && !selectedNode && accountNavId === "support" && user.role === "admin" ? <SupportView /> : null}

        {selectedNode && nodeView && nodeBasePath ? (
          nodeConnection ? (
            // Real <Routes> here (not the bare nodeNavId conditional the account views above use)
            // because BucketsView needs router-matched :bucket/* params for folder drill-down —
            // paths are built from the already-resolved nodeBasePath string, not a :nodeName param.
            <Routes>
              <Route path={nodeBasePath} element={<NodeOverviewView node={nodeView} onOpenConnectionSettings={() => {}} />} />
              <Route path={`${nodeBasePath}/buckets`} element={<BucketsView node={nodeView} />} />
              <Route path={`${nodeBasePath}/buckets/:bucket/*`} element={<BucketsView node={nodeView} />} />
              <Route path={`${nodeBasePath}/keys`} element={<KeysView node={nodeView} />} />
              <Route path={`${nodeBasePath}/connections`} element={<ConnectionsView node={nodeView} onOpenConnectionSettings={() => {}} />} />
              <Route path={`${nodeBasePath}/logs`} element={<LogsView node={nodeView} />} />
              <Route path={`${nodeBasePath}/settings`} element={<SettingsView context="node" node={nodeView} onOpenConnectionSettings={() => {}} />} />
              <Route path="*" element={<NodeOverviewView node={nodeView} onOpenConnectionSettings={() => {}} />} />
            </Routes>
          ) : (
            <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>{nodeConnectError || `Connecting securely to ${selectedNode.name}…`}</p></div>
          )
        ) : null}
      </DashboardShell>
    </>
  );
}
