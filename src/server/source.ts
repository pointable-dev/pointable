import path from "node:path";

/** Where a stylesheet's CSS lives in a file: the whole file, or one `<style>` block of a component. */
export interface Region {
  file: string;
  css: string;
  /** Offset of `css` within the file's text. */
  offset: number;
  /** Line of the file on which `css` starts, 1-based. */
  line: number;
}

const COMPONENT = /\.(astro|vue|svelte)$/;
const PREPROCESSED = /lang\s*=\s*["']?(scss|sass|less|styl|stylus)/;

/**
 * Turn a Vite module id (`/abs/src/x.css`, `/src/X.astro?astro&type=style&index=0&lang.css`)
 * or a stylesheet URL path into a file inside the project, refusing anything outside it.
 */
export function fileFromDevId(devId: string, root: string): { file: string; index: number | null } | string {
  const [rawPath, query = ""] = devId.split("?");
  let p = decodeURIComponent(rawPath);
  if (p.startsWith("/@fs/")) p = p.slice(4);
  const absolute = p.startsWith(root + path.sep) ? p : path.join(root, p);
  const file = path.resolve(absolute);
  if (!file.startsWith(root + path.sep)) return "outside the project";
  if (file.split(path.sep).includes("node_modules")) return "a dependency's stylesheet";

  const params = new URLSearchParams(query);
  if (COMPONENT.test(file)) {
    if (params.get("type") !== "style") return "not a style block";
    return { file, index: Number(params.get("index") ?? 0) };
  }
  if (!/\.(css|pcss|postcss)$/.test(file)) return "not a CSS file";
  return { file, index: null };
}

/** The CSS of the `index`th processed `<style>` block in a component (`is:inline` blocks are not counted). */
export function region(file: string, text: string, index: number | null): Region | string {
  if (index === null) return { file, css: text, offset: 0, line: 1 };
  const blocks = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/g;
  let n = 0;
  for (let m: RegExpExecArray | null; (m = blocks.exec(text)); ) {
    if (/\bis:inline\b/.test(m[1])) continue;
    if (n++ !== index) continue;
    if (PREPROCESSED.test(m[1])) return "a preprocessed (Sass/Less/Stylus) style block";
    const offset = m.index + m[0].indexOf(">") + 1;
    const line = text.slice(0, offset).split("\n").length;
    return { file, css: m[2], offset, line };
  }
  return "style block not found";
}
