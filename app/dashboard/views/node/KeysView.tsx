import { useState, type FormEvent } from "react";
import { FileKey2, Plus } from "lucide-react";
import { createKeyFormSchema, validateForm } from "../../../../vercel/validation";
import { CopyButton } from "../../components/CopyButton";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { formatDate } from "../../api/format";
import type { ApiKey } from "../../api/types";
import type { NodeViewContext } from "./context";

function asRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object" ? (value as Record<string, string>) : {};
}

function CreateKeyModal({ node, onClose, onCreated }: { node: NodeViewContext; onClose: () => void; onCreated: (secret: Record<string, string>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validateForm(createKeyFormSchema, {
      name: String(form.get("name") || "API key"),
      readOnly: form.get("readOnly") === "on",
      bucket: String(form.get("bucket") || "") || undefined,
    });
    if (!result.ok) { setError(result.message); return; }
    setBusy(true);
    try {
      const response = await node.apiFetch<Record<string, unknown>>("/v1/keys", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result.value),
      });
      onClose();
      onCreated(asRecord(response.key ?? response));
      await node.refresh(true);
    } catch (cause) {
      node.notify(cause instanceof Error ? cause.message : "Could not create key", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create an API key" description="The secret is available once, immediately after creation." onClose={onClose}>
      <form className="ob-form-stack" onSubmit={(event) => void submit(event)}>
        <label><span>Key name</span><input name="name" required placeholder="production-backups" autoFocus /></label>
        <label><span>Bucket scope</span><select name="bucket"><option value="">All buckets</option>{node.buckets.map((bucket) => <option key={bucket.name} value={bucket.name}>{bucket.name}</option>)}</select></label>
        <label className="ob-check-row"><input name="readOnly" type="checkbox" /><span><strong>Read-only access</strong><small>Allow listing and downloading, but block writes and deletes.</small></span></label>
        {error ? <p className="ob-form-error">{error}</p> : null}
        <div className="ob-modal-actions">
          <button className="ob-button secondary compact" type="button" onClick={onClose}>Cancel</button>
          <button className="ob-button primary compact" type="submit" disabled={busy}>{busy ? "Creating…" : "Create key"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function KeysView({ node }: { node: NodeViewContext }) {
  const { keys, loadState, notify, refresh, apiFetch } = node;
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<Record<string, string> | null>(null);

  async function revokeKey(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Applications using it will stop working immediately.`)) return;
    try {
      await apiFetch(`/v1/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      notify("API key revoked");
      await refresh(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not revoke key", "error");
    }
  }

  return (
    <section>
      <div className="ob-page-heading">
        <div><p className="ob-eyebrow">Credentials</p><h1>API keys</h1><p>Issue independent S3 credentials and revoke them without restarting the node.</p></div>
        <button className="ob-button primary compact" type="button" onClick={() => setCreateOpen(true)} disabled={loadState !== "connected"}><Plus size={15} /> Create API key</button>
      </div>
      <div className="ob-security-note">
        <span aria-hidden="true"><FileKey2 size={16} /></span>
        <div><strong>Secrets are shown once.</strong><p>OpenBucket stores what it needs to verify S3 signatures. Keep the storage root and its <code>.openbucket</code> metadata private.</p></div>
      </div>
      {keys.length ? (
        <div className="ob-table-card">
          <table>
            <thead><tr><th>Name</th><th>Access key</th><th>Scope</th><th>Created</th><th><span className="ob-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="ob-strong-cell">{key.name}</td>
                  <td><div className="ob-inline-code"><code>{key.accessKeyId}</code><CopyButton value={key.accessKeyId} /></div></td>
                  <td>{key.bucket ? `${key.bucket} · ` : "All buckets · "}{key.readOnly ? "Read only" : "Read/write"}</td>
                  <td>{formatDate(key.createdAt)}</td>
                  <td className="ob-row-actions"><button className="ob-text-button danger" type="button" onClick={() => void revokeKey(key)}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No API keys available." body="Create credentials for your first S3 client. The initial key is printed by the daemon on first run." />
      )}
      {createOpen ? <CreateKeyModal node={node} onClose={() => setCreateOpen(false)} onCreated={setRevealedKey} /> : null}
      {revealedKey ? (
        <Modal title="Save this secret now" description="OpenBucket will not display this secret again." onClose={() => setRevealedKey(null)}>
          <div className="ob-secret-grid">
            {[["Access key", revealedKey.accessKeyId ?? revealedKey.accessKey ?? ""], ["Secret key", revealedKey.secretAccessKey ?? revealedKey.secretKey ?? ""]].map(([label, value]) => (
              <div key={label}><span>{label}</span><code>{value}</code><CopyButton value={value} /></div>
            ))}
          </div>
          <div className="ob-modal-actions"><button className="ob-button primary compact" type="button" onClick={() => setRevealedKey(null)}>I saved the secret</button></div>
        </Modal>
      ) : null}
    </section>
  );
}
