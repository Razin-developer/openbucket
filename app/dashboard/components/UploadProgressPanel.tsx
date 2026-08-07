import { CircleAlert, FileUp, X } from "lucide-react";
import type { UploadItem } from "../../lib/useUploadQueue";
import { Progress } from "../../components/ui/progress";

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unit;
  return `${scaled >= 100 || unit === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
}

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: (id: string) => void }) {
  const percent = item.total > 0 ? Math.min(100, Math.round((item.loaded / item.total) * 100)) : 0;
  return (
    <div className={`ob-upload-row ${item.status}`}>
      <span className="ob-upload-icon" aria-hidden="true">{item.status === "error" ? <CircleAlert size={14} /> : <FileUp size={14} />}</span>
      <div className="ob-upload-info">
        <div className="ob-upload-name"><span>{item.file.name}</span><small>{formatBytes(item.total)}</small></div>
        {item.status === "error" ? (
          <p className="ob-upload-error">{item.error}</p>
        ) : item.status === "cancelled" ? (
          <p className="ob-upload-error">Cancelled</p>
        ) : (
          <Progress className="ob-upload-bar h-1" value={item.status === "done" ? 100 : percent} />
        )}
      </div>
      {item.status === "queued" || item.status === "uploading" ? (
        <button type="button" className="ob-icon-button" aria-label={`Cancel upload of ${item.file.name}`} onClick={() => onCancel(item.id)}><X size={13} /></button>
      ) : null}
    </div>
  );
}

/** Per-file upload queue with progress bars — driven by useUploadQueue (app/lib/useUploadQueue.ts). */
export function UploadProgressPanel({ items, onCancel, onDismiss }: { items: UploadItem[]; onCancel: (id: string) => void; onDismiss: () => void }) {
  if (!items.length) return null;
  const active = items.filter((item) => item.status === "queued" || item.status === "uploading").length;
  return (
    <div className="ob-upload-panel" aria-live="polite">
      <div className="ob-upload-panel-head">
        <strong>{active > 0 ? `Uploading ${active} file${active === 1 ? "" : "s"}…` : "Uploads complete"}</strong>
        {active === 0 ? <button type="button" className="ob-text-button" onClick={onDismiss}>Dismiss</button> : null}
      </div>
      <div className="ob-upload-list">{items.map((item) => <UploadRow item={item} key={item.id} onCancel={onCancel} />)}</div>
    </div>
  );
}
