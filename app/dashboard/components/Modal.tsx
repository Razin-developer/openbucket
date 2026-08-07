import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";

/**
 * Thin wrapper around shadcn's Dialog primitive that keeps the exact external API every call site
 * already uses (title/description/children/onClose) while getting Radix's focus trap, ESC-to-close,
 * outside-click, and portal-based positioning for free. Visuals are driven by ob-modal-* classes so
 * this still matches the app's existing look — only the underlying behavior/a11y machinery changed.
 */
export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="ob-modal-card border-0 p-0 gap-0 shadow-none sm:max-w-[520px]">
        <div className="ob-modal-head">
          <div>
            <p className="ob-eyebrow">OpenBucket</p>
            <DialogTitle asChild><h2 id="ob-modal-title">{title}</h2></DialogTitle>
            {description ? <DialogDescription asChild><p>{description}</p></DialogDescription> : null}
          </div>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
