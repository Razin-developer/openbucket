import { ArrowRight } from "lucide-react";
import { NodeCard } from "../../components/NodeCard";
import { StatCard } from "../../components/StatCard";
import { summarizeFleet, type AccountNode, type AccountUser, type UsageSummary } from "../../api/account-api";
import { formatBytes, formatNumber } from "../../api/format";
import { Onboarding } from "./Onboarding";

export function AccountOverviewView({ user, nodes, usage, onView, onOpen }: { user: AccountUser; nodes: AccountNode[]; usage: UsageSummary; onView: (id: string) => void; onOpen: (node: AccountNode) => void }) {
  const name = user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0];
  const summary = summarizeFleet(nodes, usage);
  return (
    <>
      <header className="ob-page-heading">
        <div><p className="ob-eyebrow">ACCOUNT CONTROL PLANE</p><h1>Welcome, {name}.</h1><p>Your registered nodes and their last reported storage state.</p></div>
        {nodes.length > 0 ? <button className="ob-button primary" type="button" onClick={() => onOpen(nodes[0])}>Open live node console</button> : null}
      </header>
      <section className="ob-stat-grid" aria-label="Account usage summary">
        <StatCard label="Nodes" value={formatNumber(summary.nodeCount)} detail={`${summary.onlineNodeCount} online`} />
        <StatCard label="Stored" value={formatBytes(summary.storedBytes)} detail={`${formatBytes(summary.capacityBytes)} reported capacity`} />
        <StatCard label="Objects" value={formatNumber(summary.objectCount)} detail={`${formatNumber(summary.bucketCount)} buckets`} />
        <StatCard label="Requests" value={formatNumber(summary.requestCount)} detail={`${formatBytes(summary.bytesIn + summary.bytesOut)} transferred`} />
      </section>
      {nodes.length === 0 ? (
        <Onboarding user={user} />
      ) : (
        <section className="ob-account-section">
          <div className="ob-section-head"><div><p className="ob-eyebrow">NODE FLEET</p><h2>Storage hosts</h2></div><button type="button" onClick={() => onView("nodes")}>View all nodes <ArrowRight size={14} /></button></div>
          <div className="ob-node-grid">{nodes.slice(0, 2).map((node) => <NodeCard node={node} key={node.id} onOpen={onOpen} />)}</div>
        </section>
      )}
      {nodes.length > 0 ? <Onboarding user={user} /> : null}
    </>
  );
}
