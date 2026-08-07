"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wraps the dashboard shell in next-themes so Settings > Appearance can flip light/dark and have
 * it persist (next-themes writes to localStorage by default). Uses `data-theme` on <html> — the
 * dark palette itself lives in app/dashboard/dashboard-shell.css under
 * `:root[data-theme="dark"] .ob-shell`, scoped to the dashboard chrome only (never the public site).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
