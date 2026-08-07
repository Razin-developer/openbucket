import { z } from "zod";
import { ApiError } from "../auth/http.js";
import type { SupportSeverity } from "./database.js";

const MAX_MESSAGE_BYTES = 4_000;
const MAX_SHORT_TEXT_BYTES = 200;
const MAX_EMAIL_BYTES = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEVERITIES = ["low", "medium", "high", "critical"] as const satisfies readonly SupportSeverity[];

function requiredTextSchema(field: string, maxBytes: number) {
  return z.unknown().optional().transform((value, ctx) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: `${field} is required.` });
      return z.NEVER;
    }
    const trimmed = value.trim();
    if (Buffer.byteLength(trimmed, "utf8") > maxBytes) {
      ctx.addIssue({ code: "custom", message: `${field} is too long.` });
      return z.NEVER;
    }
    return trimmed;
  });
}

function optionalTextSchema(field: string, maxBytes: number) {
  return z.unknown().optional().transform((value, ctx) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
      ctx.addIssue({ code: "custom", message: `${field} is invalid.` });
      return z.NEVER;
    }
    return value.trim() || null;
  });
}

const optionalEmailSchema = optionalTextSchema("email", MAX_EMAIL_BYTES).transform((value, ctx) => {
  if (value === null) return null;
  if (!EMAIL_PATTERN.test(value)) {
    ctx.addIssue({ code: "custom", message: "email is invalid." });
    return z.NEVER;
  }
  return value.toLowerCase();
});

const requiredEmailSchema = requiredTextSchema("email", MAX_EMAIL_BYTES).transform((value, ctx) => {
  if (!EMAIL_PATTERN.test(value)) {
    ctx.addIssue({ code: "custom", message: "email is invalid." });
    return z.NEVER;
  }
  return value.toLowerCase();
});

const optionalPathSchema = optionalTextSchema("path", 512).transform((value, ctx) => {
  if (value === null) return null;
  if (!value.startsWith("/")) {
    ctx.addIssue({ code: "custom", message: "path is invalid." });
    return z.NEVER;
  }
  return value;
});

const severitySchema = z.unknown().optional().transform((value, ctx) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !SEVERITIES.includes(value as SupportSeverity)) {
    ctx.addIssue({ code: "custom", message: "severity must be one of low, medium, high, critical." });
    return z.NEVER;
  }
  return value as SupportSeverity;
});

export type FeedbackInput = { message: string; email: string | null; name: string | null; path: string | null };

const feedbackBodySchema = z.object({
  message: requiredTextSchema("message", MAX_MESSAGE_BYTES),
  email: optionalEmailSchema,
  name: optionalTextSchema("name", MAX_SHORT_TEXT_BYTES),
  path: optionalPathSchema,
}).strict();

export function validateFeedbackInput(body: Record<string, unknown>): FeedbackInput {
  const result = feedbackBodySchema.safeParse(body);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

export type BugReportInput = {
  title: string;
  message: string;
  stepsToReproduce: string | null;
  severity: SupportSeverity | null;
  email: string | null;
  path: string | null;
};

const bugReportBodySchema = z.object({
  title: requiredTextSchema("title", MAX_SHORT_TEXT_BYTES),
  message: requiredTextSchema("message", MAX_MESSAGE_BYTES),
  stepsToReproduce: optionalTextSchema("stepsToReproduce", MAX_MESSAGE_BYTES),
  severity: severitySchema,
  email: optionalEmailSchema,
  path: optionalPathSchema,
}).strict();

export function validateBugReportInput(body: Record<string, unknown>): BugReportInput {
  const result = bugReportBodySchema.safeParse(body);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

export type HelpRequestInput = {
  subject: string;
  message: string;
  email: string;
  name: string | null;
  path: string | null;
};

const helpRequestBodySchema = z.object({
  subject: requiredTextSchema("subject", MAX_SHORT_TEXT_BYTES),
  message: requiredTextSchema("message", MAX_MESSAGE_BYTES),
  email: requiredEmailSchema,
  name: optionalTextSchema("name", MAX_SHORT_TEXT_BYTES),
  path: optionalPathSchema,
}).strict();

export function validateHelpRequestInput(body: Record<string, unknown>): HelpRequestInput {
  const result = helpRequestBodySchema.safeParse(body);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

function invalidRequest(error: z.ZodError): Error {
  const message = error.issues[0]?.message ?? "Request is invalid.";
  return new ApiError(400, "INVALID_REQUEST", message);
}
