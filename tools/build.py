"""Builds site/ (the folder Vercel serves) from src/ and samples/.  Run: python3 tools/build.py"""
import base64, json, os, shutil
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SITE = os.path.join(ROOT, "site")
src = lambda p: open(os.path.join(ROOT, "src", p), encoding="utf-8").read()

html = src("app.html")
# the sample invoices are embedded in the page, so they open even without a server
samples = os.path.join(ROOT, "samples")
packed = {n: base64.b64encode(open(os.path.join(samples, n), "rb").read()).decode() for n in sorted(os.listdir(samples))}
html = html.replace("/*@@SAMPLEFILES@@*/", "const SAMPLE_FILES = " + json.dumps(packed) + ";")
for marker, f in [("/*@@DATA@@*/", "data.js"), ("/*@@ENGINE@@*/", "engine.js"), ("/*@@AI@@*/", "ai.js"), ("/*@@UI@@*/", "ui.js")]:
    html = html.replace(marker, src(f))

shutil.rmtree(SITE, ignore_errors=True)
os.makedirs(os.path.join(SITE, "vendor"))
open(os.path.join(SITE, "index.html"), "w", encoding="utf-8").write(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    "<style>[hidden]{display:none!important}img{max-width:100%}</style></head><body>" + html + "</body></html>")
shutil.copytree(samples, os.path.join(SITE, "samples"))
shutil.copytree(os.path.join(ROOT, "src", "api"), os.path.join(SITE, "api"))   # Vercel function for the AI reader
model = os.path.join(ROOT, "tools", "eng.traineddata.gz")                         # Tesseract English model (OCR)
open(os.path.join(SITE, "vendor", "eng.traineddata.b64.txt"), "w").write(base64.b64encode(open(model, "rb").read()).decode())
print("built site/")
