// Invoice decision engine. Pure functions only: no DOM, no storage.
// The UI calls these one stage at a time so each stage can be shown live.
// The same file runs under Node for the test script in tools/test_engine.js.

const Engine = (() => {
  // ------------------------------------------------------------------ helpers
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const UOMS = new Set(["ea", "each", "yd", "yds", "m", "rl", "roll", "rolls", "pc", "pcs", "unit", "units", "cs", "case",
    "bx", "box", "load", "loads", "hr", "hrs", "lb", "lbs", "kg", "ft", "set", "sets", "pk"]);

  const num = (s) => {
    if (s == null) return NaN;
    const t = String(s).replace(/[$,]/g, "").replace(/^\((.*)\)$/, "-$1").trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
  };
  const round2 = (x) => Math.round(x * 100) / 100;
  // Amounts are shown in the currency printed on the invoice (rupees stay rupees).
  // The reference data is in US dollars, so the currency only changes how amounts are written.
  const CUR_INFO = { USD: ["$", "en-US"], INR: ["₹", "en-IN"], EUR: ["€", "en-IE"], GBP: ["£", "en-GB"], CAD: ["CA$", "en-CA"], AUD: ["A$", "en-AU"], AED: ["AED ", "en-US"], CHF: ["CHF ", "en-CH"] };
  let CUR = "USD";
  const setCurrency = (code) => { CUR = CUR_INFO[code] ? code : "USD"; };
  const money = (x, cur) => {
    if (x == null || isNaN(x)) return "—";
    const [sym, loc] = CUR_INFO[cur] || CUR_INFO[CUR];
    return sym + x.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100;

  function parseDate(s) {
    if (!s) return null;
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m && validDate(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // slashes: US M/D/Y unless the first part can only be a day
    if (m && +m[1] > 12 && validDate(+m[3], +m[2], +m[1])) return iso(+m[3], +m[2], +m[1]);
    if (m && validDate(+m[3], +m[1], +m[2])) return iso(+m[3], +m[1], +m[2]);
    m = s.match(/\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})\b/); // dots or dashes: D.M.Y, the usual non-US order
    if (m && validDate(+m[3], +m[2], +m[1])) return iso(+m[3], +m[2], +m[1]);
    m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
    if (m && validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2])) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s\-.,]+(\d{4})/i);
    if (m && validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return null;
  }

  const addDays = (isoDate, days) => {
    const d = new Date(isoDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);

  const moneyIn = (line) => {
    const out = [];
    const re = /\$?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d{2})?|\d+\.\d{2})(?!\d)/g;
    let m;
    while ((m = re.exec(line))) out.push(num(m[1]));
    return out.filter((x) => !isNaN(x));
  };

  const words = (s) => (s || "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const STOP = new Set(["inc", "llc", "co", "corp", "company", "ltd", "the", "and", "of"]);
  const nameKey = (s) => words(s).filter((w) => !STOP.has(w)).join(" ");

  function similarity(a, b) {
    const A = new Set(words(a)), B = new Set(words(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((w) => { if (B.has(w)) inter++; });
    return (2 * inter) / (A.size + B.size);
  }

  const normInvoiceNo = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const invoiceCore = (s) => ((s || "").match(/\d+/g) || []).join("").replace(/^0+/, "");

  // ------------------------------------------------------------------ stage: extract
  // Pulls header fields and line items out of the document's text lines.
  // Every field records the line it came from so the UI can show its evidence.
  const CURRENCIES = [[/₹|\bINR\b|\bRs\.?(?=\s?\d)|\bGSTIN\b|\b[CSI]GST\b/, "INR"], [/€|\bEUR\b/, "EUR"], [/£|\bGBP\b/, "GBP"], [/\bCAD\b|C\$/, "CAD"], [/\bAUD\b|A\$/, "AUD"], [/\bAED\b/, "AED"], [/\bCHF\b/, "CHF"]];
  // a line that is only a label, with its value printed on the next line
  const LABEL_ONLY = {
    invoiceNumber: /^(?:tax\s+)?(?:invoice|inv|bill)\.?\s*(?:no\.?|number|num\.?|#|id)\s*[:#.]?\s*$/i,
    invoiceDate: /^(?:invoice|bill)?\s*date\s*(?:of\s+issue)?\s*:?\s*$/i,
    total: /^(?:total(?:\s+amount)?(?:\s+due)?|amount\s+(?:due|payable)|balance\s+due|grand\s+total|net\s+payable)\s*(?:\(.*\))?\s*:?\s*$/i,
  };

  // cells (optional): for each line, the text split wherever the page has a wide gap,
  // so side-by-side blocks like "Billed to | From" can be told apart.
  function extract(rawLines, cells) {
    const fields = {};
    const set = (key, value, line, how) => { if (value != null && value !== "" && !fields[key]) fields[key] = { value, line, how }; };
    const text0 = rawLines.join("\n");
    const cur = CURRENCIES.find(([re]) => re.test(text0));
    set("currency", cur ? cur[1] : "USD", null, cur ? "symbol on document" : "default");
    setCurrency(cur ? cur[1] : "USD");   // every message built for this document now writes amounts in its currency
    // normalise currency symbols so amounts parse the same way everywhere
    const lines = rawLines.map((L) => L.replace(/[\u0000-\u001f]/g, "").replace(/(US\$|USD|INR|Rs\.?|₹|EUR|€|GBP|£|CAD|C\$|AUD|A\$|AED|CHF)\s?(?=\d)/g, "$"));

    // values printed under their label. In two-column layouts another line
    // (often "Bill To") can sit between the label row and its values, so look
    // a few lines ahead for the first line that holds a matching value.
    const ahead = (i, pick) => {
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) { const v = pick(lines[j].trim()); if (v != null) return { v, L: lines[j] }; }
      return null;
    };
    lines.forEach((L, i) => {
      const t = L.trim();
      if (LABEL_ONLY.invoiceNumber.test(t) || (/\binvoice\s*(no|number|#)/i.test(t) && /\bdate\b/i.test(t) && !/\d/.test(t))) {
        const r = ahead(i, (n) => n.split(/\s+/).find((x) => /\d/.test(x) && /[A-Z\-\/]/i.test(x) && !parseDate(x) && x.length <= 24) || null);
        if (r) set("invoiceNumber", r.v.replace(/[,;]$/, ""), t + " ⏎ " + r.L, "label above value");
      }
      if (LABEL_ONLY.invoiceDate.test(t) || (/\bdate\b/i.test(t) && !/\d/.test(t) && !/\b(due|ship|delivery)\s+date\b/i.test(t))) {
        const r = ahead(i, (n) => parseDate(n));
        if (r) set("invoiceDate", r.v, t + " ⏎ " + r.L, "label above value");
      }
      if (LABEL_ONLY.total.test(t)) {
        const r = ahead(i, (n) => { const v = moneyIn(n); if (v.length) return v[v.length - 1]; const m = n.match(/^\$?\s?(\d[\d,]*)$/); return m ? num(m[1]) : null; });
        if (r) set("total", r.v, t + " ⏎ " + r.L, "label above value");
      }
    });

    // invoice number
    for (const L of lines) {
      const re = /\b(?:(?:tax\s+)?invoice|inv|bill\s*(?=no|number|#))\b\.?\s*(?:no\.?|number|num\.?|#|id)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/]*(?:\s\d{2,})?)/gi;
      let m;
      while ((m = re.exec(L))) {
        const v = m[1].trim();
        if (/\d/.test(v) && !/^(date|to|total|amount)/i.test(v) && !parseDate(v) && !/^\d{1,2}$/.test(v)) { set("invoiceNumber", v, L, "label"); break; }
      }
      if (fields.invoiceNumber) break;
    }
    if (!fields.invoiceNumber) {
      // a bare "No. 000123" or "#000123" near the top of the page, with no word "invoice" beside it
      for (const L of lines.slice(0, 10)) {
        const m = L.match(/(?:^|\s)(?:no\.?|number|#)\s*[:.]?\s*([A-Z]{0,4}-?\d{3,}[A-Z0-9\-\/]*)\b/i);
        if (m && !/\b(po|p\.o|tax|gst|vat|phone|tel|acct|account|order|ref|zip|id)\b/i.test(L.slice(0, m.index + 3))) { set("invoiceNumber", m[1], L, "No. near the top"); break; }
      }
    }

    // invoice date: prefer an explicit invoice/bill date label, never due or ship date
    const dateLines = [
      ...lines.filter((L) => /\b(invoice|bill)\s+date\b/i.test(L)),
      ...lines.filter((L) => /\bdate\b/i.test(L) && !/\b(due|ship|delivery|order|po)\s+date\b/i.test(L)),
    ];
    for (const L of dateLines) {
      const after = L.replace(/^.*?\bdate\b\s*:?\s*/i, "");
      const d = parseDate(after);
      if (d) { set("invoiceDate", d, L, "label"); break; }
    }

    // PO number: labelled first, then any PO-like token in free text
    for (const L of lines) {
      const m = L.match(/\b(?:P\.?\s?O\.?|purchase\s+order|customer\s+po|your\s+po|ref\s+po)\b\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*(?:PO[-\s]?)?(\d{7,10})\b/i);
      if (m) { set("poNumber", "PO-" + m[1], L, "label"); break; }
    }
    if (!fields.poNumber) {
      for (const L of lines) {
        const m = L.match(/\bPO-?(\d{7,10})\b/i);
        if (m) { set("poNumber", "PO-" + m[1], L, "free text"); break; }
      }
    }

    // amounts
    const totalLabels = [/\b(total\s+due|amount\s+due|balance\s+due|total\s+charges|invoice\s+total|grand\s+total|total\s+amount|amount\s+payable|net\s+payable|total\s+payable|invoice\s+amount)\b/i, /^\s*total\b/i];
    const intAtEnd = (x) => { const m = x.match(/\$\s?(\d[\d,]*)\s*[.,;]?\s*$/) || x.match(/[:\s](\d{1,3}(?:,\d{2,3})+)\s*$/); return m ? num(m[1]) : NaN; };
    for (const re of totalLabels) {
      const L = lines.find((x) => re.test(x) && !/sub\s?total/i.test(x) && (moneyIn(x).length || !isNaN(intAtEnd(x))));
      if (L) { const v = moneyIn(L); set("total", v.length ? v[v.length - 1] : intAtEnd(L), L, "label"); break; }
    }
    {
      const L = lines.find((x) => /\b(sub\s?total|merchandise\s+total|taxable\s+(value|amount)|net\s+amount|amount\s+before\s+tax)\b/i.test(x) && moneyIn(x).length);
      if (L) { const v = moneyIn(L); set("subtotal", v[v.length - 1], L, "label"); }
    }
    {
      // one or more tax lines: sales tax, VAT, GST, or CGST + SGST added together
      const T = lines.filter((x) => /^\s*((sales|use)\s+)?(tax|vat|gst|igst|cgst|sgst|utgst|hst|pst)\b/i.test(x) && !/\b(id|no|number|in)\b\s*[:#]/i.test(x) && moneyIn(x).length);
      if (T.length) set("tax", round2(T.reduce((a, x) => { const v = moneyIn(x); return a + v[v.length - 1]; }, 0)), T.join(" + "), T.length > 1 ? "tax lines added" : "label");
    }

    // terms
    {
      const L = lines.find((x) => /\bnet\s*\d+\b/i.test(x));
      if (L) {
        const net = +L.match(/\bnet\s*(\d+)/i)[1];
        const disc = L.match(/(\d+(?:\.\d+)?)\s*%\s*(\d+)/);
        set("terms", { net, discPct: disc ? +disc[1] : 0, discDays: disc ? +disc[2] : 0, text: L.replace(/^.*?terms\s*:?\s*/i, "").trim() }, L, "label");
      }
    }

    // remit-to bank
    for (const L of lines) {
      const m = L.match(/\b(?:account|acct)\.?\s*(?:no\.?\s*)?(?:number\s*)?ending(?:\s+in)?\s*:?\s*(\d{4})\b/i);
      if (m) { set("bankLast4", m[1], L, "label"); break; }
    }
    for (const L of lines) {
      const m = L.match(/\b([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3}\s(?:Bank|Credit Union))\b/);
      if (m) { set("bankName", m[1].replace(/^Bank:\s*/, ""), L, "label"); break; }
    }
    const changeLine = lines.find((L) => /(new\s+(bank|account|banking)|moved\s+our\s+banking|chang\w*\s+(our\s+)?bank|updated?\s+(payment|banking|remit)|update\s+your\s+(vendor\s+)?records)/i.test(L));
    if (changeLine) set("bankChangeNotice", true, changeLine, "wording");

    const resent = lines.find((L) => /(second\s+notice|final\s+notice|past\s+due|re-?sent|duplicate\s+copy|reminder)/i.test(L));
    if (resent) set("reminderWording", true, resent, "wording");

    // contact emails
    const emails = [];
    lines.forEach((L) => { (L.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach((e) => emails.push(e.toLowerCase())); });
    if (emails.length) set("emails", [...new Set(emails)], lines.find((L) => L.includes("@")), "pattern");

    // line items: description, qty, [uom], unit price, amount, with qty x price checked
    let found = [];
    lines.forEach((L, i) => { const it = parseItemLine(L); if (it) found.push({ i, it }); });
    // a row sitting between two good rows whose unit price the reader garbled ("2 sus $90"):
    // work the price out as amount / quantity, and say so
    if (found.length >= 2) {
      const first = found[0].i, last = found[found.length - 1].i, have = new Set(found.map((x) => x.i));
      for (let i = first + 1; i < last; i++) {
        if (have.has(i)) continue;
        const it = parseItemLine(lines[i], true);
        if (it) found.push({ i, it });
      }
      found.sort((a, b) => a.i - b.i);
    }
    const items = found.map((x) => x.it);
    fields.lines = { value: items, line: null, how: "table rows where qty × price = amount" };

    // the two parties: "Billed to" and "From", often printed side by side
    {
      const clean = (x) => (x || "").replace(/\s+/g, " ").trim();
      const nameLike = (x) => /[a-z]{3,}/i.test(x || "") && (x || "").length <= 70 && !/@|^\s*\d|\b(street|st\.|road|rd\.|ave|avenue|suite|floor|city)\b|^\s*(date|invoice|no\.?|item|total|payment|note)\b/i.test(x);
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/\b(bill(?:ed)?\s*to|sold\s*to|customer)\b/i.test(t) && /\bfrom\b/i.test(t) && !/\d/.test(t)) {
          for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
            const c = cells && cells[j];
            if (c && c.length >= 2 && nameLike(c[0]) && nameLike(c[1])) { set("billTo", clean(c[0]), lines[j], "left column under Billed to"); set("vendorName", clean(c[1]), lines[j], "right column under From"); break; }
          }
          continue;
        }
        let m = t.match(/^(?:bill(?:ed)?\s*to|sold\s*to)\s*:\s*(\S.*)$/i);
        if (m && nameLike(m[1])) set("billTo", clean(m[1]), t, "Billed to label");
        m = t.match(/^from\s*:\s*(\S.*)$/i);
        if (m && nameLike(m[1])) set("vendorName", clean(m[1]), t, "From label");
        if (/^from\s*:?\s*$/i.test(t) && nameLike(lines[i + 1])) set("vendorName", clean(lines[i + 1]), lines[i + 1], "line under From");
      }
    }

    // the sender's name as printed, usually the first line of the letterhead
    const strip = (L) => L.replace(/\b(tax\s+invoice|commercial\s+invoice|invoice|bill)\s*$/i, "").trim();
    const head = lines.slice(0, 6).find((L) => { const x = strip(L); return /[a-z]{3,}/i.test(x) && x.length <= 70 && !/(invoice|bill\s+to|sold\s+to|ship\s+to|gstin|vat\s+no|page\s+\d|^date|@|^\d|^your\b|^company\b|^logo\b|^no\.?\s*\d|billed\s+to|^from\b|\b(road|rd|street|st|ave|avenue|blvd|plot|suite|floor)\b)/i.test(x); });
    if (head) set("vendorName", strip(head), head, "letterhead");

    // does this look like an invoice at all?
    const text = lines.join("\n");
    const signals = [
      [/\b(invoice|tax invoice|bill\s+(no|number|#)|freight\s+bill)\b/i.test(text), "the word invoice"],
      [!!fields.invoiceNumber, "an invoice number"],
      [!!fields.total, "a total"],
      [items.length > 0, "priced line items"],
      [/\b(qty|quantity|unit\s+price|rate|amount\s+due|bill\s+to|remit)\b/i.test(text), "billing terms"],
    ];
    const hit = signals.filter((x) => x[0]).map((x) => x[1]);
    fields.signals = { value: { score: hit.length, found: hit, missing: signals.filter((x) => !x[0]).map((x) => x[1]) }, line: null, how: "keywords and structure" };

    return fields;
  }

  function parseItemLine(L, lenient) {
    const t = L.trim().split(/\s+/).map((x) => x.replace(/^\$/, ""));
    if (t.length < 4) return null;
    const amount = num(t[t.length - 1]);
    const price = num(t[t.length - 2]);
    if (lenient && isNaN(price) && !isNaN(amount) && amount > 0 && /^[^\d$]{1,6}$/.test(t[t.length - 2])) {
      const q = num(t[t.length - 3]);
      const d = t.slice(0, t.length - 3).join(" ");
      if (Number.isInteger(q) && q > 0 && /[a-z]{3,}/i.test(d)) return { sku: null, desc: d, qty: q, uom: null, price: round2(amount / q), amount, raw: L, priceInferred: true };
    }
    let k = t.length - 3, uom = null;
    if (UOMS.has(t[k].toLowerCase().replace(/\.$/, ""))) { uom = t[k].toLowerCase(); k--; }
    if (k < 1) return null;
    const qty = num(t[k]);
    if ([amount, price, qty].some(isNaN) || qty <= 0 || amount <= 0) return null;
    const desc = t.slice(0, k).join(" ");
    if (!/[a-z]{3,}/i.test(desc)) return null;
    if (Math.abs(qty * price - amount) > Math.max(0.011, amount * 0.001)) return null;
    let sku = null, d = desc;
    const first = t[0];
    if (/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(first) || /^[A-Z]{2,5}\d*$/.test(first)) {
      if (first === first.toUpperCase() && t.slice(1, k).length) { sku = first; d = t.slice(1, k).join(" "); }
    }
    return { sku, desc: d, qty, uom, price, amount, raw: L };
  }

  // ------------------------------------------------------------------ stage: validate document
  function validateDocument(f, policy, today, company) {
    const checks = [];
    const missing = ["invoiceNumber", "invoiceDate", "total"].filter((k) => !f[k]);
    if (missing.length) {
      checks.push({ id: "fields", status: missing.includes("total") ? "fail" : "warn", label: "Required fields",
        detail: "Could not find: " + missing.map(labelOf).join(", ") + "." });
    } else {
      checks.push({ id: "fields", status: "pass", label: "Required fields", detail: "Invoice number, date and total all found." });
    }
    // invoice date sanity: a future date or a very old one usually means a typo or a stale bill
    if (f.invoiceDate && today) {
      const age = daysBetween(f.invoiceDate.value, today);
      if (age < -3) checks.push({ id: "date", status: "warn", label: "Invoice date", detail: `Dated ${f.invoiceDate.value}, ${-age} days in the future. Check for a typo before it's scheduled.` });
      else if (age > (policy.maxAgeDays || 180)) checks.push({ id: "date", status: "warn", label: "Invoice date", detail: `Dated ${f.invoiceDate.value}, ${age} days ago (limit ${policy.maxAgeDays || 180}). Old bills are often duplicates or already settled.` });
    }
    if (!f.poNumber) checks.push({ id: "po_ref", status: "warn", label: "PO reference", detail: "No PO number printed on the invoice." });

    const items = f.lines.value;
    const sumLines = round2(items.reduce((s, x) => s + x.amount, 0));
    const tax = f.tax ? f.tax.value : 0;
    const subtotal = f.subtotal ? f.subtotal.value : null;
    const total = f.total ? f.total.value : null;
    if (!items.length) {
      checks.push({ id: "lines", status: "warn", label: "Line items", detail: "No itemised lines could be read; only header totals are available." });
    } else {
      checks.push({ id: "lines", status: "pass", label: "Line items", detail: `${items.length} lines read, each with qty × unit price = line amount.` });
      const base = subtotal != null ? subtotal : total != null ? round2(total - tax) : null;
      if (base != null) {
        const diff = round2(sumLines - base);
        checks.push(Math.abs(diff) <= policy.mathTolerance
          ? { id: "math_lines", status: "pass", label: "Lines add up", detail: `Lines sum to ${money(sumLines)}, matching the ${subtotal != null ? "subtotal" : "total before tax"}.` }
          : { id: "math_lines", status: "fail", label: "Lines add up", detail: `Lines sum to ${money(sumLines)} but the invoice says ${money(base)} (off by ${money(Math.abs(diff))}).` });
      }
    }
    const guessed = items.filter((x) => x.priceInferred);
    if (guessed.length) checks.push({ id: "price_read", status: "warn", label: "Unit price unreadable", detail: `${guessed.map((x) => x.desc).join("; ")}: the unit price couldn't be read, so it was worked out as amount ÷ quantity. Check it against the document.` });
    if (f.billTo && company && similarity(f.billTo.value, company) < 0.34 && !nameKey(f.billTo.value).includes(nameKey(company).split(" ")[0])) {
      checks.push({ id: "billto", status: "fail", label: "Billed to", detail: `The invoice is addressed to “${f.billTo.value}”, not ${company}. It may have been sent to us by mistake.` });
    }
    if (subtotal != null && total != null) {
      const diff = round2(subtotal + tax - total);
      checks.push(Math.abs(diff) <= policy.mathTolerance
        ? { id: "math_total", status: "pass", label: "Total = subtotal + tax", detail: `${money(subtotal)} + ${money(tax)} tax = ${money(total)}.` }
        : { id: "math_total", status: "fail", label: "Total = subtotal + tax", detail: `${money(subtotal)} + ${money(tax)} ≠ ${money(total)}.` });
    }
    if (f.currency && f.currency.value !== "USD") checks.push({ id: "currency", status: "warn", label: "Currency", detail: `Amounts are in ${f.currency.value}. Harbor & Pine pays in USD, so AP must confirm the rate and the vendor's billing currency.` });
    if (tax > 0) checks.push({ id: "tax", status: "warn", label: "Sales tax", detail: `Vendor charged ${money(tax)} tax. Oregon has no general sales tax, so AP should confirm this charge.` });
    return checks;
  }

  // ------------------------------------------------------------------ stage: vendor + bank
  function identifyVendor(f, lines, seed) {
    const text = lines.join("\n");
    const top = lines.slice(0, 6).join(" ");
    const buyerKey = nameKey(seed.company);
    let best = null;
    for (const v of seed.vendors) {
      const keys = [v.name, ...v.aliases].map(nameKey).filter(Boolean);
      let score = 0, how = "";
      for (const k of keys) {
        if (k === buyerKey) continue;
        if (nameKey(top).includes(k)) { score = Math.max(score, 3); how = "name in letterhead"; }
        else if (nameKey(text).includes(k)) { score = Math.max(score, 2); how = how || "name in document"; }
      }
      const emails = f.emails ? f.emails.value : [];
      if (emails.some((e) => v.domains.includes(e.split("@")[1]))) { score += 2; how = how ? how + " + email domain" : "email domain"; }
      if (score && (!best || score > best.score)) best = { vendor: v, score, how };
    }
    if (!best) {
      // try fuzzy on the first line, which is usually the letterhead
      for (const v of seed.vendors) {
        const s = Math.max(...[v.name, ...v.aliases].map((n) => similarity(n, lines[0] || "")));
        if (s >= 0.6 && (!best || s > best.score)) best = { vendor: v, score: s, how: "fuzzy name match" };
      }
    }
    return best;
  }

  function vendorChecks(f, match) {
    const checks = [];
    if (!match) {
      checks.push({ id: "vendor", status: "fail", label: "Vendor on file", detail: "The sender doesn't match any vendor in the vendor master." });
      return checks;
    }
    const v = match.vendor;
    if (v.status !== "Active") {
      checks.push({ id: "vendor", status: "fail", label: "Vendor on file", detail: `${v.name} (${v.id}) is ${v.status.toLowerCase()} in the vendor master.` });
      return checks;
    }
    checks.push({ id: "vendor", status: "pass", label: "Vendor on file", detail: `${v.name} (${v.id}), matched by ${match.how}.` });

    // bank details and lookalike domains: the fraud checks
    const emails = f.emails ? f.emails.value : [];
    const foreign = emails.filter((e) => !v.domains.includes(e.split("@")[1]));
    const vendorToken = words(v.name)[0];
    const lookalike = foreign.filter((e) => e.split("@")[1].includes(vendorToken));
    if (lookalike.length) {
      checks.push({ id: "domain", status: "fail", label: "Sender domain", detail: `${lookalike.join(", ")} looks like ${v.name} but isn't a domain on file (${v.domains.join(", ")}).` });
    } else if (emails.length) {
      checks.push({ id: "domain", status: foreign.length ? "warn" : "pass", label: "Sender domain",
        detail: foreign.length ? `Unrecognised address on invoice: ${foreign.join(", ")}.` : `Contact address matches ${v.domains[0]}.` });
    }

    if (f.bankLast4 && f.bankLast4.value !== v.bank.last4) {
      checks.push({ id: "bank", status: "fail", label: "Remit-to bank account",
        detail: `Invoice asks for payment to account ending ${f.bankLast4.value}${f.bankName ? " at " + f.bankName.value : ""}. Vendor master has ${v.bank.name}, ending ${v.bank.last4}.` });
    } else if (f.bankChangeNotice) {
      checks.push({ id: "bank", status: "fail", label: "Remit-to bank account", detail: "Invoice contains a request to change payment details." });
    } else if (f.bankLast4) {
      checks.push({ id: "bank", status: "pass", label: "Remit-to bank account", detail: `Account ending ${v.bank.last4} matches the vendor master.` });
    } else {
      checks.push({ id: "bank", status: "info", label: "Remit-to bank account", detail: "No bank details on the invoice; payment goes to the account on file." });
    }
    return checks;
  }

  // ------------------------------------------------------------------ stage: duplicates
  // history = ledger entries plus earlier runs that were entered (approved or on hold)
  function duplicateCheck(f, vendor, history) {
    if (!vendor || !f.invoiceNumber) {
      return { checks: [{ id: "dup", status: "info", label: "Duplicate check", detail: "Skipped: need both a known vendor and an invoice number." }], match: null };
    }
    const inv = f.invoiceNumber.value, n = normInvoiceNo(inv), core = invoiceCore(inv);
    const total = f.total ? f.total.value : null;
    const same = history.filter((h) => h.vendor === vendor.id);
    let exact = same.find((h) => normInvoiceNo(h.invoice) === n);
    if (exact) {
      return { match: exact, checks: [{ id: "dup", status: "fail", label: "Duplicate check",
        detail: `Invoice ${inv} was already ${exact.status === "Paid" ? "paid on " + exact.paidOn + " (" + exact.payRef + ")" : "entered on " + (exact.enteredOn || exact.date)}.` }] };
    }
    const probable = same.find((h) => invoiceCore(h.invoice) === core && core.length >= 3 && total != null && Math.abs(h.amount - total) < 0.01);
    if (probable) {
      return { match: probable, checks: [{ id: "dup", status: "fail", label: "Duplicate check",
        detail: `"${inv}" and "${probable.invoice}" are the same number once prefixes and leading zeros are removed (${core}), same vendor, same amount ${money(total)}. ${probable.status === "Paid" ? "Original paid " + probable.paidOn + ", ref " + probable.payRef + "." : "Original already entered."}` }] };
    }
    const checks = [];
    const sameCore = same.find((h) => invoiceCore(h.invoice) === core && core.length >= 3);
    if (sameCore) checks.push({ id: "dup", status: "warn", label: "Duplicate check", detail: `Same number as ${sameCore.invoice} but a different amount (${money(sameCore.amount)}). Could be a corrected invoice.` });
    const sameAmt = same.find((h) => total != null && Math.abs(h.amount - total) < 0.01 && f.invoiceDate && h.date && Math.abs(daysBetween(h.date, f.invoiceDate.value)) <= 30);
    if (!sameCore && sameAmt) checks.push({ id: "dup", status: "warn", label: "Duplicate check", detail: `Different number, but ${sameAmt.invoice} had the same amount within 30 days.` });
    if (!checks.length) checks.push({ id: "dup", status: "pass", label: "Duplicate check", detail: `No match on number, normalised number (${core || n}) or amount across ${same.length} earlier invoices from this vendor.` });
    return { checks, match: null };
  }

  // ------------------------------------------------------------------ stage: PO match
  function findPO(f, vendor, seed) {
    if (f.poNumber) {
      const po = seed.pos.find((p) => p.po === f.poNumber.value);
      return po ? { po, how: "quoted on invoice" } : { po: null, how: "quoted but not found" };
    }
    if (!vendor) return { po: null, how: "no vendor" };
    // no PO printed: look for an open PO from this vendor with the same lines and total
    const total = f.total ? f.total.value : null;
    const cands = seed.pos.filter((p) => p.vendor === vendor.id && p.status === "Open").map((p) => {
      const poTotal = round2(p.lines.reduce((s, l) => s + l.qty * l.price, 0));
      const lineScore = f.lines.value.length
        ? f.lines.value.filter((it) => p.lines.some((l) => similarity(it.desc, l.desc) >= 0.5)).length / f.lines.value.length
        : 0;
      const totalMatch = total != null && Math.abs(poTotal - (total - (f.tax ? f.tax.value : 0))) < 0.01;
      return { p, poTotal, lineScore, totalMatch, score: (totalMatch ? 1 : 0) + lineScore };
    }).sort((a, b) => b.score - a.score);
    if (cands.length && cands[0].score >= 1.5 && (cands.length === 1 || cands[0].score - cands[1].score >= 0.5)) {
      return { po: cands[0].p, how: "inferred", candidates: cands.map((c) => ({ po: c.p.po, total: c.poTotal, lineScore: c.lineScore, totalMatch: c.totalMatch })) };
    }
    return { po: null, how: "no confident match", candidates: cands.map((c) => ({ po: c.p.po, total: c.poTotal, lineScore: c.lineScore, totalMatch: c.totalMatch })) };
  }

  function matchPO(f, vendor, poFind, history, policy) {
    const checks = [];
    const lines = [];
    if (!poFind.po) {
      const c = poFind.candidates || [];
      checks.push({ id: "po", status: "fail", label: "Purchase order",
        detail: f.poNumber ? `${f.poNumber.value} isn't in the PO list.` : (c.length ? `No PO on the invoice and no single open PO fits (${c.map((x) => x.po).join(", ")} checked).` : "No PO on the invoice and no open PO for this vendor.") });
      return { checks, lines, approvable: null };
    }
    const po = poFind.po;
    if (vendor && po.vendor !== vendor.id) {
      checks.push({ id: "po", status: "fail", label: "Purchase order", detail: `${po.po} belongs to a different vendor (${po.vendor}).` });
      return { checks, lines, approvable: null };
    }
    if (poFind.how === "inferred") {
      const c = poFind.candidates.find((x) => x.po === po.po);
      checks.push({ id: "po", status: "warn", label: "Purchase order",
        detail: `Inferred ${po.po}: ${c.totalMatch ? "same total" : "total differs"}, ${Math.round(c.lineScore * 100)}% of lines match. Checked ${poFind.candidates.length} open PO${poFind.candidates.length > 1 ? "s" : ""} for this vendor.` });
    } else {
      checks.push({ id: "po", status: "pass", label: "Purchase order", detail: `${po.po}, raised ${po.date} by ${po.requester}.` });
    }

    // billed and received so far, per PO line
    const billedBefore = {};
    history.filter((h) => h.po === po.po).forEach((h) => (h.lines || []).forEach((l) => { billedBefore[l.ln] = (billedBefore[l.ln] || 0) + l.qty; }));
    const received = {};
    po.receipts.forEach((r) => Object.entries(r.lines).forEach(([ln, q]) => { received[ln] = (received[ln] || 0) + q; }));

    const used = new Set();
    let approvable = 0, nonPO = 0;
    for (const it of f.lines.value) {
      let best = null;
      for (const pl of po.lines) {
        if (used.has(pl.ln)) continue;
        const s = it.sku && it.sku === pl.sku ? 1 : similarity(it.desc, pl.desc);
        if (s >= 0.5 && (!best || s > best.s)) best = { pl, s };
      }
      if (!best) {
        const isFreight = /freight|shipping|delivery|fuel|liftgate|handling/i.test(it.desc);
        nonPO += it.amount;
        const ok = isFreight && it.amount <= policy.freightAllowance;
        lines.push({ it, pl: null, status: ok ? "pass" : "fail",
          notes: [ok ? `Freight not on PO, ${money(it.amount)} is within the ${money(policy.freightAllowance)} allowance.` : isFreight ? `Freight ${money(it.amount)} is over the ${money(policy.freightAllowance)} allowance.` : "Not on the PO."] });
        if (ok) approvable += it.amount;
        continue;
      }
      used.add(best.pl.ln);
      const pl = best.pl, notes = [];
      let status = "pass";
      const pv = (it.price - pl.price) / pl.price * 100;
      if (pv > policy.pricePct + 1e-9) { status = "fail"; notes.push(`Price ${money(it.price)} is ${pv.toFixed(2)}% over PO ${money(pl.price)} (limit ${policy.pricePct}%).`); }
      else if (Math.abs(pv) > 0.001) notes.push(`Price ${pv > 0 ? "+" : ""}${pv.toFixed(2)}% vs PO ${money(pl.price)}, within ${policy.pricePct}%.`);
      else notes.push(`Price matches PO.`);
      const prior = billedBefore[pl.ln] || 0;
      const cum = prior + it.qty;
      const maxOrd = pl.qty * (1 + policy.qtyPct / 100);
      if (cum > maxOrd + 1e-9) { status = "fail"; notes.push(`Billed ${fmtQ(cum, pl.uom)} in total${prior ? ` (${fmtQ(prior, pl.uom)} before + ${fmtQ(it.qty, pl.uom)} now)` : ""}, PO ordered ${fmtQ(pl.qty, pl.uom)}.`); }
      else if (prior) notes.push(`${fmtQ(prior, pl.uom)} billed before; ${fmtQ(cum, pl.uom)} of ${fmtQ(pl.qty, pl.uom)} after this invoice.`);
      let allowQty = Math.max(0, Math.min(it.qty, maxOrd - prior));
      if (po.receiptRequired) {
        const rec = received[pl.ln] || 0;
        if (cum > rec + 1e-9) {
          status = "fail";
          notes.push(`Only ${fmtQ(rec, pl.uom)} received; billing would reach ${fmtQ(cum, pl.uom)}.`);
        } else notes.push(`Received ${fmtQ(rec, pl.uom)}, covers billing.`);
        allowQty = Math.max(0, Math.min(allowQty, rec - prior));
      }
      // over tolerance: pay the PO price; within tolerance: pay what was billed
      const allowPrice = pv > policy.pricePct + 1e-9 ? pl.price : it.price;
      approvable += round2(allowQty * allowPrice);
      lines.push({ it, pl, status, notes, allowQty, prior });
    }
    const failLines = lines.filter((l) => l.status === "fail");
    checks.push({ id: "lines_match", status: failLines.length ? "fail" : "pass", label: po.receiptRequired ? "3-way match (PO, receipt, invoice)" : "2-way match (PO, invoice)",
      detail: failLines.length ? `${failLines.length} of ${lines.length} lines outside tolerance.` : `All ${lines.length} lines within tolerance.` });
    const unbilled = po.lines.filter((pl) => !used.has(pl.ln));
    if (unbilled.length && f.lines.value.length) checks.push({ id: "partial", status: "info", label: "Partial billing", detail: `PO lines not on this invoice: ${unbilled.map((l) => l.desc).join("; ")}.` });
    return { checks, lines, approvable: round2(approvable + (f.tax ? f.tax.value : 0)), nonPO: round2(nonPO), po };
  }

  const fmtQ = (q, uom) => `${q.toLocaleString("en-US")} ${uom || ""}`.trim();
  const labelOf = (k) => ({ invoiceNumber: "invoice number", invoiceDate: "invoice date", total: "total", poNumber: "PO number" })[k] || k;

  // ------------------------------------------------------------------ stage: AI cross-check
  // Compare the rules-based read with the AI reader's read, field by field.
  function compareWithAI(f, ai, vendorMatch, seed) {
    const rows = [];
    if (!ai) return rows;
    const cmp = (key, label, mine, theirs, eq) => {
      const hasM = mine != null && mine !== "", hasT = theirs != null && theirs !== "";
      let status = "pass";
      if (hasM && hasT && !eq(mine, theirs)) status = "fail";
      else if (hasM !== hasT) status = "warn";
      else if (!hasM && !hasT) status = "info";
      rows.push({ key, label, mine, theirs, status });
    };
    cmp("invoiceNumber", "Invoice number", f.invoiceNumber && f.invoiceNumber.value, ai.invoice_number, (a, b) => normInvoiceNo(a) === normInvoiceNo(b));
    cmp("invoiceDate", "Invoice date", f.invoiceDate && f.invoiceDate.value, ai.invoice_date && (parseDate(String(ai.invoice_date)) || ai.invoice_date), (a, b) => a === b);
    cmp("poNumber", "PO number", f.poNumber && f.poNumber.value, ai.po_number, (a, b) => invoiceCore(a) === invoiceCore(b));
    cmp("total", "Total", f.total && f.total.value, ai.total != null ? num(ai.total) : null, (a, b) => Math.abs(a - b) < 0.01);
    cmp("bankLast4", "Bank account (last 4)", f.bankLast4 && f.bankLast4.value, ai.bank_account_last4, (a, b) => String(a) === String(b));
    const aiVendor = ai.vendor_name ? identifyVendor({ emails: null }, [String(ai.vendor_name)], seed) : null;
    cmp("vendor", "Vendor", vendorMatch && vendorMatch.vendor.id, aiVendor && aiVendor.vendor.id, (a, b) => a === b);
    rows.push({ key: "bankChange", label: "Asks to change bank details", mine: !!f.bankChangeNotice, theirs: !!ai.asks_to_change_bank_details,
      status: !!f.bankChangeNotice === !!ai.asks_to_change_bank_details ? "pass" : "warn" });
    return rows;
  }

  // Fill gaps in the rules-based read with the AI reader's values, marked as AI-sourced.
  function fillFromAI(f, ai) {
    if (!ai) return [];
    const filled = [];
    const put = (key, value, label) => { if (!f[key] && value != null && value !== "") { f[key] = { value, line: null, how: "AI reader (no rule match)" }; filled.push(label); } };
    put("invoiceNumber", ai.invoice_number ? String(ai.invoice_number) : null, "invoice number");
    put("invoiceDate", ai.invoice_date ? parseDate(String(ai.invoice_date)) : null, "invoice date");
    put("poNumber", ai.po_number && /\d{7,10}/.test(ai.po_number) ? "PO-" + String(ai.po_number).match(/\d{7,10}/)[0] : null, "PO number");
    put("total", ai.total != null && !isNaN(num(ai.total)) ? num(ai.total) : null, "total");
    put("bankLast4", ai.bank_account_last4 && /^\d{4}$/.test(String(ai.bank_account_last4)) ? String(ai.bank_account_last4) : null, "bank account");
    if (!f.bankChangeNotice && ai.asks_to_change_bank_details) { f.bankChangeNotice = { value: true, line: null, how: "AI reader" }; filled.push("bank change request"); }
    return filled;
  }

  // ------------------------------------------------------------------ stage: decide
  // Fixed precedence. The first matching rule sets the outcome; every failed
  // check is still listed so the reviewer sees the whole picture.
  function decide(ctx, policy) {
    const all = ctx.checks;
    const failed = (id) => all.find((c) => c.id === id && c.status === "fail");
    const v = ctx.vendor && ctx.vendor.vendor;
    const f = ctx.fields;
    const total = f.total ? f.total.value : null;
    const reasons = all.filter((c) => c.status === "fail" || c.status === "warn");
    let status, code, headline, owner, action, message = null;

    const sig = f.signals ? f.signals.value : { score: 0, found: [], missing: [] };
    const printed = f.vendorName ? f.vendorName.value : null;
    const poorScan = ctx.ocrConfidence != null && ctx.ocrConfidence < 60 && !f.total && !f.invoiceNumber;
    if (!ctx.lineCount || poorScan) {
      status = "Hold"; code = "UNREADABLE"; owner = "AP specialist";
      headline = poorScan ? `The scan is too unclear to read (OCR confidence ${ctx.ocrConfidence}%)` : "No text could be read from this file";
      action = "Open the file and key the invoice in manually, or ask the vendor for a clearer copy or a text PDF.";
    } else if (!f.total && !f.invoiceNumber && (sig.score < 2 || !(f.lines && f.lines.value.length))) {
      status = "Rejected"; code = "NOT_INVOICE"; owner = "AP inbox triage";
      headline = "This doesn't look like an invoice";
      action = `Nothing was entered. ${ctx.lineCount} lines were read, but there's no invoice number, no total and none of ${sig.missing.join(", ")}. Send it back or forward it to the right team.`;
    } else if (!f.total && !f.invoiceNumber) {
      status = "Hold"; code = "UNREADABLE"; owner = "AP specialist";
      headline = "Looks like an invoice, but the invoice number and total couldn't be found";
      action = `Found ${sig.found.join(", ")}. Key the number and total in manually, or turn on the AI second reader, which handles unusual layouts.`;
    } else if (failed("vendor")) {
      status = "Rejected"; code = v ? "VENDOR_INACTIVE" : "VENDOR_UNKNOWN"; owner = "Procurement";
      headline = v ? `${v.name} is not an active vendor` : `${printed ? `“${printed}”` : "The sender"} is not a vendor on file`;
      action = "Don't enter the invoice. Procurement decides whether to onboard or reactivate the vendor.";
      message = { to: "Sender of the invoice", subject: `Invoice ${f.invoiceNumber ? f.invoiceNumber.value : ""} not processed`,
        body: `Hello,\n\nWe received invoice ${f.invoiceNumber ? f.invoiceNumber.value : "(no number)"}${total != null ? " for " + money(total) : ""}, but we don't have an active vendor record for your company, so we can't process it.\n\nIf you're supplying us under an agreement, please ask your contact at ${ctx.company} to start vendor onboarding. Once that's done, send the invoice again.\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (failed("dup")) {
      const d = ctx.dupMatch;
      status = "Rejected"; code = "DUPLICATE"; owner = "AP specialist";
      headline = d && d.status === "Paid" ? `Already paid as ${d.invoice} on ${d.paidOn}` : `Duplicate of ${d ? d.invoice : "an earlier invoice"}`;
      action = "Don't pay. Reply to the vendor with the original payment details.";
      message = { to: v ? `${v.name} (${v.domains[0]})` : "Vendor", subject: `Re: invoice ${f.invoiceNumber.value}`,
        body: `Hello,\n\n${f.reminderWording ? "Thanks for the reminder on" : "We received"} invoice ${f.invoiceNumber.value} for ${money(total)}. Our records show this as the same bill as invoice ${d.invoice} dated ${d.date}${d.status === "Paid" ? `, which we paid on ${d.paidOn} by ACH (reference ${d.payRef})` : ", which is already in our system"}.\n\nWe won't be paying it a second time. If your records show something different, please send a statement and we'll reconcile it with you.\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (failed("bank") || failed("domain")) {
      status = "Hold"; code = "BANK_CHANGE"; owner = "AP lead + Treasury";
      headline = "Payment blocked: bank details on the invoice don't match the vendor master";
      action = `Don't pay and don't reply to the email on the invoice. Call ${v.name} on the number already on file, ${v.phone}, to confirm. Any change to the vendor's bank record needs a second approver.`;
      message = { to: "Treasury / AP lead (internal)", subject: `Verify bank change: ${v.name}, invoice ${f.invoiceNumber ? f.invoiceNumber.value : ""}`,
        body: `Invoice ${f.invoiceNumber ? f.invoiceNumber.value : ""} from ${v.name} for ${money(total)} matches ${ctx.poMatch && ctx.poMatch.po ? ctx.poMatch.po.po : "its PO"}, but it asks us to pay a different account (ending ${f.bankLast4 ? f.bankLast4.value : "?"}${f.bankName ? ", " + f.bankName.value : ""}). The vendor master has ${v.bank.name}, ending ${v.bank.last4}.${failed("domain") ? `\n\nThe contact email on the invoice (${failed("domain").detail.split(" looks like")[0]}) is not one of their domains on file.` : ""}\n\nPlease call ${v.phone} (the number on file, not the one on the invoice) and confirm before anyone changes the vendor record. The invoice stays on hold until then.` };
    } else if (failed("billto")) {
      const bt = f.billTo.value;
      status = "Hold"; code = "WRONG_BUYER"; owner = "AP specialist";
      headline = `Addressed to “${bt}”, not ${ctx.company}`;
      action = "Don't pay. It may have been sent to us by mistake. Ask the vendor who it is for, or for a corrected copy.";
      message = { to: v ? `${v.name} (${v.domains[0]})` : "Vendor", subject: `Invoice ${f.invoiceNumber ? f.invoiceNumber.value : ""}: addressed to another company`,
        body: `Hello,\n\nInvoice ${f.invoiceNumber ? f.invoiceNumber.value : "(no number)"}${total != null ? " for " + money(total) : ""} is made out to “${bt}”, not ${ctx.company}. Could you confirm who it is meant for, and send a corrected copy if it was ours?\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (!f.total || !f.invoiceNumber || !f.invoiceDate) {
      status = "Hold"; code = "MISSING_FIELDS"; owner = "AP specialist";
      const miss = ["invoiceNumber", "invoiceDate", "total"].filter((k) => !f[k]).map(labelOf);
      headline = `Missing ${miss.join(" and ")}`;
      action = "Ask the vendor for a complete invoice, or fill the field from the vendor portal and re-run.";
      message = { to: v ? `${v.name} (${v.domains[0]})` : "Vendor", subject: "Missing details on your invoice",
        body: `Hello,\n\nWe received your invoice${total != null ? " for " + money(total) : ""}, but it doesn't show the ${miss.join(" or the ")}. Could you send a corrected copy?\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (failed("math_lines") || failed("math_total")) {
      status = "Hold"; code = "MATH"; owner = "AP specialist";
      headline = "The invoice doesn't add up";
      action = "Ask the vendor for a corrected invoice.";
      message = { to: v ? `${v.name} (${v.domains[0]})` : "Vendor", subject: `Invoice ${f.invoiceNumber.value}: totals don't reconcile`,
        body: `Hello,\n\nOn invoice ${f.invoiceNumber.value}: ${(failed("math_lines") || failed("math_total")).detail} Could you send a corrected copy?\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (failed("po")) {
      status = "Hold"; code = "NO_PO"; owner = "Requester";
      headline = "No purchase order found";
      action = "Ask the person who ordered this to raise or identify the PO.";
    } else if (all.find((c) => c.id === "po" && c.status === "warn")) {
      const po = ctx.poMatch.po;
      status = "Hold"; code = "PO_INFERRED"; owner = po.requester;
      headline = `PO not quoted; matched to ${po.po} by lines and amount`;
      action = `One-click confirmation from ${po.requester.split(" (")[0]} that this invoice belongs to ${po.po}. Everything else checks out, so it can be paid as soon as that's confirmed.`;
      message = { to: po.requester, subject: `Is this invoice for ${po.po}?`,
        body: `Hi ${po.requester.split(" ")[0]},\n\n${v.name} sent invoice ${f.invoiceNumber.value} for ${money(total)} without a PO number. It matches your ${po.po} line for line and the goods are received.\n\nCan you confirm it belongs to ${po.po}? Once you do, it goes to the next payment run.\n\nThanks,\nAccounts Payable` };
    } else if (failed("lines_match")) {
      const pm = ctx.poMatch;
      const bad = pm.lines.filter((l) => l.status === "fail");
      status = "Hold"; code = "MATCH_EXCEPTION"; owner = "AP specialist + vendor";
      const disputed = round2(total - pm.approvable);
      headline = `${bad.length} line${bad.length > 1 ? "s" : ""} outside tolerance: ${money(pm.approvable)} can be paid, ${money(disputed)} is in question`;
      action = `Hold the invoice. Ask ${v.name} for a credit memo for the over-billed amount, or wait for the missing goods to be received.`;
      const bullets = bad.map((l) => `- ${l.it.desc}: ${l.notes.filter((n) => !/^Price matches|within|covers/.test(n)).join(" ")}`).join("\n");
      message = { to: `${v.name} (${v.domains[0]})`, subject: `Invoice ${f.invoiceNumber.value}: quantities don't match ${pm.po.po}`,
        body: `Hello,\n\nWe've checked invoice ${f.invoiceNumber.value} (${money(total)}) against ${pm.po.po} and our receiving records:\n\n${bullets}\n\nWe can pay ${money(pm.approvable)} now. For the remaining ${money(disputed)}, please send a credit memo, or a revised invoice once the rest of the goods arrive.\n\nThanks,\nAccounts Payable, ${ctx.company}` };
    } else if (ctx.aiDisagree && ctx.aiDisagree.length) {
      status = "Hold"; code = "READ_CONFLICT"; owner = "AP specialist";
      headline = `Two readings of the document disagree on ${ctx.aiDisagree.join(", ")}`;
      action = "Look at the document and confirm the right value before it's paid.";
    } else if (total > policy.autoApproveLimit) {
      status = "Hold"; code = "APPROVAL_LIMIT"; owner = "Controller";
      headline = `Matched, but ${money(total)} is above the ${money(policy.autoApproveLimit)} auto-approval limit`;
      action = "Controller approves in the queue; no other issues.";
    } else {
      status = "Approved"; code = "OK"; owner = "Payment run";
      headline = `Matched to ${ctx.poMatch.po.po}. Approved for payment`;
      action = "Post to the ledger and schedule for payment.";
    }

    // payment scheduling, for approved invoices and for the approvable part of a held one
    let schedule = null;
    if (f.invoiceDate && v) {
      const t = (f.terms && f.terms.value) || parseTerms(v.terms);
      const due = addDays(f.invoiceDate.value, t.net || 30);
      schedule = { due, net: t.net };
      if (t.discPct) {
        const discBy = addDays(f.invoiceDate.value, t.discDays);
        const base = status === "Approved" ? total : ctx.poMatch && ctx.poMatch.approvable;
        schedule.discount = { pct: t.discPct, by: discBy, amount: base ? round2(base * t.discPct / 100) : null };
      }
    }
    return { status, code, headline, owner, action, message, schedule, reasons };
  }

  function parseTerms(s) {
    const net = +(String(s).match(/net\s*(\d+)/i) || [0, 30])[1];
    const d = String(s).match(/(\d+(?:\.\d+)?)\s*%\s*(\d+)/);
    return { net, discPct: d ? +d[1] : 0, discDays: d ? +d[2] : 0 };
  }

  // ERP-ready record for the posting step
  function erpRecord(ctx, decision) {
    const f = ctx.fields;
    return {
      vendor_id: ctx.vendor ? ctx.vendor.vendor.id : null,
      invoice_number: f.invoiceNumber ? f.invoiceNumber.value : null,
      invoice_date: f.invoiceDate ? f.invoiceDate.value : null,
      po_number: ctx.poMatch && ctx.poMatch.po ? ctx.poMatch.po.po : null,
      po_source: ctx.poFind ? ctx.poFind.how : null,
      currency: "USD",
      total: f.total ? f.total.value : null,
      tax: f.tax ? f.tax.value : 0,
      lines: (ctx.poMatch && ctx.poMatch.lines || []).map((l) => ({ po_line: l.pl ? l.pl.ln : null, description: l.it.desc, qty: l.it.qty, unit_price: l.it.price, amount: l.it.amount, status: l.status })),
      decision: decision.status.toUpperCase(),
      reason_code: decision.code,
      payable_now: decision.status === "Approved" ? (f.total ? f.total.value : null) : (decision.code === "MATCH_EXCEPTION" ? ctx.poMatch.approvable : 0),
      due_date: decision.schedule ? decision.schedule.due : null,
      payment_block: decision.status !== "Approved",
      route_to: decision.owner,
    };
  }

  return { setCurrency, extract, parseItemLine, validateDocument, identifyVendor, vendorChecks, duplicateCheck, findPO, matchPO,
    compareWithAI, fillFromAI, decide, erpRecord, parseDate, money, normInvoiceNo, invoiceCore, round2, addDays, daysBetween };
})();

if (typeof module !== "undefined") module.exports = Engine;
