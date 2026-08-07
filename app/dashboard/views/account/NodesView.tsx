import { NodeCard } from "../../components/NodeCard";
import type { AccountNode, AccountUser } from "../../api/account-api";
import { Onboarding } from "./Onboarding";

export function NodesView({ user, nodes, onOpen }: { user: AccountUser; nodes: AccountNode[]; onOpen: (node: AccountNode) => void }) {
  return (
    <>
      <header className="ob-page-heading"><div><p className="ob-eyebrow">REGISTERED STORAGE</p><h1>Nodes</h1><p>Every value below comes from a node heartbeat stored by the account API.</p></div></header>
      {nodes.length ? (
        <div className="ob-node-grid full">{nodes.map((node) => <NodeCard node={node} key={node.id} onOpen={onOpen} />)}</div>
      ) : (
        <section className="ob-state-panel"><h2>No nodes registered</h2><p>Authenticate the CLI and start a storage node. It will appear after its first successful registration.</p><Onboarding user={user} /></section>
      )}
    </>
  );
}
