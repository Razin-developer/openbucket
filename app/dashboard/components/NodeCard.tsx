import { ArrowRight } from "lucide-react";
import { nodeApiUrl, type AccountNode } from "../api/account-api";
import { formatBytes, formatDate, formatNumber, relativeHeartbeat } from "../api/format";
import { CopyButton } from "./CopyButton";

function NodeStatus({ status }: { status: AccountNode["status"] }) {
  return <span className={`ob-node-status ${status}`}><i aria-hidden="true" />{status[0].toUpperCase() + status.slice(1)}</span>;
}

export function NodeCard({ node, onOpen }: { node: AccountNode; onOpen?: (node: AccountNode) => void }) {
  const apiUrl = nodeApiUrl(node);
  return (
    <article className="ob-node-card">
      <header><div><NodeStatus status={node.status} /><h3>{node.name}</h3><p>{node.endpoint.futureS3Hostname}</p></div><span className="ob-node-id">{node.id}</span></header>
      <div className="ob-node-facts">
        <div><span>Stored</span><strong>{formatBytes(node.storage.usedBytes)}</strong></div>
        <div><span>Objects</span><strong>{formatNumber(node.storage.objectCount)}</strong></div>
        <div><span>Requests</span><strong>{formatNumber(node.usage.requests)}</strong></div>
        <div><span>Last seen</span><strong>{relativeHeartbeat(node.lastSeenAt)}</strong></div>
      </div>
      <div className="ob-node-endpoints">
        <div className="ob-node-endpoint"><span>OpenBucket API</span><code>{apiUrl}</code><CopyButton value={apiUrl} /></div>
        <div className="ob-node-endpoint"><span>Node services</span><em>{node.status === "online" ? "Available" : "Offline"}</em></div>
      </div>
      <footer><span>OpenBucket {node.version || "version pending"}</span>{onOpen ? <button type="button" onClick={() => onOpen(node)}>Open node <ArrowRight size={14} /></button> : <span>Registered {formatDate(node.createdAt)}</span>}</footer>
    </article>
  );
}
