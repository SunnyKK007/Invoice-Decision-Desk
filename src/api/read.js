// Vercel serverless function: the optional "second reader".
//
// The page sends the text it read from an invoice. This function asks Google's
// Gemini model to read the same text on its own and returns the key fields as
// JSON. The API key lives in a Vercel environment variable (GEMINI_API_KEY),
// never in the page, so visitors can't copy it.
//
//   GET  /api/read  -> { configured: true|false }   (lets the page know if the reader is on)
//   POST /api/read  -> { text: "..." }  returns the fields as JSON

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const COMPANY = "Harbor & Pine Outdoor Co.";
const MAX_TEXT = 12000;

// very small per-visitor limit, so one person can't run up the bill
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), windowMs = 60 * 1000, max = 20;
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > max;
}

function buildPrompt(text) {
  return `You are reading a vendor invoice for the accounts payable team of ${COMPANY}. That company is the buyer; never return it as the vendor.
Reply with only a JSON object, no other text:
{"vendor_name": string|null, "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null, "po_number": string|null, "total": number|null, "bank_account_last4": string|null, "asks_to_change_bank_details": boolean, "line_items": [{"description": string, "qty": number, "unit_price": number, "amount": number}]}
Use null for anything that is not printed on the document. Do not infer a PO number that is not printed.

Document text:
${text}`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.GEMINI_API_KEY;

  if (req.method === "GET") return res.status(200).json({ configured: !!key, model: key ? MODEL : null });
  if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST." });
  if (!key) return res.status(501).json({ code: "unconfigured", error: "The built-in AI reader isn't set up on this server." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return res.status(429).json({ code: "rate", error: "Too many requests. Wait a minute and try again." });

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const text = body && typeof body.text === "string" ? body.text.slice(0, MAX_TEXT) : "";
  if (text.trim().length < 20) return res.status(400).json({ error: "No document text was sent." });

  try {
    const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(text) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
    let r = await call();
    // Google is sometimes briefly busy (429 or 503): wait a moment and try once more
    if (r.status === 429 || r.status === 503) { await new Promise((ok) => setTimeout(ok, 2500)); r = await call(); }
    if (!r.ok) {
      // pass Google's own explanation back (it never contains the key), so a problem can be diagnosed
      let why = "";
      try { const j = await r.json(); why = (j && j.error && j.error.message) || ""; } catch { /* no body */ }
      why = why.replace(/\s+/g, " ").slice(0, 240);
      // 429 from Google after the retry means the owner's quota is used up
      const code = r.status === 429 ? 429 : 502;
      return res.status(code).json({ code: r.status === 429 ? "quota" : "error", error: `Google Gemini said ${r.status} (${MODEL})${why ? ": " + why : ""}` });
    }
    const data = await r.json();
    const raw = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    const fields = raw ? safeParse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) : null;
    if (!fields || typeof fields !== "object") return res.status(502).json({ error: "The AI service didn't return readable fields." });
    return res.status(200).json({ fields, model: MODEL });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach the AI service." });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
