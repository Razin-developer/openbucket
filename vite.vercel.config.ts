import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const vercelRoot = path.join(projectRoot, "vercel");

const publicUrlNames = [
  "NEXT_PUBLIC_OPENBUCKET_API_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_DOCS_URL",
] as const;

function validatedPublicUrl(name: (typeof publicUrlNames)[number], raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an HTTP(S) URL without embedded credentials.`);
  }
  if (name !== "NEXT_PUBLIC_DOCS_URL" && (parsed.search || parsed.hash)) {
    throw new Error(`${name} must not include query parameters or a fragment.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export default defineConfig(({ mode }) => {
  // loadEnv reads local .env variants, while process.env supplies values configured
  // in Vercel. Only this explicit public allowlist is emitted into browser code.
  const fileEnv = loadEnv(mode, projectRoot, "");
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const inferredAppUrl = vercelProductionUrl ? `https://${vercelProductionUrl}` : undefined;
  const publicEnv = Object.fromEntries(
    publicUrlNames.map((name) => [
      name,
      validatedPublicUrl(
        name,
        process.env[name] ?? fileEnv[name] ?? (name === "NEXT_PUBLIC_APP_URL" ? inferredAppUrl : undefined),
      ),
    ]),
  ) as Record<(typeof publicUrlNames)[number], string | undefined>;

  const canonicalUrl = publicEnv.NEXT_PUBLIC_APP_URL ?? "https://openbucket.vercel.app";

  return {
    root: vercelRoot,
    publicDir: path.join(projectRoot, "public"),
    envDir: projectRoot,
    plugins: [
      react(),
      {
        name: "openbucket-vercel-metadata",
        transformIndexHtml(html) {
          return html.replaceAll("https://openbucket.vercel.app", canonicalUrl);
        },
      },
    ],
    define: Object.fromEntries(
      publicUrlNames.map((name) => [
        `process.env.${name}`,
        publicEnv[name] === undefined ? "undefined" : JSON.stringify(publicEnv[name]),
      ]),
    ),
    build: {
      outDir: path.join(projectRoot, "vercel-dist"),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
    },
  };
});
