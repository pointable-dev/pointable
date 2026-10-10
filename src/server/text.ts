import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Where a piece of visible text is written in the project. Offsets are into the file's text. */
export interface TextHit {
  file: string;
  start: number;
  end: number;
  line: number;
  context: string;
}

const EXTENSIONS = /\.(astro|vue|svelte|html?|md|mdx|markdoc|jsx|tsx|js|ts|mjs|cjs|json|ya?ml|txt)$/i;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".astro", ".next", ".nuxt", ".svelte-kit", ".output", ".vercel", ".netlify", ".pointable", "coverage", ".cache", ".turbo"]);
const MAX_BYTES = 1_000_000;

async function* files(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (SKIP.has(e.name) || e.isDirectory()) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) yield* files(full);
    } else if (EXTENSIONS.test(e.name)) yield full;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A character as it may be written in source: typographic quotes and dashes, or as HTML entities. */
function char(ch: string): string {
  switch (ch) {
    case "'":
    case "’":
    case "‘":
      return "(?:'|’|‘|&rsquo;|&lsquo;|&#39;|&#x27;|&apos;|\\\\')";
    case '"':
    case "“":
    case "”":
      return '(?:"|“|”|&quot;|&ldquo;|&rdquo;|\\\\")';
    case "&":
      return "(?:&amp;|&)";
    case "—":
      return "(?:—|&mdash;)";
    case "–":
      return "(?:–|&ndash;)";
    case "…":
      return "(?:…|&hellip;|\\.\\.\\.)";
    case "<":
      return "(?:<|&lt;)";
    case ">":
      return "(?:>|&gt;)";
    default:
      return escapeRegex(ch);
  }
}

export const words = (s: string) => s.replace(/\u00a0/g, " ").trim().split(/\s+/).filter(Boolean);

/**
 * A pattern for visible text that tolerates how it is wrapped, indented and escaped in source.
 * Closing punctuation is optional, since templates often add it (`{title}.`).
 */
export function textPattern(visible: string): RegExp | null {
  const list = words(visible);
  if (!list.length) return null;
  const parts = list.map((w) => [...w].map(char).join(""));
  const lastWord = list[list.length - 1];
  const closing = /[.,;:!?]$/.exec(lastWord);
  if (closing && lastWord.length > 1) parts[parts.length - 1] = [...lastWord.slice(0, -1)].map(char).join("") + `(?:${char(closing[0])})?`;
  const body = parts.join("(?:\\s|&nbsp;|\\\\n)+");
  const first = /\w/.test(list[0][0]) ? "(?<![\\w])" : "";
  const last = /\w/.test(lastWord.replace(/[.,;:!?]$/, "").slice(-1)) ? "(?![\\w])" : "";
  return new RegExp(first + body + last, "g");
}

export interface Source {
  file: string;
  text: string;
}

/** The project's text files, read once per edit. */
export async function loadSources(root: string): Promise<Source[]> {
  const out: Source[] = [];
  for await (const file of files(root)) {
    try {
      if ((await stat(file)).size > MAX_BYTES) continue;
      out.push({ file, text: await readFile(file, "utf8") });
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}

/** Every place in the project's source where this visible text is written. */
export async function findText(root: string, visible: string, limit = 12): Promise<TextHit[]> {
  return search(await loadSources(root), visible, limit);
}

export function search(sources: Source[], visible: string, limit = 12): TextHit[] {
  const pattern = textPattern(visible);
  if (!pattern) return [];
  const hits: TextHit[] = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(pattern)) {
      const start = m.index!;
      const end = start + m[0].length;
      const lineStart = text.lastIndexOf("\n", start) + 1;
      const lineEnd = text.indexOf("\n", end);
      hits.push({
        file,
        start,
        end,
        line: text.slice(0, start).split("\n").length,
        context: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim().slice(0, 160),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export interface Plan {
  /** The stretch of visible text to look for, and what it becomes. */
  before: string;
  after: string;
  hits: TextHit[];
}

/**
 * Decide what to replace. Ideally the whole text is written in one place. When it isn't (a heading
 * put together from two props, say), narrow to the words that changed, widened with neighbouring
 * words only as far as needed to find them in exactly one place.
 */
export function plan(sources: Source[], before: string, after: string): Plan {
  const whole = search(sources, before);
  if (whole.length) return { before, after, hits: whole };

  const b = words(before);
  const a = words(after);
  let p = 0;
  while (p < b.length && p < a.length && b[p] === a[p]) p++;
  let s = 0;
  while (s < b.length - p && s < a.length - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s++;
  const end = b.length - s;
  const make = (l: number, r: number, hits: TextHit[]): Plan => ({
    before: b.slice(l, r).join(" "),
    after: [...b.slice(l, p), ...a.slice(p, a.length - s), ...b.slice(end, r)].join(" "),
    hits,
  });

  let several: Plan | null = null;
  for (let size = Math.max(1, end - p); size <= b.length; size++) {
    let any = false;
    for (let l = Math.max(0, end - size); l <= Math.min(p, b.length - size); l++) {
      const hits = search(sources, b.slice(l, l + size).join(" "));
      if (hits.length === 1) return make(l, l + size, hits);
      if (hits.length) {
        any = true;
        several ??= make(l, l + size, hits);
      }
    }
    // A longer stretch can only be found in fewer places; once nothing is found, nothing longer will be.
    if (!any) break;
  }
  return several ?? { before, after, hits: [] };
}

/** Inside a JS/TS string literal on this line? Returns its quote character. */
function quoteAround(text: string, start: number): string | null {
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const before = text.slice(lineStart, start);
  let open: string | null = null;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === "\\") i++;
    else if (open) {
      if (ch === open) open = null;
    } else if (ch === '"' || ch === "'" || ch === "`") open = ch;
  }
  return open;
}

function frontmatterEnd(text: string): number {
  if (!text.startsWith("---")) return -1;
  const end = text.indexOf("\n---", 3);
  return end < 0 ? -1 : end;
}

/** The new text, escaped for where it goes: a string literal, an attribute, JSX or markup. */
export function escapeFor(file: string, text: string, start: number, next: string): string {
  const ext = path.extname(file).toLowerCase();
  const js = (q: string) => next.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), "\\" + q).replace(/\n/g, q === "`" ? "\n" : "\\n");

  if (ext === ".json") return js('"');
  if (ext === ".md" || ext === ".mdx" || ext === ".txt" || ext === ".yml" || ext === ".yaml") return next;

  const inScript = [".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"].includes(ext) || (ext === ".astro" && start < frontmatterEnd(text));
  const quote = quoteAround(text, start);
  // A string literal in script, or an attribute value in markup.
  if (quote && inScript) return js(quote);
  if (quote) return next.replace(new RegExp(quote, "g"), quote === '"' ? "&quot;" : "&#39;");
  // Markup text (HTML, a component template, or JSX text).
  let out = next.replace(/&(?![a-z]+;|#\d+;)/gi, "&amp;").replace(/</g, "&lt;");
  if (ext !== ".html" && ext !== ".htm") out = out.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
  return out;
}
