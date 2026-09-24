import "server-only";
import nodemailer from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  replyTo?: string;
}

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}

/**
 * SMTP email adapter. When SMTP is not configured the message is not sent; in development the
 * subject and recipient (never the body, which may contain a token) are logged.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean }> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(JSON.stringify({ level: "info", msg: "email_not_configured", to: msg.to.replace(/(.).+@/, "$1***@"), subject: msg.subject }));
      if (process.env.DEV_PRINT_EMAILS === "true") console.info(msg.text);
    }
    return { sent: false };
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({
    from: msg.fromName ? `"${msg.fromName.replace(/"/g, "")}" <${process.env.EMAIL_FROM}>` : process.env.EMAIL_FROM,
    to: msg.to,
    replyTo: msg.replyTo || undefined,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
  return { sent: true };
}

export function appBaseUrl() {
  return (
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}
