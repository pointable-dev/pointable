import postcss, { type AtRule, type Declaration, type Rule, type ChildNode, type Container } from "postcss";
import type { NewRule, PathSeg, Target } from "../shared/types.ts";
import { normalizeCompiled, normalizeParams, normalizeSource, pathKey, splitList } from "../shared/selectors.ts";
import type { Region } from "./source.ts";

/** Where to change text in a region: replace `[start, end)` with `text`. Offsets are within the region. */
export interface Splice {
  start: number;
  end: number;
  text: string;
}

export interface Found {
  rule: Rule;
  decl: Declaration | null;
  /** The rule doesn't exist yet: write `selector { … }` right after `rule`. */
  create?: { selector: string };
  /** 1-based line in the file. */
  line: number;
  /** The source value as written, when declared. */
  value: string | null;
}

function sourcePath(node: Rule): PathSeg[] {
  const segs: PathSeg[] = [];
  for (let n: Container | undefined = node; n && n.type !== "root"; n = n.parent as Container | undefined) {
    if (n.type === "rule") segs.unshift({ kind: "rule", selector: (n as Rule).selector });
    else if (n.type === "atrule") segs.unshift({ kind: "at", name: (n as AtRule).name.toLowerCase(), params: (n as AtRule).params });
  }
  return segs;
}

function lastRuleSelector(path: PathSeg[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (seg.kind === "rule") return normalizeCompiled(seg.selector);
  }
  return "";
}

/** Find the declaration of `property` in a rule, the last one if it is declared twice. */
function declIn(rule: Rule, property: string): Declaration | null {
  const custom = property.startsWith("--");
  let found: Declaration | null = null;
  for (const node of rule.nodes ?? []) {
    if (node.type !== "decl") continue;
    if (custom ? node.prop === property : node.prop.toLowerCase() === property.toLowerCase()) found = node;
  }
  return found;
}

function rawValue(decl: Declaration): string {
  return (decl.raws.value as { raw?: string } | undefined)?.raw ?? decl.value;
}

/**
 * Find the rule a target points at in a region of source CSS.
 * Exact path first, then looser matches when a compiler has rewritten the at-rules around it.
 */
export function locate(reg: Region, target: Target): Found | string {
  let root;
  try {
    root = postcss.parse(reg.css);
  } catch (e) {
    return `could not parse ${reg.file}: ${(e as Error).message}`;
  }
  const rules: Rule[] = [];
  root.walkRules((r) => {
    rules.push(r);
  });

  const wanted = pathKey(target.path, "compiled");
  const wantedAt = target.path.filter((s) => s.kind === "at").map((s) => (s.kind === "at" ? s.name : "")).join(",");
  const wantedSelector = pathKey(target.path.filter((s) => s.kind === "rule"), "compiled");
  const wantedLast = lastRuleSelector(target.path);

  const tiers: ((r: Rule) => boolean)[] = [
    (r) => pathKey(sourcePath(r), "source") === wanted,
    (r) => {
      const p = sourcePath(r);
      const at = p.filter((s) => s.kind === "at").map((s) => (s.kind === "at" ? s.name : "")).join(",");
      return at === wantedAt && pathKey(p.filter((s) => s.kind === "rule"), "source") === wantedSelector;
    },
    (r) => normalizeSource(r.selector) === wantedLast,
  ];

  for (const [tier, test] of tiers.entries()) {
    const matches = rules.filter(test);
    if (!matches.length) continue;
    // Exact paths keep their order, so the nth match is the rule. Looser tiers prefer a rule that declares the property.
    let rule = matches[target.nth] ?? null;
    if (tier > 0 || !rule) {
      const declaring = matches.filter((r) => declIn(r, target.property));
      rule = declaring.length === 1 ? declaring[0] : matches.length === 1 ? matches[0] : (rule ?? null);
    }
    if (!rule) continue;
    const decl = declIn(rule, target.property);
    const node: ChildNode = decl ?? rule;
    return {
      rule,
      decl,
      line: reg.line + (node.source?.start?.line ?? 1) - 1,
      value: decl ? rawValue(decl) : null,
    };
  }
  return `no rule matching ${target.path.map((s) => (s.kind === "at" ? "@" + s.name + " " + normalizeParams(s.params) : s.selector)).join(" › ")}`;
}

