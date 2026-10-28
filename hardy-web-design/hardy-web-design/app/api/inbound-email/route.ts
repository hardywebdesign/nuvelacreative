import { NextResponse } from "next/server";
import { Resend } from "resend";
import { STUDIO_NAME } from "@/lib/site";

export const runtime = "nodejs";

// Resend webhook for the "email.received" event: when someone emails hello@nuvelacreative.com,
// send a short alert email (to Gmail, so the phone shows a notification).
//
// Vercel environment variables:
//   RESEND_WEBHOOK_SECRET  the webhook's signing secret from Resend (starts with "whsec_")
//   ALERT_EMAIL            where alerts go; falls back to NOTIFY_EMAIL. A carrier email-to-text
//                          address (e.g. 6165551234@vtext.com) also works if the carrier still offers one.
export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const alertTo = process.env.ALERT_EMAIL || process.env.NOTIFY_EMAIL;
  if (!apiKey || !secret || !alertTo) {
    console.error("Missing RESEND_API_KEY, RESEND_WEBHOOK_SECRET or ALERT_EMAIL environment variable.");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const payload = await req.text();
  let event;
  try {
    // Throws unless the request really came from Resend.
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: req.headers.get("svix-id") ?? "",
        timestamp: req.headers.get("svix-timestamp") ?? "",
        signature: req.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Acknowledge other event types so Resend doesn't retry them.
  if (event.type !== "email.received") return NextResponse.json({ ok: true });

  const sender = senderName(event.data.from);
  const subject = event.data.subject?.trim() || "(no subject)";
  // Short enough to read in a phone notification (or a text, if ALERT_EMAIL is a carrier address).
  const text = clip(`New email from ${sender}: ${subject}`, 140);

  const { error } = await resend.emails.send({
    from: process.env.FROM_EMAIL || `${STUDIO_NAME} <onboarding@resend.dev>`,
    to: [alertTo],
    subject: clip(`📩 hello@ inbox: ${sender}: ${subject}`, 120),
    text: `${text}\n\nRead it in your Resend inbox.`,
  });
  if (error) {
    console.error("New-email alert failed:", error);
    // A 500 makes Resend retry the webhook later.
    return NextResponse.json({ error: "Alert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// "Jane Smith <jane@example.com>" -> "Jane Smith"; a bare address stays as is.
function senderName(from: string) {
  const match = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from || "");
  return (match ? match[1] : from || "someone").trim();
}

function clip(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
