import { Activity, Box, Cable, FileKey2, LayoutDashboard, MessageSquare, Network, ShieldCheck, UserRound } from "lucide-react";
import type { NavItem } from "../api/types";

export const NODE_NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "buckets", label: "Buckets", icon: Box },
  { id: "keys", label: "API keys", icon: FileKey2 },
  { id: "connections", label: "Connections", icon: Cable },
  { id: "logs", label: "Logs & analytics", icon: Activity },
];

export const ACCOUNT_NAV_ITEMS: NavItem[] = [
  { id: "account-overview", label: "Overview", icon: LayoutDashboard },
  { id: "nodes", label: "Nodes", icon: Network },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "account", label: "Account", icon: UserRound },
];

export const ACCOUNT_ADMIN_NAV_ITEMS: NavItem[] = [
  { id: "admin", label: "Admin", icon: ShieldCheck },
  { id: "support", label: "Support", icon: MessageSquare },
];
