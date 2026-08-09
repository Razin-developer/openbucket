import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_API, getInitialConnection, normalizeApiBase, tokenStorageKey, API_STORAGE_KEY } from "../api/node-api";
import type { NodeConnection } from "../api/types";

export type InitialConnectionHint = { apiBase: string; token: string; displayUrl?: string };

/**
 * Owns connection bootstrap (URL params / localStorage / sessionStorage) plus the
 * "generation" counter used to ignore stale in-flight requests after a connection change —
 * behavior carried over from app/dashboard.tsx unchanged.
 */
function resolveInitial(initialConnection?: InitialConnectionHint): { apiBase: string; adminToken: string } {
  const initial = initialConnection ?? getInitialConnection();
  const adminToken = "token" in initial ? initial.token : (initial as NodeConnection).adminToken;
  try { return { apiBase: normalizeApiBase(initial.apiBase), adminToken }; }
  catch { return { apiBase: DEFAULT_API, adminToken }; }
}

export function useNodeConnection(initialConnection?: InitialConnectionHint) {
  // Resolved synchronously on first render (not deferred behind a setTimeout(0) effect) — the
  // deferral meant every page load fired a guaranteed-to-fail first request against the hardcoded
  // DEFAULT_API (127.0.0.1:7272) before self-correcting a tick later, which read as "the local
  // dashboard isn't connecting" even though it always recovered a moment after.
  const [{ apiBase, adminToken }, setConnectionState] = useState(() => resolveInitial(initialConnection));
  const connectionGeneration = useRef(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // The lazy useState initializer above already resolved the connection from the exact same
    // source for the first render — this effect only needs to react to `initialConnection`
    // actually changing afterward (e.g. the hosted dashboard switching which node is selected).
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    connectionGeneration.current += 1;
    setConnectionState(resolveInitial(initialConnection));
  }, [initialConnection]);

  const saveConnection = useCallback((nextApi: string, nextToken: string, onError: (message: string) => void, onSaved: () => void) => {
    let normalized: string;
    try { normalized = normalizeApiBase(nextApi.trim() || DEFAULT_API); }
    catch (error) { onError(error instanceof Error ? error.message : "Invalid management API URL"); return; }
    window.localStorage.setItem(API_STORAGE_KEY, normalized);
    const storageKey = tokenStorageKey(normalized);
    if (nextToken.trim()) window.sessionStorage.setItem(storageKey, nextToken.trim()); else window.sessionStorage.removeItem(storageKey);
    connectionGeneration.current += 1;
    setConnectionState({ apiBase: normalized, adminToken: nextToken.trim() });
    onSaved();
  }, []);

  return { apiBase, adminToken, connectionGeneration, saveConnection };
}
