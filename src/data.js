// Reference data for Harbor & Pine Outdoor Co., a fictional mid-size company.
// In a real deployment these come from the ERP: vendor master, open POs,
// goods receipts and the AP ledger. Here they are fixed so every run is
// repeatable on demo day.

const SEED = {
  company: "Harbor & Pine Outdoor Co.",
  today: "2026-10-30",

  policy: {
    pricePct: 2.0,          // unit price may be up to 2% above PO price
    qtyPct: 0.0,            // billed qty may not exceed ordered or received qty
    freightAllowance: 150,  // non-PO freight line accepted up to this amount
    autoApproveLimit: 10000,// above this, a controller signs off even when matched
    mathTolerance: 0.02,    // rounding slack when re-adding the invoice
    maxAgeDays: 180,        // invoices older than this are flagged for a look
  },

  vendors: [
    { id: "V-1001", name: "Northwind Packaging Supply LLC", aliases: ["Northwind Packaging", "Northwind"],
      domains: ["northwindpack.com"], bank: { name: "Columbia Ridge Bank", last4: "4417" },
      phone: "(503) 555-0148", terms: "Net 30", status: "Active" },
    { id: "V-1002", name: "Summit Textile Mills, Inc.", aliases: ["Summit Textile Mills", "Summit Textile"],
      domains: ["summittextile.com"], bank: { name: "Willamette Valley Bank", last4: "6630" },
      phone: "(541) 555-0190", terms: "2% 10, Net 45", status: "Active" },
    { id: "V-1003", name: "Cascade Freight Lines Inc.", aliases: ["Cascade Freight Lines", "Cascade Freight"],
      domains: ["cascadefreight.com"], bank: { name: "Puget Commerce Bank", last4: "5512" },
      phone: "(253) 555-0107", terms: "Net 15", status: "Active" },
    { id: "V-1004", name: "Bluebird Office & Janitorial", aliases: ["Bluebird Office", "Bluebird Office and Janitorial"],
      domains: ["bluebirdoffice.com"], bank: { name: "Cedar Point Credit Union", last4: "2280" },
      phone: "(503) 555-0161", terms: "Net 30", status: "Active" },
    { id: "V-1005", name: "Ridgeway Print Co.", aliases: ["Ridgeway Print", "Ridgeway Printing"],
      domains: ["ridgewayprint.com"], bank: { name: "High Desert Bank", last4: "3086" },
      phone: "(541) 555-0175", terms: "Net 30", status: "Active" },
    { id: "V-1006", name: "Alder Creek Electrical", aliases: ["Alder Creek Electric"],
      domains: ["aldercreekelectric.com"], bank: { name: "Umpqua Valley Bank", last4: "7714" },
      phone: "(503) 555-0139", terms: "Net 30", status: "Inactive" },
    { id: "V-1007", name: "Olivia Wilson", aliases: ["Olivia Wilson Design"],
      domains: ["reallygreatsite.com"], bank: { name: "Lakeside Community Credit Union", last4: "4821" },
      phone: "(503) 555-0123", terms: "Net 30", status: "Active" },
  ],

  pos: [
    { po: "PO-4500123", vendor: "V-1001", date: "2026-10-05", requester: "Dana Whitfield (Warehouse Ops)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "BX-181210", desc: "Corrugated shipping box 18x12x10 in", qty: 2000, uom: "ea", price: 1.42 },
        { ln: 2, sku: "TP-48CL", desc: "Packing tape 48 mm x 100 m, clear", qty: 300, uom: "rl", price: 3.15 },
        { ln: 3, sku: "VF-PAPER", desc: "Void fill paper roll 15 in x 1,200 ft", qty: 40, uom: "rl", price: 27.50 },
      ],
      receipts: [{ grn: "GRN-7790", date: "2026-10-22", lines: { 1: 2000, 2: 300, 3: 40 } }] },

    { po: "PO-4500131", vendor: "V-1002", date: "2026-09-18", requester: "Marco Ruiz (Product Development)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "CAN-10OZ", desc: "Canvas, 10 oz duck, natural, 60 in", qty: 1200, uom: "yd", price: 6.80 },
        { ln: 2, sku: "WEB-PP1", desc: "Polypropylene webbing 1 in, black", qty: 3000, uom: "m", price: 0.42 },
      ],
      receipts: [
        { grn: "GRN-7781", date: "2026-10-03", lines: { 1: 600 } },
        { grn: "GRN-7802", date: "2026-10-24", lines: { 1: 600, 2: 1800 } },
      ] },

    { po: "PO-4500119", vendor: "V-1003", date: "2026-09-26", requester: "Dana Whitfield (Warehouse Ops)",
      receiptRequired: false, status: "Open",
      lines: [
        { ln: 1, sku: "LH-PDX-RNO", desc: "Linehaul Portland OR to Reno NV, 53 ft dry van", qty: 2, uom: "load", price: 1450.00 },
        { ln: 2, sku: "FSC", desc: "Fuel surcharge", qty: 1, uom: "ea", price: 412.50 },
        { ln: 3, sku: "LIFT", desc: "Liftgate service at delivery", qty: 1, uom: "ea", price: 100.00 },
      ],
      receipts: [] },

    { po: "PO-4500127", vendor: "V-1004", date: "2026-10-12", requester: "Priya Nair (Facilities)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "GLV-NIT-L", desc: "Nitrile gloves, large, box of 100", qty: 40, uom: "bx", price: 8.95 },
        { ln: 2, sku: "TWL-MF16", desc: "Paper towels, multifold, case of 16", qty: 25, uom: "cs", price: 41.20 },
        { ln: 3, sku: "CLN-FL5", desc: "Neutral floor cleaner, 5 gal", qty: 6, uom: "ea", price: 64.00 },
      ],
      receipts: [{ grn: "GRN-7811", date: "2026-10-23", lines: { 1: 40, 2: 25, 3: 6 } }] },

    { po: "PO-4500134", vendor: "V-1005", date: "2026-10-01", requester: "Jordan Lee (Marketing)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "CAT-24", desc: "Product catalog, 24 pp, saddle-stitched", qty: 500, uom: "ea", price: 2.10 },
        { ln: 2, sku: "RC-4x9", desc: "Rack cards 4x9, two-sided", qty: 1000, uom: "ea", price: 0.186 },
      ],
      receipts: [{ grn: "GRN-7795", date: "2026-10-20", lines: { 1: 500, 2: 1000 } }] },

    { po: "PO-4500140", vendor: "V-1005", date: "2026-10-21", requester: "Jordan Lee (Marketing)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "BAN-RT", desc: "Retractable banner stand, printed", qty: 6, uom: "ea", price: 185.00 },
      ],
      receipts: [] },

    { po: "PO-4500150", vendor: "V-1007", date: "2026-10-20", requester: "Jordan Lee (Marketing)",
      receiptRequired: true, status: "Open",
      lines: [
        { ln: 1, sku: "DSN-LOGO", desc: "Logo", qty: 1, uom: "ea", price: 500.00 },
        { ln: 2, sku: "PRT-BAN", desc: "Banner", qty: 2, uom: "ea", price: 45.00 },
        { ln: 3, sku: "PRT-POS", desc: "Poster", qty: 3, uom: "ea", price: 55.00 },
      ],
      receipts: [{ grn: "GRN-7903", date: "2026-10-27", lines: { 1: 1, 2: 2, 3: 3 } }] },
  ],

  // Invoices already entered or paid before this demo starts.
  ledger: [
    { vendor: "V-1001", invoice: "NW-24-1102", date: "2026-09-14", amount: 2310.00, po: "PO-4500098",
      status: "Paid", paidOn: "2026-10-12", payRef: "ACH-20261012-0117", lines: [] },
    { vendor: "V-1002", invoice: "ST-5521", date: "2026-10-04", amount: 4080.00, po: "PO-4500131",
      status: "Paid", paidOn: "2026-10-13", payRef: "ACH-20261013-0204", lines: [{ ln: 1, qty: 600 }] },
    { vendor: "V-1003", invoice: "INV-0871", date: "2026-10-02", amount: 3412.50, po: "PO-4500119",
      status: "Paid", paidOn: "2026-10-14", payRef: "ACH-20261014-0332", lines: [{ ln: 1, qty: 2 }, { ln: 2, qty: 1 }, { ln: 3, qty: 1 }] },
    { vendor: "V-1004", invoice: "BB-30388", date: "2026-09-29", amount: 642.50, po: "PO-4500109",
      status: "Paid", paidOn: "2026-10-27", payRef: "ACH-20261027-0051", lines: [] },
    { vendor: "V-1005", invoice: "2026-0988", date: "2026-09-12", amount: 915.00, po: "PO-4500101",
      status: "Paid", paidOn: "2026-10-10", payRef: "ACH-20261010-0088", lines: [] },
  ],
};

