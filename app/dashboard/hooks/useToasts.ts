import { useCallback, useState } from "react";
import type { Toast } from "../api/types";

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600);
  }, []);
  return { toasts, notify };
}
