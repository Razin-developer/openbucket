"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { Label } from "../../../components/ui/label";

/** Light/dark toggle for Settings > Appearance. Guards against the next-themes hydration flash. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Guards against the next-themes SSR/hydration flash: `theme` is only meaningful client-side,
    // after localStorage has been read, so the switch stays disabled until then. This is
    // next-themes' own documented mounted-guard pattern, not state derived from props/state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const isDark = mounted && theme === "dark";

  return (
    <div className="ob-check-row" style={{ cursor: "default" }}>
      <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 20, marginTop: 2 }}>
        {isDark ? <Moon size={16} /> : <Sun size={16} />}
      </span>
      <span style={{ flex: 1 }}>
        <Label htmlFor="ob-theme-toggle"><strong>Dark mode</strong></Label>
        <small>{isDark ? "The dashboard is using its dark palette." : "The dashboard is using its light palette."}</small>
      </span>
      <Switch
        id="ob-theme-toggle"
        checked={isDark}
        disabled={!mounted}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Toggle dark mode"
      />
    </div>
  );
}
