import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Separator } from "../../../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { CopyButton } from "../../components/CopyButton";
import { formatDuration } from "../../api/format";
import type { AccountUser } from "../../api/account-api";
import type { NodeViewContext } from "../node/context";
import { ThemeToggle } from "./ThemeToggle";

type SettingsViewProps =
  | { context: "account"; user: AccountUser; node?: undefined; onOpenConnectionSettings?: undefined }
  | { context: "node"; node: NodeViewContext; onOpenConnectionSettings: () => void; user?: undefined };

function ProfilePanel(props: SettingsViewProps) {
  if (props.context === "account") {
    const { user } = props;
    return (
      <section className="ob-profile-card">
        <Avatar size="lg" className="size-[75px] rounded-md">
          <AvatarFallback className="rounded-md bg-[color:var(--ink)] text-[27px] font-extrabold text-white">
            {(user.name || user.email)[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div><span>Name</span><strong>{user.name || "Not set"}</strong></div>
        <div><span>Email</span><strong>{user.email}</strong></div>
        <div><span>Role</span><strong className="ob-role">{user.role}</strong></div>
        <div><span>User ID</span><code>{user.id}</code></div>
      </section>
    );
  }

  const { node, onOpenConnectionSettings } = props;
  const { status, loadState, apiBase, adminToken, displayUrl } = node;
  return (
    <section className="ob-profile-card" style={{ gridTemplateColumns: "75px repeat(3, 1fr)" }}>
      <Avatar size="lg" className="size-[75px] rounded-md">
        <AvatarFallback className="rounded-md bg-[color:var(--ink)] text-[27px] font-extrabold text-white">
          {(status?.nodeName || "OB")[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div><span>Node name</span><strong>{status?.nodeName || "Not connected"}</strong></div>
      <div><span>Status</span><strong className="ob-role">{loadState === "connected" ? "Online" : loadState === "loading" ? "Connecting" : "Offline"}</strong></div>
      <div><span>Version</span><strong>{status?.version || "—"}</strong></div>
      <div><span>Storage root</span><code>{status?.storageRoot || "—"}</code></div>
      <div><span>Management API</span><code>{displayUrl ?? apiBase}</code></div>
      <div><span>Uptime</span><strong>{status ? formatDuration(status.uptimeSeconds) : "—"}</strong></div>
      {adminToken ? <div><span>Session</span><strong>Token-authenticated</strong></div> : null}
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8 }}>
        {apiBase ? <CopyButton value={apiBase} label="Copy API URL" /> : null}
        <button className="ob-button secondary compact" type="button" onClick={onOpenConnectionSettings}>Connection settings</button>
      </div>
    </section>
  );
}

export function SettingsView(props: SettingsViewProps) {
  return (
    <>
      <header className="ob-page-heading">
        <div>
          <p className="ob-eyebrow">DASHBOARD PREFERENCES</p>
          <h1>Settings</h1>
          <p>{props.context === "account" ? "Your account identity and how the dashboard looks." : "This node's identity, connection, and how the dashboard looks."}</p>
        </div>
      </header>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="ob-settings-panel">
          <ProfilePanel {...props} />
          {props.context === "account" ? (
            <section className="ob-account-note">
              <p className="ob-eyebrow">SEPARATE SECURITY BOUNDARIES</p>
              <h2>Account login never exposes a daemon token.</h2>
              <p>The live node view receives a short-lived, node-scoped capability only after the owner opens it. Infrastructure addresses and long-lived storage credentials stay off this dashboard.</p>
            </section>
          ) : null}
        </TabsContent>
        <TabsContent value="appearance" className="ob-settings-panel">
          <section className="ob-account-note">
            <p className="ob-eyebrow">THEME</p>
            <h2>Choose how OpenBucket looks.</h2>
            <Separator className="my-4" />
            <ThemeToggle />
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
