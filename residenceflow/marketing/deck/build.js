/* Builds the GestPro sales decks (EN + FR) into ../dist.
 * Usage: npm run prep && npm run build   (or: node build.js en|fr)
 */
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const Fi = require("react-icons/fi");
const sharp = require("sharp");

const DIST = path.join(__dirname, "..", "dist");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, "assets", "manifest.json"), "utf8"));
fs.mkdirSync(DIST, { recursive: true });

// Palette: deep navy + emerald + light grey
const C = {
  navy: "0B1F3A", navy2: "14305A", navy3: "1E3F73",
  emerald: "10B981", emeraldDk: "059669", emeraldLt: "D1FAE5",
  grey: "F3F4F6", greyLine: "E5E7EB", white: "FFFFFF",
  text: "1F2937", muted: "6B7280", light: "CBD5E1",
};
const FONT = "Calibri";
const HFONT = "Calibri";
const W = 10, H = 5.625, M = 0.5;

// ---------- helpers ----------
const iconCache = {};
async function icon(name, color, px = 256) {
  const key = name + color + px;
  if (iconCache[key]) return iconCache[key];
  const Comp = Fi[name];
  if (!Comp) throw new Error("Unknown icon " + name);
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px, strokeWidth: 2 }));
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  iconCache[key] = "image/png;base64," + buf.toString("base64");
  return iconCache[key];
}

async function iconCircle(slide, name, x, y, d, { bg = C.emerald, fg = C.white } = {}) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: bg }, line: { color: bg, width: 0 } });
  const s = d * 0.5;
  slide.addImage({ data: await icon(name, fg), x: x + (d - s) / 2, y: y + (d - s) / 2, w: s, h: s });
}

function fitBox(name, x, y, w, h) {
  const m = MANIFEST[name];
  if (!m) throw new Error("Unknown asset " + name);
  const r = m.w / m.h;
  let fw = w, fh = w / r;
  if (fh > h) { fh = h; fw = h * r; }
  return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
}

function shot(slide, name, x, y, w, h, { align = "left", shadow = true } = {}) {
  const b = fitBox(name, x, y, w, h);
  if (align === "left") { b.x = x; }
  if (align === "top") { b.y = y; }
  if (align === "topleft") { b.x = x; b.y = y; }
  if (shadow) {
    slide.addShape("roundRect", {
      x: b.x, y: b.y, w: b.w, h: b.h, rectRadius: 0.05,
      fill: { color: C.white }, line: { color: C.greyLine, width: 0.75 },
      shadow: { type: "outer", blur: 6, offset: 2, angle: 60, color: "000000", opacity: 0.25 },
    });
  }
  slide.addImage({ path: path.join(__dirname, MANIFEST[name].file), x: b.x, y: b.y, w: b.w, h: b.h });
  return b;
}

function phone(slide, name, x, y, h) {
  const bezel = 0.07;
  const w = (h - 2 * bezel) * 390 / 844 + 2 * bezel;
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.18, fill: { color: "111827" }, line: { color: "374151", width: 1 },
    shadow: { type: "outer", blur: 8, offset: 3, angle: 60, color: "000000", opacity: 0.35 },
  });
  slide.addImage({ path: path.join(__dirname, MANIFEST[name].file), x: x + bezel, y: y + bezel, w: w - 2 * bezel, h: h - 2 * bezel, rounding: false });
  return { x, y, w, h };
}

function caption(slide, text, x, y, w, opts = {}) {
  slide.addText(text, { x, y, w, h: 0.25, fontFace: FONT, fontSize: 9.5, italic: true, color: opts.color || C.muted, align: opts.align || "left", margin: 0, isTextBox: true });
}

function header(slide, title, sub, { dark = false } = {}) {
  slide.background = { color: dark ? C.navy : C.white };
  const size = title.length > 60 ? 20 : title.length > 46 ? 22.5 : 26;
  slide.addText(title, { x: M, y: 0.3, w: W - 2 * M, h: 0.55, fontFace: HFONT, fontSize: size, bold: true, color: dark ? C.white : C.navy, margin: 0, isTextBox: true, valign: "middle", fit: "shrink" });
  if (sub) slide.addText(sub, { x: M, y: 0.86, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 12, color: dark ? C.light : C.muted, margin: 0, isTextBox: true, valign: "top" });
}

