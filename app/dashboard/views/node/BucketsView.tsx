import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FolderOpen, Plus, RefreshCw, Share2, Trash2, Upload, UploadCloud } from "lucide-react";
import { nodeViewPath } from "../../shell/paths";
import { createBucketFormSchema, validateForm } from "../../../lib/validation";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UploadProgressPanel } from "../../components/UploadProgressPanel";
import { Badge } from "../../../components/ui/badge";
import { Checkbox } from "../../../components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Skeleton } from "../../../components/ui/skeleton";
import { Spinner } from "../../../components/ui/spinner";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { usePager, ListPagination } from "../../components/Pager";
import { formatBytes, formatDate, formatNumber } from "../../api/format";
import type { Bucket, StorageObject } from "../../api/types";
import type { NodeViewContext } from "./context";

function CreateBucketModal({ node, onClose }: { node: NodeViewContext; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validateForm(createBucketFormSchema, { name: String(form.get("name") ?? ""), public: isPublic });
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
        <label className="ob-check-row">
          <Checkbox checked={isPublic} onCheckedChange={(checked) => setIsPublic(checked === true)} />
          <span><strong>Allow anonymous downloads</strong><small>Uploads and management still require credentials.</small></span>
        </label>
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
  const { buckets, loadState, notify, refresh, apiFetch, objectBrowser, basePath } = node;
  const {
    selectedBucket, objects, folders, objectPrefix, busy, setObjectPrefix, setSelectedBucket, setObjects, loadObjects,
    uploadFiles, downloadObject, deleteObject, shareObject, uploadItems, cancelUpload, clearFinishedUploads,
  } = objectBrowser;
  const [createOpen, setCreateOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [bucketToDelete, setBucketToDelete] = useState<Bucket | null>(null);
  const [objectToDelete, setObjectToDelete] = useState<StorageObject | null>(null);
  const uploading = uploadItems.some((item) => item.status === "queued" || item.status === "uploading");
  const bucketsPager = usePager(buckets);
  const objectsPager = usePager(objects);
  const navigate = useNavigate();
  const params = useParams<{ bucket?: string; "*": string }>();
  const bucketParam = params.bucket ? decodeURIComponent(params.bucket) : null;
  // The trailing wildcard segments are the folder path (e.g. "photos/2026") — each segment is its
  // own encodeURIComponent unit (see nodeViewPath), so split/decode/rejoin rather than decoding
  // the whole splat string at once.
  const folderParam = (params["*"] ?? "").split("/").filter(Boolean).map(decodeURIComponent).join("/");
  const folderPrefix = folderParam ? `${folderParam}/` : "";

  // The URL (:bucket + the folder wildcard) is the source of truth for what's open — this is what
  // makes a bucket/folder URL deep-linkable/refreshable/back-button-able instead of pure in-memory
  // state, the same class of bug the rest of the dashboard nav rewrite fixed.
  useEffect(() => {
    if (bucketParam && (bucketParam !== selectedBucket || folderPrefix !== objectPrefix)) {
      void loadObjects(bucketParam, folderPrefix);
    } else if (!bucketParam && selectedBucket) {
      setSelectedBucket(null);
      setObjects([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketParam, folderPrefix]);

  const breadcrumbSegments = objectPrefix.split("/").filter(Boolean);
  const openFolder = (depth: number) => navigate(nodeViewPath(basePath, "buckets", selectedBucket ?? undefined, breadcrumbSegments.slice(0, depth).join("/")));

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files);
  }

  async function deleteBucket(bucket: Bucket) {
    try {
      await apiFetch(`/v1/buckets/${encodeURIComponent(bucket.name)}`, { method: "DELETE" });
      if (selectedBucket === bucket.name) navigate(nodeViewPath(basePath, "buckets"));
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
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Objects</TableHead><TableHead>Size</TableHead><TableHead>Access</TableHead><TableHead>Created</TableHead><TableHead><span className="ob-sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {bucketsPager.pageItems.map((bucket) => (
                  <TableRow key={bucket.name}>
                    <TableCell><button className="ob-bucket-link" type="button" onClick={() => navigate(nodeViewPath(basePath, "buckets", bucket.name))}><span className="ob-bucket-glyph"><FolderOpen size={14} /></span>{bucket.name}</button></TableCell>
                    <TableCell>{formatNumber(bucket.objectCount)}</TableCell>
                    <TableCell>{formatBytes(bucket.sizeBytes)}</TableCell>
                    <TableCell><Badge variant={bucket.public ? "outline" : "secondary"} className={bucket.public ? "border-[color:var(--accent)] text-[color:var(--accent-deep)] bg-[color:var(--accent-soft)]" : ""}>{bucket.public ? "Public" : "Private"}</Badge></TableCell>
                    <TableCell>{formatDate(bucket.createdAt)}</TableCell>
                    <TableCell className="ob-row-actions"><button className="ob-text-button danger" type="button" onClick={() => setBucketToDelete(bucket)}>Delete</button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ob-pagination-bar">
              <span>{buckets.length} bucket{buckets.length === 1 ? "" : "s"}</span>
              <ListPagination page={bucketsPager.page} pageCount={bucketsPager.pageCount} onChange={bucketsPager.setPage} />
            </div>
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
          {dragOver ? (
            <div className="ob-dropzone-overlay" aria-hidden="true">
              <div className="ob-dropzone-card"><UploadCloud size={22} /><strong>Drop to upload</strong><span>Files land in {selectedBucket}{objectPrefix ? `/${objectPrefix}` : ""}</span></div>
            </div>
          ) : null}
          <div className="ob-browser-toolbar">
            <div>
              <button className="ob-back-button" type="button" onClick={() => navigate(nodeViewPath(basePath, "buckets"))}><ArrowLeft size={14} /> All buckets</button>
              <h2 className="ob-folder-crumbs">
                <button type="button" onClick={() => openFolder(0)}>{selectedBucket}</button>
                {breadcrumbSegments.map((segment, index) => (
                  <span key={index}>
                    <span aria-hidden="true"> / </span>
                    <button type="button" onClick={() => openFolder(index + 1)}>{segment}</button>
                  </span>
                ))}
              </h2>
              <p>{folders.length ? `${folders.length} folder${folders.length === 1 ? "" : "s"}, ` : ""}{objects.length} object{objects.length === 1 ? "" : "s"} here · drag and drop files to upload</p>
            </div>
            <div className="ob-toolbar-actions">
              <label className="ob-button primary compact ob-upload-button">
                <Upload size={15} /> {uploading ? "Uploading…" : "Upload files"}
                <input type="file" multiple onChange={(event) => { if (event.target.files?.length) uploadFiles(event.target.files); event.target.value = ""; }} />
              </label>
              <button className="ob-button secondary compact" type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)} disabled={busy === "objects"}>
                {busy === "objects" ? <Spinner className="size-[15px]" /> : <RefreshCw size={15} />} Refresh
              </button>
            </div>
          </div>
          {uploadItems.length ? <div style={{ padding: "0 24px 16px" }}><UploadProgressPanel items={uploadItems} onCancel={cancelUpload} onDismiss={clearFinishedUploads} /></div> : null}
          <div className="ob-prefix-bar">
            <label htmlFor="ob-prefix">Prefix</label>
            <input id="ob-prefix" value={objectPrefix} onChange={(event) => setObjectPrefix(event.target.value)} placeholder="photos/2026" onKeyDown={(event) => event.key === "Enter" && void loadObjects(selectedBucket, objectPrefix)} />
            <button type="button" onClick={() => void loadObjects(selectedBucket, objectPrefix)}>Apply</button>
          </div>
          {busy === "objects" ? (
            <div className="ob-loading-rows" aria-label="Loading objects">
              <Skeleton className="h-9 mb-2.5" /><Skeleton className="h-9 mb-2.5" /><Skeleton className="h-9" />
            </div>
          ) : objects.length || folders.length ? (
            <div className="ob-table-card flush">
              <Table>
                <TableHeader><TableRow><TableHead>Object key</TableHead><TableHead>Size</TableHead><TableHead>Modified</TableHead><TableHead>ETag</TableHead><TableHead><span className="ob-sr-only">Actions</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {folders.map((folder) => {
                    const name = folder.slice(objectPrefix.length).replace(/\/$/, "");
                    return (
                      <TableRow key={folder} className="ob-folder-row">
                        <TableCell colSpan={4}>
                          <button className="ob-bucket-link" type="button" onClick={() => navigate(nodeViewPath(basePath, "buckets", selectedBucket ?? undefined, folder))}>
                            <span className="ob-bucket-glyph"><FolderOpen size={14} /></span>{name}
                          </button>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    );
                  })}
                  {objectsPager.pageItems.map((object) => (
                    <ContextMenu key={object.key}>
                      <ContextMenuTrigger asChild>
                        <TableRow>
                          <TableCell className="ob-object-key">{object.key.slice(objectPrefix.length)}</TableCell>
                          <TableCell>{formatBytes(object.sizeBytes)}</TableCell>
                          <TableCell>{formatDate(object.lastModified)}</TableCell>
                          <TableCell><code className="ob-etag">{object.etag?.replaceAll('"', "").slice(0, 14) || "—"}</code></TableCell>
                          <TableCell>
                            <div className="ob-inline-actions">
                              <button type="button" onClick={() => void downloadObject(object)}><Download size={14} /> Download</button>
                              <button type="button" onClick={() => void shareObject(object)}>Share</button>
                              <button className="danger" type="button" onClick={() => setObjectToDelete(object)}>Delete</button>
                            </div>
                          </TableCell>
                        </TableRow>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => void downloadObject(object)}><Download size={14} /> Download</ContextMenuItem>
                        <ContextMenuItem onSelect={() => void shareObject(object)}><Share2 size={14} /> Share</ContextMenuItem>
                        <ContextMenuItem variant="destructive" onSelect={() => setObjectToDelete(object)}><Trash2 size={14} /> Delete</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </TableBody>
              </Table>
              <div className="ob-pagination-bar">
                <span>{objects.length} object{objects.length === 1 ? "" : "s"}</span>
                <ListPagination page={objectsPager.page} pageCount={objectsPager.pageCount} onChange={objectsPager.setPage} />
              </div>
            </div>
          ) : (
            <EmptyState title={objectPrefix ? "This folder is empty." : "This bucket is empty."} body="Upload a file here or send a PutObject request to the S3 endpoint." />
          )}
        </div>
      )}
      {createOpen ? <CreateBucketModal node={node} onClose={() => setCreateOpen(false)} /> : null}
      <ConfirmDialog
        open={bucketToDelete !== null}
        title={`Delete bucket "${bucketToDelete?.name ?? ""}"?`}
        description="The daemon refuses to delete a non-empty bucket. This cannot be undone."
        confirmLabel="Delete bucket"
        onOpenChange={(open) => { if (!open) setBucketToDelete(null); }}
        onConfirm={() => { if (bucketToDelete) void deleteBucket(bucketToDelete); }}
      />
      <ConfirmDialog
        open={objectToDelete !== null}
        title={`Delete "${objectToDelete?.key ?? ""}"?`}
        description="This object will be permanently removed. This cannot be undone."
        confirmLabel="Delete object"
        onOpenChange={(open) => { if (!open) setObjectToDelete(null); }}
        onConfirm={() => { if (objectToDelete) void deleteObject(objectToDelete); }}
      />
    </section>
  );
}
