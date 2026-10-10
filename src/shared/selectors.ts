import type { PathSeg } from "./types.ts";

/** Split at top-level commas, leaving commas inside (), [] and strings alone. */
export function splitList(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

/** Replace every `name(…)` call with what `fn` returns for its argument, matching nested parentheses. */
function mapCalls(input: string, name: string, fn: (arg: string) => string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const at = input.indexOf(name + "(", i);
    if (at < 0) break;
    out += input.slice(i, at);
    let depth = 0;
    let j = at + name.length;
    for (; j < input.length; j++) {
      if (input[j] === "(") depth++;
      else if (input[j] === ")" && --depth === 0) break;
    }
    out += fn(input.slice(at + name.length + 1, j));
    i = j + 1;
  }
  return out + input.slice(i);
}

function tidy(selector: string): string {
  return selector
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~,])\s*/g, "$1")
    .replace(/\[\s*([^\]~|^$*=\s]+)\s*([~|^$*]?=)\s*(["']?)([^"'\]]*)\3\s*\]/g, "[$1$2$4]")
    .replace(/::?(before|after|first-line|first-letter)\b/g, "::$1")
    .trim();
}

/** A selector as the browser holds it, with the scoping that frameworks add taken back out. */
export function normalizeCompiled(selector: string): string {
  return tidy(
    selector
      .replace(/\[data-astro-cid-[\w-]+\]/g, "")
      .replace(/:where\(\.astro-[\w-]+\)/g, "")
      .replace(/\[data-v-[\w-]+\]/g, "")
      .replace(/\.svelte-[\w-]+/g, ""),
  );
}

/** A selector as written in source, with `:global(…)` unwrapped the way the compiler does. */
export function normalizeSource(selector: string): string {
  return tidy(mapCalls(selector, ":global", (arg) => arg));
}

export function normalizeParams(params: string): string {
  return params.replace(/\s+/g, "").toLowerCase();
}

/** A comparable key for a path. Compiled paths come from the browser, source paths from the file. */
export function pathKey(path: PathSeg[], side: "compiled" | "source"): string {
  return path
    .map((seg) =>
      seg.kind === "at"
        ? `@${seg.name} ${normalizeParams(seg.params)}`
        : side === "compiled"
          ? normalizeCompiled(seg.selector)
          : normalizeSource(seg.selector),
    )
    .join(" { ");
}

/** Loose equality for CSS values: the browser re-serialises what it parses (".5" becomes "0.5"). */
export function sameValue(a: string, b: string): boolean {
  const norm = (v: string) =>
    v
      .trim()
      .toLowerCase()
      .replace(/\s*!important$/, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([,/()])\s*/g, "$1")
      .replace(/(^|[^\d.\w])(-?)\.(\d)/g, "$1$20.$3")
      .replace(/(\d\.\d*?)0+(?!\d)/g, "$1")
      .replace(/\.(?!\d)/g, "")
      .replace(/["']/g, "");
  return norm(a) === norm(b);
}
