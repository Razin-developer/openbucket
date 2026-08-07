import nodemailer, { type Transporter } from "nodemailer";

export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };

export function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.OPENBUCKET_SMTP_HOST?.trim();
  const user = process.env.OPENBUCKET_SMTP_USER?.trim();
  const pass = process.env.OPENBUCKET_SMTP_PASS;
  const from = process.env.OPENBUCKET_SMTP_FROM?.trim() || user;
  const port = Number(process.env.OPENBUCKET_SMTP_PORT?.trim() || "587");
  if (!host || !user || !pass || !from || !Number.isFinite(port)) return null;
  return { host, port, user, pass, from };
}

const globalMailer = globalThis as typeof globalThis & { __openbucketTransport?: Transporter };

export function getTransport(config: SmtpConfig): Transporter {
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

/**
 * Shared branded HTML layout for all transactional email — a plain header/body/footer table
 * structure that renders consistently across email clients (inline styles only, no external
 * assets, no CSS that Outlook/Gmail strip). Callers supply the body as pre-built HTML paragraphs.
 */
function renderBrandedEmail(options: { preheader: string; heading: string; bodyHtml: string; footerNote: string }): string {
  const { preheader, heading, bodyHtml, footerNote } = options;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none; font-size:1px; color:#f4f4f5; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e4e4e7;">
            <tr>
              <td style="background-color:#171717; padding:24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <div style="width:28px; height:28px; border-radius:7px; background-color:#ffffff; display:inline-block; text-align:center; line-height:28px; font-weight:700; color:#171717; font-size:14px;">OB</div>
                    </td>
                    <td style="vertical-align:middle; padding-left:10px;">
                      <span style="color:#ffffff; font-size:17px; font-weight:600; letter-spacing:-0.01em;">OpenBucket</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px; font-size:20px; line-height:1.3; color:#171717;">${heading}</h1>
                <div style="font-size:14px; line-height:1.6; color:#3f3f46;">
                  ${bodyHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px; background-color:#fafafa; border-top:1px solid #e4e4e7;">
                <p style="margin:0; font-size:12px; line-height:1.6; color:#71717a;">${footerNote}</p>
                <p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#a1a1aa;">This is an automated message from OpenBucket. Please don&rsquo;t reply directly to this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function stripTags(value: string): string {
  // Strip repeatedly, not once: a single pass can leave a valid tag behind from adversarial
  // nesting like "<<script>script>" (the outer pass only removes the inner "<script>").
  let previous: string;
  let current = value;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current;
}

function textFromHtmlParagraphs(paragraphs: string[]): string {
  return paragraphs.map(stripTags).join("\n\n");
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Fire-and-log-don't-throw, matching sendPasswordResetEmail: a submission must still succeed even if the send fails or SMTP isn't configured. */
async function sendSupportConfirmationEmail(options: { to: string; subject: string; heading: string; preheader: string; bodyParagraphs: string[]; footerNote: string; logLabel: string }): Promise<boolean> {
  const config = readSmtpConfig();
  if (!config) {
    console.error(`OpenBucket SMTP is not configured (OPENBUCKET_SMTP_HOST/PORT/USER/PASS); ${options.logLabel} confirmation email was not sent.`);
    return false;
  }
  try {
    const transport = getTransport(config);
    const bodyHtml = options.bodyParagraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join("\n");
    await transport.sendMail({
      from: config.from,
      to: options.to,
      subject: options.subject,
      text: textFromHtmlParagraphs(options.bodyParagraphs),
      html: renderBrandedEmail({ preheader: options.preheader, heading: options.heading, bodyHtml, footerNote: options.footerNote }),
    });
    return true;
  } catch (error) {
    console.error(`Failed to send ${options.logLabel} confirmation email.`, error);
    return false;
  }
}

const REPLY_FOOTER_NOTE = "We&rsquo;ll get back to you if a reply is needed. No action is required from you right now.";

export async function sendFeedbackConfirmationEmail(to: string, message: string): Promise<boolean> {
  const excerpt = escapeHtml(message.length > 240 ? `${message.slice(0, 240)}…` : message);
  return sendSupportConfirmationEmail({
    to,
    subject: "We received your OpenBucket feedback",
    heading: "Thanks for the feedback",
    preheader: "Your feedback was received by the OpenBucket team.",
    bodyParagraphs: [
      "Thanks for taking the time to tell us what&rsquo;s working (or not) in OpenBucket. Your note has been logged and read by the team.",
      `<span style="color:#71717a;">What you sent:</span><br /><span style="display:block; margin-top:6px; padding:12px 14px; background-color:#fafafa; border:1px solid #e4e4e7; border-radius:8px; color:#3f3f46;">${excerpt}</span>`,
    ],
    footerNote: REPLY_FOOTER_NOTE,
    logLabel: "feedback",
  });
}

export async function sendBugReportConfirmationEmail(to: string, title: string, severity: string | null): Promise<boolean> {
  const severityLine = severity
    ? `<span style="color:#71717a;">Reported severity:</span> <strong style="color:#171717;">${escapeHtml(severity)}</strong><br />`
    : "";
  return sendSupportConfirmationEmail({
    to,
    subject: "We received your OpenBucket bug report",
    heading: "Thanks for the bug report",
    preheader: "Your bug report was received by the OpenBucket team.",
    bodyParagraphs: [
      "Thanks for reporting this — it helps make OpenBucket more reliable for everyone. Your report has been logged and read by the team.",
      `${severityLine}<span style="color:#71717a;">Summary:</span> <strong style="color:#171717;">${escapeHtml(title)}</strong>`,
    ],
    footerNote: REPLY_FOOTER_NOTE,
    logLabel: "bug report",
  });
}

export async function sendHelpRequestConfirmationEmail(to: string, subject: string): Promise<boolean> {
  return sendSupportConfirmationEmail({
    to,
    subject: "We received your OpenBucket help request",
    heading: "We got your message",
    preheader: "Your help request was received by the OpenBucket team.",
    bodyParagraphs: [
      "Thanks for reaching out. Your request has been logged and a real person will read it.",
      `<span style="color:#71717a;">Subject:</span> <strong style="color:#171717;">${escapeHtml(subject)}</strong>`,
      "We typically reply within 1&ndash;2 business days. If your question is answered in the meantime, feel free to check the <a href=\"https://openbucket.zydcode.in/faq\" style=\"color:#171717;\">FAQ</a>.",
    ],
    footerNote: "We&rsquo;ll reply by email as soon as we can.",
    logLabel: "help request",
  });
}
