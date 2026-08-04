/**
 * Gmail-style quoted-history helpers.
 *
 * Drafts created through the Gmail API do not get the "On <date>, <sender>
 * wrote:" quoted trailer that Gmail's own compose UI appends to replies.
 * For recipients who were already on the thread that's invisible, but a
 * recipient CC'd for the first time (agent handoffs) receives a reply with
 * no context at all — email never retro-delivers earlier messages.
 *
 * These helpers replicate Gmail's native quote format (attribution line +
 * "> " prefixes in text, gmail_quote blockquote in HTML) so drafts render,
 * collapse, and thread exactly like a hand-composed Gmail reply.
 */

export interface QuoteSource {
  /** ISO timestamp the quoted message was received. */
  receivedAt: string;
  /** Display name of the quoted message's sender, if known. */
  senderName: string | null;
  senderEmail: string;
  bodyText: string;
  /** Original HTML body if stored; text is escaped as a fallback. */
  bodyHtml: string | null;
}

/** "On Tue, Aug 4, 2026 at 3:12 PM John Smith <john@example.com> wrote:" */
export function formatQuoteAttribution(source: QuoteSource): string {
  const d = new Date(source.receivedAt);
  const datePart = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d
    .toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    // Newer ICU inserts a narrow no-break space before AM/PM
    .replace(/[  ]/g, " ");

  const who = source.senderName
    ? `${source.senderName} <${source.senderEmail}>`
    : `<${source.senderEmail}>`;

  return `On ${datePart} at ${timePart} ${who} wrote:`;
}

/** Attribution line + the quoted body with "> " line prefixes. */
export function buildQuotedText(source: QuoteSource): string {
  const quoted = source.bodyText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${formatQuoteAttribution(source)}\n${quoted}`;
}

/** Gmail's collapsible quote block: gmail_attr line + gmail_quote blockquote. */
export function buildQuotedHtml(source: QuoteSource): string {
  let inner: string;
  if (source.bodyHtml) {
    // If a full HTML document was stored, embed only the <body> content
    const bodyMatch = source.bodyHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    inner = bodyMatch ? bodyMatch[1] : source.bodyHtml;
  } else {
    inner = escapeHtml(source.bodyText).replace(/\n/g, "<br>");
  }

  const attr = escapeHtml(formatQuoteAttribution(source));
  return (
    `<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attr}<br></div>` +
    `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
    `${inner}</blockquote></div>`
  );
}

/**
 * Drop everything from the first quote marker down: the "On ... wrote:"
 * attribution, "-----Original Message-----" style separators, and any
 * "> "-prefixed lines. Used to compare a sent body against the original
 * draft text and to keep quoted trailers out of AI prompts and training.
 */
export function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{3,}\s*(Original Message|Forwarded message)/i.test(line.trim())) break;
    if (/^_{3,}/.test(line.trim())) break;
    if (line.trim().startsWith(">")) continue;
    result.push(line);
  }
  return result.join("\n").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
