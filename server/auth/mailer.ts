// Transactional email for the auth flow now lives in the shared, general-purpose mailer at
// server/mailer.ts (shared with server/support/service.ts), so there's a single SMTP transport
// implementation instead of two divergent ones. Re-exported here so existing imports keep working.
export { sendPasswordResetEmail } from "../mailer.js";
