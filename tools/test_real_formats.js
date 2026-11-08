// Runs documents that are NOT in the demo data through the engine: invoices
// from unknown vendors in other layouts (GST/INR, labels above values, SaaS)
// and documents that aren't invoices at all. Prints what was extracted and
// the decision, so extraction regressions show up immediately.
//   node tools/test_real_formats.js
const fs = require("fs"), path = require("path");
const E = require("../src/engine.js");
const { SEED } = require("../src/data.js");
const dir = path.join(__dirname, "fixtures_real");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".txt")).sort()) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  const fl = E.extract(lines);
  const checks = [...E.validateDocument(fl, SEED.policy, SEED.today, SEED.company)];
  const vm = E.identifyVendor(fl, lines, SEED);
  checks.push(...E.vendorChecks(fl, vm));
  const d = E.decide({ fields: fl, checks, vendor: vm, company: SEED.company, lineCount: lines.length, poMatch: { lines: [] } }, SEED.policy);
  const g = (k) => (fl[k] ? JSON.stringify(fl[k].value) : "-");
  console.log(`${f.padEnd(34)} ${d.status.padEnd(9)} ${d.code.padEnd(15)} no=${g("invoiceNumber")} date=${g("invoiceDate")} total=${g("total")} ${g("currency")} sender=${g("vendorName")}`);
}