function footer(slide, n, dark = false) {
  slide.addText("GestPro  |  Bouquet Innovation", { x: M, y: H - 0.35, w: 4, h: 0.25, fontFace: FONT, fontSize: 8.5, color: dark ? C.light : "9CA3AF", margin: 0, isTextBox: true });
  slide.addText(String(n), { x: W - M - 0.6, y: H - 0.35, w: 0.6, h: 0.25, fontFace: FONT, fontSize: 8.5, color: dark ? C.light : "9CA3AF", align: "right", margin: 0, isTextBox: true });
}

function bullets(slide, items, x, y, w, h, { size = 12, color = C.text, gap = 7, bold = false } = {}) {
  slide.addText(items.map((t, i) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: i < items.length - 1, paraSpaceAfter: gap, bold } })),
    { x, y, w, h, fontFace: FONT, fontSize: size, color, valign: "top", margin: 0, isTextBox: true, lineSpacingMultiple: 1.05 });
}

function card(slide, x, y, w, h, { fill = C.grey, line } = {}) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { color: fill, width: 0 } });
}

// ---------- slides ----------
async function build(T) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "Bouquet Innovation";
  pres.company = "Bouquet Innovation";
  pres.title = "GestPro";
  let n = 0;

  // 1. Title
  {
    const s = pres.addSlide(); n++;
    s.background = { color: C.navy };
    s.addShape("rect", { x: 0, y: 0, w: 0.06, h: H, fill: { color: C.navy }, line: { color: C.navy, width: 0 } });
    s.addText(T.title.kicker.toUpperCase(), { x: M, y: 0.75, w: 4.6, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.emerald, charSpacing: 3, margin: 0, isTextBox: true });
    s.addText(T.title.headline, { x: M, y: 1.1, w: 4.6, h: 1.0, fontFace: HFONT, fontSize: 60, bold: true, color: C.white, margin: 0, isTextBox: true, valign: "middle" });
    s.addText(T.title.sub, { x: M, y: 2.1, w: 4.5, h: 0.95, fontFace: HFONT, fontSize: 18, color: C.white, margin: 0, isTextBox: true, valign: "top" });
    s.addText(T.title.tag, { x: M, y: 3.15, w: 4.4, h: 1.1, fontFace: FONT, fontSize: 12, color: C.light, margin: 0, isTextBox: true, valign: "top" });
    s.addText(T.title.foot, { x: M, y: H - 0.6, w: 6, h: 0.3, fontFace: FONT, fontSize: 9.5, color: "94A3B8", margin: 0, isTextBox: true });
    shot(s, "admin-dashboard", 5.25, 0.9, 4.4, 2.75, { align: "topleft" });
    phone(s, "admin-dashboard-mobile", 8.0, 2.45, 2.9);
    s.addNotes(T.notes[1]);
  }

  // 2. Problem
  {
    const s = pres.addSlide(); n++;
    header(s, T.problem.title, T.problem.sub);
    const gap = 0.25, cw = (W - 2 * M - 3 * gap) / 4, cy = 1.55, ch = 3.4;
    for (let i = 0; i < 4; i++) {
      const c = T.problem.cards[i], x = M + i * (cw + gap);
      card(s, x, cy, cw, ch);
      await iconCircle(s, c.icon, x + 0.25, cy + 0.3, 0.6, { bg: C.navy });
      s.addText(c.h, { x: x + 0.25, y: cy + 1.1, w: cw - 0.5, h: 0.75, fontFace: HFONT, fontSize: 14.5, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "top" });
      s.addText(c.p, { x: x + 0.25, y: cy + 1.85, w: cw - 0.5, h: 1.4, fontFace: FONT, fontSize: 11, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    }
    footer(s, n); s.addNotes(T.notes[2]);
  }

  // 3. Answer
  {
    const s = pres.addSlide(); n++;
    header(s, T.answer.title, T.answer.sub);
    const b = shot(s, "admin-dashboard", 4.95, 1.45, 4.55, 3.2, { align: "topleft" });
    caption(s, T.answer.caption, b.x, b.y + b.h + 0.08, b.w);
    let y = 1.5;
    for (let i = 0; i < 3; i++) {
      const p = T.answer.points[i];
      s.addShape("ellipse", { x: M, y: y + 0.02, w: 0.42, h: 0.42, fill: { color: C.emerald }, line: { color: C.emerald, width: 0 } });
      s.addText(String(i + 1), { x: M, y: y + 0.02, w: 0.42, h: 0.42, fontFace: HFONT, fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
      s.addText(p.h, { x: M + 0.6, y, w: 3.7, h: 0.4, fontFace: HFONT, fontSize: 15, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(p.p, { x: M + 0.6, y: y + 0.42, w: 3.7, h: 0.75, fontFace: FONT, fontSize: 11.5, color: C.text, margin: 0, isTextBox: true, valign: "top" });
      y += 1.2;
    }
    footer(s, n); s.addNotes(T.notes[3]);
  }

  // 4. Module 1: portfolio
  {
    const s = pres.addSlide(); n++;
    header(s, T.mod1.title, T.mod1.sub);
    bullets(s, T.mod1.bullets, M, 1.5, 3.3, 3.5, { size: 11.5, gap: 8 });
    const a = shot(s, "admin-building-preview", 4.5, 1.4, 5.0, 3.2, { align: "topleft" });
    caption(s, T.mod1.capA, a.x + 2.6, a.y + a.h + 0.08, a.w - 2.6, { align: "right" });
    const b = shot(s, "admin-tenant-detail", 3.95, 3.5, 2.5, 1.6, { align: "topleft" });
    caption(s, T.mod1.capB, b.x, b.y + b.h + 0.06, b.w);
    footer(s, n);
  }

  // 5. Module 2: rent & payments
  {
    const s = pres.addSlide(); n++;
    header(s, T.mod2.title, T.mod2.sub);
    bullets(s, T.mod2.bullets, M, 1.5, 3.6, 3.5, { size: 11.5, gap: 8 });
    const a = shot(s, "admin-invoices", 4.45, 1.35, 4.6, 2.9, { align: "topleft" });
    caption(s, T.mod2.capA, a.x, a.y + a.h + 0.08, 2.5);
    const b = shot(s, "admin-receipt-card", 6.45, 3.4, 2.95, 1.85, { align: "topleft" });
    caption(s, T.mod2.capB, b.x, b.y + b.h + 0.05, b.w - 0.6);
    footer(s, n);
  }

  // 6. Module 3: arrears
  {
    const s = pres.addSlide(); n++;
    header(s, T.mod3.title, T.mod3.sub);
    bullets(s, T.mod3.bullets, M, 1.5, 3.8, 3.6, { size: 11.5, gap: 8 });
    const a = shot(s, "admin-arrears-table", 4.6, 1.4, 4.9, 2.4, { align: "topleft" });
    caption(s, T.mod3.cap, a.x, a.y + a.h + 0.07, a.w);
    const tw = (4.9 - 3 * 0.15) / 4, ty = 4.2;
    const tcol = [C.emeraldLt, "FEF3C7", "FED7AA", "FECACA"];
    const tfg = [C.emeraldDk, "B45309", "C2410C", "B91C1C"];
    for (let i = 0; i < 4; i++) {
      const x = 4.6 + i * (tw + 0.15);
      card(s, x, ty, tw, 0.95, { fill: tcol[i] });
      s.addText(T.mod3.stats[i].n, { x, y: ty + 0.1, w: tw, h: 0.45, fontFace: HFONT, fontSize: 20, bold: true, color: tfg[i], align: "center", margin: 0, isTextBox: true, valign: "middle" });
      s.addText(T.mod3.stats[i].l, { x, y: ty + 0.55, w: tw, h: 0.3, fontFace: FONT, fontSize: 10, color: tfg[i], align: "center", margin: 0, isTextBox: true });
    }
    footer(s, n);
  }

  // 7. Module 4: maintenance / concierge / portal
  {
    const s = pres.addSlide(); n++;
    header(s, T.mod4.title, T.mod4.sub);
    const gap = 0.2, cw = (W - 2 * M - 2 * gap) / 3;
    for (let i = 0; i < 3; i++) {
      const c = T.mod4.cols[i], x = M + i * (cw + gap);
      const b = shot(s, c.img, x, 1.4, cw, 2.0, { align: "topleft" });
      s.addText(c.h, { x, y: b.y + b.h + 0.18, w: cw, h: 0.35, fontFace: HFONT, fontSize: 15, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(c.p, { x, y: b.y + b.h + 0.55, w: cw, h: 1.05, fontFace: FONT, fontSize: 11, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    }
    s.addText(T.mod4.extra, { x: M, y: 4.8, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 10.5, italic: true, color: C.muted, margin: 0, isTextBox: true });
    footer(s, n);
  }

  // 8. 3D & mobile
  {
    const s = pres.addSlide(); n++;
    header(s, T.threeD.title, T.threeD.sub);
    const a = shot(s, "admin-building-3d", M, 1.45, 3.1, 1.95, { align: "topleft" });
    caption(s, T.threeD.capA, a.x, a.y + a.h + 0.06, a.w);
    const b = shot(s, "admin-building-3d-unit", 3.8, 1.45, 3.1, 1.95, { align: "topleft" });
    caption(s, T.threeD.capB, b.x, b.y + b.h + 0.06, b.w);
    const p = phone(s, "admin-building-3d-mobile", 7.75, 1.4, 3.65);
    caption(s, T.threeD.capM, p.x, p.y + p.h + 0.08, p.w, { align: "center" });
    bullets(s, T.threeD.bullets, M, 3.8, 6.4, 1.4, { size: 11.5, gap: 5 });
    footer(s, n);
  }

  // 9. Security
  {
    const s = pres.addSlide(); n++;
    header(s, T.security.title, T.security.sub);
    const cw = 2.85, rh = 1.2;
    for (let i = 0; i < 6; i++) {
      const it = T.security.items[i];
      const x = M + (i % 2) * (cw + 0.2), y = 1.45 + Math.floor(i / 2) * rh;
      await iconCircle(s, it.icon, x, y + 0.02, 0.44, { bg: C.emeraldLt, fg: C.emeraldDk });
      s.addText(it.h, { x: x + 0.58, y, w: cw - 0.58, h: 0.32, fontFace: HFONT, fontSize: 12.5, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(it.p, { x: x + 0.58, y: y + 0.33, w: cw - 0.58, h: 0.8, fontFace: FONT, fontSize: 9.5, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    }
    const a = shot(s, "admin-admin-audit-logs", 6.65, 1.5, 2.85, 2.5, { align: "topleft" });
    caption(s, T.security.cap, a.x, a.y + a.h + 0.07, a.w);
    const l = shot(s, "public-login", 6.65, 3.45, 2.85, 1.78, { align: "topleft" });
    footer(s, n);
  }

  // 10. Roles & multi-enterprise
  {
    const s = pres.addSlide(); n++;
    header(s, T.roles.title, T.roles.sub);
    const cols = 3, chipW = 1.75, chipH = 0.4, gx = 0.12, gy = 0.12;
    T.roles.roles.forEach((r, i) => {
      const x = M + (i % cols) * (chipW + gx), y = 1.55 + Math.floor(i / cols) * (chipH + gy);
      const owner = /owner|propri/i.test(r);
      s.addShape("roundRect", { x, y, w: chipW, h: chipH, rectRadius: 0.2, fill: { color: owner ? C.emeraldLt : C.grey }, line: { color: owner ? C.emerald : C.greyLine, width: 0.75 } });
      s.addText(r, { x, y, w: chipW, h: chipH, fontFace: FONT, fontSize: 9.5, bold: true, color: C.navy, align: "center", valign: "middle", margin: 0, isTextBox: true });
    });
    s.addText(T.roles.note, { x: M, y: 4.2, w: 5.5, h: 0.9, fontFace: FONT, fontSize: 11, italic: true, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    const a = shot(s, "admin-admin-roles-table", 6.55, 1.4, 2.95, 3.5, { align: "top" });
    caption(s, T.roles.cap, a.x, a.y + a.h + 0.07, a.w);
    footer(s, n);
  }

  // 11. Reports
  {
    const s = pres.addSlide(); n++;
    header(s, T.reports.title, T.reports.sub);
    const gw = 2.25;
    T.reports.groups.forEach((g, i) => {
      const x = M + i * (gw + 0.2);
      card(s, x, 1.45, gw, 3.5);
      s.addText(g.h.toUpperCase(), { x: x + 0.2, y: 1.6, w: gw - 0.4, h: 0.3, fontFace: HFONT, fontSize: 11, bold: true, color: C.emeraldDk, charSpacing: 2, margin: 0, isTextBox: true });
      bullets(s, g.items, x + 0.2, 2.0, gw - 0.4, 2.9, { size: 11, gap: 7 });
    });
    const a = shot(s, "admin-reports-grid", 5.5, 1.4, 4.0, 3.55, { align: "topleft" });
    caption(s, T.reports.cap, a.x, a.y + a.h + 0.07, a.w);
    footer(s, n);
  }

  // 12. Onboarding
  {
    const s = pres.addSlide(); n++;
    header(s, T.onboard.title, T.onboard.sub);
    const k = 5, gap = 0.15, cw = (W - 2 * M - (k - 1) * gap) / k, cy = 1.55;
    s.addShape("line", { x: M + cw / 2, y: cy + 0.3, w: (cw + gap) * (k - 1), h: 0, line: { color: C.greyLine, width: 2 } });
    for (let i = 0; i < k; i++) {
      const st = T.onboard.steps[i], x = M + i * (cw + gap);
      s.addShape("ellipse", { x: x + cw / 2 - 0.3, y: cy, w: 0.6, h: 0.6, fill: { color: i === 0 ? C.emerald : C.navy }, line: { color: C.white, width: 2 } });
      s.addText(st.n, { x: x + cw / 2 - 0.3, y: cy, w: 0.6, h: 0.6, fontFace: HFONT, fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
      card(s, x, cy + 0.85, cw, 2.35);
      s.addText(st.h, { x: x + 0.15, y: cy + 1.0, w: cw - 0.3, h: 0.55, fontFace: HFONT, fontSize: 13.5, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "top" });
      s.addText(st.p, { x: x + 0.15, y: cy + 1.55, w: cw - 0.3, h: 1.5, fontFace: FONT, fontSize: 10.5, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    }
    footer(s, n);
  }

  // 13. Who it is for
  {
    const s = pres.addSlide(); n++;
    header(s, T.who.title, T.who.sub);
    const a = shot(s, "owner-dashboard", M, 1.5, 4.1, 2.6, { align: "topleft" });
    caption(s, T.lang === "fr" ? "Vue propriétaire (lecture seule)" : "Owner view (read-only)", a.x, a.y + a.h + 0.07, a.w);
    const p = phone(s, "admin-payments-mobile", 3.35, 2.9, 2.3);
    const cw = 2.2, ch = 1.75, gx = 0.2, gy = 0.2;
    for (let i = 0; i < 4; i++) {
      const c = T.who.cards[i], x = 5.1 + (i % 2) * (cw + gx), y = 1.45 + Math.floor(i / 2) * (ch + gy);
      card(s, x, y, cw, ch);
      await iconCircle(s, c.icon, x + 0.2, y + 0.2, 0.45, { bg: C.navy });
      s.addText(c.h, { x: x + 0.75, y: y + 0.2, w: cw - 0.9, h: 0.45, fontFace: HFONT, fontSize: 12.5, bold: true, color: C.navy, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(c.p, { x: x + 0.2, y: y + 0.78, w: cw - 0.4, h: 0.9, fontFace: FONT, fontSize: 10.5, color: C.text, margin: 0, isTextBox: true, valign: "top" });
    }
    footer(s, n);
  }

  // 14. Why GestPro (dark)
  {
    const s = pres.addSlide(); n++;
    header(s, T.why.title, null, { dark: true });
    const cw = 2.9, ch = 1.75, gx = 0.15, gy = 0.2;
    for (let i = 0; i < 6; i++) {
      const it = T.why.items[i], x = M + (i % 3) * (cw + gx), y = 1.15 + Math.floor(i / 3) * (ch + gy);
      card(s, x, y, cw, ch, { fill: C.navy2 });
      await iconCircle(s, it.icon, x + 0.25, y + 0.25, 0.5, { bg: C.emerald, fg: C.navy });
      s.addText(it.h, { x: x + 0.9, y: y + 0.25, w: cw - 1.1, h: 0.5, fontFace: HFONT, fontSize: 15, bold: true, color: C.white, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(it.p, { x: x + 0.25, y: y + 0.9, w: cw - 0.5, h: 0.8, fontFace: FONT, fontSize: 11, color: C.light, margin: 0, isTextBox: true, valign: "top" });
    }
    footer(s, n, true);
  }

  // 15. Packaging
  {
    const s = pres.addSlide(); n++;
    header(s, T.packaging.title, T.packaging.sub);
    const gap = 0.25, cw = (W - 2 * M - 2 * gap) / 3, cy = 1.4, ch = 3.75;
    T.packaging.tiers.forEach((t, i) => {
      const x = M + i * (cw + gap), f = !!t.featured;
      card(s, x, cy, cw, ch, { fill: f ? C.navy : C.grey });
      s.addText(t.name, { x: x + 0.25, y: cy + 0.2, w: cw - 0.5, h: 0.45, fontFace: HFONT, fontSize: 20, bold: true, color: f ? C.white : C.navy, margin: 0, isTextBox: true, valign: "middle" });
      s.addText(t.for, { x: x + 0.25, y: cy + 0.65, w: cw - 0.5, h: 0.45, fontFace: FONT, fontSize: 10, italic: true, color: f ? C.light : C.muted, margin: 0, isTextBox: true, valign: "top" });
      bullets(s, t.items, x + 0.25, cy + 1.05, cw - 0.5, 1.95, { size: 9.5, gap: 2.5, color: f ? C.white : C.text });
      s.addShape("roundRect", { x: x + 0.25, y: cy + ch - 0.6, w: cw - 0.5, h: 0.38, rectRadius: 0.19, fill: { color: f ? C.emerald : C.white }, line: { color: f ? C.emerald : C.greyLine, width: 0.75 } });
      s.addText(T.packaging.price, { x: x + 0.25, y: cy + ch - 0.6, w: cw - 0.5, h: 0.38, fontFace: FONT, fontSize: 10.5, bold: true, color: f ? C.navy : C.navy, align: "center", valign: "middle", margin: 0, isTextBox: true });
    });
    footer(s, n);
  }

  // 16. Next steps / contact
  {
    const s = pres.addSlide(); n++;
    s.background = { color: C.navy };
    s.addText(T.next.title, { x: M, y: 0.6, w: 5.6, h: 1.0, fontFace: HFONT, fontSize: 30, bold: true, color: C.white, margin: 0, isTextBox: true, valign: "top" });
    let y = 1.9;
    T.next.steps.forEach((st, i) => {
      s.addShape("ellipse", { x: M, y, w: 0.42, h: 0.42, fill: { color: C.emerald }, line: { color: C.emerald, width: 0 } });
      s.addText(String(i + 1), { x: M, y, w: 0.42, h: 0.42, fontFace: HFONT, fontSize: 14, bold: true, color: C.navy, align: "center", valign: "middle", margin: 0, isTextBox: true });
      s.addText(st, { x: M + 0.6, y: y - 0.02, w: 5.0, h: 0.5, fontFace: FONT, fontSize: 14, color: C.white, margin: 0, isTextBox: true, valign: "middle" });
      y += 0.65;
    });
    s.addText(T.next.contact, { x: M, y: 4.05, w: 5.6, h: 0.45, fontFace: HFONT, fontSize: 20, bold: true, color: C.emerald, margin: 0, isTextBox: true, valign: "middle" });
    s.addText(T.next.company, { x: M, y: 4.5, w: 5.6, h: 0.35, fontFace: FONT, fontSize: 12, color: C.light, margin: 0, isTextBox: true });
    s.addText(T.next.thanks, { x: M, y: H - 0.65, w: 3, h: 0.35, fontFace: FONT, fontSize: 11, italic: true, color: "94A3B8", margin: 0, isTextBox: true });
    phone(s, "public-login-mobile", 6.6, 0.7, 4.2);
    phone(s, "tenant-portal-billing-mobile", 8.1, 1.3, 3.9);
  }

  const out = path.join(DIST, T.file);
  await pres.writeFile({ fileName: out });
  console.log("wrote", out, "slides:", n);
}

(async () => {
  const which = process.argv[2];
  const langs = which ? [which] : ["en", "fr"];
  for (const l of langs) await build(require("./content/" + l + ".js"));
})().catch((e) => { console.error(e); process.exit(1); });
