import { useState, type DragEvent, type FormEvent } from "react";
import { ArrowLeft, Download, FolderOpen, Plus, RefreshCw, Upload } from "lucide-react";
import { createBucketFormSchema, validateForm } from "../../../../vercel/validation";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { UploadProgressPanel } from "../../components/UploadProgressPanel";
import { formatBytes, formatDate, formatNumber } from "../../api/format";
import type { Bucket } from "../../api/types";
import type { NodeViewContext } from "./context";

function CreateBucketModal({ node, onClose }: { node: NodeViewContext; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validateForm(createBucketFormSchema, { name: String(form.get("name") ?? ""), public: form.get("public") === "on" });
    if (!result.ok) { setError(result.message); return; }
    setBusy(true);
    try {
      await node.apiFetch("/v1/buckets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result.value) });
      onClose();
      node.notify("Bucket created");
      await node.refresh(true);
    } catch (cause) {
      node.notify(cause instanceof Error ? cause.message : "Could not create bucket", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Create a bucket" description="Bucket names use S3-compatible lowercase naming rules." onClose={onClose}>
      <form className="ob-form-stack" onSubmit={(event) => void submit(event)}>
        <label><span>Bucket name</span><input name="name" required minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9.\-]*[a-z0-9]" placeholder="project-assets" autoFocus /></label>
        <label className="ob-check-row"><input name="public" type="checkbox" /><span><strong>Allow anonymous downloads</strong><small>Uploads and management still require credentials.</small></span></label>
        {error ? <p className="ob-form-error">{error}</p> : null}
        <div className="ob-modal-actions">
          <button className="ob-button secondary compact" type="button" onClick={onClose}>Cancel</button>
          <button className="ob-button primary compact" type="submit" disabled={busy}>{busy ? "Creating…" : "Create bucket"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function BucketsView({ node }: { node: NodeViewContext }) {
  const { buckets, loadState, notify, refresh, apiFetch, objectBrowser } = node;
  const {
    selectedBucket, objects, objectPrefix, busy, setObjectPrefix, setSelectedBucket, setObjects, loadObjects,
    uploadFiles, downloadObject, deleteObject, shareObject, uploadItems, cancelUpload, clearFinishedUploads,
  } = objectBrowser;
  const [createOpen, setCreateOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const uploading = uploadItems.some((item) => item.status === "queued" || item.status === "uploading");

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files);
  }

  async function deleteBucket(bucket: Bucket) {
    if (!window.confirm(`Delete bucket "${bucket.name}"? The daemon refuses non-empty bucket deletion.`)) return;
    try {
      await apiFetch(`/v1/buckets/${encodeURIComponent(bucket.name)}`, { method: "DELETE" });
      if (selectedBucket === bucket.name) setSelectedBucket(null);
      notify("Bucket deleted");
      await refresh(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete bucket", "error");
    }
  }

  return (
    <section>
      <div className="ob-page-heading">
        <div><p className="ob-eyebrow">Object storage</p><h1>Buckets</h1><p>Each bucket is a confined directory inside your selected storage root.</p></div>
        <button className="ob-button primary compact" type="button" onClick={() => setCreateOpen(true)} disabled={loadState !== "connected"}><Plus size={15} /> Create bucket</button>
      </div>
      {!selectedBucket ? (
        buckets.length ? (
          <div className="ob-table-card">
            <table>
              <thead><tr><th>Name</th><th>Objects</th><th>Size</th><th>Access</th><th>Created</th><th><span className="ob-sr-only">Actions</span></th></tr></thead>
              <tbody>
                {buckets.map((bucket) => (
                  <tr key={bucket.name}>
                    <td><button className="ob-bucket-link" type="button" onClick={() => void loadObjects(bucket.name)}><span className="ob-bucket-glyph"><FolderOpen size={14} /></span>{bucket.name}</button></td>
                    <td>{formatNumber(bucket.objectCount)}</td>
                    <td>{formatBytes(bucket.sizeBytes)}</td>
                    <td><span className={`ob-status-badge ${bucket.public ? "info" : "neutral"}`}>{bucket.public ? "Public" : "Private"}</span></td>
                    <td>{formatDate(bucket.createdAt)}</td>
                    <td className="ob-row-actions"><button className="ob-text-button danger" type="button" onClick={() => void deleteBucket(bucket)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No buckets yet." body="Create a bucket to map a safe namespace inside this storage root." action={<button className="ob-button primary compact" type="button" onClick={() => setCreateOpen(true)} disabled={loadState !== "connected"}><Plus size={15} /> Create your first bucket</button>} />
        )
      ) : (
        <div
          className={`ob-object-browser${dragOver ? " drag-over" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="ob-browser-toolbar">
            <div>
              <button className="ob-back-button" type="button" onClick={() => { setSelectedBucket(null); setObjects([]); }}><ArrowLeft size={14} /> All buckets</button>
              <h2>{selectedBucket}</h2>
              <p>{objects.length} visible object{objects.length === 1 ? "" : "s"} · drag and drop files to upload</p>
            </div>
            <div className="ob-toolbar-actions">
              <label className="ob-button primary compact ob-upload-button">
                <Upload size={15} /> {uploading ? "Uploading…" : "Upload files"}
                <input type="file" multiple onChange={(event) => { if (event.target.files?.length) uploadFiles(event.target.files); event.target.value = ""; }} />
              </label>
              <button className="ob-button secondary compact" type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)}><RefreshCw size={15} /> Refresh</button>
            </div>
          </div>
          {uploadItems.length ? <div style={{ padding: "0 24px 16px" }}><UploadProgressPanel items={uploadItems} onCancel={cancelUpload} onDismiss={clearFinishedUploads} /></div> : null}
          <div className="ob-prefix-bar">
            <label htmlFor="ob-prefix">Prefix</label>
            <input id="ob-prefix" value={objectPrefix} onChange={(event) => setObjectPrefix(event.target.value)} placeholder="photos/2026" onKeyDown={(event) => event.key === "Enter" && void loadObjects(selectedBucket, objectPrefix)} />
            <button type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)}>Apply</button>
          </div>
          {busy === "objects" ? (
            <div className="ob-loading-rows" aria-label="Loading objects"><i /><i /><i /></div>
          ) : objects.length ? (
            <div className="ob-table-card flush">
              <table>
                <thead><tr><th>Object key</th><th>Size</th><th>Modified</th><th>ETag</th><th><span className="ob-sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {objects.map((object) => (
                    <tr key={object.key}>
                      <td className="ob-object-key">{object.key}</td>
                      <td>{formatBytes(object.sizeBytes)}</td>
                      <td>{formatDate(object.lastModified)}</td>
                      <td><code className="ob-etag">{object.etag?.replaceAll('"', "").slice(0, 14) || "—"}</code></td>
                      <td>
                        <div className="ob-inline-actions">
                          <button type="button" onClick={() => void downloadObject(object)}><Download size={14} /> Download</button>
                          <button type="button" onClick={() => void shareObject(object)}>Share</button>
                          <button className="danger" type="button" onClick={() => void deleteObject(object)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="This bucket is empty." body="Upload a file here or send a PutObject request to the S3 endpoint." />
          )}
        </div>
      )}
      {createOpen ? <CreateBucketModal node={node} onClose={() => setCreateOpen(false)} /> : null}
    </section>
  );
}
