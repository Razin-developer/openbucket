import { Check, CircleAlert } from "lucide-react";
import type { Toast } from "../api/types";

export function ToastRegion({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="ob-toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`ob-toast ${toast.tone}`} key={toast.id}>
          <span>{toast.tone === "success" ? <Check size={13} /> : <CircleAlert size={13} />}</span>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
