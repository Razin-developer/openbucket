import { ApiError } from "../auth/http.js";
import type { SupportSeverity } from "./database.js";

const MAX_MESSAGE_BYTES = 4_000;
const MAX_SHORT_TEXT_BYTES = 200;
const MAX_EMAIL_BYTES = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEVERITIES: readonly SupportSeverity[] = ["low", "medium", "high", "critical"];

function onlyFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "INVALID_REQUEST", "Request contains unsupported fields.");
  }
}

function requiredText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} is required.`);
  }
  const trimmed = value.trim();
  if (Buffer.byteLength(trimmed, "utf8") > maxBytes) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} is too long.`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, maxBytes: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} is invalid.`);
  }
  return value.trim() || null;
}

function optionalEmail(value: unknown): string | null {
  const text = optionalText(value, "email", MAX_EMAIL_BYTES);
  if (text === null) return null;
  if (!EMAIL_PATTERN.test(text)) throw new ApiError(400, "INVALID_REQUEST", "email is invalid.");
  return text.toLowerCase();
}

function optionalPath(value: unknown): string | null {
  const text = optionalText(value, "path", 512);
  if (text === null) return null;
  if (!text.startsWith("/")) throw new ApiError(400, "INVALID_REQUEST", "path is invalid.");
  return text;
}

export type FeedbackInput = { message: string; email: string | null; name: string | null; path: string | null };

export function validateFeedbackInput(body: Record<string, unknown>): FeedbackInput {
  onlyFields(body, ["message", "email", "name", "path"]);
  return {
    message: requiredText(body.message, "message", MAX_MESSAGE_BYTES),
    email: optionalEmail(body.email),
    name: optionalText(body.name, "name", MAX_SHORT_TEXT_BYTES),
    path: optionalPath(body.path),
  };
}

export type BugReportInput = {
  title: string;
  message: string;
  stepsToReproduce: string | null;
  severity: SupportSeverity | null;
  email: string | null;
  path: string | null;
};

export function validateBugReportInput(body: Record<string, unknown>): BugReportInput {
  onlyFields(body, ["title", "message", "stepsToReproduce", "severity", "email", "path"]);
  let severity: SupportSeverity | null = null;
  if (body.severity !== undefined && body.severity !== null && body.severity !== "") {
    if (typeof body.severity !== "string" || !SEVERITIES.includes(body.severity as SupportSeverity)) {
      throw new ApiError(400, "INVALID_REQUEST", "severity must be one of low, medium, high, critical.");
    }
    severity = body.severity as SupportSeverity;
  }
  return {
    title: requiredText(body.title, "title", MAX_SHORT_TEXT_BYTES),
    message: requiredText(body.message, "message", MAX_MESSAGE_BYTES),
    stepsToReproduce: optionalText(body.stepsToReproduce, "stepsToReproduce", MAX_MESSAGE_BYTES),
    severity,
    email: optionalEmail(body.email),
    path: optionalPath(body.path),
  };
}
