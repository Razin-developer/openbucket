import { useCallback, useEffect, useState } from "react";
import { Bug, MessageSquare } from "lucide-react";
import { controlPlaneApi, type SupportListResponse } from "../../api/account-api";
import { formatDate } from "../../api/format";

export function SupportView() {
  const [kindFilter, setKindFilter] = useState<"" | "feedback" | "bug">("");
  const [statusFilter, setStatusFilter] = useState<"" | "new" | "reviewed" | "resolved">("");
  const [data, setData] = useState<SupportListResponse | null>(null);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await controlPlaneApi.listSupport(kindFilter || undefined, statusFilter || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load submissions.");
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function setStatus(id: string, status: "new" | "reviewed" | "resolved") {
    setUpdatingId(id);
    try {
      await controlPlaneApi.updateSupportStatus(id, status);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update submission.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <>
      <header className="ob-page-heading">
        <div><p className="ob-eyebrow">FEEDBACK &amp; BUG REPORTS</p><h1>Support inbox</h1><p>Submitted through the public feedback and bug report forms.</p></div>
        {data ? <span className="ob-generated">{data.newCount} new · {data.totalCount} total</span> : null}
      </header>
      <div className="ob-support-filters">
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
          <option value="">All types</option>
          <option value="feedback">Feedback</option>
          <option value="bug">Bug reports</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>
      {error ? <section className="ob-state-panel error"><h2>Support data unavailable</h2><p>{error}</p></section> : null}
      {!error && !data ? <div className="ob-loading" aria-live="polite"><span /><span /><span /><p>Loading submissions…</p></div> : null}
      {!error && data && data.submissions.length === 0 ? <section className="ob-state-panel"><h2>No submissions</h2><p>Nothing matches this filter yet.</p></section> : null}
      {!error && data && data.submissions.length > 0 ? (
        <div className="ob-support-list">
          {data.submissions.map((item) => (
            <article className={`ob-support-item ${item.status}`} key={item.id}>
              <div className="ob-support-item-head">
                <span className={`ob-support-kind ${item.kind}`}>{item.kind === "bug" ? <Bug size={13} /> : <MessageSquare size={13} />} {item.kind === "bug" ? "Bug" : "Feedback"}</span>
                {item.severity ? <span className={`ob-support-severity ${item.severity}`}>{item.severity}</span> : null}
                <span className="ob-support-status">{item.status}</span>
                <span className="ob-support-date">{formatDate(item.createdAt)}</span>
              </div>
              {item.title ? <h3>{item.title}</h3> : null}
              <p>{item.message}</p>
              {item.stepsToReproduce ? <p className="ob-support-steps"><strong>Steps to reproduce</strong><br />{item.stepsToReproduce}</p> : null}
              <div className="ob-support-item-foot">
                <span>{item.name || item.email || "Anonymous"}{item.path ? ` · ${item.path}` : ""}</span>
                <div className="ob-support-actions">
                  {(["new", "reviewed", "resolved"] as const).filter((status) => status !== item.status).map((status) => (
                    <button key={status} type="button" disabled={updatingId === item.id} onClick={() => void setStatus(item.id, status)}>Mark {status}</button>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}
