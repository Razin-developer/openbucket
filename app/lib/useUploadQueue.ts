"use client";

import { useCallback, useRef, useState } from "react";
import { UploadAbortedError, uploadObject, type UploadConnection, type UploadResult } from "./uploads";

export type UploadItemStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type UploadItem = {
  id: string;
  file: File;
  key: string;
  status: UploadItemStatus;
  loaded: number;
  total: number;
  error?: string;
};

type StartOptions = { connection: UploadConnection; bucket: string; onComplete?: (item: UploadItem, result: UploadResult) => void };

let nextId = 0;

/**
 * Manages a queue of file uploads (multi-select or drag-and-drop) against one bucket,
 * running them one at a time so a slow connection doesn't contend with itself, while
 * exposing per-file progress for a progress-list UI. Each item is driven by
 * uploadObject() (app/lib/uploads.ts), which itself picks single-PUT vs multipart.
 */
export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const runningRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const runQueue = useCallback((options: StartOptions) => {
    if (runningRef.current) return;
    runningRef.current = true;
    void (async () => {
      for (;;) {
        let next: UploadItem | undefined;
        // The functional updater runs synchronously (only the resulting render is deferred),
        // so `next` is already populated by the time setItems() returns below.
        setItems((current) => {
          next = current.find((item) => item.status === "queued");
          return next ? current.map((item) => (item.id === next!.id ? { ...item, status: "uploading" } : item)) : current;
        });
        if (!next) break;
        const item = next;
        const controller = new AbortController();
        controllers.current.set(item.id, controller);
        try {
          const result = await uploadObject({
            connection: options.connection,
            bucket: options.bucket,
            key: item.key,
            file: item.file,
            signal: controller.signal,
            onProgress: (progress) => updateItem(item.id, { loaded: progress.loaded, total: progress.total }),
          });
          updateItem(item.id, { status: "done", loaded: item.file.size, total: item.file.size });
          options.onComplete?.(item, result);
        } catch (error) {
          if (error instanceof UploadAbortedError) updateItem(item.id, { status: "cancelled" });
          else updateItem(item.id, { status: "error", error: error instanceof Error ? error.message : "Upload failed" });
        } finally {
          controllers.current.delete(item.id);
        }
      }
      runningRef.current = false;
    })();
  }, [updateItem]);

  const addFiles = useCallback((files: FileList | File[], keyForFile: (file: File) => string, options: StartOptions) => {
    const queued: UploadItem[] = Array.from(files).map((file) => ({
      id: `upload-${(nextId += 1)}`,
      file,
      key: keyForFile(file),
      status: "queued" as const,
      loaded: 0,
      total: file.size,
    }));
    setItems((current) => [...current, ...queued]);
    runQueue(options);
  }, [runQueue]);

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((item) => item.status === "queued" || item.status === "uploading"));
  }, []);

  return { items, addFiles, cancel, clearFinished };
}
