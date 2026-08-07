// Supersedes both `.metric-card` (old app/dashboard.tsx) and `.cp-metric` (old control-plane.css).
export function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="ob-stat-card">
      <p className="ob-eyebrow">{label}</p>
      <p className="ob-stat-value">{value}</p>
      {detail ? <p className="ob-stat-detail">{detail}</p> : null}
    </article>
  );
}
