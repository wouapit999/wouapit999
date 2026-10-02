/**
 * Isometric SVG rendering of a BuildingModel (pure, no I/O). Used for the hover preview that
 * appears next to building links; it shares the layout engine with the interactive 3D view so
 * both pictures match.
 */
import { STATUS_COLORS, type BuildingModel } from "./building-3d";

interface Box {
  x: number; // min corner
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  stroke?: string;
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Projects a world point to 2D isometric screen coordinates (Y up in world, down on screen). */
export function project(x: number, y: number, z: number) {
  return { u: (x - z) * COS30, v: (x + z) * SIN30 - y };
}

function shade(hex: string, factor: number) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const c = [m[1], m[2], m[3]].map((p) => Math.max(0, Math.min(255, Math.round(parseInt(p, 16) * factor))));
  return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function poly(points: { u: number; v: number }[], fill: string, stroke: string) {
  const pts = points.map((p) => `${p.u.toFixed(2)},${p.v.toFixed(2)}`).join(" ");
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="0.12" stroke-linejoin="round"/>`;
}

/** Visible faces for the camera direction implied by project(): top, +X side and +Z side. */
function boxSvg(b: Box) {
  const { x, y, z, w, h, d } = b;
  const P = project;
  const stroke = b.stroke ?? shade(b.color, 0.55);
  const top = [P(x, y + h, z), P(x + w, y + h, z), P(x + w, y + h, z + d), P(x, y + h, z + d)];
  const right = [P(x + w, y, z), P(x + w, y + h, z), P(x + w, y + h, z + d), P(x + w, y, z + d)];
  const front = [P(x, y, z + d), P(x + w, y, z + d), P(x + w, y + h, z + d), P(x, y + h, z + d)];
  return poly(top, shade(b.color, 1.08), stroke) + poly(right, shade(b.color, 0.78), stroke) + poly(front, shade(b.color, 0.92), stroke);
}

export function renderBuildingSvg(model: BuildingModel, opts: { width?: number; height?: number; title?: string } = {}) {
  const width = opts.width ?? 320;
  const height = opts.height ?? 200;
  const boxes: Box[] = [];
  const slabT = 0.25;
  for (const s of model.slabs) boxes.push({ x: s.x - s.w / 2, y: s.y, z: s.z - s.d / 2, w: s.w, h: slabT, d: s.d, color: "#cbd5e1" });
  for (const c of model.cores) boxes.push({ x: c.x - c.w / 2, y: 0, z: c.z - c.d / 2, w: c.w, h: c.h, d: c.d, color: "#94a3b8" });
  for (const u of model.units) {
    boxes.push({ x: u.x - u.w / 2, y: u.y, z: u.z - u.d / 2, w: u.w, h: u.h, d: u.d, color: STATUS_COLORS[u.status] ?? "#cbd5e1" });
  }
  // Roof slab per block, on top of the highest floor.
  const topY = model.floors.length * model.floorHeight;
  for (const block of model.blocks) {
    const s = model.slabs.find((sl) => sl.block === block);
    if (s) boxes.push({ x: s.x - s.w / 2, y: topY, z: s.z - s.d / 2, w: s.w, h: slabT, d: s.d, color: "#e2e8f0" });
  }
  // Painter's algorithm: far (small x+z) first, then low first.
  boxes.sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y);

  // Fit the projected bounds into the viewport.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const b of boxes) {
    for (const [px, py, pz] of [[b.x, b.y, b.z], [b.x + b.w, b.y, b.z], [b.x, b.y, b.z + b.d], [b.x + b.w, b.y, b.z + b.d],
      [b.x, b.y + b.h, b.z], [b.x + b.w, b.y + b.h, b.z], [b.x, b.y + b.h, b.z + b.d], [b.x + b.w, b.y + b.h, b.z + b.d]]) {
      const p = project(px, py, pz);
      minU = Math.min(minU, p.u); maxU = Math.max(maxU, p.u); minV = Math.min(minV, p.v); maxV = Math.max(maxV, p.v);
    }
  }
  if (!isFinite(minU)) { minU = -5; maxU = 5; minV = -5; maxV = 5; }
  const pad = 1;
  const vb = `${(minU - pad).toFixed(2)} ${(minV - pad).toFixed(2)} ${(maxU - minU + 2 * pad).toFixed(2)} ${(maxV - minV + 2 * pad).toFixed(2)}`;
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  const ground = `<ellipse cx="${((minU + maxU) / 2).toFixed(2)}" cy="${(maxV - 0.3).toFixed(2)}" rx="${((maxU - minU) / 2 + 0.6).toFixed(2)}" ry="${Math.max(1.2, (maxU - minU) * 0.12).toFixed(2)}" fill="#dcfce7" opacity="0.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img">${title}${ground}${boxes.map(boxSvg).join("")}</svg>`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
