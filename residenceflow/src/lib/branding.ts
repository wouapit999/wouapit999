const HEX = /^#([0-9a-f]{6})$/i;

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastWithWhite(hex: string) {
  return 1.05 / (luminance(hex) + 0.05);
}

export const FALLBACK_BRAND = "#1d4ed8";

/**
 * Returns the configured brand colour only if it is a valid hex colour with enough contrast
 * against white text (WCAG AA for UI, 4.5:1); otherwise the safe fallback theme colour.
 */
export function safeBrandColor(hex: string | null | undefined) {
  if (!hex || !HEX.test(hex)) return FALLBACK_BRAND;
  return contrastWithWhite(hex) >= 4.5 ? hex : FALLBACK_BRAND;
}

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];
export const MAX_IMAGE_BYTES = 512 * 1024;

/** Validates an uploaded branding image by declared type, size and magic bytes. */
export function validateImage(bytes: Uint8Array, mime: string): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(mime)) return "Unsupported image type.";
  if (bytes.byteLength === 0) return "Empty file.";
  if (bytes.byteLength > MAX_IMAGE_BYTES) return "Image exceeds 512 KB.";
  const b = bytes;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpg = b[0] === 0xff && b[1] === 0xd8;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  const isIco = b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
  if (mime === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes).toLowerCase();
    if (!text.includes("<svg") || /<script|on\w+\s*=|javascript:|<foreignobject/.test(text)) return "SVG contains unsafe content.";
    return null;
  }
  if (mime === "image/png" && !isPng) return "File content does not match PNG.";
  if (mime === "image/jpeg" && !isJpg) return "File content does not match JPEG.";
  if (mime === "image/webp" && !isWebp) return "File content does not match WebP.";
  if (mime.includes("icon") && !isIco && !isPng) return "File content does not match ICO.";
  return null;
}
