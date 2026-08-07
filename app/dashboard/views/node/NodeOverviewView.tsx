import { ArrowRight } from "lucide-react";
import { CopyButton } from "../../components/CopyButton";
import { formatBytes, formatDuration, formatNumber } from "../../api/format";
import { StatCard } from "../../components/StatCard";
import type { NodeViewContext } from "./context";

export function NodeOverviewView({ node, onOpenConnectionSettings }: { node: NodeViewContext; onOpenConnectionSettings: () => void }) {
  const { status, loadState, lastError, analytics, refresh, onNavigate } = node;
  const capacityPercent = status?.capacityBytes ? Math.min(100, (status.filesystemUsedBytes / status.capacityBytes) * 100) : 0;
  const endpoint = "${OPENBUCKET_S3_ENDPOINT}";

  return (
    <>
      <section className="ob-hero">
        <div className="ob-hero-copy">
          <p className="ob-eyebrow">Local storage node</p>
          <div className="ob-hero-status-row">
            <span className={`ob-status-dot ${loadState === "connected" ? "online" : "offline"}`} aria-hidden="true" />
            <span>{loadState === "connected" ? "Online" : loadState === "loading" ? "Connecting" : "Offline"}</span>
          </div>
          <h1>{status?.nodeName || "Connect your first disk."}</h1>
          <p className="ob-hero-lead">{status?.storageRoot ? `${status.storageRoot} is serving real objects through an S3-compatible endpoint.` : "Run one command to turn a folder, SSD, USB drive, or NAS mount into object storage."}</p>
          <div className="ob-hero-actions">
            <button className="ob-button primary" type="button" onClick={() => onNavigate(status ? "buckets" : "connections")}>{status ? "Manage buckets" : "Connect daemon"}</button>
            <button className="ob-button secondary" type="button" onClick={() => onNavigate("connections")}>View endpoints</button>
          </div>
        </div>
        <div className="ob-capacity-panel">
          <div className="ob-capacity-ring" style={{ "--ob-capacity": `${capacityPercent * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{capacityPercent.toFixed(capacityPercent >= 10 ? 0 : 1)}%</strong><span>disk used</span></div>
          </div>
          <dl>
            <div><dt>Managed</dt><dd>{formatBytes(status?.usedBytes ?? 0)}</dd></div>
            <div><dt>Available</dt><dd>{formatBytes(status?.availableBytes ?? 0)}</dd></div>
            <div><dt>Capacity</dt><dd>{formatBytes(status?.capacityBytes ?? 0)}</dd></div>
          </dl>
        </div>
      </section>
      {loadState === "disconnected" ? (
        <section className="ob-connection-alert" role="alert">
          <div><p className="ob-eyebrow">Daemon not reachable</p><h2>Your files stay untouched until you connect.</h2><p>{lastError}. Start a node, then refresh this page.</p></div>
          <div className="ob-command-row"><code>openbucket serve D:\OpenBucket</code><CopyButton value="openbucket serve D:\OpenBucket" /></div>
          <div className="ob-alert-actions">
            <button className="ob-button primary compact" type="button" onClick={() => void refresh()}>Try again</button>
            <button className="ob-button secondary compact" type="button" onClick={onOpenConnectionSettings}>Change API URL</button>
          </div>
        </section>
      ) : null}
      <section className="ob-stat-grid" aria-label="Node metrics">
        <StatCard label="Buckets" value={formatNumber(status?.bucketCount ?? 0)} detail="Mapped to real directories" />
        <StatCard label="Objects" value={formatNumber(status?.objectCount ?? 0)} detail={formatBytes(status?.usedBytes ?? 0)} />
        <StatCard label="Requests today" value={formatNumber(status?.requestsToday ?? 0)} detail={`${formatNumber(analytics.requests)} all time`} />
        <StatCard label="Uptime" value={formatDuration(status?.uptimeSeconds ?? 0)} detail={status?.version ? `OpenBucket ${status.version}` : "Daemon not connected"} />
      </section>
      <section className="ob-split-grid">
        <article className="ob-panel">
          <div className="ob-panel-head"><div><p className="ob-eyebrow">S3 endpoint</p><h2>Ready for existing tools.</h2></div><span className={`ob-status-badge ${status ? "success" : "neutral"}`}>{status ? "Active" : "Waiting"}</span></div>
          <div className="ob-endpoint-box"><code>{endpoint}</code><CopyButton value={endpoint} /></div>
          <p className="ob-panel-note">Path-style requests work with AWS SDKs, Boto3, the AWS CLI, backup tools, and frameworks.</p>
        </article>
        <article className="ob-panel ob-quickstart-panel">
          <div className="ob-panel-head"><div><p className="ob-eyebrow">Quick start</p><h2>Upload from any app.</h2></div></div>
          <pre><code>{`aws s3 cp ./photo.png s3://assets/photo.png \\\n  --endpoint-url ${endpoint}`}</code></pre>
          <button className="ob-text-button ob-text-button-icon" type="button" onClick={() => onNavigate("connections")}>Open all integration examples <ArrowRight size={14} /></button>
        </article>
      </section>
    </>
  );
}
