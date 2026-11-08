// The optional AI "second reader".
//
// It reads the invoice text separately from the rules and returns the key
// fields as JSON. The page compares the two readings; the AI never decides
// anything. This file only knows how to talk to each provider:
//
//   builtin    the site owner's Gemini key, kept on the server (/api/read)
//   gemini     Google Gemini, with the visitor's own key
//   openai     OpenAI (ChatGPT models), with the visitor's own key
//   xai        xAI (Grok), with the visitor's own key
//   anthropic  Anthropic (Claude), with the visitor's own key
//
// A visitor's key goes straight from their browser to the provider. It never
// touches this site's server and is never stored here.

const AI = (() => {
  const COMPANY = "Harbor & Pine Outdoor Co.";

  // "models" are suggestions shown before a key is entered (checked against the
  // providers' own model pages on 8 Nov 2026). Model names change often, so as
  // soon as a key is pasted the page asks the provider which ones that key can use.
  const PROVIDERS = {
    builtin: { label: "Built-in reader (site owner's Gemini)", short: "Gemini", host: "Google", needsKey: false, models: [] },
    gemini: { label: "Google Gemini", short: "Gemini", host: "Google", needsKey: true, keyUrl: "https://aistudio.google.com/apikey",
      models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"] },
    openai: { label: "OpenAI (ChatGPT)", short: "OpenAI", host: "OpenAI", needsKey: true, keyUrl: "https://platform.openai.com/api-keys",
      models: ["gpt-6.1-terra", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"] },
    xai: { label: "xAI (Grok)", short: "Grok", host: "xAI", needsKey: true, keyUrl: "https://console.x.ai",
      models: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning"] },
    anthropic: { label: "Anthropic (Claude)", short: "Claude", host: "Anthropic", needsKey: true, keyUrl: "https://console.anthropic.com/settings/keys",
      models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"] },
  };

  const SAMPLE_TEXT = ["Northwind Packaging Supply LLC", "Invoice No: NW-24-1187", "Invoice Date: 2026-10-28", "PO Number: PO-4500123", "Total Due $4,979.00"];

  function prompt(lines) {
    return `You are reading a vendor invoice for the accounts payable team of ${COMPANY}. That company is the buyer; never return it as the vendor.
Reply with only a JSON object, no other text:
{"vendor_name": string|null, "invoice_number": string|null, "invoice_date": "YYYY-MM-DD"|null, "po_number": string|null, "total": number|null, "bank_account_last4": string|null, "asks_to_change_bank_details": boolean, "line_items": [{"description": string, "qty": number, "unit_price": number, "amount": number}]}
Use null for anything that is not printed on the document. Do not infer a PO number that is not printed.

Document text:
${lines.join("\n").slice(0, 12000)}`;
  }

  // models sometimes wrap JSON in ```json fences or add a sentence around it
  function parseJSON(raw) {
    if (!raw) return null;
    const t = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try { return JSON.parse(t); } catch { /* try the outermost braces */ }
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* give up */ } }
    return null;
  }

  // one place that turns any failure into a plain sentence
  async function send(cfg, url, init) {
    const P = PROVIDERS[cfg.provider];
    let r;
    try { r = await fetch(url, init); }
    catch { throw new Error(`Couldn't reach ${P.host} from the browser. You may be offline, or ${P.host} may not allow calls straight from a web page.`); }
    if (r.ok) return r.json();
    let why = "";
    try { const j = await r.json(); why = (j.error && (j.error.message || (typeof j.error === "string" ? j.error : ""))) || j.message || ""; } catch { /* no body */ }
    why = String(why).replace(/\s+/g, " ").slice(0, 200);
    const base = {
      400: `${P.host} didn't accept the request`, 401: `${P.host} rejected the key. Check that it's correct and active`,
      403: `${P.host} says this key isn't allowed to do that`, 404: `${P.host} doesn't know the model "${cfg.model}"`,
      429: `${P.host} says too many requests, or this model's quota is used up. Try a different model (each one usually has its own allowance)`,
    }[r.status] || `${P.host} returned an error (${r.status})`;
    throw new Error(why ? `${base}: ${why}` : base);
  }

  async function read(cfg, lines) {
    const p = cfg.provider;
    if (p === "builtin") {
      let r, j = null;
      try { r = await fetch("api/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines.join("\n") }) }); j = await r.json(); }
      catch { throw new Error("The built-in reader didn't answer."); }
      if (!r.ok || !j || !j.fields) { const err = new Error((j && j.error) || "The built-in reader didn't answer (" + r.status + ")"); err.code = (j && j.code) || "error"; throw err; }
      return j.fields;
    }
    if (!cfg.key) throw new Error("No API key has been entered.");
    if (!cfg.model) throw new Error("No model has been chosen.");
    let out;
    if (p === "gemini") {
      const d = await send(cfg, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt(lines) }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }) });
      out = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts && d.candidates[0].content.parts[0] && d.candidates[0].content.parts[0].text;
    } else if (p === "openai" || p === "xai") {
      const base = p === "openai" ? "https://api.openai.com/v1" : "https://api.x.ai/v1";
      const d = await send(cfg, base + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: prompt(lines) }], response_format: { type: "json_object" } }) });
      out = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    } else if (p === "anthropic") {
      const d = await send(cfg, "https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1500, messages: [{ role: "user", content: prompt(lines) }] }) });
      out = d.content && d.content[0] && d.content[0].text;
    } else throw new Error("Unknown provider.");
    const fields = parseJSON(out);
    if (!fields || typeof fields !== "object") throw new Error(`${PROVIDERS[p].host} answered, but not with readable fields. Try a different model.`);
    return fields;
  }

  // ask the provider which models this key can use: [{ id, label }]
  async function listModels(cfg) {
    const p = cfg.provider;
    if (!PROVIDERS[p].needsKey) return [];
    if (!cfg.key) throw new Error("Paste your key first, then load your models.");
    let list = [];
    if (p === "gemini") {
      const d = await send(cfg, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": cfg.key } });
      list = (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /^models\/(gemini|gemma)/.test(m.name) && !/(tts|image|live|native-audio|transcribe|embedding|veo|imagen|robotics|computer-use|aqa|omni|deep-research|antigravity)/.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name.replace(/^models\//, "") }));
    } else if (p === "openai") {
      const d = await send(cfg, "https://api.openai.com/v1/models", { headers: { Authorization: "Bearer " + cfg.key } });
      list = (d.data || []).map((m) => ({ id: m.id, label: m.id })).filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(embedding|whisper|tts|audio|realtime|image|transcribe|moderation|search|instruct|codex|diarize|cyber)/.test(m.id));
    } else if (p === "xai") {
      const d = await send(cfg, "https://api.x.ai/v1/models", { headers: { Authorization: "Bearer " + cfg.key } });
      list = (d.data || []).map((m) => ({ id: m.id, label: m.id })).filter((m) => /grok/.test(m.id) && !/image|imagine|video|multi-agent|build/.test(m.id));
    } else if (p === "anthropic") {
      const d = await send(cfg, "https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
      list = (d.data || []).map((m) => ({ id: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id }));
    }
    if (!list.length) throw new Error(`${PROVIDERS[p].host} returned no models this key can use for reading text.`);
    return list.sort((a, b) => b.id.localeCompare(a.id));   // newest-looking names first
  }

  // a real, tiny read to prove the key and model work
  async function test(cfg) {
    const f = await read(cfg, SAMPLE_TEXT);
    const ok = f && /NW-24-1187/i.test(String(f.invoice_number || ""));
    return { ok, fields: f };
  }

  return { PROVIDERS, read, listModels, test, parseJSON, prompt };
})();

if (typeof module !== "undefined") module.exports = AI;