const SAMPLES = [
  { file: "samples/01_Northwind_NW-24-1187.pdf", vendor: "Northwind Packaging", label: "Clean invoice",
    note: "Text PDF, PO quoted, one price 0.95% over PO, freight line added.", kind: "happy" },
  { file: "samples/02_Summit_ST-5538.pdf", vendor: "Summit Textile Mills", label: "Second half of a split PO",
    note: "Bills more canvas than was ordered and webbing that hasn't arrived yet.", kind: "edge" },
  { file: "samples/03_Cascade_CFL-871.pdf", vendor: "Cascade Freight Lines", label: "Re-sent bill, new number",
    note: "\"Second notice\" for a bill already paid, reformatted invoice number.", kind: "edge" },
  { file: "samples/04_Bluebird_BB-30412.pdf", vendor: "Bluebird Office & Janitorial", label: "New bank details",
    note: "Matches the PO exactly, but asks to pay a new account from a lookalike domain.", kind: "edge" },
  { file: "samples/05_Ridgeway_scanned.pdf", vendor: "Ridgeway Print Co.", label: "Scanned, no PO number",
    note: "Image only, so it needs OCR. The PO has to be inferred.", kind: "edge" },
  { file: "samples/06_Olivia_Wilson_picture.webp", vendor: "Olivia Wilson", label: "Made out to another company",
    note: "A small designer invoice saved as a picture. Everything matches a PO, but it's addressed to Studio Shodwe, not us.", kind: "edge" },
];

if (typeof module !== "undefined") module.exports = { SEED, SAMPLES };
