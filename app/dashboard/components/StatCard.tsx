import { Card } from "../../components/ui/card";

// Supersedes both `.metric-card` (old app/dashboard.tsx) and `.cp-metric` (old control-plane.css).
// Wraps shadcn's Card for structure/elevation while keeping the .ob-stat-card sizing/spacing rules
// and this component's existing external prop API (label/value/detail) untouched.
export function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="ob-stat-card gap-0 rounded-[var(--radius-lg)] py-0 ring-0">
      <p className="ob-eyebrow">{label}</p>
      <p className="ob-stat-value">{value}</p>
      {detail ? <p className="ob-stat-detail">{detail}</p> : null}
    </Card>
  );
}
