import { Menu, Search } from "lucide-react";
import type { ReactNode } from "react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "../../components/ui/breadcrumb";
import { Kbd, KbdGroup } from "../../components/ui/kbd";

export type BreadcrumbCrumb = { label: string; onClick?: () => void };

export function Topbar({
  breadcrumbs, search, topbarActions, avatarStack, onOpenMobileNav, onOpenCommandPalette,
}: {
  breadcrumbs: BreadcrumbCrumb[];
  search?: ReactNode;
  topbarActions?: ReactNode;
  avatarStack?: ReactNode;
  onOpenMobileNav: () => void;
  onOpenCommandPalette?: () => void;
}) {
  return (
    <header className="ob-topbar">
      <button className="ob-mobile-menu ob-icon-button" type="button" aria-label="Open navigation" onClick={onOpenMobileNav}><Menu size={18} /></button>
      <div className="ob-breadcrumbs">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="contents">
                  <BreadcrumbItem>
                    {isLast || !crumb.onClick ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <button type="button" onClick={crumb.onClick}>{crumb.label}</button>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {isLast ? null : <BreadcrumbSeparator />}
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      {search ? <div className="ob-topbar-search">{search}</div> : null}
      <div className="ob-topbar-actions">
        {onOpenCommandPalette ? (
          <button className="ob-command-trigger" type="button" onClick={onOpenCommandPalette}>
            <Search size={13} />
            <span>Jump to…</span>
            <KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup>
          </button>
        ) : null}
        {topbarActions}
        {avatarStack}
      </div>
    </header>
  );
}
