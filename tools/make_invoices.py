"""Generate the five test invoices used in the demo.

Each vendor gets its own layout on purpose: label wording, date formats,
PO formats and table shapes all differ, the way real vendor invoices do.
The Ridgeway invoice is rendered as an image only (no text layer) to
stand in for a scanned paper invoice.

Run:  python3 tools/make_invoices.py
Out:  samples/*.pdf
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "samples")
os.makedirs(OUT, exist_ok=True)
W, H = LETTER

BUYER = ["Harbor & Pine Outdoor Co.", "Accounts Payable", "2150 NW Riverside Dr", "Portland, OR 97209"]


def money(x):
    return f"{x:,.2f}"


def table(c, x, y, cols, widths, rows, aligns, head_fill=None, font="Helvetica", size=9, row_h=16):
    """Draw a simple table. Returns the y below the last row."""
    c.setFont(font + "-Bold" if font == "Helvetica" else font, size)
    if head_fill:
        c.setFillColor(head_fill)
        c.rect(x, y - 4, sum(widths), row_h, fill=1, stroke=0)
        c.setFillColor(colors.white)
    cx = x
    for title, w, a in zip(cols, widths, aligns):
        if a == "r":
            c.drawRightString(cx + w - 4, y, title)
        else:
            c.drawString(cx + 4, y, title)
        cx += w
    c.setFillColor(colors.black)
    c.setFont(font, size)
    y -= row_h + 2
    for r in rows:
        cx = x
        for val, w, a in zip(r, widths, aligns):
            if a == "r":
                c.drawRightString(cx + w - 4, y, val)
            else:
                c.drawString(cx + 4, y, val)
            cx += w
        c.setStrokeColor(colors.HexColor("#dddddd"))
        c.line(x, y - 5, x + sum(widths), y - 5)
        y -= row_h
    return y


# ---------------------------------------------------------------- 1. Northwind (happy path)
def northwind():
    c = canvas.Canvas(os.path.join(OUT, "01_Northwind_NW-24-1187.pdf"), pagesize=LETTER)
    c.setTitle("Invoice NW-24-1187")
    navy = colors.HexColor("#1f3a5f")
    c.setFillColor(navy)
    c.rect(0, H - 1.1 * inch, W, 1.1 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(0.75 * inch, H - 0.62 * inch, "NORTHWIND PACKAGING SUPPLY LLC")
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, H - 0.85 * inch, "4410 SE Johnson Creek Blvd, Milwaukie, OR 97222  |  ar@northwindpack.com  |  (503) 555-0148")
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 26)
    c.drawRightString(W - 0.75 * inch, H - 1.65 * inch, "INVOICE")

    y = H - 1.6 * inch
    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.75 * inch, y, "BILL TO")
    c.setFont("Helvetica", 10)
    for i, line in enumerate(BUYER):
        c.drawString(0.75 * inch, y - 14 * (i + 1), line)

    meta = [("Invoice No:", "NW-24-1187"), ("Invoice Date:", "October 26, 2026"), ("PO Number:", "PO-4500123"),
            ("Terms:", "Net 30"), ("Due Date:", "November 25, 2026"), ("Customer ID:", "HPO-0042")]
    my = H - 2.0 * inch
    for k, v in meta:
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(4.6 * inch, my, k)
        c.setFont("Helvetica", 9.5)
        c.drawString(5.7 * inch, my, v)
        my -= 14

    rows = [
        ["BX-181210", "Corrugated shipping box 18x12x10 in", "2,000", "ea", "1.42", "2,840.00"],
        ["TP-48CL", "Packing tape 48 mm x 100 m, clear", "300", "rl", "3.18", "954.00"],
        ["VF-PAPER", "Void fill paper roll 15 in x 1,200 ft", "40", "rl", "27.50", "1,100.00"],
        ["FRT", "Freight - LTL delivery to Portland DC", "1", "ea", "85.00", "85.00"],
    ]
    y = table(c, 0.75 * inch, H - 3.2 * inch, ["SKU", "Description", "Qty", "UoM", "Unit Price", "Amount"],
              [70, 220, 50, 40, 70, 82], rows, ["l", "l", "r", "l", "r", "r"], head_fill=navy)

    tx = W - 0.75 * inch
    y -= 10
    for k, v, bold in [("Subtotal", "4,979.00", False), ("Sales Tax (0%)", "0.00", False), ("TOTAL DUE (USD)", "$4,979.00", True)]:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 11 if bold else 10)
        c.drawRightString(tx - 95, y, k)
        c.drawRightString(tx, y, v)
        y -= 17

    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.75 * inch, 2.0 * inch, "REMIT TO")
    c.setFont("Helvetica", 9)
    for i, line in enumerate(["Northwind Packaging Supply LLC", "Bank: Columbia Ridge Bank", "Account ending: 4417",
                              "Payment by ACH preferred. Please reference the invoice number."]):
        c.drawString(0.75 * inch, 2.0 * inch - 13 * (i + 1), line)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(0.75 * inch, 0.7 * inch, "Thank you for your business. Questions? ar@northwindpack.com")
    c.save()


# ---------------------------------------------------------------- 2. Summit (split PO / over-billing)
def summit():
    c = canvas.Canvas(os.path.join(OUT, "02_Summit_ST-5538.pdf"), pagesize=LETTER)
    c.setTitle("Summit Textile Mills invoice ST-5538")
    c.setFont("Times-Bold", 18)
    c.drawCentredString(W / 2, H - 0.8 * inch, "Summit Textile Mills, Inc.")
    c.setFont("Times-Roman", 10)
    c.drawCentredString(W / 2, H - 1.0 * inch, "88 Mill Race Road, Eugene, Oregon 97402  -  Tel 541-555-0190  -  billing@summittextile.com")
    c.line(0.75 * inch, H - 1.12 * inch, W - 0.75 * inch, H - 1.12 * inch)

    c.setFont("Times-Bold", 12)
    c.drawString(0.75 * inch, H - 1.5 * inch, "INVOICE # ST-5538")
    c.setFont("Times-Roman", 10.5)
    c.drawString(0.75 * inch, H - 1.72 * inch, "Date: 10/27/2026")
    c.drawString(0.75 * inch, H - 1.9 * inch, "Customer PO: 4500131")
    c.drawString(0.75 * inch, H - 2.08 * inch, "Terms: 2% 10, Net 45")
    c.drawString(4.4 * inch, H - 1.5 * inch, "Sold to:")
    for i, line in enumerate(BUYER):
        c.drawString(4.4 * inch, H - 1.68 * inch - 14 * i, line)

    c.setFont("Times-Bold", 10.5)
    y = H - 2.8 * inch
    c.drawString(0.75 * inch, y, "Item / Description")
    c.drawRightString(4.6 * inch, y, "Quantity")
    c.drawRightString(5.7 * inch, y, "Price")
    c.drawRightString(W - 0.75 * inch, y, "Extended")
    c.line(0.75 * inch, y - 5, W - 0.75 * inch, y - 5)
    c.setFont("Times-Roman", 10.5)
    rows = [("Canvas, 10 oz duck, natural, 60 in", "700 yd", "6.80", "4,760.00"),
            ("Polypropylene webbing 1 in, black", "3,000 m", "0.42", "1,260.00")]
    y -= 22
    for d, q, p, a in rows:
        c.drawString(0.75 * inch, y, d)
        c.drawRightString(4.6 * inch, y, q)
        c.drawRightString(5.7 * inch, y, p)
        c.drawRightString(W - 0.75 * inch, y, a)
        y -= 18
    c.line(0.75 * inch, y + 6, W - 0.75 * inch, y + 6)
    y -= 10
    c.drawRightString(5.7 * inch, y, "Merchandise total")
    c.drawRightString(W - 0.75 * inch, y, "6,020.00")
    y -= 16
    c.drawRightString(5.7 * inch, y, "Tax")
    c.drawRightString(W - 0.75 * inch, y, "0.00")
    y -= 18
    c.setFont("Times-Bold", 11.5)
    c.drawRightString(5.7 * inch, y, "Amount due")
    c.drawRightString(W - 0.75 * inch, y, "$6,020.00")

    c.setFont("Times-Italic", 10)
    c.drawString(0.75 * inch, 2.4 * inch, "Partial shipment 2 of 2 against your PO 4500131. Balance of order now complete.")
    c.setFont("Times-Roman", 9.5)
    c.drawString(0.75 * inch, 2.15 * inch, "Remit: Summit Textile Mills, Inc. - Willamette Valley Bank - acct ending 6630")
    c.save()


# ---------------------------------------------------------------- 3. Cascade (resent duplicate)
def cascade():
    c = canvas.Canvas(os.path.join(OUT, "03_Cascade_CFL-871.pdf"), pagesize=LETTER)
    c.setTitle("Cascade Freight Lines freight bill")
    green = colors.HexColor("#2d5a3d")
    c.setFillColor(green)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.75 * inch, H - 0.8 * inch, "Cascade Freight Lines Inc.")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8.5)
    c.drawString(0.75 * inch, H - 0.98 * inch, "1200 Marine View Dr, Tacoma, WA 98422  ·  USDOT 3349107  ·  billing@cascadefreight.com")

    c.setFillColor(colors.HexColor("#b03a2e"))
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 0.75 * inch, H - 0.8 * inch, "SECOND NOTICE - PAYMENT DUE")
    c.setFillColor(colors.black)

    c.setFont("Helvetica-Bold", 13)
    c.drawString(0.75 * inch, H - 1.5 * inch, "FREIGHT BILL / INVOICE")
    data = [("Invoice", "CFL 871"), ("Bill date", "2026-10-28"), ("Ref PO", "4500119"), ("Pro number", "CF-77120"),
            ("Ship date", "2026-09-29"), ("Terms", "Net 15")]
    y = H - 1.8 * inch
    for k, v in data:
        c.setFont("Helvetica", 9.5)
        c.drawString(0.75 * inch, y, k)
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(1.9 * inch, y, v)
        y -= 14
    c.setFont("Helvetica", 9.5)
    c.drawString(4.4 * inch, H - 1.8 * inch, "Bill to:")
    for i, line in enumerate(BUYER):
        c.drawString(4.4 * inch, H - 1.95 * inch - 13 * i, line)

    rows = [["Linehaul Portland OR to Reno NV, 53 ft dry van", "2", "1,450.00", "2,900.00"],
            ["Fuel surcharge", "1", "412.50", "412.50"],
            ["Liftgate service at delivery", "1", "100.00", "100.00"]]
    y = table(c, 0.75 * inch, H - 3.0 * inch, ["Description", "Units", "Rate", "Charge"], [300, 50, 80, 102],
              rows, ["l", "r", "r", "r"], head_fill=green)
    y -= 10
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 0.75 * inch - 110, y, "Total charges")
    c.drawRightString(W - 0.75 * inch, y, "3,412.50")
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, 2.3 * inch, "Our records show this bill as unpaid. Please remit promptly to avoid a hold on your account.")
    c.drawString(0.75 * inch, 2.1 * inch, "Remit to: Cascade Freight Lines Inc., Puget Commerce Bank, account ending 5512")
    c.save()


# ---------------------------------------------------------------- 4. Bluebird (bank change)
def bluebird():
    c = canvas.Canvas(os.path.join(OUT, "04_Bluebird_BB-30412.pdf"), pagesize=LETTER)
    c.setTitle("Bluebird invoice BB-30412")
    blue = colors.HexColor("#2f6fb0")
    c.setFillColor(blue)
    c.circle(0.95 * inch, H - 0.85 * inch, 0.22 * inch, fill=1, stroke=0)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(1.3 * inch, H - 0.8 * inch, "Bluebird Office & Janitorial")
    c.setFont("Helvetica", 8.5)
    c.drawString(1.3 * inch, H - 0.97 * inch, "730 Industrial Way, Salem, OR 97301  ·  accounts@bluebird-office-supply.co  ·  (971) 555-0122")
    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(W - 0.75 * inch, H - 0.85 * inch, "Invoice")

    y = H - 1.5 * inch
    for k, v in [("Invoice #", "BB-30412"), ("Date", "Oct 27, 2026"), ("Your PO", "PO-4500127"), ("Terms", "Net 30")]:
        c.setFont("Helvetica", 9.5)
        c.drawString(4.8 * inch, y, k)
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(5.8 * inch, y, v)
        y -= 14
    c.setFont("Helvetica", 9.5)
    c.drawString(0.75 * inch, H - 1.5 * inch, "Ship to / Bill to")
    for i, line in enumerate(BUYER):
        c.drawString(0.75 * inch, H - 1.65 * inch - 13 * i, line)

    rows = [["Nitrile gloves, large, box of 100", "40", "8.95", "358.00"],
            ["Paper towels, multifold, case of 16", "25", "41.20", "1,030.00"],
            ["Neutral floor cleaner, 5 gal", "6", "64.00", "384.00"]]
    y = table(c, 0.75 * inch, H - 2.7 * inch, ["Item", "Qty", "Price", "Total"], [300, 60, 80, 92], rows,
              ["l", "r", "r", "r"], head_fill=blue)
    y -= 8
    for k, v in [("Subtotal", "1,772.00"), ("Tax", "0.00"), ("Balance Due", "$1,772.00")]:
        c.setFont("Helvetica-Bold" if k == "Balance Due" else "Helvetica", 10.5)
        c.drawRightString(W - 0.75 * inch - 100, y, k)
        c.drawRightString(W - 0.75 * inch, y, v)
        y -= 16

    bx, by = 0.75 * inch, 1.6 * inch
    c.setStrokeColor(colors.HexColor("#c0392b"))
    c.setLineWidth(1.4)
    c.rect(bx, by, W - 1.5 * inch, 1.15 * inch, fill=0)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.setFont("Helvetica-Bold", 10)
    c.drawString(bx + 10, by + 0.92 * inch, "IMPORTANT - UPDATED PAYMENT INFORMATION")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9.5)
    for i, line in enumerate([
        "We have moved our banking. Please remit this and all future payments to our new account:",
        "Bank: Meridian Trust Bank    Account ending: 9921",
        "Effective immediately. Our previous account will be closed at month end.",
        "Please update your vendor records and confirm by reply to accounts@bluebird-office-supply.co"]):
        c.drawString(bx + 10, by + 0.72 * inch - 13 * i, line)
    c.save()


# ---------------------------------------------------------------- 5. Ridgeway (scanned, no PO)
def ridgeway():
    S = 3  # render at ~216 dpi on a letter page
    img = Image.new("L", (int(8.5 * 72 * S), int(11 * 72 * S)), 250)
    d = ImageDraw.Draw(img)
    f = lambda size, bold=False: ImageFont.truetype(
        "/System/Library/Fonts/Supplemental/" + ("Courier New Bold.ttf" if bold else "Courier New.ttf"), size * S)
    try:
        f(10)
    except OSError:
        f = lambda size, bold=False: ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/" + ("Arial Bold.ttf" if bold else "Arial.ttf"), size * S)

    def t(x, y, s, size=11, bold=False, anchor="la"):
        d.text((x * S, y * S), s, fill=25, font=f(size, bold), anchor=anchor)

    t(54, 50, "RIDGEWAY PRINT CO.", 20, True)
    t(54, 74, "19 Hawthorne Ave, Bend OR 97701   (541) 555-0175", 10)
    t(54, 88, "orders@ridgewayprint.com", 10)
    t(558, 50, "INVOICE", 20, True, "ra")
    t(400, 120, "Invoice No. 2026-1049", 11, True)
    t(400, 136, "Date: Oct 24 2026", 11)
    t(400, 152, "Terms: Net 30", 11)
    t(54, 120, "Bill to:", 11, True)
    for i, line in enumerate(BUYER):
        t(54, 136 + 15 * i, line, 11)

    y = 250
    d.line((54 * S, (y - 6) * S, 558 * S, (y - 6) * S), fill=40, width=S)
    t(54, y, "DESCRIPTION", 10, True)
    t(380, y, "QTY", 10, True, "ra")
    t(470, y, "UNIT", 10, True, "ra")
    t(558, y, "AMOUNT", 10, True, "ra")
    d.line((54 * S, (y + 16) * S, 558 * S, (y + 16) * S), fill=40, width=S)
    y += 30
    for desc, q, u, a in [("Product catalog 24pp saddle stitched", "500", "2.10", "1,050.00"),
                          ("Rack cards 4x9 two sided", "1,000", "0.186", "186.00")]:
        t(54, y, desc, 11)
        t(380, y, q, 11, anchor="ra")
        t(470, y, u, 11, anchor="ra")
        t(558, y, a, 11, anchor="ra")
        y += 22
    d.line((54 * S, (y) * S, 558 * S, (y) * S), fill=40, width=S)
    y += 18
    t(470, y, "Subtotal", 11, anchor="ra"); t(558, y, "1,236.00", 11, anchor="ra"); y += 18
    t(470, y, "Tax", 11, anchor="ra"); t(558, y, "0.00", 11, anchor="ra"); y += 20
    t(470, y, "TOTAL DUE", 12, True, "ra"); t(558, y, "$1,236.00", 12, True, "ra")
    t(54, 560, "Remit to Ridgeway Print Co. - High Desert Bank - account ending 3086", 10)
    t(54, 578, "Job: Fall catalog + rack cards. Thank you!", 10)

    # make it look scanned: slight skew, blur, paper noise, uneven exposure
    random.seed(7)
    img = img.rotate(0.7, resample=Image.BICUBIC, fillcolor=245, expand=False)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    px = img.load()
    for _ in range(26000):
        x, y = random.randrange(img.width), random.randrange(img.height)
        px[x, y] = max(0, px[x, y] - random.randrange(40, 120))
    shade = Image.linear_gradient("L").resize(img.size).point(lambda v: 255 - v // 14)
    img = Image.composite(img, Image.new("L", img.size, 0), shade)
    path_png = os.path.join(HERE, "_ridgeway_scan.jpg")
    img.convert("L").save(path_png, quality=72)

    c = canvas.Canvas(os.path.join(OUT, "05_Ridgeway_scanned.pdf"), pagesize=LETTER)
    c.setTitle("scan_0047")
    c.drawImage(path_png, 0, 0, W, H)
    c.save()
    os.replace(path_png, os.path.join(HERE, "ridgeway_scan_preview.jpg"))


if __name__ == "__main__":
    northwind(); summit(); cascade(); bluebird(); ridgeway()
    print("wrote", sorted(os.listdir(OUT)))
