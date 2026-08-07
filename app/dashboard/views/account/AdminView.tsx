import type { AdminOverview } from "../../api/account-api";
import { formatBytes, formatDate, formatNumber } from "../../api/format";
import { StatCard } from "../../components/StatCard";

export function AdminView({ overview }: { overview: AdminOverview }) {
  return (
    <>
      <header className="ob-page-heading">
        <div><p className="ob-eyebrow">AUTHORIZED ADMINISTRATION</p><h1>System overview</h1><p>Global totals returned by the admin-only API.</p></div>
        <span className="ob-generated">Generated {formatDate(overview.generatedAt)}</span>
      </header>
      <section className="ob-stat-grid admin">
        <StatCard label="Users" value={formatNumber(overview.users.total)} detail={`${overview.users.active} active · ${overview.users.disabled} disabled`} />
        <StatCard label="Nodes" value={formatNumber(overview.nodes.total)} detail={`${overview.nodes.online} online · ${overview.nodes.revoked} revoked`} />
        <StatCard label="Stored" value={formatBytes(overview.storage.usedBytes)} detail={`${formatBytes(overview.storage.capacityBytes)} capacity`} />
        <StatCard label="Objects" value={formatNumber(overview.storage.objectCount)} detail={`${formatNumber(overview.storage.bucketCount)} buckets`} />
        <StatCard label="Requests" value={formatNumber(overview.usage.requests)} detail={`${formatNumber(overview.usage.errors)} errors`} />
      </section>
      <section className="ob-admin-note">
        <strong>Read-only overview</strong>
        <p>This page deliberately exposes aggregate operational state only. Account credentials, node bearer tokens, daemon management tokens, and S3 secrets are never returned here.</p>
      </section>
    </>
  );
}
