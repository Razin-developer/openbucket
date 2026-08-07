import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Sidebar-pinned workspace/node switcher slot. In standalone mode it's a static label
 * (only ever one node); in hosted mode the caller passes a dropdown of nodes.
 */
export function WorkspaceSwitcher({ statusDot, title, subtitle, onSettings, children }: {
  statusDot?: "online" | "offline";
  title: string;
  subtitle?: string;
  onSettings?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="ob-workspace-switcher">
      {statusDot ? (
        <div className="ob-node-state">
          <span className={`ob-status-dot ${statusDot}`} />
          <span>{statusDot === "online" ? "Daemon online" : "Daemon offline"}</span>
        </div>
      ) : null}
      <strong>{title}</strong>
      {subtitle ? <small>{subtitle}</small> : null}
      {children}
      {onSettings ? <button type="button" onClick={onSettings}><Settings2 size={13} /> Connection settings</button> : null}
    </div>
  );
}
