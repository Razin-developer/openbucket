import { Menu } from "lucide-react";
import type { ReactNode } from "react";

export function Topbar({
  breadcrumbs, search, topbarActions, avatarStack, onOpenMobileNav,
}: {
  breadcrumbs: ReactNode;
  search?: ReactNode;
  topbarActions?: ReactNode;
  avatarStack?: ReactNode;
  onOpenMobileNav: () => void;
}) {
  return (
    <header className="ob-topbar">
      <button className="ob-mobile-menu ob-icon-button" type="button" aria-label="Open navigation" onClick={onOpenMobileNav}><Menu size={18} /></button>
      <div className="ob-breadcrumbs">{breadcrumbs}</div>
      {search ? <div className="ob-topbar-search">{search}</div> : null}
      <div className="ob-topbar-actions">
        {topbarActions}
        {avatarStack}
      </div>
    </header>
  );
}
