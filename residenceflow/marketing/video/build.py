#!/usr/bin/env python3
"""Builds the GestPro promotional video (EN or FR).

Usage:  python3 marketing/video/build.py en|fr

Inputs (prepared by record.mjs / shots.mjs in the scratch directory):
  <SCRATCH>/rec-<lang>/rec-<lang>.mp4 + marks-<lang>.json   real screen recording + step timestamps
  <SCRATCH>/shots-<lang>/*.png                               viewport screenshots in the UI language
Output: marketing/dist/GestPro-Promo-<LANG>.mp4  (1280x720, 25 fps, H.264 + AAC)
"""
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

LANG = (sys.argv[1] if len(sys.argv) > 1 else "en").lower()
ROOT = Path("/home/user/residenceflow")
SCRATCH = Path("/tmp/claude-0/-home-user-wouapit999/04f28657-26f1-5632-b4c6-df1d99bb088e/scratchpad/video")
# Optional environment overrides:
#   GESTPRO_VARIANT=foyou      targeted pitch for Groupe Foyou (logo plates + addressed copy); default: generic promo
#   GESTPRO_MUSIC=/path.mp3    background music (default: the client-supplied track below)
#   GESTPRO_OUT_SUFFIX=Name    output file GestPro-<Name>-<LANG>.mp4 (default: "Promo", or "Groupe-Foyou" for the foyou variant)
VARIANT = os.environ.get("GESTPRO_VARIANT", "").strip().lower()
WORK = SCRATCH / (f"build-{LANG}" + (f"-{VARIANT}" if VARIANT else ""))
DIST = ROOT / "marketing" / "dist"
FF = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2"
DEFAULT_MUSIC = "/root/.claude/uploads/04f28657-26f1-5632-b4c6-df1d99bb088e/34b4075b-Legacy_in_Your_Bloodline.mp3"
MUSIC = os.environ.get("GESTPRO_MUSIC") or DEFAULT_MUSIC
OUT_SUFFIX = os.environ.get("GESTPRO_OUT_SUFFIX") or ("Groupe-Foyou" if VARIANT == "foyou" else "Promo")
PROSPECT = {"name": "Groupe Foyou", "logo": ROOT / "marketing" / "video" / "assets" / "groupe-foyou-logo.png"} if VARIANT == "foyou" else None
SHOTS = SCRATCH / f"shots-{LANG}"
DOCSHOTS = ROOT / "docs" / "screenshots"
REC = SCRATCH / f"rec-{LANG}" / f"rec-{LANG}.mp4"
MARKS = {m["name"]: m["t"] for m in json.load(open(SCRATCH / f"rec-{LANG}" / f"marks-{LANG}.json"))["marks"]}

W, H, FPS = 1280, 720, 25
XF = 0.6  # cross-fade duration

NAVY = (15, 23, 42)
NAVY2 = (30, 41, 59)
EMERALD = (16, 185, 129)
WHITE = (255, 255, 255)
SLATE = (203, 213, 225)
SLATE2 = (148, 163, 184)

F_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
F_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
F_LOGO = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


