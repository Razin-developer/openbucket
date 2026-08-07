import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="ob-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ob-modal-card" role="dialog" aria-modal="true" aria-labelledby="ob-modal-title">
        <div className="ob-modal-head">
          <div>
            <p className="ob-eyebrow">OpenBucket</p>
            <h2 id="ob-modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button ref={closeRef} className="ob-icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}
