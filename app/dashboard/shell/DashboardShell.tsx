import { useEffect, useState, type ReactNode } from "react";
import type { NavSection } from "../api/types";
import { Sidebar } from "./Sidebar";
import { Topbar, type BreadcrumbCrumb } from "./Topbar";
import { ThemeProvider } from "./ThemeProvider";
import { Toaster } from "../../components/ui/sonner";
import { TooltipProvider } from "../../components/ui/tooltip";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "../../components/ui/command";
import "../dashboard-shell.css";

const MOBILE_GUARD_MIN_WIDTH = 768;

function useIsBelowMobileGuard() {
  const [tooNarrow, setTooNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_GUARD_MIN_WIDTH - 1}px)`);
    const update = () => setTooNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return tooNarrow;
}

function MobileGuard() {
  return (
    <div className="ob-mobile-guard" role="alert">
      <div className="ob-mobile-guard-card">
        <strong>Use a bigger screen</strong>
        <p>OpenBucket&apos;s dashboard needs a bigger screen — use a tablet or desktop to manage buckets, keys, and logs.</p>
      </div>
    </div>
  );
}

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
  breadcrumbs: BreadcrumbCrumb[];
  search?: ReactNode;
  topbarActions?: ReactNode;
  avatarStack?: ReactNode;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const tooNarrow = useIsBelowMobileGuard();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (tooNarrow) {
    return (
      <ThemeProvider>
        <div className="ob-shell">
          <MobileGuard />
        </div>
      </ThemeProvider>
    );
  }

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
              onOpenCommandPalette={() => setPaletteOpen(true)}
            />
            <main id="ob-main-content" className="ob-main-content">{children}</main>
          </div>
          <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
            <Command>
              <CommandInput placeholder="Jump to a section… (Ctrl/Cmd+K)" />
              <CommandList>
                <CommandEmpty>No matching section.</CommandEmpty>
                {navSections.map((section) => (
                  <CommandGroup key={section.id} heading={section.label ?? "Navigate"}>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <CommandItem
                          key={item.id}
                          value={`${section.label ?? ""} ${item.label}`}
                          onSelect={() => { onNavigate(item.id); setPaletteOpen(false); }}
                        >
                          <Icon size={15} aria-hidden="true" />
                          {item.label}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </CommandDialog>
          <Toaster position="bottom-right" />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