# ----------------------------------------------------------------------------- copy
T = {
    "en": {
        "tagline": "Rent collected. Buildings under control.",
        "by": "by Bouquet Innovation",
        "problem_h": "Sound familiar?",
        "problem": [
            "Rent that slips through the cracks, month after month",
            "Paper receipts that get lost or disputed",
            "No clear view of who owes what until it is too late",
        ],
        "login": ("One login. Your whole business.", "Owners, managers, cashiers and tenants each see what they need"),
        "dashboard": ("Your entire portfolio on one screen", "Occupancy, collections, arrears and work orders, updated live"),
        "invoices": ("Every rent, every month, invoiced automatically", "Rent, service charges and penalties generated on schedule"),
        "receipt": ("Numbered receipts that cannot be altered", "Each receipt carries a verification code your tenants can check"),
        "arrears": ("Arrears at a glance, reminders sent for you", "Aged balances per tenant: 30, 60, 90 days and more"),
        "3d": ("Your building in interactive 3D", "Occupied, vacant and under-maintenance units, floor by floor"),
        "maintenance": ("Maintenance from request to completion", "Work orders, priorities, technicians and vendors in one flow"),
        "roles": ("13 roles, one secure space per company", "Owners, managers, cashiers, concierges, technicians, tenants..."),
        "audit": ("Two-factor login and a full audit trail", "Every sensitive action is recorded: who, what, when"),
        "reports": ("Reports and exports in one click", "Rent roll, collection rate, arrears aging, revenue by building"),
        "phones": ("Works on phone, tablet and PC, in French and English", "Tenants pay and report issues from their own portal"),
        "trust_h": "Built for Cameroon and Africa",
        "trust": [
            ("FCFA amounts, Douala time zone", "Figures the way your accountant expects them"),
            ("Mobile money, cash and bank transfer", "Every payment confirmed and receipted"),
            ("Fully bilingual: French and English", "Each user picks their own language"),
            ("Cloud hosted, daily backups, 2FA", "Your data protected and available 24/7"),
        ],
        "cta_h": "Ask for your access code today",
        "cta_mail": "support@bouquet-innovation.net",
        "cta_apps": "Android and iOS apps coming soon to the stores",
        "close_sub": "Bouquet Innovation  |  Douala, Cameroon",
        "close_tag": "Rent collected. Buildings under control.",
        "phone_labels": ["Manager", "Tenant portal", "Dark mode"],
    },
    "fr": {
        "tagline": "Loyers encaissés. Immeubles maîtrisés.",
        "by": "par Bouquet Innovation",
        "problem_h": "Ça vous parle ?",
        "problem": [
            "Des loyers qui se perdent, mois après mois",
            "Des reçus papier égarés ou contestés",
            "Aucune visibilité sur les impayés, jusqu'à ce qu'il soit trop tard",
        ],
        "login": ("Une seule connexion. Toute votre activité.", "Propriétaires, gestionnaires, caissiers et locataires : chacun voit ce qui le concerne"),
        "dashboard": ("Tout votre parc immobilier sur un seul écran", "Occupation, encaissements, impayés et interventions, en temps réel"),
        "invoices": ("Chaque loyer, chaque mois, facturé automatiquement", "Loyers, charges et pénalités générés à la date prévue"),
        "receipt": ("Des reçus numérotés, impossibles à falsifier", "Chaque reçu porte un code de vérification que le locataire peut contrôler"),
        "arrears": ("Les impayés d'un coup d'œil, les relances envoyées pour vous", "Soldes par locataire : 30, 60, 90 jours et plus"),
        "3d": ("Votre immeuble en 3D interactive", "Logements occupés, vacants ou en travaux, étage par étage"),
        "maintenance": ("La maintenance, de la demande à la clôture", "Ordres de travail, priorités, techniciens et prestataires dans un seul flux"),
        "roles": ("13 rôles, un espace sécurisé par entreprise", "Propriétaires, gestionnaires, caissiers, concierges, techniciens, locataires..."),
        "audit": ("Connexion à deux facteurs et journal d'audit complet", "Chaque action sensible est tracée : qui, quoi, quand"),
        "reports": ("Rapports et exports en un clic", "État locatif, taux de recouvrement, balance âgée, revenus par immeuble"),
        "phones": ("Sur téléphone, tablette et PC, en français et en anglais", "Les locataires paient et signalent les pannes depuis leur portail"),
        "trust_h": "Conçu pour le Cameroun et l'Afrique",
        "trust": [
            ("Montants en FCFA, heure de Douala", "Des chiffres comme votre comptable les attend"),
            ("Mobile money, espèces et virement", "Chaque paiement confirmé et reçu à l'appui"),
            ("Entièrement bilingue : français et anglais", "Chaque utilisateur choisit sa langue"),
            ("Hébergé dans le cloud, sauvegardes quotidiennes, 2FA", "Vos données protégées et disponibles 24h/24"),
        ],
        "cta_h": "Demandez votre code d'accès dès aujourd'hui",
        "cta_mail": "support@bouquet-innovation.net",
        "cta_apps": "Applications Android et iOS bientôt disponibles sur les stores",
        "close_sub": "Bouquet Innovation  |  Douala, Cameroun",
        "close_tag": "Loyers encaissés. Immeubles maîtrisés.",
        "phone_labels": ["Gestionnaire", "Portail locataire", "Mode sombre"],
    },
}[LANG]

