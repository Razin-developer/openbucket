import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { NavSection } from "../api/types";

function OpenBucketMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="ob-brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#171717" />
      <path d="M8 10.5h16l-1.6 12.2a3 3 0 0 1-3 2.6h-6.8a3 3 0 0 1-3-2.6L8 10.5Z" fill="#fff" />
      <path d="M7 8.5A1.5 1.5 0 0 1 8.5 7h15a1.5 1.5 0 0 1 0 3h-15A1.5 1.5 0 0 1 7 8.5Z" fill="#fff" />
      <path d="M12 15h8M12.7 19h6.6" stroke="#171717" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar({
  navSections, activeNavId, onNavigate, workspaceSwitcher, sidebarFooter, mobileNavOpen, onCloseMobile,
}: {
  navSections: NavSection[];
  activeNavId: string;
  onNavigate: (id: string) => void;
  workspaceSwitcher?: ReactNode;
  sidebarFooter?: ReactNode;
  mobileNavOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      <aside className={`ob-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="ob-brand-row">
          <OpenBucketMark />
          <div><strong>OpenBucket</strong><span>Dashboard</span></div>
          <button className="ob-mobile-close ob-icon-button" type="button" aria-label="Close navigation" onClick={onCloseMobile}><X size={16} /></button>
        </div>
        {workspaceSwitcher}
        {navSections.map((section) => (
          <nav key={section.id} aria-label={section.label ?? section.id}>
            {section.label ? <p className="ob-nav-label">{section.label}</p> : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={activeNavId === item.id ? "active" : ""} type="button" onClick={() => { onNavigate(item.id); onCloseMobile(); }}>
                  <Icon size={17} aria-hidden="true" />{item.label}
                </button>
              );
            })}
          </nav>
        ))}
        {sidebarFooter ? <div className="ob-sidebar-foot">{sidebarFooter}</div> : null}
      </aside>
      {mobileNavOpen ? <button className="ob-sidebar-scrim" type="button" aria-label="Close navigation" onClick={onCloseMobile} /> : null}
    </>
  );
}
