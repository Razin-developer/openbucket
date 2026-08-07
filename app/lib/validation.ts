import { z } from "zod";

/** S3-compatible bucket naming rules, matching the dashboard's existing input pattern/minLength/maxLength. */
export const bucketNameSchema = z.string()
  .min(3, "Bucket names must be at least 3 characters.")
  .max(63, "Bucket names must be at most 63 characters.")
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Use lowercase letters, numbers, dots, and hyphens only.");

/** Object keys may contain slashes (folders) but not be empty, absolute, or contain traversal segments. */
export const objectKeySchema = z.string()
  .trim()
  .min(1, "Enter an object key.")
  .max(1024, "Object keys must be at most 1024 characters.")
  .refine((value) => !value.startsWith("/"), "Object keys can't start with a slash.")
  .refine((value) => !value.split("/").includes(".."), "Object keys can't contain \"..\" segments.");

export const maxUploadFileCount = 50;
export const maxUploadFileBytes = 5 * 1024 * 1024 * 1024; // 5 GiB per file, generous local-disk ceiling.

/**
 * Dashboard connection-settings form. Mirrors the exact checks app/dashboard/api/node-api.ts's
 * normalizeApiBase() performs (no credentials, query string, or fragment) as a Zod schema, so the
 * ConnectionModal can validate before it even calls normalizeApiBase.
 */
export const dashboardConnectionSchema = z.object({
  apiBase: z
    .string()
    .trim()
    .min(1, "Enter a management API URL.")
    .url("Enter a valid HTTP(S) URL.")
    .refine((value) => {
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
      } catch {
        return false;
      }
    }, "Use an HTTP(S) management API URL without credentials, query parameters, or a fragment."),
  adminToken: z.string().optional(),
});

/** Dashboard bucket-create form (mirrors the daemon's S3-compatible bucket naming rules). */
export const createBucketFormSchema = z.object({
  name: bucketNameSchema,
  public: z.boolean().optional(),
});

/** Dashboard API-key-create form. */
export const createKeyFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a key name.").max(200, "Key name is too long."),
  bucket: z.string().trim().max(63, "Bucket name is too long.").optional(),
  readOnly: z.boolean().optional(),
});

/** Runs a schema and returns either the parsed value or the first human-readable error message. */
export function validateForm<T>(schema: z.ZodType<T>, data: unknown): { ok: true; value: T } | { ok: false; message: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "Please check the value and try again." };
}