if PROSPECT:
    T.update({
        "en": {
            "title_sub": "A proposal for Groupe Foyou",
            "problem_h": "Does this sound familiar, Groupe Foyou?",
            "problem": [
                "Is rent slipping through the cracks, month after month?",
                "Are paper receipts getting lost or disputed by tenants?",
                "Do you know exactly who owes what, right now?",
            ],
            "dashboard": ("All of Groupe Foyou's buildings on one screen", "Occupancy, collections, arrears and work orders, updated live"),
            "trust_h": "Ready for Groupe Foyou's portfolio",
            "cta_h": "Groupe Foyou, ask for your demonstration",
            "cta_apps": "On-site demonstration within 48 hours",
            "close_tag": "Groupe Foyou + GestPro",
        },
        "fr": {
            "title_sub": "Une proposition pour Groupe Foyou",
            "problem_h": "Groupe Foyou, ça vous parle ?",
            "problem": [
                "Des loyers qui vous échappent, mois après mois ?",
                "Des reçus papier égarés ou contestés par vos locataires ?",
                "Savez-vous précisément qui vous doit quoi, aujourd'hui ?",
            ],
            "dashboard": ("Tous les immeubles de Groupe Foyou sur un seul écran", "Occupation, encaissements, impayés et interventions, en temps réel"),
            "trust_h": "Prêt pour le parc de Groupe Foyou",
            "cta_h": "Groupe Foyou, demandez votre démonstration",
            "cta_apps": "Démonstration sur site sous 48 h",
            "close_tag": "Groupe Foyou + GestPro",
        },
    }[LANG])


# ----------------------------------------------------------------------------- drawing helpers
def fit_font(path, text, max_w, start, minimum=18):
    size = start
    while size > minimum:
        f = font(path, size)
        if f.getlength(text) <= max_w:
            return f
        size -= 1
    return font(path, minimum)


