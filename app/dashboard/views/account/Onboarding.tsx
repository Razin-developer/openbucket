import { ArrowRight } from "lucide-react";
import { CopyButton } from "../../components/CopyButton";
import type { AccountUser } from "../../api/account-api";

export function Onboarding({ user }: { user: AccountUser }) {
  const loginCommand = `openbucket login --email ${user.email}`;
  const serveCommand = "openbucket serve /path/to/storage";
  return (
    <section className="ob-onboarding">
      <div className="ob-onboarding-copy">
        <p className="ob-eyebrow">CONNECT A REAL NODE</p>
        <h2>Login once. Serve the disk.</h2>
        <p>The CLI securely prompts for your password, registers the node, and sends real heartbeats and usage to this account. Object bytes remain on the storage host.</p>
        <a href="/docs#first-node">Read the node guide <ArrowRight size={14} /></a>
      </div>
      <div className="ob-command-stack">
        <div><span><b>01</b> Authenticate this machine</span><div><code>{loginCommand}</code><CopyButton value={loginCommand} /></div></div>
        <div><span><b>02</b> Name and start the node</span><div><code>{serveCommand}</code><CopyButton value={serveCommand} /></div></div>
        <p>OpenBucket asks for a unique node name and keeps infrastructure endpoints out of this dashboard.</p>
      </div>
    </section>
  );
}
