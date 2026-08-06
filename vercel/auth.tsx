/* eslint-disable @next/next/no-html-link-for-pages */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { HostedControlPlane, type AccountUser } from "./control-plane";
import { BrandMark, SiteShell } from "./site-shell";

type User = AccountUser;
type AuthResponse = { user?: User; ok?: boolean; message?: string; error?: { code?: string; message?: string } };
type GateState = { kind: "loading" } | { kind: "ready"; user: User } | { kind: "error"; message: string };

const dashboardMinWidthQuery = "(min-width: 900px)";

function useMeetsDashboardMinWidth(): boolean {
  const [meets, setMeets] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(dashboardMinWidthQuery).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(dashboardMinWidthQuery);
    const onChange = () => setMeets(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return meets;
}

function SmallScreenGate() {
  return (
    <main className="auth-gate">
      <span className="auth-gate-mark" aria-hidden="true"><BrandMark size={40} /></span>
      <h1>A larger screen is required</h1>
      <p>The OpenBucket dashboard is built for managing storage nodes with room to work — it isn&apos;t available on small screens yet. Please reopen it on a tablet or desktop.</p>
      <a className="site-button dark" href="/">Return home</a>
    </main>
  );
}

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

const googleErrorMessages: Record<string, string> = {
  google_state_missing: "The Google sign-in attempt expired. Please try again.",
  google_state_mismatch: "The Google sign-in attempt could not be verified. Please try again.",
  google_reserved_email: "That email is reserved. Sign in with your account email and password instead.",
  google_account_disabled: "This account has been disabled.",
  google_signin_failed: "Google sign-in failed. Please try again.",
};

function googleStartUrl(): string {
  return `/api/auth/google/start?next=${encodeURIComponent(safeNextPath())}`;
}

function GoogleButton() {
  return (
    <a className="site-button light auth-google" href={googleStartUrl()}>
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.34Z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58Z" />
      </svg>
      Continue with Google
    </a>
  );
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const code = new URLSearchParams(window.location.search).get("error");
    return code ? googleErrorMessages[code] || "Sign-in failed. Please try again." : "";
  });

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
        <section className="auth-panel">
          <div className="auth-card">
            <p className="section-kicker">OPENBUCKET ACCOUNT</p>
            <h1>{registering ? "Create your account." : "Welcome back."}</h1>
            <p>{registering ? "Set up an account to pair your OpenBucket node with the hosted dashboard." : "Sign in to open the hosted dashboard and connect your OpenBucket node."}</p>
            <GoogleButton />
            <div className="auth-divider"><span>or</span></div>
            <form onSubmit={(event) => void submit(event)}>
              {registering ? <label><span>Name <small>optional</small></span><input name="name" type="text" autoComplete="name" maxLength={80} placeholder="Your name" /></label> : null}
              <label><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
              <label>
                <span className="auth-label-row">
                  Password
                  {!registering ? <a className="auth-forgot-link" href="/forgot-password">Forgot password?</a> : null}
                </span>
                <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={12} maxLength={128} placeholder="At least 12 characters" />
              </label>
              {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
              <button className="site-button dark auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
            </form>
            {registering ? <p className="auth-switch">Already have an account? <a href="/login">Sign in</a></p>
              : <p className="auth-switch">Need an account? <a href="/register">Create one</a></p>}
            <p className="auth-privacy">Web authentication protects the hosted route. Your local daemon still requires its own management token, kept in this tab&apos;s session storage.</p>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

export function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function requestReset(targetEmail: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      if (!response.ok && response.status !== 429) {
        const payload = await readAuthResponse(response);
        throw new Error(payload.error?.message || "Something went wrong. Please try again.");
      }
      setSent(true);
      setCooldown(30);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetEmail = String(form.get("email") ?? "").trim();
    setEmail(targetEmail);
    void requestReset(targetEmail);
  }

  return (
    <SiteShell current="login" compact>
      <main className="auth-layout">
        <section className="auth-panel">
          <div className="auth-card">
            <p className="section-kicker">RESET YOUR PASSWORD</p>
            {sent ? (
              <>
                <h1>Check your email.</h1>
                <p>If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 30 minutes.</p>
                <button
                  className="site-button light auth-submit"
                  type="button"
                  disabled={busy || cooldown > 0}
                  onClick={() => void requestReset(email)}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : busy ? "Sending…" : "Resend email"}
                </button>
                <p className="auth-switch"><a href="/login">Back to sign in</a></p>
              </>
            ) : (
              <>
                <h1>Forgot your password?</h1>
                <p>Enter your account email and we&apos;ll send you a link to reset it.</p>
                <form onSubmit={submit}>
                  <label><span>Email</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" /></label>
                  {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
                  <button className="site-button dark auth-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
                </form>
                <p className="auth-switch"><a href="/login">Back to sign in</a></p>
              </>
            )}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

export function ResetPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const token = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setError("Passwords don't match.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = await readAuthResponse(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message || "This reset link is invalid or has expired.");
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This reset link is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SiteShell current="login" compact>
      <main className="auth-layout">
        <section className="auth-panel">
          <div className="auth-card">
            <p className="section-kicker">RESET YOUR PASSWORD</p>
            {done ? (
              <>
                <span className="auth-success-mark" aria-hidden="true"><CheckCircle2 size={28} /></span>
                <h1>Password updated.</h1>
                <p>Your password has been changed and any other signed-in sessions were signed out.</p>
                <a className="site-button dark auth-submit" href="/login">Sign in</a>
              </>
            ) : !token ? (
              <>
                <h1>This link is missing a token.</h1>
                <p>Request a new password reset link and open it directly from your email.</p>
                <a className="site-button dark auth-submit" href="/forgot-password">Request a new link</a>
              </>
            ) : (
              <>
                <h1>Choose a new password.</h1>
                <p>Enter a new password for your account.</p>
                <form onSubmit={(event) => void submit(event)}>
                  <label><span>New password</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} placeholder="At least 12 characters" /></label>
                  <label><span>Confirm password</span><input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} placeholder="Repeat your new password" /></label>
                  {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
                  <button className="site-button dark auth-submit" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
                </form>
              </>
            )}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

export function ProtectedDashboard() {
  const meetsMinWidth = useMeetsDashboardMinWidth();
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

  if (!meetsMinWidth) {
    return <SmallScreenGate />;
  }
  if (state.kind === "loading") {
    return <main className="auth-gate"><span className="auth-gate-mark" aria-hidden="true"><BrandMark size={40} /><i /></span><p>Opening your dashboard…</p></main>;
  }
  if (state.kind === "error") {
    return <main className="auth-gate"><span className="auth-gate-mark error" aria-hidden="true"><AlertCircle size={24} /></span><h1>Dashboard unavailable</h1><p>{state.message}</p><button className="site-button dark" type="button" onClick={() => { setState({ kind: "loading" }); void loadSession(); }}>Try again</button></main>;
  }
  return <HostedControlPlane user={state.user} />;
}
