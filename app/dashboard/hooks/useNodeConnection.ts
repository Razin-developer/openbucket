import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_API, getInitialConnection, normalizeApiBase, tokenStorageKey, API_STORAGE_KEY } from "../api/node-api";
import type { NodeConnection } from "../api/types";

export type InitialConnectionHint = { apiBase: string; token: string; displayUrl?: string };

/**
 * Owns connection bootstrap (URL params / localStorage / sessionStorage) plus the
 * "generation" counter used to ignore stale in-flight requests after a connection change —
 * behavior carried over from app/dashboard.tsx unchanged.
 */
export function useNodeConnection(initialConnection?: InitialConnectionHint) {
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [adminToken, setAdminToken] = useState("");
  const connectionGeneration = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const initial = initialConnection ?? getInitialConnection();
      connectionGeneration.current += 1;
      try { setApiBase(normalizeApiBase(initial.apiBase)); }
      catch { setApiBase(DEFAULT_API); }
      setAdminToken("token" in initial ? initial.token : (initial as NodeConnection).adminToken);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialConnection]);

  const saveConnection = useCallback((nextApi: string, nextToken: string, onError: (message: string) => void, onSaved: () => void) => {
    let normalized: string;
    try { normalized = normalizeApiBase(nextApi.trim() || DEFAULT_API); }
    catch (error) { onError(error instanceof Error ? error.message : "Invalid management API URL"); return; }
    window.localStorage.setItem(API_STORAGE_KEY, normalized);
    const storageKey = tokenStorageKey(normalized);
    if (nextToken.trim()) window.sessionStorage.setItem(storageKey, nextToken.trim()); else window.sessionStorage.removeItem(storageKey);
    connectionGeneration.current += 1;
    setApiBase(normalized);
    setAdminToken(nextToken.trim());
    onSaved();
  }, []);

  return { apiBase, adminToken, connectionGeneration, saveConnection, setApiBase, setAdminToken };
}
