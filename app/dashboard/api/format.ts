// Formatting helpers shared by node and account views.

export function formatBytes(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** unit;
  return `${scaled >= 100 || unit === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 100_000 ? "compact" : "standard" }).format(value);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function relativeHeartbeat(value: string | null): string {
  if (!value) return "No heartbeat yet";
  const elapsed = Date.now() - new Date(value).valueOf();
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(value);
  if (elapsed < 60_000) return "Heartbeat just now";
  if (elapsed < 3_600_000) return `Heartbeat ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `Heartbeat ${Math.floor(elapsed / 3_600_000)}h ago`;
  return `Heartbeat ${Math.floor(elapsed / 86_400_000)}d ago`;
}

export function methodTone(method: string): string {
  if (["PUT", "POST"].includes(method)) return "method-write";
  if (method === "DELETE") return "method-delete";
  return "method-read";
}