/** The change that sets `property: value` in the found rule, keeping the file's own formatting. */
export function splice(reg: Region, found: Found, property: string, value: string): Splice {
  const { rule, decl } = found;
  if (found.create) {
    // A new rule right after the outer one, laid out the way that one is.
    const start = rule.source!.start!.offset;
    const end = rule.source!.end!.offset;
    const lineStart = reg.css.lastIndexOf("\n", start - 1) + 1;
    const indent = /^[ \t]*/.exec(reg.css.slice(lineStart, start))![0];
    const single = !reg.css.slice(start, end).includes("\n");
    const text = single
      ? `\n${indent}${found.create.selector} { ${property}: ${value}; }`
      : `\n\n${indent}${found.create.selector} {\n${indent}  ${property}: ${value};\n${indent}}`;
    return { start: end, end, text };
  }
  if (decl) {
    const start = decl.source!.start!.offset + decl.prop.length + (decl.raws.between ?? ":").length;
    return { start, end: start + rawValue(decl).length, text: value };
  }

  const text = `${property}: ${value};`;
  const ruleStart = rule.source!.start!.offset;
  const ruleEnd = rule.source!.end!.offset; // just past the closing brace
  const singleLine = !reg.css.slice(ruleStart, ruleEnd).includes("\n");
  const last = rule.last;

  if (!last) {
    const open = reg.css.indexOf("{", ruleStart) + 1;
    return { start: open, end: ruleEnd - 1, text: ` ${text} ` };
  }

  const at = last.source!.end!.offset;
  const semicolon = last.type === "decl" && !rule.raws.semicolon ? ";" : "";
  if (singleLine) return { start: at, end: at, text: `${semicolon} ${text}` };
  const before = String(last.raws.before ?? "\n  ");
  const indent = before.slice(before.lastIndexOf("\n") + 1);
  return { start: at, end: at, text: `${semicolon}\n${indent}${text}` };
}

/** The selector a new rule gets, in source terms: the outer rule's matching part, then the element. */
export function newSelector(outer: Rule, create: NewRule): string {
  const want = normalizeCompiled(create.part);
  const parts = splitList(outer.selector);
  const part = parts.find((p) => normalizeSource(p) === want) ?? parts[0];
  const tail = create.wrap === "global" ? `:global(${create.tail})` : create.wrap === "deep" ? `:deep(${create.tail})` : create.tail;
  return `${part} ${tail}`;
}

/**
 * For a target with `create`: the rule it asks for if it is already written beside the outer rule
 * (an earlier save made it), or where to write it.
 */
export function locateNew(reg: Region, outerFound: Found, target: Target): Found {
  const outer = outerFound.rule;
  const selector = newSelector(outer, target.create!);
  const key = normalizeSource(selector);
  const siblings = (outer.parent?.nodes ?? []).filter((n): n is Rule => n.type === "rule" && normalizeSource(n.selector) === key);
  const rule = siblings[siblings.length - 1];
  if (rule) {
    const decl = declIn(rule, target.property);
    const node: ChildNode = decl ?? rule;
    return { rule, decl, line: reg.line + (node.source?.start?.line ?? 1) - 1, value: decl ? rawValue(decl) : null };
  }
  const single = !reg.css.slice(outer.source!.start!.offset, outer.source!.end!.offset).includes("\n");
  return { rule: outer, decl: null, value: null, create: { selector }, line: reg.line + (outer.source?.end?.line ?? 1) - 1 + (single ? 1 : 2) };
}
