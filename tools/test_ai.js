// Checks src/ai.js against pretend provider replies (no keys, no network).
// This proves the request shapes and reply parsing match what each provider's
// documentation describes. It cannot prove the real services accept them.
const AI = require("../src/ai.js");
const FIELDS = { invoice_number: "NW-24-1187", total: 4979 };
let failed = 0;
const ok = (name, cond, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + (extra || ""))); if (!cond) failed++; };

function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const c = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(c);
    const { status = 200, json } = handler(c);
    return { ok: status < 400, status, json: async () => json };
  };
  return calls;
}
const lines = ["Northwind Packaging Supply LLC", "Invoice No: NW-24-1187"];

(async () => {
  // ---- Gemini
  let calls = fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(FIELDS) + "\n```" }] } }] } }));
  let f = await AI.read({ provider: "gemini", model: "gemini-2.5-flash", key: "K" }, lines);
  ok("gemini: reads fenced JSON", f.invoice_number === "NW-24-1187");
  ok("gemini: key in header, not in URL", calls[0].headers["x-goog-api-key"] === "K" && !calls[0].url.includes("K="), calls[0].url);
  ok("gemini: model in URL", calls[0].url.includes("models/gemini-2.5-flash:generateContent"));
  ok("gemini: asks for JSON", calls[0].body.generationConfig.responseMimeType === "application/json");

  // ---- OpenAI and xAI share a shape
  for (const [p, host] of [["openai", "api.openai.com"], ["xai", "api.x.ai"]]) {
    calls = fakeFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify(FIELDS) } }] } }));
    f = await AI.read({ provider: p, model: "m1", key: "K" }, lines);
    ok(p + ": reads reply", f.total === 4979);
    ok(p + ": right host and bearer key", calls[0].url.startsWith("https://" + host + "/v1/chat/completions") && calls[0].headers.Authorization === "Bearer K", calls[0].url);
    ok(p + ": sends model and json mode", calls[0].body.model === "m1" && calls[0].body.response_format.type === "json_object");
  }

  // ---- Anthropic
  calls = fakeFetch(() => ({ json: { content: [{ type: "text", text: "Here you go: " + JSON.stringify(FIELDS) }] } }));
  f = await AI.read({ provider: "anthropic", model: "claude-haiku-5-5", key: "K" }, lines);
  ok("anthropic: reads JSON inside prose", f.invoice_number === "NW-24-1187");
  ok("anthropic: headers", calls[0].headers["x-api-key"] === "K" && calls[0].headers["anthropic-version"] && calls[0].headers["anthropic-dangerous-direct-browser-access"] === "true");
  ok("anthropic: body", calls[0].body.model === "claude-haiku-5-5" && calls[0].body.max_tokens > 0);

  // ---- built-in goes to our own function and never sends a key
  calls = fakeFetch(() => ({ json: { fields: FIELDS } }));
  f = await AI.read({ provider: "builtin", model: "", key: "SHOULD-NOT-BE-SENT" }, lines);
  ok("builtin: calls api/read", calls[0].url === "api/read" && f.total === 4979);
  ok("builtin: key never sent", !JSON.stringify(calls[0]).includes("SHOULD-NOT-BE-SENT"));

  // ---- model lists
  const gm = (n, methods = ["generateContent"]) => ({ name: "models/" + n, displayName: n, supportedGenerationMethods: methods });
  fakeFetch(() => ({ json: { models: [gm("gemini-2.5-flash"), gm("gemini-2.5-pro"), gm("gemini-2.0-flash"), gm("gemma-3-27b-it"), gm("gemini-2.5-flash-preview-tts"), gm("gemini-2.5-flash-image"), gm("embedding-001", ["embedContent"])] } }));
  let list = await AI.listModels({ provider: "gemini", key: "K" });
  ok("gemini list: every text model, newest first", list.map((m) => m.id).join() === "gemma-3-27b-it,gemini-2.5-pro,gemini-2.5-flash,gemini-2.0-flash", list.map((m) => m.id).join());
  ok("gemini list: no speech, image or embedding models", !list.some((m) => /tts|image|embedding/.test(m.id)));
  fakeFetch(() => ({ json: { data: [{ id: "gpt-4o" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "o3-mini" }, { id: "gpt-4o-audio-preview" }] } }));
  list = await AI.listModels({ provider: "openai", key: "K" });
  ok("openai list: drops embeddings, audio, whisper", list.map((m) => m.id).join() === "o3-mini,gpt-4o", list.map((m) => m.id).join());
  fakeFetch(() => ({ json: { data: [{ id: "grok-3" }, { id: "grok-2-image" }] } }));
  list = await AI.listModels({ provider: "xai", key: "K" });
  ok("xai list: drops image models", list.length === 1 && list[0].id === "grok-3");
  fakeFetch(() => ({ json: { data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }] } }));
  list = await AI.listModels({ provider: "anthropic", key: "K" });
  ok("anthropic list: shows display name", list[0].label.includes("Claude Haiku 5.5"));

  // ---- errors say something useful
  const expectErr = async (name, status, body, needle, cfg) => {
    fakeFetch(() => ({ status, json: body }));
    try { await AI.read(cfg || { provider: "openai", model: "bad-model", key: "K" }, lines); ok(name, false, "no error thrown"); }
    catch (e) { ok(name, e.message.includes(needle), e.message); }
  };
  await expectErr("401 says the key was rejected", 401, { error: { message: "Incorrect API key" } }, "rejected the key");
  await expectErr("404 names the model", 404, { error: { message: "no such model" } }, "bad-model");
  await expectErr("429 mentions quota and suggests another model", 429, { error: { message: "quota exceeded" } }, "Try a different model");
  await expectErr("provider message is passed along", 400, { error: { message: "context too long" } }, "context too long");
  fakeFetch(() => ({ json: { choices: [{ message: { content: "sorry, I can't" } }] } }));
  try { await AI.read({ provider: "openai", model: "m", key: "K" }, lines); ok("unreadable reply is an error", false); } catch (e) { ok("unreadable reply is an error", /not with readable fields/.test(e.message), e.message); }
  global.fetch = async () => { throw new TypeError("Failed to fetch"); };
  try { await AI.read({ provider: "xai", model: "m", key: "K" }, lines); ok("blocked or offline is explained", false); } catch (e) { ok("blocked or offline is explained", /Couldn't reach xAI/.test(e.message), e.message); }
  try { await AI.read({ provider: "gemini", model: "m", key: "" }, lines); ok("missing key is explained", false); } catch (e) { ok("missing key is explained", /No API key/.test(e.message)); }

  // ---- the test button
  fakeFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify(FIELDS) } }] } }));
  let t = await AI.test({ provider: "openai", model: "m", key: "K" });
  ok("test(): passes when the invoice number is read", t.ok === true);
  fakeFetch(() => ({ json: { choices: [{ message: { content: JSON.stringify({ invoice_number: "WRONG" }) } }] } }));
  t = await AI.test({ provider: "openai", model: "m", key: "K" });
  ok("test(): fails when the number is wrong", t.ok === false);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
