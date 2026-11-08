// Runs every fixture through the engine in the same order the UI does.
const fs = require("fs"), path = require("path");
const E = require("../src/engine.js");
const { SEED } = require("../src/data.js");
const dir = path.join(__dirname, "fixtures");
let history = SEED.ledger.slice();
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
const runs = process.argv[2] === "twice" ? [...files, files[0]] : files;
for (const file of runs) {
  const lines = fs.readFileSync(path.join(dir, file), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  const f = E.extract(lines);
  const checks = [...E.validateDocument(f, SEED.policy, SEED.today, SEED.company)];
  const vendor = E.identifyVendor(f, lines, SEED);
  checks.push(...E.vendorChecks(f, vendor));
  const v = vendor && vendor.vendor.status === "Active" ? vendor.vendor : null;
  const dup = E.duplicateCheck(f, v, history);
  checks.push(...dup.checks);
  const poFind = E.findPO(f, v, SEED);
  const poMatch = E.matchPO(f, v, poFind, history, SEED.policy);
  checks.push(...poMatch.checks);
  const ctx = { fields: f, checks, vendor, dupMatch: dup.match, poFind, poMatch, company: SEED.company, lineCount: lines.length };
  const d = E.decide(ctx, SEED.policy);
  console.log("\n=====", file);
  console.log("fields:", JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "lines").map(([k, x]) => [k, x.value]))));
  console.log("lines:", f.lines.value.map((l) => `${l.sku || ""}|${l.desc}|${l.qty}|${l.uom || ""}|${l.price}|${l.amount}`).join("\n       "));
  checks.forEach((c) => console.log(`  [${c.status}] ${c.label}: ${c.detail}`));
  (poMatch.lines || []).forEach((l) => console.log(`     line ${l.status}: ${l.it.desc} -> ${l.notes.join(" ")}`));
  console.log("DECISION:", d.status, d.code, "|", d.headline, "| owner:", d.owner);
  console.log("action:", d.action, "| schedule:", JSON.stringify(d.schedule));
  if (d.message) console.log("--- message to", d.message.to, "\n" + d.message.body);
  if (d.status !== "Rejected") history.push({ vendor: v && v.id, invoice: f.invoiceNumber && f.invoiceNumber.value, date: f.invoiceDate && f.invoiceDate.value, amount: f.total && f.total.value, po: poMatch.po && poMatch.po.po, status: d.status === "Approved" ? "Approved" : "On hold", enteredOn: "2026-10-30", lines: (poMatch.lines || []).filter((l) => l.pl).map((l) => ({ ln: l.pl.ln, qty: l.it.qty })) });
}
