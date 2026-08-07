import { useCallback, useEffect, useMemo, useState } from "react";
import {
  arrayFrom, makeApiFetch, normalizeAnalytics, normalizeBucket, normalizeKey, normalizeLog, normalizeStatus,
} from "../api/node-api";
import type { Analytics, ApiKey, Bucket, ClientConfig, LoadState, RequestLog, Status } from "../api/types";

/**
 * Owns the daemon status/buckets/keys/logs/analytics/config poll — the data layer that used to
 * live inline in app/dashboard.tsx's Dashboard component. One instance is shared by the standalone
 * app and by the hosted "node selected" context, which is what eliminates LiveNodeConsole's
 * separate full-shell/data-layer duplication.
 */
export function useNodeData(apiBase: string, adminToken: string, connectionGeneration: { current: number }, enabled = true) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [lastError, setLastError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(() => normalizeAnalytics({}));
  const [clientConfig, setClientConfig] = useState<ClientConfig>({});

  const apiFetch = useMemo(() => makeApiFetch(apiBase, adminToken), [apiBase, adminToken]);

  const clearNodeState = useCallback(() => {
    setStatus(null);
    setBuckets([]);
    setKeys([]);
    setLogs([]);
    setAnalytics(normalizeAnalytics({}));
    setClientConfig({});
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    const generation = connectionGeneration.current;
    if (!quiet) setLoadState("loading");
    try {
      const [statusPayload, bucketPayload, keyPayload, logPayload, analyticsPayload, configPayload] = await Promise.all([
        apiFetch<unknown>("/v1/status"),
        apiFetch<unknown>("/v1/buckets"),
        apiFetch<unknown>("/v1/keys"),
        apiFetch<unknown>("/v1/logs?limit=100"),
        apiFetch<unknown>("/v1/analytics"),
        apiFetch<ClientConfig>("/v1/config/client"),
      ]);
      if (generation !== connectionGeneration.current) return;
      setStatus(normalizeStatus(statusPayload));
      setBuckets(arrayFrom<unknown>(bucketPayload, "buckets").map(normalizeBucket));
      setKeys(arrayFrom<unknown>(keyPayload, "keys").map(normalizeKey));
      setLogs(arrayFrom<unknown>(logPayload, "logs").map(normalizeLog));
      setAnalytics(normalizeAnalytics(analyticsPayload));
      setClientConfig(configPayload ?? {});
      setLoadState("connected");
      setLastError("");
      setLastUpdated(new Date());
    } catch (error) {
      if (generation !== connectionGeneration.current) return;
      setLoadState("disconnected");
      setLastError(error instanceof Error ? error.message : "Unable to reach the OpenBucket daemon");
      clearNodeState();
    }
  }, [apiFetch, clearNodeState, connectionGeneration]);

  useEffect(() => {
    if (!enabled) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), 10_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh, enabled]);

  return {
    apiFetch, loadState, lastError, lastUpdated, status, buckets, keys, logs, analytics, clientConfig, refresh, clearNodeState,
  };
}
