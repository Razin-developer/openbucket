import { NodeCard } from "../../components/NodeCard";
import { usePager, ListPagination } from "../../components/Pager";
import type { AccountNode, AccountUser } from "../../api/account-api";
import { Onboarding } from "./Onboarding";

export function NodesView({ user, nodes, onOpen }: { user: AccountUser; nodes: AccountNode[]; onOpen: (node: AccountNode) => void }) {
  const nodesPager = usePager(nodes);
  return (
    <>
      <header className="ob-page-heading"><div><p className="ob-eyebrow">REGISTERED STORAGE</p><h1>Nodes</h1><p>Every value below comes from a node heartbeat stored by the account API.</p></div></header>
      {nodes.length ? (
        <>
          <div className="ob-node-grid full">{nodesPager.pageItems.map((node) => <NodeCard node={node} key={node.id} onOpen={onOpen} />)}</div>
          <div className="ob-pagination-bar">
            <span>{nodes.length} node{nodes.length === 1 ? "" : "s"}</span>
            <ListPagination page={nodesPager.page} pageCount={nodesPager.pageCount} onChange={nodesPager.setPage} />
          </div>
        </>
      ) : (
        <section className="ob-state-panel"><h2>No nodes registered</h2><p>Authenticate the CLI and start a storage node. It will appear after its first successful registration.</p><Onboarding user={user} /></section>
      )}
    </>
  );
}
