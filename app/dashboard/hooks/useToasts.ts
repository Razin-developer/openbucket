import { useCallback } from "react";
import { toast } from "sonner";
import type { Toast } from "../api/types";

/** Thin wrapper so every view keeps calling notify(message, tone) — the shadcn/sonner Toaster (mounted once in DashboardShell) renders them. */
export function useToasts() {
  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    if (tone === "error") toast.error(message);
    else toast.success(message);
  }, []);
  return { notify };
}
