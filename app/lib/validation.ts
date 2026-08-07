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

/** Runs a schema and returns either the parsed value or the first human-readable error message. */
export function validateValue<T>(schema: z.ZodType<T>, data: unknown): { ok: true; value: T } | { ok: false; message: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "Please check the value and try again." };
}
