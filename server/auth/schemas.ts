import { z } from "zod";

/**
 * Zod schemas for the auth API. Each schema wraps the exact same rules the hand-rolled
 * validators previously enforced (Unicode-normalized, byte-length-aware — Zod's built-in
 * `.email()`/`.min()`/`.max()` are character-count-only and wouldn't preserve the existing byte
 * caps), so behavior is unchanged; only the mechanism moved to Zod. Field-level errors keep their
 * historical ApiError codes by being parsed individually (see callers in service.ts) rather than
 * a single all-fields-at-once schema, since different fields must fail with different codes.
 */

const CONTROL_OR_SPACE_CHARS = new RegExp("[\\u0000-\\u001f\\u007f\\s]");
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

export const emailSchema = z.string().transform((value, ctx) => {
  const email = value.normalize("NFKC").trim().toLowerCase();
  const fail = () => { ctx.addIssue({ code: "custom", message: "Enter a valid email address." }); return z.NEVER; };
  if (email.length < 3 || email.length > 254 || CONTROL_OR_SPACE_CHARS.test(email)) return fail();
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1] || parts[1].length > 253) return fail();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0])) return fail();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(parts[1])) return fail();
  return email;
});

export const passwordSchema = z.string().superRefine((value, ctx) => {
  const characters = Array.from(value).length;
  const bytes = Buffer.byteLength(value, "utf8");
  if (characters < 12 || characters > 128 || bytes > 1024 || value.includes("\0")) {
    ctx.addIssue({ code: "custom", message: "Password must contain 12-128 characters." });
  }
});

export const nameSchema = z.string().nullish().transform((value, ctx) => {
  if (value === undefined || value === null || value === "") return null;
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || Array.from(name).length > 80 || Buffer.byteLength(name, "utf8") > 320 || CONTROL_CHARS.test(name)) {
    ctx.addIssue({ code: "custom", message: "Name must contain 1-80 characters." });
    return z.NEVER;
  }
  return name;
});

export const registerBodySchema = z.object({
  email: z.unknown(),
  password: z.unknown(),
  name: z.unknown().optional(),
}).strict();

export const loginBodySchema = z.object({
  email: z.unknown(),
  password: z.unknown(),
}).strict();

export const forgotPasswordBodySchema = z.object({
  email: z.unknown(),
}).strict();

export const resetPasswordBodySchema = z.object({
  token: z.unknown(),
  password: z.unknown(),
}).strict();

export const resetTokenSchema = z.string().min(16).max(512);
