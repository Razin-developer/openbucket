import { useState, type FormEvent } from "react";
import { AlertCircle, Check } from "lucide-react";
import { SiteShell } from "./site-shell";
import { helpRequestFormSchema, validateForm } from "./validation";

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

export function HelpPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const validated = validateForm(helpRequestFormSchema, {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      subject: String(form.get("subject") ?? "").trim(),
      message: String(form.get("message") ?? "").trim(),
    });
    if (!validated.ok) { setError(validated.message); return; }
    setBusy(true);
    const result = await postJson("/api/help", {
      name: validated.value.name || undefined,
      email: validated.value.email,
      subject: validated.value.subject,
      message: validated.value.message,
      path: "/help",
    });
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.message);
  }

  return (
    <SiteShell current="docs">
      <main className="info-page">
        <InfoHero
          kicker="HELP & CONTACT"
          title="Get help from a real person."
          lead="Stuck on setup, connecting a client, or something the docs don't cover? Send us the details and we'll reply by email."
        />
        {sent ? (
          <div className="info-success"><Check size={18} aria-hidden="true" /> Thanks — we received your message and will reply by email.</div>
        ) : (
          <form className="info-form" onSubmit={(event) => void submit(event)}>
            <label><span>Name <small>optional</small></span><input name="name" type="text" maxLength={200} placeholder="Your name" /></label>
            <label><span>Email</span><input name="email" type="email" required maxLength={254} placeholder="you@example.com" /></label>
            <label><span>Subject</span><input name="subject" type="text" required maxLength={200} placeholder="What's this about?" /></label>
            <label><span>Message</span><textarea name="message" required maxLength={4000} rows={7} placeholder="Tell us what you need help with." /></label>
            {error ? <div className="auth-error" role="alert"><span aria-hidden="true"><AlertCircle size={14} /></span>{error}</div> : null}
            <button className="site-button dark" type="submit" disabled={busy}>{busy ? "Sending…" : "Send message"}</button>
          </form>
        )}
        <div className="info-prose">
          <h2>Common questions</h2>
          <p>Before writing in, a lot of the usual questions — self-hosting, what the hosted dashboard stores, renaming a node, and more — are already answered on the <a href="/faq">FAQ page</a>. It&apos;s worth a quick look first.</p>
        </div>
        <p className="info-note"><a href="/faq">Browse the FAQ &rarr;</a></p>
      </main>
    </SiteShell>
  );
}
