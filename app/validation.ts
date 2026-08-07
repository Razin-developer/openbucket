import { z } from "zod";

/**
 * Client-side pre-submit validation. Deliberately lighter-weight than the server's schemas
 * (server/auth/schemas.ts, server/support/model.ts remain the source of truth — these just catch
 * obvious mistakes before a network round-trip so the user gets instant feedback).
 */

export const clientEmailSchema = z.string().trim().min(3, "Enter a valid email address.").max(254, "Enter a valid email address.").refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email address.");

export const clientPasswordSchema = z.string().min(12, "Password must contain at least 12 characters.").max(128, "Password must contain at most 128 characters.");

export const clientNameSchema = z.string().trim().max(80, "Name must be 80 characters or fewer.").optional();

export const registerFormSchema = z.object({
  email: clientEmailSchema,
  password: clientPasswordSchema,
  name: clientNameSchema,
});

export const loginFormSchema = z.object({
  email: clientEmailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordFormSchema = z.object({
  email: clientEmailSchema,
});

export const resetPasswordFormSchema = z.object({
  password: clientPasswordSchema,
  confirm: z.string(),
}).refine((data) => data.password === data.confirm, { error: "Passwords don't match.", path: ["confirm"] });

export const feedbackFormSchema = z.object({
  message: z.string().trim().min(1, "Enter your feedback.").max(4000, "Feedback is too long."),
  name: z.string().trim().max(200, "Name is too long.").optional(),
  email: z.union([clientEmailSchema, z.literal("")]).optional(),
});

export const bugReportFormSchema = z.object({
  title: z.string().trim().min(1, "Enter a short summary.").max(200, "Title is too long."),
  message: z.string().trim().min(1, "Describe what happened.").max(4000, "Description is too long."),
  stepsToReproduce: z.string().trim().max(4000, "Steps to reproduce is too long.").optional(),
  severity: z.enum(["low", "medium", "high", "critical", ""]).optional(),
  email: z.union([clientEmailSchema, z.literal("")]).optional(),
});

/**
 * Dashboard form schemas (bucket/key/connection) live in app/lib/validation.ts, not here — the
 * daemon's standalone Docker image builds only app/ (see .dockerignore excluding vercel/), so
 * anything reachable from app/page.tsx must not depend on this file.
 */

/** Runs a schema and returns either the parsed value or the first human-readable error message. */
export function validateForm<T>(schema: z.ZodType<T>, data: unknown): { ok: true; value: T } | { ok: false; message: string } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "Please check the form and try again." };
}
