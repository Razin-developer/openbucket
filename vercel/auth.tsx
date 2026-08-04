/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";
import { HostedControlPlane, type AccountUser } from "./control-plane";
import { SiteShell } from "./site-shell";

type User = AccountUser;
type AuthResponse = { user?: User; error?: { code?: string; message?: string } };
type GateState = { kind: "loading" } | { kind: "ready"; user: User } | { kind: "error"; message: string };

function safeNextPath(): string {
  const candidate = new URLSearchParams(window.location.search).get("next");
  return candidate === "/dashboard" || candidate?.startsWith("/dashboard?") ? candidate : "/dashboard";
}

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  try {
    return await response.json() as AuthResponse;
  } catch {
    return {};
  }
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    if (registering) {
      body.name = String(form.get("name") ?? "").trim();
      body.signupToken = String(form.get("signupToken") ?? "");
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readAuthResponse(response);
      if (!response.ok || !payload.user) {
        throw new Error(payload.error?.message || (response.status === 429 ? "Too many attempts. Wait a moment and try again." : "Authentication failed. Please try again."));
      }
      window.location.assign(safeNextPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <SiteShell current={mode} compact>
      <main className="auth-layout">
        <section className="auth-art" aria-hidden="true">
          <img src="/og.png" alt="" />
          <div className="auth-art-caption"><span>LOCAL STORAGE</span><i /><span>CLOUD INTERFACE</span></div>
        </section>
        <section className="auth-panel">
          <div className="auth-card">
            <p className="section-kicker">OPENBUCKET ACCOUNT</p>
            <h1>{registering ? "Set up the owner account." : "Welcome back."}</h1>
            <p>{registering ? "Use the one-time setup token configured on the server. MongoDB atomically closes registration after the first owner is created." : "Sign in to open the hosted dashboard and connect your OpenBucket node."}</p>
            <form onSubmit={(event) => void submit(event)}>
              {registering ? <label><span>One-time setup token</span><input name="signupToken" type="password" autoComplete="one-time-code" required minLength={32} maxLength={512} placeholder="Paste the server setup token" /></label> : null}
              {registering ? <label><span>Name <small>optional</small></span><input name="name" type="text" autoComplete="name" maxLength={80} placeholder="Your name" /></label> : null}
              <label><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
              <label><span>Password</span><input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={12} maxLength={128} placeholder="At least 12 characters" /></label>
              {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
              <button className="site-button dark auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
            </form>
            {registering ? <p className="auth-switch">Already have an account? <a href="/login">Sign in</a></p>
              : <p className="auth-switch">Need an owner account? <a href="/docs#dashboard">Owner setup guide</a></p>}
            <p className="auth-privacy">Web authentication protects the hosted route. Your local daemon still requires its own management token, kept in this tab&apos;s session storage.</p>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

export function ProtectedDashboard() {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "same-origin", headers: { accept: "application/json" } });
      const payload = await readAuthResponse(response);
      if (response.status === 401) {
        window.location.replace("/login?next=%2Fdashboard");
        return;
      }
      if (!response.ok || !payload.user) throw new Error(payload.error?.message || "The account service is temporarily unavailable.");
      setState({ kind: "ready", user: payload.user });
    } catch (cause) {
      setState({ kind: "error", message: cause instanceof Error ? cause.message : "The account service is temporarily unavailable." });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSession(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSession]);

  if (state.kind === "loading") {
    return <main className="auth-gate"><span className="auth-gate-mark" aria-hidden="true"><i /></span><p>Opening your dashboard…</p></main>;
  }
  if (state.kind === "error") {
    return <main className="auth-gate"><span className="auth-gate-mark error" aria-hidden="true"><AlertCircle size={24} /></span><h1>Dashboard unavailable</h1><p>{state.message}</p><button className="site-button dark" type="button" onClick={() => { setState({ kind: "loading" }); void loadSession(); }}>Try again</button></main>;
  }
  return <HostedControlPlane user={state.user} />;
}
