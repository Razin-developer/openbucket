import { useState, type FormEvent } from "react";
import { AlertCircle, Check } from "lucide-react";
import { SiteShell, githubUrl } from "./site-shell";
import { bugReportFormSchema, feedbackFormSchema, validateForm } from "./validation";

function InfoHero({ kicker, title, lead }: { kicker: string; title: string; lead?: string }) {
  return (
    <header className="docs-hero" id="top">
      <p className="section-kicker">{kicker}</p>
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
    </header>
  );
}

async function postJson(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true, message: "" };
    if (response.status === 429) return { ok: false, message: "Too many submissions from this connection. Try again in a bit." };
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return { ok: false, message: payload?.error?.message || "Something went wrong. Please try again." };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

export function FeedbackPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const validated = validateForm(feedbackFormSchema, {
      message: String(form.get("message") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
    });
    if (!validated.ok) { setError(validated.message); return; }
    setBusy(true);
    const result = await postJson("/api/feedback", {
      message: validated.value.message,
      email: validated.value.email || undefined,
      name: validated.value.name || undefined,
      path: "/feedback",
    });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.message);
  }

  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero kicker="FEEDBACK" title="Tell us what's working — or not." lead="Feature ideas, rough edges, anything you'd change. This goes straight to the people building OpenBucket." />
        {sent ? (
          <div className="info-success"><Check size={18} aria-hidden="true" /> Thanks — your feedback was sent.</div>
        ) : (
          <form className="info-form" onSubmit={(event) => void submit(event)}>
            <label><span>Name <small>optional</small></span><input name="name" type="text" maxLength={200} placeholder="Your name" /></label>
            <label><span>Email <small>optional, if you&apos;d like a reply</small></span><input name="email" type="email" maxLength={254} placeholder="you@example.com" /></label>
            <label><span>Feedback</span><textarea name="message" required maxLength={4000} rows={7} placeholder="What's on your mind?" /></label>
            {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
            <button className="site-button dark" type="submit" disabled={busy}>{busy ? "Sending…" : "Send feedback"}</button>
          </form>
        )}
      </main>
    </SiteShell>
  );
}

const severities = [
  { value: "low", label: "Low — cosmetic or minor annoyance" },
  { value: "medium", label: "Medium — gets in the way" },
  { value: "high", label: "High — blocks normal use" },
  { value: "critical", label: "Critical — data loss or security" },
];

export function BugReportPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const validated = validateForm(bugReportFormSchema, {
      title: String(form.get("title") ?? "").trim(),
      message: String(form.get("message") ?? "").trim(),
      stepsToReproduce: String(form.get("stepsToReproduce") ?? "").trim(),
      severity: String(form.get("severity") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
    });
    if (!validated.ok) { setError(validated.message); return; }
    setBusy(true);
    const result = await postJson("/api/bugs", {
      title: validated.value.title,
      message: validated.value.message,
      stepsToReproduce: validated.value.stepsToReproduce || undefined,
      severity: validated.value.severity || undefined,
      email: validated.value.email || undefined,
      path: "/report-bug",
    });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.message);
  }

  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero kicker="BUG REPORT" title="Found something broken?" lead="Include the OpenBucket version, your OS, and exact steps if you can — it's the difference between a same-day fix and a guess. Never include credentials, tokens, or share URLs here; use the security process instead." />
        <p className="info-note">Security vulnerability? Don&apos;t file it here — follow the <a href={`${githubUrl}/blob/main/docs/SECURITY.md`}>security reporting process</a> instead.</p>
        {sent ? (
          <div className="info-success"><Check size={18} aria-hidden="true" /> Thanks — your bug report was sent.</div>
        ) : (
          <form className="info-form" onSubmit={(event) => void submit(event)}>
            <label><span>Title</span><input name="title" type="text" required maxLength={200} placeholder="Short summary of the bug" /></label>
            <label><span>What happened</span><textarea name="message" required maxLength={4000} rows={5} placeholder="What did you expect, and what happened instead?" /></label>
            <label><span>Steps to reproduce <small>optional</small></span><textarea name="stepsToReproduce" maxLength={4000} rows={4} placeholder={"1. \n2. \n3. "} /></label>
            <label>
              <span>Severity <small>optional</small></span>
              <select name="severity" defaultValue="">
                <option value="">Not sure</option>
                {severities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label><span>Email <small>optional, if you&apos;d like a reply</small></span><input name="email" type="email" maxLength={254} placeholder="you@example.com" /></label>
            {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
            <button className="site-button dark" type="submit" disabled={busy}>{busy ? "Sending…" : "Report bug"}</button>
          </form>
        )}
      </main>
    </SiteShell>
  );
}

