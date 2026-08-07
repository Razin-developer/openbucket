import { useState, type FormEvent } from "react";
import { FileKey2, Plus } from "lucide-react";
import { createKeyFormSchema, validateForm } from "../../../lib/validation";
import { CopyButton } from "../../components/CopyButton";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Checkbox } from "../../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { formatDate } from "../../api/format";
import type { ApiKey } from "../../api/types";
import type { NodeViewContext } from "./context";

function asRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object" ? (value as Record<string, string>) : {};
}

function CreateKeyModal({ node, onClose, onCreated }: { node: NodeViewContext; onClose: () => void; onCreated: (secret: Record<string, string>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bucket, setBucket] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validateForm(createKeyFormSchema, {
      name: String(form.get("name") || "API key"),
      readOnly,
      bucket: bucket || undefined,
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
        <label>
          <span>Bucket scope</span>
          <Select value={bucket || "__all__"} onValueChange={(value) => setBucket(value === "__all__" ? "" : value)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="All buckets" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All buckets</SelectItem>
              {node.buckets.map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="ob-check-row">
          <Checkbox checked={readOnly} onCheckedChange={(checked) => setReadOnly(checked === true)} />
          <span><strong>Read-only access</strong><small>Allow listing and downloading, but block writes and deletes.</small></span>
        </label>
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
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);

  async function revokeKey(key: ApiKey) {
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
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Access key</TableHead><TableHead>Scope</TableHead><TableHead>Created</TableHead><TableHead><span className="ob-sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="ob-strong-cell">{key.name}</TableCell>
                  <TableCell><div className="ob-inline-code"><code>{key.accessKeyId}</code><CopyButton value={key.accessKeyId} /></div></TableCell>
                  <TableCell>{key.bucket ? `${key.bucket} · ` : "All buckets · "}{key.readOnly ? "Read only" : "Read/write"}</TableCell>
                  <TableCell>{formatDate(key.createdAt)}</TableCell>
                  <TableCell className="ob-row-actions"><button className="ob-text-button danger" type="button" onClick={() => setKeyToRevoke(key)}>Revoke</button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      <ConfirmDialog
        open={keyToRevoke !== null}
        title={`Revoke "${keyToRevoke?.name ?? ""}"?`}
        description="Applications using this key will stop working immediately. This cannot be undone."
        confirmLabel="Revoke key"
        onOpenChange={(open) => { if (!open) setKeyToRevoke(null); }}
        onConfirm={() => { if (keyToRevoke) void revokeKey(keyToRevoke); }}
      />
    </section>
  );
}
