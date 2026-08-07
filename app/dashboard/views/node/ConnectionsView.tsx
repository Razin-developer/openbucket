import { useMemo, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import type { NodeViewContext } from "./context";

export function ConnectionsView({ node, onOpenConnectionSettings }: { node: NodeViewContext; onOpenConnectionSettings: () => void }) {
  const { loadState, keys, displayUrl } = node;
  const endpoint = "${OPENBUCKET_S3_ENDPOINT}";
  const accessKey = keys[0]?.accessKeyId ?? "YOUR_ACCESS_KEY";
  const snippets = useMemo(() => ({
    javascript: `import { S3Client } from "@aws-sdk/client-s3";\n\nconst s3 = new S3Client({\n  endpoint: "${endpoint}",\n  region: "auto",\n  forcePathStyle: true,\n  credentials: {\n    accessKeyId: process.env.OPENBUCKET_ACCESS_KEY,\n    secretAccessKey: process.env.OPENBUCKET_SECRET_KEY,\n  },\n});`,
    python: `import os\nimport boto3\n\ns3 = boto3.client(\n    "s3",\n    endpoint_url="${endpoint}",\n    region_name="auto",\n    aws_access_key_id=os.environ["OPENBUCKET_ACCESS_KEY"],\n    aws_secret_access_key=os.environ["OPENBUCKET_SECRET_KEY"],\n)`,
    aws: `AWS_ACCESS_KEY_ID=${accessKey} aws s3 ls \\\n  --endpoint-url ${endpoint}`,
    curl: `curl -H "Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN" \\\n  $OPENBUCKET_API_URL/v1/status`,
  }), [accessKey]);
  const [snippetTab, setSnippetTab] = useState<keyof typeof snippets>("javascript");
  const apiDisplay = displayUrl ?? (typeof window === "undefined" ? "OpenBucket" : window.location.origin);

  return (
    <section>
      <div className="ob-page-heading">
        <div><p className="ob-eyebrow">Developer setup</p><h1>Connections</h1><p>Use standard S3 clients. Change the endpoint, keep the ecosystem.</p></div>
        <button className="ob-button secondary compact" type="button" onClick={onOpenConnectionSettings}>Dashboard connection</button>
      </div>
      <div className="ob-endpoint-grid">
        {[
          ["OpenBucket API", apiDisplay, "Use this OpenBucket URL to manage the node."],
          ["S3 service", loadState === "connected" ? "Available" : "Not connected", "Provide OPENBUCKET_S3_ENDPOINT to your workload."],
          ["File sharing", loadState === "connected" ? "Available" : "Not connected", "Create expiring links from the Buckets page."],
        ].map(([label, value, note]) => (
          <article className="ob-endpoint-card" key={label}>
            <p className="ob-eyebrow">{label}</p>
            <div className="ob-endpoint-value"><code>{value}</code>{label === "OpenBucket API" ? <CopyButton value={value} /> : null}</div>
            <p>{note}</p>
          </article>
        ))}
      </div>
      <article className="ob-code-panel">
        <div className="ob-code-panel-head"><div><p className="ob-eyebrow">Copy, paste, connect</p><h2>Client configuration</h2></div><CopyButton value={snippets[snippetTab]} label="Copy snippet" /></div>
        <div className="ob-tabs" role="tablist" aria-label="Client examples">
          {(["javascript", "python", "aws", "curl"] as const).map((tab) => (
            <button key={tab} role="tab" aria-selected={snippetTab === tab} type="button" onClick={() => setSnippetTab(tab)}>{tab === "aws" ? "AWS CLI" : tab[0].toUpperCase() + tab.slice(1)}</button>
          ))}
        </div>
        <pre><code>{snippets[snippetTab]}</code></pre>
      </article>
      <article className="ob-env-panel">
        <div><p className="ob-eyebrow">Environment</p><h2>Everything is configurable.</h2><p>Keep workload endpoints in your deployment environment, not in source code or the dashboard.</p></div>
        <div className="ob-env-list"><code>OPENBUCKET_S3_ENDPOINT=https://your-s3-endpoint</code><code>OPENBUCKET_API_URL=https://your-openbucket-api</code></div>
      </article>
    </section>
  );
}
