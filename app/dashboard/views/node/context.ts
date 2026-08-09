import type { useObjectBrowser } from "../../hooks/useObjectBrowser";
import type { NodeApiFetch } from "../../api/node-api";
import type { Analytics, ApiKey, Bucket, LoadState, RequestLog, Status } from "../../api/types";

/** Bundled node-scoped state passed to every views/node/* component. */
export type NodeViewContext = {
  apiFetch: NodeApiFetch;
  apiBase: string;
  adminToken: string;
  status: Status | null;
  loadState: LoadState;
  lastError: string;
  lastUpdated: Date | null;
  buckets: Bucket[];
  keys: ApiKey[];
  logs: RequestLog[];
  analytics: Analytics;
  refresh: (quiet?: boolean) => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
  objectBrowser: ReturnType<typeof useObjectBrowser>;
  displayUrl?: string;
  /** The S3 URL to display/share — reverse-proxy URL when hosted, real local endpoint when
   *  standalone. Never a raw Cloudflare tunnel URL. */
  s3DisplayUrl?: string;
  onNavigate: (id: string) => void;
  /** "" for the standalone local dashboard, "/dashboard/nodes/:name" for the hosted one — lets
   *  views build real node-scoped URLs (e.g. the bucket object-browser route) via nodeViewPath. */
  basePath: string;
};
