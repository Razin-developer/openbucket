import { useCallback, useEffect, useState } from "react";
import { controlPlaneApi, type AccountNode, type AccountUser, type AdminOverview, type UsageSummary } from "../api/account-api";

/** Account-level (hosted) data layer — moved out of HostedControlPlane's load() unchanged. */
export function useAccountData(user: AccountUser) {
  const [nodes, setNodes] = useState<AccountNode[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [admin, setAdmin] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    setError("");
    try {
      const [nodePayload, usagePayload] = await Promise.all([controlPlaneApi.listNodes(), controlPlaneApi.usage()]);
      setNodes(nodePayload.nodes);
      setUsage(usagePayload);
      if (user.role === "admin") {
        const adminPayload = await controlPlaneApi.adminOverview();
        setAdmin(adminPayload);
      } else {
        setAdmin(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The account data could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }, [user.role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return { nodes, usage, admin, error, refreshing, load };
}
