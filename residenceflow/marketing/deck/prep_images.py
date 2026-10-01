"""Crop the product screenshots to presentation-friendly viewports.

Full-page captures in docs/screenshots are very tall; the decks use the
top viewport (1280x800 desktop, 390x844 mobile) plus a few targeted crops.
Writes PNGs to marketing/deck/assets and a manifest.json with their sizes.
"""
import json, os
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "screenshots")
OUT = os.path.join(os.path.dirname(__file__), "assets")
os.makedirs(OUT, exist_ok=True)

# name -> (source file, crop box or None, max height)
DESKTOP = [
    "admin-dashboard", "admin-dashboard-dark", "admin-building-preview",
    "admin-building-3d", "admin-building-3d-unit", "admin-building-3d-exploded",
    "admin-invoices", "admin-payments", "admin-arrears", "admin-maintenance",
    "admin-tenant-detail", "admin-reports", "admin-admin-roles", "admin-admin-audit-logs",
    "admin-leases", "admin-deposits", "concierge-visitors", "tenant-portal-home",
    "owner-dashboard", "admin-units", "public-login", "admin-invoice-detail",
    "admin-properties",
]
MOBILE = [
    "admin-dashboard-mobile", "admin-building-3d-mobile", "public-login-mobile",
    "tenant-portal-billing-mobile", "admin-payments-mobile", "admin-maintenance-mobile",
    "admin-dashboard-dark-mobile", "admin-arrears-mobile",
]
SPECIAL = {
    # receipt card only
    "admin-receipt-card": ("admin-receipt", (410, 150, 1110, 580)),
    # dashboard KPIs without the sidebar
    "admin-dashboard-kpis": ("admin-dashboard", (240, 60, 1280, 620)),
    "admin-dashboard-charts": ("admin-dashboard", (240, 620, 1280, 1270)),
    "admin-arrears-table": ("admin-arrears", (240, 60, 1280, 560)),
    "admin-admin-roles-table": ("admin-admin-roles", (240, 150, 940, 1060)),
    "admin-reports-grid": ("admin-reports", (240, 60, 1280, 1000)),
}

manifest = {}

def save(name, im):
    path = os.path.join(OUT, name + ".png")
    im.save(path, optimize=True)
    manifest[name] = {"w": im.width, "h": im.height, "file": "assets/" + name + ".png"}

for n in DESKTOP:
    im = Image.open(os.path.join(SRC, n + ".png")).convert("RGB")
    save(n, im.crop((0, 0, im.width, min(im.height, 800))))

for n in MOBILE:
    im = Image.open(os.path.join(SRC, n + ".png")).convert("RGB")
    h = min(im.height, int(im.width * 844 / 390))
    save(n, im.crop((0, 0, im.width, h)))

for n, (src, box) in SPECIAL.items():
    im = Image.open(os.path.join(SRC, src + ".png")).convert("RGB")
    save(n, im.crop(box))

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)
print(f"{len(manifest)} assets written")
