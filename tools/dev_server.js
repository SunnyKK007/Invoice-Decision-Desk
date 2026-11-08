// Local test server: serves site/ and runs the real api/read.js function.
//
//   node tools/dev_server.js            uses your real GEMINI_API_KEY from the environment
//   node tools/dev_server.js agree      pretend Gemini that always agrees with the rules
//   node tools/dev_server.js disagree   pretend Gemini that reads the total $100 higher
//   node tools/dev_server.js quota      pretend Gemini whose quota is used up (tests the switch to your own key)
//
// The pretend modes exist so the second-reader flow can be tested without a key.
const http = require("http"), fs = require("fs"), path = require("path");
const Engine = require("../src/engine.js");

const mode = process.argv[2];
const PORT = +process.env.PORT || (mode ? 8766 : 8767);
const ROOT = path.join(__dirname, "..", "site");

if (mode === "agree" || mode === "disagree") {
  process.env.GEMINI_API_KEY = "test-key";
  global.fetch = async (url, opts) => {
    const text = JSON.parse(opts.body).contents[0].parts[0].text.split("Document text:\n")[1] || "";
    const f = Engine.extract(text.split("\n").map((s) => s.trim()).filter(Boolean));
    const ai = {
      vendor_name: f.vendorName ? f.vendorName.value : null,
      invoice_number: f.invoiceNumber ? f.invoiceNumber.value : null,
      invoice_date: f.invoiceDate ? f.invoiceDate.value : null,
      po_number: f.poNumber ? f.poNumber.value : null,
      total: f.total ? f.total.value + (mode === "disagree" ? 100 : 0) : null,
      bank_account_last4: f.bankLast4 ? f.bankLast4.value : null,
      asks_to_change_bank_details: !!f.bankChangeNotice,
      line_items: [],
    };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(ai) }] } }] }) };
  };
}
if (mode === "quota") {
  process.env.GEMINI_API_KEY = "test-key";
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Resource has been exhausted (e.g. check quota)." } }) });
}
// reloaded on every request, so edits to the function apply without restarting
const handler = (req, res) => { delete require.cache[require.resolve("../src/api/read.js")]; return require("../src/api/read.js")(req, res); };

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/read") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // minimal stand-ins for the response helpers Vercel provides
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
      try { req.body = body ? JSON.parse(body) : undefined; } catch { req.body = body; } // bad JSON reaches the handler as a string, which rejects it
      handler(req, res);
    });
    return;
  }
  let p = path.join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (${mode || "real Gemini key from environment"})`));
