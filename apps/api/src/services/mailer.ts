/**
 * Sends e-mail. Two ways, whichever is configured:
 *
 * 1. Cloudflare Email Service: a `send_email` binding named EMAIL in
 *    wrangler.jsonc (needs your own domain onboarded in Cloudflare).
 * 2. Brevo (free plan, no own domain needed): BREVO_API_KEY plus a sender
 *    address that is verified in Brevo.
 *
 * MAIL_FROM is the sender address in both cases.
 */

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface CloudflareMailBinding {
  send(message: { from: { email: string; name: string }; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

let cloudflareBinding: CloudflareMailBinding | null = null;

/** Called on Workers when the EMAIL binding exists. */
export function setMailBinding(binding: unknown): void {
  if (binding && typeof (binding as CloudflareMailBinding).send === "function") cloudflareBinding = binding as CloudflareMailBinding;
}

const SENDER_NAME = "Yellowlime AI Agent";

export function mailConfigured(): boolean {
  return Boolean(process.env.MAIL_FROM && (cloudflareBinding || process.env.BREVO_API_KEY));
}

export async function sendMail(mail: OutgoingMail, fetcher: typeof fetch = fetch): Promise<void> {
  const from = process.env.MAIL_FROM?.trim();
  if (!from) throw new Error("mail_not_configured");

  if (cloudflareBinding) {
    await cloudflareBinding.send({ from: { email: from, name: SENDER_NAME }, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new Error("mail_not_configured");
  const res = await fetcher("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: SENDER_NAME },
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
  });
  if (!res.ok) throw new Error(`mail_failed_${res.status}`);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The e-mail with the 6-digit verification code. */
export function verificationMail(to: string, name: string, code: string, minutes: number): OutgoingMail {
  const first = name.split(" ")[0] || name;
  return {
    to,
    subject: `${code} is je code voor de Yellowlime AI Agent`,
    text: [
      `Hoi ${first},`,
      "",
      `Je code om je e-mailadres te bevestigen: ${code}`,
      "",
      `De code is ${minutes} minuten geldig. Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren.`,
      "",
      "Yellowlime AI Agent",
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f6f9f1;font-family:Arial,Helvetica,sans-serif;color:#16362f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:18px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4d7469">Yellowlime AI Agent</td></tr>
<tr><td style="padding-top:14px;font-size:22px;font-weight:bold">Hoi ${escapeHtml(first)}, hier is je code</td></tr>
<tr><td style="padding-top:20px"><div style="background:#16362f;color:#f5f966;font-size:34px;font-weight:bold;letter-spacing:10px;text-align:center;padding:18px 0;border-radius:12px">${code}</div></td></tr>
<tr><td style="padding-top:20px;font-size:15px;line-height:1.5;color:#34574e">Vul deze code in om je e-mailadres te bevestigen. De code is ${minutes} minuten geldig.<br><br>Heb je dit niet zelf aangevraagd? Dan kun je deze mail negeren.</td></tr>
</table></td></tr></table></body></html>`,
  };
}
