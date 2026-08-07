import { summarizeFleet, type AccountNode, type UsageSummary } from "../../api/account-api";
import { formatBytes, formatDate, formatNumber } from "../../api/format";
import { StatCard } from "../../components/StatCard";

export function UsageView({ usage, nodes }: { usage: UsageSummary; nodes: AccountNode[] }) {
  const summary = summarizeFleet(nodes, usage);
  const usedPercent = summary.capacityBytes > 0 ? Math.min(100, (summary.storedBytes / summary.capacityBytes) * 100) : 0;
  return (
    <>
      <header className="ob-page-heading"><div><p className="ob-eyebrow">ACCOUNT TOTALS</p><h1>Usage</h1><p>Real request totals from {formatDate(usage.from)} through {formatDate(usage.to)}.</p></div></header>
      <section className="ob-usage-layout">
        <article className="ob-capacity-panel ob-usage-capacity">
          <div className="ob-capacity-ring" style={{ "--ob-capacity": `${usedPercent * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{usedPercent.toFixed(usedPercent >= 10 ? 0 : 1)}%</strong><span>reported used</span></div>
          </div>
          <dl>
            <div><dt>Stored</dt><dd>{formatBytes(summary.storedBytes)}</dd></div>
            <div><dt>Capacity</dt><dd>{formatBytes(summary.capacityBytes)}</dd></div>
            <div><dt>Last heartbeat</dt><dd>{formatDate(summary.lastSeenAt)}</dd></div>
          </dl>
        </article>
        <div className="ob-stat-grid ob-usage-grid">
          <StatCard label="Buckets" value={formatNumber(summary.bucketCount)} />
          <StatCard label="Objects" value={formatNumber(summary.objectCount)} />
          <StatCard label="Uploaded" value={formatBytes(usage.totals.bytesIn)} />
          <StatCard label="Downloaded" value={formatBytes(usage.totals.bytesOut)} />
          <StatCard label="Requests" value={formatNumber(usage.totals.requests)} detail={`${formatNumber(usage.totals.errors)} errors`} />
          <StatCard label="Online nodes" value={formatNumber(summary.onlineNodeCount)} detail={`${summary.nodeCount} registered`} />
        </div>
      </section>
      <section className="ob-series">
        <h2>Requests over time</h2>
        {usage.series.length ? (
          <div className="ob-series-table" role="table" aria-label="Request usage by interval">
            {usage.series.map((point) => (
              <div role="row" key={point.start}>
                <time role="cell" dateTime={point.start}>{formatDate(point.start)}</time>
                <span role="cell">{formatNumber(point.requests)} requests</span>
                <span role="cell">{formatBytes(point.bytesIn + point.bytesOut)}</span>
                <span role="cell">{formatNumber(point.errors)} errors</span>
              </div>
            ))}
          </div>
        ) : <p>No requests were recorded in this interval.</p>}
      </section>
    </>
  );
}