def wrap(text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if f.getlength(t) <= max_w:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def gradient_bg(glow=True):
    """Navy background with a soft diagonal gradient and an emerald glow in a corner."""
    img = Image.new("RGB", (W, H), NAVY)
    px = img.load()
    for y in range(H):
        for x in range(0, W, 2):
            k = 1 - (x / W * 0.55 + y / H * 0.45)
            c = tuple(int(NAVY[i] + (NAVY2[i] - NAVY[i]) * k * 0.9) for i in range(3))
            px[x, y] = c
            px[x + 1, y] = c
    if glow:
        g = Image.new("RGB", (W, H), (0, 0, 0))
        ImageDraw.Draw(g).ellipse((W - 520, H - 420, W + 260, H + 300), fill=EMERALD)
        g = g.filter(ImageFilter.GaussianBlur(160))
        img = Image.blend(img, Image.merge("RGB", [Image.eval(a, lambda v: v) for a in g.split()]).convert("RGB"), 0.0)
        img = Image.composite(img, img, Image.new("L", (W, H), 255))
        # additive-ish glow
        base = img.load(); gl = g.load()
        for y in range(H):
            for x in range(W):
                r, gg, b = gl[x, y]
                if gg:
                    br, bg_, bb = base[x, y]
                    base[x, y] = (min(255, br + r * 22 // 100), min(255, bg_ + gg * 22 // 100), min(255, bb + b * 22 // 100))
    return img


def logo_layer(scale=1.0):
    """'GestPro' word mark with an emerald rounded square icon."""
    s = scale
    f = font(F_LOGO, int(64 * s))
    text = "GestPro"
    tw = f.getlength(text)
    icon = int(72 * s)
    gap = int(22 * s)
    w = int(icon + gap + tw) + 4
    h = int(icon) + 4
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, icon, icon), radius=int(18 * s), fill=EMERALD)
    # simple building glyph inside the icon
    bw, bh = icon * 0.46, icon * 0.56
    bx, by = icon * 0.27, icon * 0.24
    d.rounded_rectangle((bx, by, bx + bw, by + bh), radius=int(4 * s), fill=WHITE)
    for r in range(3):
        for c in range(2):
            d.rectangle((bx + bw * (0.18 + c * 0.44), by + bh * (0.14 + r * 0.27), bx + bw * (0.38 + c * 0.44), by + bh * (0.28 + r * 0.27)), fill=EMERALD)
    d.text((icon + gap, (icon - f.getbbox(text)[3]) / 2 - int(6 * s)), text, font=f, fill=WHITE)
    return img


def text_layer(text, fnt, fill, max_w=None):
    if max_w:
        lines = wrap(text, fnt, max_w)
    else:
        lines = [text]
    lh = int(fnt.size * 1.25)
    w = int(max(fnt.getlength(l) for l in lines)) + 6
    img = Image.new("RGBA", (w, lh * len(lines) + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((0, i * lh), l, font=fnt, fill=fill)
    return img


def check_layer(size=34):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, size - 1, size - 1), fill=EMERALD)
    d.line([(size * 0.27, size * 0.52), (size * 0.44, size * 0.69), (size * 0.74, size * 0.33)], fill=WHITE, width=max(3, size // 9), joint="curve")
    return img


def prospect_plate(scale=1.0, pad=None):
    """The prospect's logo, upscaled with LANCZOS (<= 2.5x) on a white rounded plate so it reads on navy."""
    logo = Image.open(PROSPECT["logo"]).convert("RGBA")
    f = min(2.5, scale)
    logo = logo.resize((int(logo.width * f), int(logo.height * f)), Image.LANCZOS)
    pad = pad if pad is not None else max(10, int(14 * f))
    w, h = logo.width + 2 * pad, logo.height + 2 * pad
    plate = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle((0, 0, w - 1, h - 1), radius=int(min(w, h) * 0.18), fill=(255, 255, 255, 255))
    plate.alpha_composite(logo, (pad, pad))
    return plate


def hstack(parts, gap=28):
    """Horizontally stacks RGBA layers, vertically centred."""
    h = max(p.height for p in parts)
    w = sum(p.width for p in parts) + gap * (len(parts) - 1)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = 0
    for p in parts:
        out.alpha_composite(p, (x, (h - p.height) // 2))
        x += p.width + gap
    return out


def ease(t):
    return 1 - (1 - t) ** 3


def render_card(name, duration, bg, layers):
    """layers: list of dicts {img, x, y, t0, fade, slide}. Writes PNG frames and encodes a scene mp4."""
    n = int(round(duration * FPS))
    fdir = WORK / f"frames-{name}"
    if fdir.exists():
        shutil.rmtree(fdir)
    fdir.mkdir(parents=True)
    for i in range(n):
        t = i / FPS
        frame = bg.copy()
        for L in layers:
            a = (t - L["t0"]) / L.get("fade", 0.7)
            if a <= 0:
                continue
            a = min(1.0, a)
            e = ease(a)
            img = L["img"]
            if a < 1:
                alpha = img.split()[3].point(lambda v: int(v * e))
                img = img.copy()
                img.putalpha(alpha)
            dy = int(L.get("slide", 24) * (1 - e))
            frame.paste(img, (int(L["x"]), int(L["y"] + dy)), img)
        frame.save(fdir / f"{i:04d}.png", compress_level=1)
    out = WORK / f"scene-{name}.mp4"
    run([FF, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(fdir / "%04d.png"),
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), str(out)])
    shutil.rmtree(fdir)
    return out, duration


def caption_png(name, head, proof):
    """Semi-transparent navy band at the bottom with headline + proof line."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    band_top = H - 150
    d.rectangle((0, band_top, W, H), fill=NAVY + (222,))
    d.rectangle((64, band_top + 30, 70, H - 30), fill=EMERALD)
    text_w = W - 64 - 100
    if PROSPECT:
        plate = prospect_plate(0.72, pad=8)
        img.alpha_composite(plate, (W - plate.width - 36, band_top + (150 - plate.height) // 2))
        text_w -= plate.width + 36
    fh = fit_font(F_BOLD, head, text_w, 40, 28)
    d.text((92, band_top + 26), head, font=fh, fill=WHITE)
    fp = fit_font(F_REG, proof, text_w, 25, 19)
    d.text((92, band_top + 92), proof, font=fp, fill=SLATE)
    # small brand chip top-right so the product name is always on screen
    chip = logo_layer(0.36)
    img.paste(chip, (W - chip.width - 24, 18), chip)
    p = WORK / f"cap-{name}.png"
    img.save(p)
    return p


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(" ".join(cmd))
        print(r.stderr[-3000:])
        raise SystemExit(1)
    return r


def render_clip(name, start, duration, head, proof, zoom=0.05, ax=0.5, ay=0.3):
    cap = caption_png(name, head, proof)
    out = WORK / f"scene-{name}.mp4"
    n = int(duration * FPS)
    vf = (
        f"[0:v]fps={FPS},scale={W}:{H},zoompan=z='1+{zoom}*on/{n}':x='(iw-iw/zoom)*{ax}':y='(ih-ih/zoom)*{ay}':d=1:s={W}x{H}:fps={FPS}[v];"
        f"[1:v]format=rgba,fade=t=in:st=0.45:d=0.6:alpha=1[c];[v][c]overlay=0:0:format=auto,format=yuv420p[o]"
    )
    run([FF, "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(REC),
         "-loop", "1", "-t", f"{duration:.3f}", "-i", str(cap), "-filter_complex", vf, "-map", "[o]",
         "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-r", str(FPS), str(out)])
    return out, duration


def prep_still(src, name, y0=0, x0=0, cw=W, ch=H):
    """Crop a 16:9 window from a screenshot and upscale it for a smooth zoom."""
    im = Image.open(src).convert("RGB")
    if im.width != cw:
        im = im.resize((cw, int(im.height * cw / im.width)), Image.LANCZOS)
    if im.height < y0 + ch:
        y0 = max(0, im.height - ch)
    im = im.crop((x0, y0, x0 + cw, y0 + ch)).resize((W * 2, H * 2), Image.LANCZOS)
    p = WORK / f"still-{name}.png"
    im.save(p)
    return p


def render_still(name, png, duration, head, proof, z0=1.0, z1=1.10, a0=(0.5, 0.5), a1=None):
    a1 = a1 or a0
    cap = caption_png(name, head, proof)
    out = WORK / f"scene-{name}.mp4"
    n = int(duration * FPS)
    zexpr = f"{z0}+({z1}-{z0})*on/{n}"
    ax = f"({a0[0]}+({a1[0]}-{a0[0]})*on/{n})"
    ay = f"({a0[1]}+({a1[1]}-{a0[1]})*on/{n})"
    vf = (
        f"[0:v]zoompan=z='{zexpr}':x='(iw-iw/zoom)*{ax}':y='(ih-ih/zoom)*{ay}':d={n}:s={W}x{H}:fps={FPS}[v];"
        f"[1:v]format=rgba,fade=t=in:st=0.45:d=0.6:alpha=1[c];[v][c]overlay=0:0:format=auto,format=yuv420p[o]"
    )
    run([FF, "-y", "-loglevel", "error", "-i", str(png), "-loop", "1", "-t", f"{duration:.3f}", "-i", str(cap),
         "-filter_complex", vf, "-map", "[o]", "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "fast",
         "-crf", "18", "-r", str(FPS), str(out)])
    return out, duration


def phone_mock(shot, screen_h=600):
    """Frames a 390x844 (or 2x) phone screenshot in a dark rounded bezel."""
    im = Image.open(shot).convert("RGB")
    im = im.resize((390, int(im.height * 390 / im.width)), Image.LANCZOS).crop((0, 0, 390, 844))
    sw = int(390 * screen_h / 844)
    im = im.resize((sw, screen_h), Image.LANCZOS)
    bez = 12
    r = int(sw * 0.13)
    pw, ph = sw + 2 * bez, screen_h + 2 * bez
    out = Image.new("RGBA", (pw + 40, ph + 40), (0, 0, 0, 0))
    # shadow
    sh = Image.new("RGBA", out.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((20, 30, 20 + pw, 30 + ph), radius=r + bez, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    out.alpha_composite(sh)
    body = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=r + bez, fill=(17, 24, 39, 255), outline=(71, 85, 105, 255), width=2)
    mask = Image.new("L", (sw, screen_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, screen_h - 1), radius=r, fill=255)
    body.paste(im, (bez, bez), mask)
    # notch pill
    ImageDraw.Draw(body).rounded_rectangle((pw / 2 - sw * 0.11, bez + 6, pw / 2 + sw * 0.11, bez + 20), radius=8, fill=(17, 24, 39, 255))
    out.alpha_composite(body, (20, 20))
    return out


def phones_scene_png(shots, labels):
    bg = gradient_bg()
    # faint desktop screenshot behind, to say "PC too"
    desk = Image.open(SHOTS / "reports.png").convert("RGB").resize((W, H), Image.LANCZOS)
    desk = desk.filter(ImageFilter.GaussianBlur(6))
    bg = Image.blend(bg, desk, 0.16)
    canvas = bg.convert("RGBA")
    xs = [165, 505, 845]
    hs = [440, 480, 440]
    ys = [70, 40, 70]
    fl = font(F_BOLD, 22)
    d = ImageDraw.Draw(canvas)
    for s, x, h_, y, lab in zip(shots, xs, hs, ys, labels):
        pm = phone_mock(s, h_)
        canvas.alpha_composite(pm, (x, y))
        tw = fl.getlength(lab)
        d.rounded_rectangle((x + pm.width / 2 - tw / 2 - 14, y - 36, x + pm.width / 2 + tw / 2 + 14, y - 2), radius=16, fill=NAVY2)
        d.text((x + pm.width / 2 - tw / 2, y - 31), lab, font=fl, fill=WHITE)
    # language chips
    fc = font(F_BOLD, 20)
    for i, tag in enumerate(["FR", "EN"]):
        cx = 40 + i * 62
        d.rounded_rectangle((cx, 24, cx + 50, 56), radius=8, fill=EMERALD if (tag.lower() == LANG) else NAVY2)
        d.text((cx + 25 - fc.getlength(tag) / 2, 29), tag, font=fc, fill=WHITE)
    p = WORK / "phones.png"
    canvas.convert("RGB").resize((W * 2, H * 2), Image.LANCZOS).save(p)
    return p


# ----------------------------------------------------------------------------- scenes

def detect_cuts():
    """Page navigations in the recording, found by frame differencing (the wall-clock marks drift
    by a few seconds because frames are dropped while the browser renders)."""
    import re
    log = WORK / "scene-cuts.txt"
    subprocess.run([FF, "-hide_banner", "-i", str(REC), "-vf", f"select='gte(scene,0.04)',metadata=print:file={log}", "-f", "null", "-"],
                   capture_output=True)
    ev = [(float(m.group(1)), float(m.group(2))) for m in re.finditer(r"pts_time:([\d.]+)\n.*?scene_score=([\d.]+)", log.read_text())]
    return ev


def cut_for(events, mark, before=3.5, after=1.0):
    """Latest isolated cut (not part of a scroll burst) in [mark-before, mark+after]; falls back to the mark."""
    cands = [(t, sc) for t, sc in events if sc >= 0.06 and mark - before <= t <= mark + after]
    best = None
    for i, (t, sc) in enumerate(cands):
        prev = cands[i - 1][0] if i else -10
        if t - prev > 0.3:
            best = t
    return best if best is not None else mark


def build_scenes():
    scenes = []
    bg = gradient_bg()

    # 1. Title card
    tag = text_layer(T["tagline"], fit_font(F_REG, T["tagline"], 1000, 44), SLATE)
    by = text_layer(T["by"], font(F_REG, 26), SLATE2)
    rule = Image.new("RGBA", (120, 5), EMERALD + (255,))
    if PROSPECT:
        logo = logo_layer(1.15)
        cross = text_layer("\u00d7", font(F_REG, 64), SLATE2)
        plate = prospect_plate(1.7)
        sub = text_layer(T["title_sub"], font(F_REG, 30), WHITE)
        scenes.append(render_card("title", 6.0, bg, [
            {"img": logo, "x": (W - (logo.width + cross.width + plate.width + 72)) / 2, "y": 190 + (plate.height - logo.height) / 2, "t0": 0.2, "fade": 0.9},
            {"img": cross, "x": (W - (logo.width + cross.width + plate.width + 72)) / 2 + logo.width + 36, "y": 190 + (plate.height - cross.height) / 2, "t0": 0.9, "fade": 0.6},
            {"img": plate, "x": (W - (logo.width + cross.width + plate.width + 72)) / 2 + logo.width + cross.width + 72, "y": 190, "t0": 1.1, "fade": 0.9, "slide": 30},
            {"img": sub, "x": (W - sub.width) / 2, "y": 190 + plate.height + 40, "t0": 2.0, "fade": 0.8},
            {"img": rule, "x": (W - 120) / 2, "y": 190 + plate.height + 100, "t0": 2.5, "fade": 0.6},
            {"img": tag, "x": (W - tag.width) / 2, "y": 190 + plate.height + 122, "t0": 2.7, "fade": 0.8},
            {"img": by, "x": (W - by.width) / 2, "y": 190 + plate.height + 186, "t0": 3.3, "fade": 0.8},
        ]))
    else:
        logo = logo_layer(1.5)
        scenes.append(render_card("title", 5.5, bg, [
            {"img": logo, "x": (W - logo.width) / 2, "y": 215, "t0": 0.2, "fade": 0.9},
            {"img": rule, "x": (W - 120) / 2, "y": 345, "t0": 0.9, "fade": 0.6},
            {"img": tag, "x": (W - tag.width) / 2, "y": 375, "t0": 1.1, "fade": 0.8},
            {"img": by, "x": (W - by.width) / 2, "y": 445, "t0": 1.9, "fade": 0.8},
        ]))

    # 2. Problem card
    ph = text_layer(T["problem_h"], font(F_BOLD, 52), WHITE)
    layers = [{"img": ph, "x": 110, "y": 120, "t0": 0.3, "fade": 0.8}]
    y = 240
    for i, line in enumerate(T["problem"]):
        f = fit_font(F_REG, line, 1000, 36, 26)
        tl = text_layer(line, f, SLATE)
        dot = Image.new("RGBA", (18, 18), (0, 0, 0, 0))
        ImageDraw.Draw(dot).ellipse((0, 0, 17, 17), fill=(248, 113, 113))
        t0 = 1.3 + i * 2.4
        layers.append({"img": dot, "x": 112, "y": y + 14, "t0": t0, "fade": 0.6})
        layers.append({"img": tl, "x": 150, "y": y, "t0": t0, "fade": 0.7, "slide": 30})
        y += 110
    scenes.append(render_card("problem", 10.0, bg, layers))

    # 3. Product tour: real recording
    M = MARKS
    ev = detect_cuts()
    c_dash = cut_for(ev, M["dashboard"])
    drift = c_dash - M["dashboard"]
    scenes.append(render_clip("login", M["login-submit"] + drift - 2.8, 3.2, *T["login"], zoom=0.04, ax=0.2, ay=0.4))
    scenes.append(render_clip("dashboard", c_dash + 0.4, 5.5, *T["dashboard"], zoom=0.05, ax=0.6, ay=0.35))
    scenes.append(render_clip("invoices", cut_for(ev, M["invoices"]) + 0.4, 5.0, *T["invoices"], zoom=0.05, ax=0.5, ay=0.4))
    scenes.append(render_clip("receipt", cut_for(ev, M["receipt"]) + 0.3, 5.0, *T["receipt"], zoom=0.07, ax=0.55, ay=0.35))
    scenes.append(render_clip("arrears", cut_for(ev, M["arrears"]) + 0.4, 4.5, *T["arrears"], zoom=0.05, ax=0.5, ay=0.4))
    scenes.append(render_clip("3d", cut_for(ev, M["3d-explode"]) - 4.5, 8.5, *T["3d"], zoom=0.06, ax=0.3, ay=0.5))
    scenes.append(render_clip("maintenance", cut_for(ev, M["maintenance"]) + 0.4, 4.5, *T["maintenance"], zoom=0.05, ax=0.5, ay=0.45))

    # 4. Stills with Ken Burns (screenshots taken in the UI language)
    scenes.append(render_still("roles", prep_still(SHOTS / "roles.png", "roles"), 4.5, *T["roles"], z0=1.12, z1=1.0, a0=(0.25, 0.6), a1=(0.4, 0.5)))
    scenes.append(render_still("audit", prep_still(SHOTS / "audit.png", "audit"), 4.5, *T["audit"], z0=1.0, z1=1.12, a0=(0.5, 0.4), a1=(0.65, 0.7)))
    scenes.append(render_still("reports", prep_still(SHOTS / "reports.png", "reports"), 4.5, *T["reports"], z0=1.1, z1=1.0, a0=(0.45, 0.65), a1=(0.5, 0.5)))

    # 5. Phones
    dark = DOCSHOTS / "admin-dashboard-dark-mobile.png"
    pp = phones_scene_png([SHOTS / "m-dashboard.png", SHOTS / "m-portal-home.png", dark], T["phone_labels"])
    scenes.append(render_still("phones", pp, 5.5, *T["phones"], z0=1.0, z1=1.07, a0=(0.5, 0.45), a1=(0.5, 0.4)))

    # 6. Trust card
    tp = prospect_plate(1.0) if PROSPECT else None
    th = text_layer(T["trust_h"], fit_font(F_BOLD, T["trust_h"], (W - 220 - tp.width - 48) if tp else 1060, 50, 34), WHITE)
    layers = [{"img": th, "x": 110, "y": 95, "t0": 0.3, "fade": 0.8}]
    if tp:
        layers.append({"img": tp, "x": W - 110 - tp.width, "y": 95 + (th.height - tp.height) / 2, "t0": 0.6, "fade": 0.8})
    y = 205
    for i, (a, b) in enumerate(T["trust"]):
        ck = check_layer(36)
        la = text_layer(a, fit_font(F_BOLD, a, 980, 32, 24), WHITE)
        lb = text_layer(b, font(F_REG, 23), SLATE2)
        t0 = 1.2 + i * 1.7
        layers.append({"img": ck, "x": 112, "y": y + 2, "t0": t0, "fade": 0.6})
        layers.append({"img": la, "x": 168, "y": y, "t0": t0, "fade": 0.7, "slide": 26})
        layers.append({"img": lb, "x": 168, "y": y + 42, "t0": t0 + 0.25, "fade": 0.7, "slide": 26})
        y += 112
    scenes.append(render_card("trust", 12.0, bg, layers))

    # 7. Call to action
    ch = text_layer(T["cta_h"], fit_font(F_BOLD, T["cta_h"], 1060, 50, 34), WHITE)
    mail_f = font(F_BOLD, 40)
    pill_w = int(mail_f.getlength(T["cta_mail"])) + 72
    pill = Image.new("RGBA", (pill_w, 84), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle((0, 0, pill_w - 1, 83), radius=42, fill=EMERALD)
    ImageDraw.Draw(pill).text((36, 18), T["cta_mail"], font=mail_f, fill=WHITE)
    apps = text_layer(T["cta_apps"], fit_font(F_REG, T["cta_apps"], 1000, 30, 22), SLATE)
    small = logo_layer(0.7)
    if PROSPECT:
        small = hstack([prospect_plate(0.95), text_layer("+", font(F_REG, 44), SLATE2), small], gap=24)
    scenes.append(render_card("cta", 7.0, bg, [
        {"img": ch, "x": (W - ch.width) / 2, "y": 190, "t0": 0.3, "fade": 0.8},
        {"img": pill, "x": (W - pill_w) / 2, "y": 300, "t0": 1.3, "fade": 0.8, "slide": 30},
        {"img": apps, "x": (W - apps.width) / 2, "y": 430, "t0": 2.6, "fade": 0.8},
        {"img": small, "x": (W - small.width) / 2, "y": 560 if not PROSPECT else 535, "t0": 3.4, "fade": 0.8},
    ]))

    # 8. Closing logo
    logo2 = logo_layer(1.5)
    if PROSPECT:
        logo2 = hstack([prospect_plate(1.25), text_layer("+", font(F_REG, 56), SLATE2), logo_layer(1.15)], gap=28)
    tag2 = text_layer(T["close_tag"], fit_font(F_BOLD if PROSPECT else F_REG, T["close_tag"], 1000, 40), WHITE if PROSPECT else SLATE)
    sub = text_layer(T["close_sub"], font(F_REG, 26), SLATE2)
    mail2 = text_layer(T["cta_mail"], font(F_BOLD, 28), EMERALD)
    block_h = logo2.height + 36 + tag2.height + 22 + sub.height + 14 + mail2.height
    y0 = (H - block_h) / 2
    scenes.append(render_card("close", 5.5, bg, [
        {"img": logo2, "x": (W - logo2.width) / 2, "y": y0, "t0": 0.1, "fade": 0.9},
        {"img": tag2, "x": (W - tag2.width) / 2, "y": y0 + logo2.height + 36, "t0": 0.7, "fade": 0.8},
        {"img": sub, "x": (W - sub.width) / 2, "y": y0 + logo2.height + 36 + tag2.height + 22, "t0": 1.3, "fade": 0.8},
        {"img": mail2, "x": (W - mail2.width) / 2, "y": y0 + logo2.height + 36 + tag2.height + 22 + sub.height + 14, "t0": 1.9, "fade": 0.8},
    ]))
    return scenes


def assemble(scenes, out_path):
    files = [str(s[0]) for s in scenes]
    durs = [s[1] for s in scenes]
    n = len(files)
    total = sum(durs) - XF * (n - 1)
    # --- audio: measure loudness, then normalise, fade, trim
    meas = subprocess.run([FF, "-hide_banner", "-i", MUSIC, "-t", f"{total:.3f}", "-af",
                           "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                          capture_output=True, text=True).stderr
    j = json.loads(meas[meas.rfind("{"):meas.rfind("}") + 1])
    ln = (f"loudnorm=I=-18:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
          f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true:print_format=summary")
    fc = []
    prev = "[0:v]"
    off = 0.0
    for i in range(1, n):
        off += durs[i - 1] - XF
        tag = "[v]" if i == n - 1 else f"[x{i}]"
        trans = "fadeblack" if i in (2, n - 3) else "fade"
        fc.append(f"{prev}[{i}:v]xfade=transition={trans}:duration={XF}:offset={off:.3f}{tag}")
        prev = tag
    fc.append(f"[{n}:a]atrim=0:{total:.3f},{ln},afade=t=in:d=1.5,afade=t=out:st={total - 3:.3f}:d=3,aresample=48000[a]")
    cmd = [FF, "-y", "-loglevel", "error"]
    for f in files:
        cmd += ["-i", f]
    cmd += ["-i", MUSIC, "-filter_complex", ";".join(fc), "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{total:.3f}", str(out_path)]
    run(cmd)
    return total


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(parents=True, exist_ok=True)
    scenes = build_scenes()
    out = DIST / f"GestPro-{OUT_SUFFIX}-{LANG.upper()}.mp4"
    total = assemble(scenes, out)
    print(f"wrote {out}  planned duration {total:.1f}s  size {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
