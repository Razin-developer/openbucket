import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import type { AccountUser } from "../../api/account-api";

export function AccountProfileView({ user }: { user: AccountUser }) {
  return (
    <>
      <header className="ob-page-heading"><div><p className="ob-eyebrow">AUTHENTICATED PROFILE</p><h1>Account</h1><p>Your identity is read from the current secure server session.</p></div></header>
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
      <section className="ob-account-note">
        <p className="ob-eyebrow">SEPARATE SECURITY BOUNDARIES</p>
        <h2>Account login never exposes a daemon token.</h2>
        <p>The live node view receives a short-lived, node-scoped capability only after the owner opens it. Infrastructure addresses and long-lived storage credentials stay off this dashboard.</p>
      </section>
    </>
  );
}