const faqEntries: { question: string; answer: string }[] = [
  { question: "Is OpenBucket really S3-compatible?", answer: "Path-style requests, AWS Signature Version 4, presigned URLs, range reads, and multipart uploads all work against your endpoint. Compatibility is deliberately partial — test your specific client/workload against it before relying on it in production." },
  { question: "Where do my files actually live?", answer: "On the disk you point the daemon at. The daemon serves real bytes from that directory; nothing is uploaded to a third party unless you configure a tunnel yourself." },
  { question: "What does the hosted dashboard store?", answer: "Account info, node registrations, presence, storage/usage summaries. Object bytes, raw node tokens, management credentials, and S3 keys never leave the storage host — see the full breakdown in the Security docs." },
  { question: "Do I need an account to use OpenBucket?", answer: "No. Run `openbucket serve <path> --offline` for fully local, account-free development. An account is only needed to pair a node with the hosted dashboard and get a public tunnel." },
  { question: "Is the interactive console (TUI) stable?", answer: "It's labeled beta — functional, but newer and less exercised than the plain CLI commands it wraps. Every action it offers is also available as a scriptable flag." },
  { question: "How do I rename a node without breaking my S3 client config?", answer: "Use `openbucket rename <new-name>`. The node's public routing identifier (routeSlug) stays fixed for its lifetime even though the display name changes, so an already-configured endpoint keeps working." },
  { question: "Can two people register a node with the same name?", answer: "Yes — a node name is a display label, not a unique identifier, the way two different Vercel accounts can each have a project called \"my-app\". Each node still gets its own unique routing identifier." },
  { question: "How do I report a security issue?", answer: "Don't use the bug report form. Follow the security reporting process in the repository's SECURITY.md so a vulnerability isn't disclosed publicly before it's fixed." },
];

export function FaqPage() {
  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero kicker="FAQ" title="Frequently asked questions." />
        <div className="faq-list">
          {faqEntries.map((entry) => (
            <details className="faq-item" key={entry.question}>
              <summary>{entry.question}</summary>
              <p>{entry.answer}</p>
            </details>
          ))}
        </div>
        <p className="info-note">Didn&apos;t find your answer? <a href="/docs">Read the docs</a> or <a href="/feedback">send us feedback</a>.</p>
      </main>
    </SiteShell>
  );
}

export function PrivacyPolicyPage() {
  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero kicker="LEGAL" title="Privacy policy." lead="Last updated 2026-08-07." />
        <div className="info-prose">
          <h2>What we collect</h2>
          <p>Creating a hosted account collects your email address, a hashed password (or a Google account identifier if you sign in with Google), and account metadata (display name, handle, timestamps). Operating a node through the hosted control plane collects node registrations, presence/heartbeat data, and aggregate storage and request counters.</p>
          <h2>What we never collect</h2>
          <p>Object bytes stored in your buckets, raw node management tokens, S3 access keys, and daemon management credentials never leave the machine running the daemon. The hosted dashboard only ever sees the metadata described above.</p>
          <h2>Feedback and bug reports</h2>
          <p>If you submit the feedback or bug report forms, we store what you typed, an optional name/email if you provide one, the page you submitted from, and your browser&apos;s user-agent string. We do not store your IP address directly — submissions are rate-limited using a keyed hash of your IP that cannot be reversed back to the address.</p>
          <h2>Cookies</h2>
          <p>A single session cookie is used to keep you signed in to the hosted dashboard. It is not used for advertising or cross-site tracking.</p>
          <h2>Third parties</h2>
          <p>We use Vercel for hosting and MongoDB Atlas for the hosted database. Neither is used for advertising. We do not sell personal data.</p>
          <h2>Your choices</h2>
          <p>You can delete your hosted account and its nodes at any time from the dashboard. Contact us through the <a href="/feedback">feedback form</a> for any other data request.</p>
        </div>
      </main>
    </SiteShell>
  );
}

export function TermsPage() {
  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero kicker="LEGAL" title="Terms of service." lead="Last updated 2026-08-07." />
        <div className="info-prose">
          <h2>The software</h2>
          <p>OpenBucket&apos;s daemon, CLI, and dashboard are open-source under the Apache-2.0 license. You may self-host and modify them under that license&apos;s terms; see the <a href={`${githubUrl}/blob/main/LICENSE`}>LICENSE</a> file.</p>
          <h2>The hosted service</h2>
          <p>The hosted dashboard at this domain is provided on an as-is, best-effort basis with no uptime guarantee. It is a control-plane and discovery convenience — it never stores or transmits your object bytes, and object storage itself remains entirely your responsibility on the host running the daemon.</p>
          <h2>Acceptable use</h2>
          <p>Don&apos;t use the hosted service to proxy or relay traffic unrelated to operating your own OpenBucket node, attempt to access another account&apos;s node or data, or abuse the feedback/bug-report forms. Accounts used this way may be suspended.</p>
          <h2>No warranty</h2>
          <p>The software and hosted service are provided without warranty of any kind, to the extent permitted by law. You are responsible for your own backups and data durability.</p>
          <h2>Changes</h2>
          <p>These terms may change as the project evolves. Continued use of the hosted service after a change means you accept the updated terms.</p>
        </div>
      </main>
    </SiteShell>
  );
}
