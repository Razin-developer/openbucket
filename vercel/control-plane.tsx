import { useCallback } from "react";
import { HostedDashboard } from "../app/dashboard";
import type { AccountRole, AccountUser } from "../app/dashboard/api/account-api";

export type { AccountRole, AccountUser };

/**
 * Thin wrapper around the shared HostedDashboard (app/dashboard/) — the account-level dashboard
 * used to be a ~420-line standalone implementation (`cp-shell`) with its own dark sidebar and a
 * separate `LiveNodeConsole` full-shell swap when opening a node. Both are gone: HostedDashboard
 * mounts the same DashboardShell used by the standalone local dashboard, and switches into a
 * node's views in place. This wrapper only keeps the logout call and the AccountUser passthrough.
 */
export function HostedControlPlane({ user }: { user: AccountUser }) {
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    } finally {
      window.location.assign("/");
    }
  }, []);

  return <HostedDashboard user={user} onLogout={() => void logout()} />;
}
