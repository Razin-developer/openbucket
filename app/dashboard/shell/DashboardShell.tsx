import { useState, type ReactNode } from "react";
import type { NavSection } from "../api/types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ThemeProvider } from "./ThemeProvider";
import { Toaster } from "../../components/ui/sonner";
import { TooltipProvider } from "../../components/ui/tooltip";
import "../dashboard-shell.css";

/**
 * The only sidebar+topbar+main layout used anywhere in OpenBucket — standalone local dashboard,
 * hosted account-level dashboard, and hosted "node selected" view all mount this same component,
 * varying only its props. Pure layout: no data fetching, no auth logic.
 */
export function DashboardShell({
  navSections, activeNavId, onNavigate, workspaceSwitcher, sidebarFooter, breadcrumbs, search, topbarActions,
  avatarStack, children,
}: {
  navSections: NavSection[];
  activeNavId: string;
  onNavigate: (id: string) => void;
  workspaceSwitcher?: ReactNode;
  sidebarFooter?: ReactNode;
  breadcrumbs: ReactNode;
  search?: ReactNode;
  topbarActions?: ReactNode;
  avatarStack?: ReactNode;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <ThemeProvider>
      <TooltipProvider>
        <div className="ob-shell">
          <a className="ob-skip-link" href="#ob-main-content">Skip to content</a>
          <Sidebar
            navSections={navSections}
            activeNavId={activeNavId}
            onNavigate={onNavigate}
            workspaceSwitcher={workspaceSwitcher}
            sidebarFooter={sidebarFooter}
            mobileNavOpen={mobileNavOpen}
            onCloseMobile={() => setMobileNavOpen(false)}
          />
          <div className="ob-workspace">
            <Topbar
              breadcrumbs={breadcrumbs}
              search={search}
              topbarActions={topbarActions}
              avatarStack={avatarStack}
              onOpenMobileNav={() => setMobileNavOpen(true)}
            />
            <main id="ob-main-content" className="ob-main-content">{children}</main>
          </div>
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
