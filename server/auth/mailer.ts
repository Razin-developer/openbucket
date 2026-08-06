import nodemailer, { type Transporter } from "nodemailer";

type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.OPENBUCKET_SMTP_HOST?.trim();
  const user = process.env.OPENBUCKET_SMTP_USER?.trim();
  const pass = process.env.OPENBUCKET_SMTP_PASS;
  const from = process.env.OPENBUCKET_SMTP_FROM?.trim() || user;
  const port = Number(process.env.OPENBUCKET_SMTP_PORT?.trim() || "587");
  if (!host || !user || !pass || !from || !Number.isFinite(port)) return null;
  return { host, port, user, pass, from };
}

const globalMailer = globalThis as typeof globalThis & { __openbucketTransport?: Transporter };

function getTransport(config: SmtpConfig): Transporter {
  if (!globalMailer.__openbucketTransport) {
    globalMailer.__openbucketTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }
  return globalMailer.__openbucketTransport;
}

/** Returns true if the email was handed off to SMTP; false if SMTP isn't configured (logged, not thrown, so callers never leak configuration state to the client). */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const config = readSmtpConfig();
  if (!config) {
    console.error("OpenBucket SMTP is not configured (OPENBUCKET_SMTP_HOST/PORT/USER/PASS); password reset email was not sent.");
    return false;
  }
  const transport = getTransport(config);
  await transport.sendMail({
    from: config.from,
    to,
    subject: "Reset your OpenBucket password",
    text: `Someone requested a password reset for your OpenBucket account.\n\nReset your password: ${resetUrl}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`,
    html: `<p>Someone requested a password reset for your OpenBucket account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>`,
  });
  return true;
}
