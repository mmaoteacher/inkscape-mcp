/**
 * Minimal SVG document helpers.
 *
 * Shapes and text are emitted as SVG markup and then handed to Inkscape, which
 * re-opens and re-exports the file. Inkscape therefore remains the authority on
 * whether the document is valid - the markup built here is only the authoring
 * step, and a malformed document fails at the Inkscape pass rather than silently
 * producing a broken file.
 */

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

/** Validate an id so it cannot break out of the attribute or collide with Inkscape names. */
export function assertSafeId(id: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id)) {
    throw new Error(
      `Invalid id "${id}": must start with a letter or underscore and contain only letters, digits, ".", "-" or "_"`,
    );
  }
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${n}`);
  // Keep it short but lossless enough for pixel coordinates.
  return String(Math.round(n * 1000) / 1000);
}

export interface SvgMeta {
  width: number;
  height: number;
  viewBox: string;
}

export function parseLength(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = value.trim().match(/^(-?[\d.]+)/);
  return match ? Number(match[1]) : fallback;
}

export function createSvgDocument(meta: SvgMeta, body: string, background?: string): string {
  const bg = background
    ? `\n  <rect id="background" x="0" y="0" width="${formatNumber(meta.width)}" height="${formatNumber(
        meta.height,
      )}" fill="${escapeXml(background)}" />`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${formatNumber(
    meta.width,
  )}" height="${formatNumber(meta.height)}" viewBox="0 0 ${formatNumber(meta.width)} ${formatNumber(meta.height)}">${bg}
${body}
</svg>
`;
}

/**
 * Insert a fragment just before the closing </svg> tag.
 * Throws when the file does not look like an SVG document, so a wrong inputPath
 * fails loudly instead of appending markup to an unrelated file.
 */
export function insertFragment(svg: string, fragment: string): string {
  const closeIndex = svg.lastIndexOf("</svg>");
  if (closeIndex === -1) {
    throw new Error("input is not an SVG document (no closing </svg> tag found)");
  }
  const head = svg.slice(0, closeIndex);
  const tail = svg.slice(closeIndex);
  const needsNewline = !head.endsWith("\n");
  return `${head}${needsNewline ? "\n" : ""}${fragment}\n${tail}`;
}

/** Ensure the root element declares the SVG namespace (hand-edited files may omit it). */
export function ensureSvgNamespace(svg: string): string {
  if (/xmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) return svg;
  return svg.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

const ELEMENT_TAGS = [
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "image",
  "use",
  "g",
  "svg",
];

export interface SvgElementInfo {
  id: string;
  tag: string;
}

/**
 * Best-effort map of element id -> tag name using a shallow tag scan.
 * Only used to annotate the authoritative geometry that Inkscape reports via
 * --query-all, so a missed element degrades to "unknown" instead of failing.
 */
export function mapIdsToTags(svg: string): Map<string, string> {
  const map = new Map<string, string>();
  const tagPattern = new RegExp(`<(${ELEMENT_TAGS.join("|")})\\b([^>]*)`, "g");
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(svg)) !== null) {
    const idMatch = match[2].match(/\bid\s*=\s*"([^"]+)"/);
    if (idMatch && !map.has(idMatch[1])) {
      map.set(idMatch[1], match[1]);
    }
  }
  return map;
}

export function readDocumentMeta(svg: string): SvgMeta {
  const rootMatch = svg.match(/<svg\b([^>]*)>/);
  if (!rootMatch) throw new Error("input is not an SVG document (no <svg> root element found)");
  const attrs = rootMatch[1];

  const viewBoxMatch = attrs.match(/viewBox\s*=\s*"([^"]+)"/);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { width: parts[2], height: parts[3], viewBox: viewBoxMatch[1] };
    }
  }

  const width = parseLength(attrs.match(/\bwidth\s*=\s*"([^"]+)"/)?.[1], NaN);
  const height = parseLength(attrs.match(/\bheight\s*=\s*"([^"]+)"/)?.[1], NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("could not determine the document size from width/height or viewBox");
  }
  return { width, height, viewBox: `0 0 ${width} ${height}` };
}
