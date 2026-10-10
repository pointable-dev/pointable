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

/** A pattern for visible text that tolerates how it is wrapped, indented and escaped in source. */
export function textPattern(visible: string): RegExp | null {
  const words = visible.replace(/ /g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map((w) => [...w].map(char).join("")).join("(?:\\s|&nbsp;|\\\\n)+");
  const first = /\w/.test(words[0][0]) ? "(?<![\\w])" : "";
  const lastWord = words[words.length - 1];
  const last = /\w/.test(lastWord[lastWord.length - 1]) ? "(?![\\w])" : "";
  return new RegExp(first + body + last, "g");
}

/** Every place in the project's source where this visible text is written. */
export async function findText(root: string, visible: string, limit = 12): Promise<TextHit[]> {
  const pattern = textPattern(visible);
  if (!pattern) return [];
  const hits: TextHit[] = [];
  for await (const file of files(root)) {
    try {
      if ((await stat(file)).size > MAX_BYTES) continue;
      const text = await readFile(file, "utf8");
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
    } catch {
      // unreadable file: skip
    }
  }
  return hits;
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
