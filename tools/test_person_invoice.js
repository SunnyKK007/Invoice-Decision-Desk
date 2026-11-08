// Regression test for a real failure: a designer-template invoice uploaded as a
// small picture. The reader's output (lines and columns) is copied from what the
// app actually produced, including its mistakes ("sus" for "$45", the big
// "INVOICE" heading not read at all, "Total $755." with a full stop).
//   node tools/test_person_invoice.js
const E = require("../src/engine.js");
const { SEED } = require("../src/data.js");

const lines = [
  "YOUR NO.000001", "LoGo", "Date: 02 June, 2030", "Billed to: From:", "Studio Shodwe Olivia Wilson",
  "123 Anywhere St., Any City 123 Anywhere St., Any City", "hello@reallygreatsite.com hello@reallygreatsite.com",
  "Item Quantity. Price Amount", "Logo 1 $500 $500", "Banner (2x6m) 2 sus $90", "Poster (1x2m) 3 $55 $165",
  "Total $755.", "Payment method: Cash", "Note: Thank you for choosing us!",
];
// what the column detector gives for each line (gaps between words)
const cells = [
  ["YOUR", "NO.000001"], ["LoGo"], ["Date: 02 June, 2030"], ["Billed to:", "From:"], ["Studio Shodwe", "Olivia Wilson"],
  ["123 Anywhere St., Any City", "123 Anywhere St., Any City"], ["hello@reallygreatsite.com", "hello@reallygreatsite.com"],
  ["Item", "Quantity.", "Price", "Amount"], ["Logo", "1", "$500", "$500"], ["Banner (2x6m)", "2", "sus", "$90"], ["Poster (1x2m)", "3", "$55", "$165"],
  ["Total", "$755."], ["Payment method: Cash"], ["Note: Thank you for choosing us!"],
];

let failed = 0;
const ok = (name, cond, got) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  got: " + JSON.stringify(got))); if (!cond) failed++; };
const v = (f, k) => (f[k] ? f[k].value : undefined);

const f = E.extract(lines, cells);
ok("invoice number read from the bare 'NO.' label", v(f, "invoiceNumber") === "000001", v(f, "invoiceNumber"));
ok("total read despite the trailing full stop", v(f, "total") === 755, v(f, "total"));
ok("date read", v(f, "invoiceDate") === "2030-06-02", v(f, "invoiceDate"));
ok("all three line items found", f.lines.value.length === 3, f.lines.value.length);
const banner = f.lines.value.find((x) => /banner/i.test(x.desc));
ok("garbled price worked out as amount / quantity", banner && banner.price === 45 && banner.priceInferred === true, banner);
ok("sender taken from the right-hand column under From", v(f, "vendorName") === "Olivia Wilson", v(f, "vendorName"));
ok("buyer taken from the left-hand column under Billed to", v(f, "billTo") === "Studio Shodwe", v(f, "billTo"));
ok("template placeholder 'YOUR LOGO' is not the sender", !/your|logo/i.test(v(f, "vendorName") || ""), v(f, "vendorName"));

const checks = E.validateDocument(f, SEED.policy, SEED.today, SEED.company);
const by = (id) => checks.find((c) => c.id === id);
ok("lines add up to the total", by("math_lines") && by("math_lines").status === "pass", by("math_lines"));
ok("unreadable price is flagged for a human", by("price_read") && by("price_read").status === "warn", by("price_read"));
ok("invoice addressed to someone else is a failed check", by("billto") && by("billto").status === "fail", by("billto"));
ok("future date is flagged", by("date") && by("date").status === "warn", by("date"));

// the old behaviour must not return: it should no longer be 'looks like an invoice but number and total not found'
const vendor = E.identifyVendor(f, lines, SEED);
checks.push(...E.vendorChecks(f, vendor));
const d = E.decide({ fields: f, checks, vendor, company: SEED.company, lineCount: lines.length, poMatch: { lines: [] } }, SEED.policy);

// the same picture, but made out to us: it must then go through to PO matching and be approved
const ours = lines.map((x, i) => (i === 4 ? "Harbor & Pine Outdoor Co. Olivia Wilson" : x));
const oursCells = cells.map((c, i) => (i === 4 ? ["Harbor & Pine Outdoor Co.", "Olivia Wilson"] : c));
const f2 = E.extract(ours, oursCells);
const v2 = E.identifyVendor(f2, ours, SEED);
const c2 = [...E.validateDocument(f2, SEED.policy, SEED.today, SEED.company), ...E.vendorChecks(f2, v2)];
const pf = E.findPO(f2, v2.vendor, SEED);
const pm = E.matchPO(f2, v2.vendor, pf, SEED.ledger, SEED.policy);
c2.push(...pm.checks);
const d2 = E.decide({ fields: f2, checks: c2, vendor: v2, company: SEED.company, lineCount: ours.length, poMatch: pm, poFind: pf, dupMatch: null }, SEED.policy);
ok("made out to us: PO inferred and all three lines match", pf.po && pf.po.po === "PO-4500150" && pm.lines.every((l) => l.status === "pass"), [pf.po && pf.po.po, pm.lines.map((l) => l.status)]);
ok("made out to us: no longer held for the wrong buyer (only the unquoted PO needs confirming)", d2.code === "PO_INFERRED", [d2.status, d2.code]);
ok("no longer reported as unreadable", d.code !== "UNREADABLE", d.code);
ok("vendor is now on file (Olivia Wilson, V-1007)", vendor && vendor.vendor.id === "V-1007", vendor && vendor.vendor.id);
ok("held because it is addressed to another company", d.status === "Hold" && d.code === "WRONG_BUYER", [d.status, d.code]);
ok("drafts a message to the vendor", d.message && /Studio Shodwe/.test(d.message.body), d.message);
console.log("   headline:", d.headline);

// without column data (plain text only) the numbers must still come out right
const plain = E.extract(lines);
ok("without columns: number, total and lines still found", v(plain, "invoiceNumber") === "000001" && v(plain, "total") === 755 && plain.lines.value.length === 3);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
