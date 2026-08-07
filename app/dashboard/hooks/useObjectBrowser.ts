import { useCallback, useRef, useState } from "react";
import { apiRequestUrl, arrayFrom, normalizeObject } from "../api/node-api";
import type { NodeApiFetch } from "../api/node-api";
import type { StorageObject } from "../api/types";

/** Object-browser state (selected bucket / prefix / listing) plus upload/download/delete/share. */
export function useObjectBrowser(apiFetch: NodeApiFetch, apiBase: string, adminToken: string, notify: (message: string, tone?: "success" | "error") => void) {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [objectPrefix, setObjectPrefix] = useState("");
  const [busy, setBusy] = useState("");
  const generation = useRef(0);

  const reset = useCallback(() => {
    setSelectedBucket(null);
    setObjects([]);
    setObjectPrefix("");
  }, []);

  const loadObjects = useCallback(async (bucket: string, prefix = "") => {
    const gen = ++generation.current;
    setBusy("objects");
    try {
      const payload = await apiFetch<unknown>(`/v1/buckets/${encodeURIComponent(bucket)}/objects?prefix=${encodeURIComponent(prefix)}`);
      if (gen !== generation.current) return;
      setObjects(arrayFrom<unknown>(payload, "objects").map(normalizeObject));
      setSelectedBucket(bucket);
      setObjectPrefix(prefix);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load objects", "error");
    } finally {
      setBusy("");
    }
  }, [apiFetch, notify]);

  const uploadObject = useCallback(async (file: File) => {
    if (!selectedBucket) return;
    const key = objectPrefix ? `${objectPrefix.replace(/\/$/, "")}/${file.name}` : file.name;
    setBusy("upload");
    try {
      await apiFetch(`/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT", headers: file.type ? { "Content-Type": file.type } : {}, body: file,
      });
      notify(`${file.name} uploaded`);
      await loadObjects(selectedBucket, objectPrefix);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed", "error");
    } finally {
      setBusy("");
    }
  }, [apiFetch, loadObjects, notify, objectPrefix, selectedBucket]);

  const downloadObject = useCallback(async (object: StorageObject) => {
    if (!selectedBucket) return;
    try {
      const headers = new Headers({ "X-OpenBucket-Client": "dashboard" });
      if (adminToken) headers.set("Authorization", `Bearer ${adminToken}`);
      const path = object.key.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(apiRequestUrl(apiBase, `/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${path}`), { headers });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = object.key.split("/").at(-1) || object.key;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Download failed", "error");
    }
  }, [adminToken, apiBase, notify, selectedBucket]);

  const deleteObject = useCallback(async (object: StorageObject) => {
    if (!selectedBucket || !window.confirm(`Delete "${object.key}"? This cannot be undone.`)) return;
    try {
      const path = object.key.split("/").map(encodeURIComponent).join("/");
      await apiFetch(`/v1/buckets/${encodeURIComponent(selectedBucket)}/objects/${path}`, { method: "DELETE" });
      notify("Object deleted");
      await loadObjects(selectedBucket, objectPrefix);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Delete failed", "error");
    }
  }, [apiFetch, loadObjects, notify, objectPrefix, selectedBucket]);

  const shareObject = useCallback(async (object: StorageObject) => {
    if (!selectedBucket) return;
    try {
      const result = await apiFetch<Record<string, string>>(`/v1/buckets/${encodeURIComponent(selectedBucket)}/share`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: object.key, expiresIn: 3600 }),
      });
      const url = result.url ?? result.shareUrl;
      if (!url) throw new Error("The daemon did not return a share URL");
      await navigator.clipboard.writeText(url);
      notify("One-hour share link copied");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create share link", "error");
    }
  }, [apiFetch, notify, selectedBucket]);

  return {
    selectedBucket, objects, objectPrefix, busy, setObjectPrefix, setSelectedBucket, setObjects,
    reset, loadObjects, uploadObject, downloadObject, deleteObject, shareObject,
  };
}
