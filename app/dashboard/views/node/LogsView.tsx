import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EmptyState } from "../../components/EmptyState";
import { StatCard } from "../../components/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../../../components/ui/chart";
import { formatBytes, formatNumber, methodTone } from "../../api/format";
import type { NodeViewContext } from "./context";

const REQUEST_CHART_CONFIG = {
  ok: { label: "2xx / 3xx", color: "var(--success)" },
  error: { label: "4xx / 5xx", color: "var(--error)" },
} satisfies ChartConfig;

export function LogsView({ node }: { node: NodeViewContext }) {
  const { logs, analytics, refresh } = node;
  const [logFilter, setLogFilter] = useState("all");
  const visibleLogs = useMemo(() => logs.filter((log) => logFilter === "all" || (logFilter === "errors" ? log.status >= 400 : log.method === logFilter)), [logFilter, logs]);

  // Requests-over-time — buckets recent request logs into minute-wide slots so the chart reads as
  // a real timeline of traffic and error rate, computed entirely from data this view already has.
  const timeline = useMemo(() => {
    if (!logs.length) return [];
    const buckets = new Map<string, { time: string; ok: number; error: number; sortKey: number }>();
    for (const log of logs) {
      const date = new Date(log.timestamp);
      date.setSeconds(0, 0);
      const sortKey = date.getTime();
      const key = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const bucket = buckets.get(key) ?? { time: key, ok: 0, error: 0, sortKey };
      if (log.status >= 400) bucket.error += 1; else bucket.ok += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => a.sortKey - b.sortKey).slice(-24);
  }, [logs]);

  return (
    <section>
      <div className="ob-page-heading">
        <div><p className="ob-eyebrow">Observability</p><h1>Logs & analytics</h1><p>Every figure is computed from requests handled by this node.</p></div>
        <button className="ob-button secondary compact" type="button" onClick={() => void refresh()}>Refresh</button>
      </div>
      <div className="ob-stat-grid compact">
        <StatCard label="Total requests" value={formatNumber(analytics.requests)} detail={`${formatNumber(analytics.requestsToday)} today`} />
        <StatCard label="Uploaded" value={formatBytes(analytics.totalBytesIn)} detail="Request body bytes" />
        <StatCard label="Downloaded" value={formatBytes(analytics.totalBytesOut)} detail="Response body bytes" />
        <StatCard label="Errors" value={formatNumber(analytics.errors)} detail={analytics.requests ? `${((analytics.errors / analytics.requests) * 100).toFixed(2)}% error rate` : "No requests yet"} />
      </div>
      {timeline.length ? (
        <div className="ob-panel ob-chart-panel">
          <div className="ob-panel-head"><h2>Requests over time</h2><span className="ob-generated">Last {timeline.length} minute{timeline.length === 1 ? "" : "s"} of activity, by outcome</span></div>
          <ChartContainer config={REQUEST_CHART_CONFIG} className="ob-request-chart">
            <BarChart data={timeline}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="time" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="ok" stackId="requests" fill="var(--color-ok)" radius={[0, 0, 2, 2]} />
              <Bar dataKey="error" stackId="requests" fill="var(--color-error)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      ) : null}
      <div className="ob-logs-toolbar">
        <div className="ob-filter-pills" role="group" aria-label="Filter request logs">
          {["all", "GET", "PUT", "POST", "DELETE", "errors"].map((filter) => (
            <button key={filter} className={logFilter === filter ? "active" : ""} type="button" onClick={() => setLogFilter(filter)}>{filter === "all" ? "All requests" : filter === "errors" ? "Errors" : filter}</button>
          ))}
        </div>
        <span>{visibleLogs.length} shown</span>
      </div>
      {visibleLogs.length ? (
        <div className="ob-table-card ob-logs-table">
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Method</TableHead><TableHead>Request</TableHead><TableHead>Status</TableHead><TableHead>Transfer</TableHead><TableHead>Duration</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleLogs.map((log, index) => (
                <TableRow key={log.requestId ?? `${log.timestamp}-${index}`}>
                  <TableCell>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</TableCell>
                  <TableCell><span className={`ob-method ${methodTone(log.method)}`}>{log.method}</span></TableCell>
                  <TableCell className="ob-log-path"><code>{log.path}</code>{log.ip ? <small>{log.ip}</small> : null}</TableCell>
                  <TableCell><span className={`ob-status-code ${log.status >= 400 ? "bad" : "good"}`}>{log.status || "—"}</span></TableCell>
                  <TableCell>{formatBytes(log.bytesOut || log.bytesIn)}</TableCell>
                  <TableCell>{log.durationMs.toFixed(log.durationMs < 10 ? 1 : 0)} ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No matching requests." body="Use the S3 endpoint or upload an object from the Buckets page; handled requests will appear here." />
      )}
    </section>
  );
}
