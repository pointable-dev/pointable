import type { PathSeg, Target } from "../shared/types.ts";
import { splitList } from "../shared/selectors.ts";
import { compare, specificity, type Specificity } from "../shared/specificity.ts";

/** A style rule from a stylesheet Pointable can write back to. */
export interface Hit {
  rule: CSSStyleRule;
  devId: string;
  path: PathSeg[];
  nth: number;
  /** Document order, for breaking specificity ties. */
  order: number;
  /** Its media and supports conditions hold right now. */
  active: boolean;
}

/** A rule that applies to an element, with how strongly. */
export interface Match extends Hit {
  specificity: Specificity;
  /** The part of a selector list that matched, e.g. `.card img` of `.card img, .tile img`. */
  part: string;
}

function devIdOf(sheet: CSSStyleSheet): string | null {
  const node = sheet.ownerNode as Element | null;
  if (!node) return null;
  const id = node.getAttribute("data-vite-dev-id");
  if (id) return id;
  if (sheet.href) {
    const url = new URL(sheet.href);
    if (url.origin === location.origin) return url.pathname;
  }
  return null;
}

function key(path: PathSeg[]): string {
  return path.map((s) => (s.kind === "at" ? `@${s.name} ${s.params}` : s.selector)).join(" { ");
}

/** Every style rule in the page's own stylesheets, in document order. */
export function collect(): Hit[] {
  const hits: Hit[] = [];
  let order = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    const devId = devIdOf(sheet);
    if (!devId) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const seen = new Map<string, number>();
    const walk = (list: CSSRuleList, path: PathSeg[], active: boolean) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSStyleRule) {
          const p = [...path, { kind: "rule" as const, selector: rule.selectorText }];
          const k = key(p);
          const nth = seen.get(k) ?? 0;
          seen.set(k, nth + 1);
          hits.push({ rule, devId, path: p, nth, order: order++, active });
          // Nested style rules are not followed yet.
        } else if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, [...path, { kind: "at", name: "media", params: rule.media.mediaText }], active && matchMedia(rule.media.mediaText).matches);
        } else if (rule instanceof CSSSupportsRule) {
          walk(rule.cssRules, [...path, { kind: "at", name: "supports", params: rule.conditionText }], active && CSS.supports(rule.conditionText));
        } else if (typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule) {
          walk(rule.cssRules, [...path, { kind: "at", name: "layer", params: rule.name }], active);
        } else if (typeof CSSContainerRule !== "undefined" && rule instanceof CSSContainerRule) {
          walk(rule.cssRules, [...path, { kind: "at", name: "container", params: rule.conditionText }], active);
        }
      }
    };
    walk(rules, [], true);
  }
  return hits;
}

/** The specificity with which a rule applies to an element, or null if it does not. */
function applies(el: Element, rule: CSSStyleRule): { specificity: Specificity; part: string } | null {
  let best: { specificity: Specificity; part: string } | null = null;
  for (const part of splitList(rule.selectorText)) {
    // States the pointer or keyboard happen to be in right now aren't the element's own style.
    if (/:(hover|active|focus|focus-within|focus-visible)\b/.test(part)) continue;
    try {
      if (!el.matches(part)) continue;
    } catch {
      continue; // pseudo-elements and selectors the browser cannot test
    }
    const s = specificity(part);
    if (!best || compare(s, best.specificity) > 0) best = { specificity: s, part };
  }
  return best;
}

/** The rules that apply to an element right now, weakest first. */
export function matching(el: Element, hits: Hit[]): Match[] {
  const out: Match[] = [];
  for (const h of hits) {
    if (!h.active) continue;
    const a = applies(el, h.rule);
    if (a) out.push({ ...h, ...a });
  }
  return out.sort((a, b) => compare(a.specificity, b.specificity) || a.order - b.order);
}

/** Of the matching rules, the one whose declaration of `property` wins. */
export function winner(matches: Match[], property: string): Match | null {
  let best: Match | null = null;
  let bestImportant = false;
  for (const m of matches) {
    if (!m.rule.style.getPropertyValue(property)) continue;
    const important = m.rule.style.getPropertyPriority(property) === "important";
    if (important || !bestImportant) {
      best = m;
      bestImportant = important;
    }
  }
  return best;
}

/** Where a custom property is set for an element: on it, or on the nearest ancestor that sets it. */
export function tokenSource(el: Element, name: string, hits: Hit[]): { match: Match; on: Element } | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const w = winner(matching(node, hits), name);
    if (w) return { match: w, on: node };
  }
  return null;
}

/** Custom properties set on the root element: the project's design tokens. */
export function rootTokens(hits: Hit[]): Map<string, { value: string; match: Match }> {
  const tokens = new Map<string, { value: string; match: Match }>();
  for (const m of matching(document.documentElement, hits)) {
    for (let i = 0; i < m.rule.style.length; i++) {
      const name = m.rule.style.item(i);
      if (name.startsWith("--")) tokens.set(name, { value: m.rule.style.getPropertyValue(name).trim(), match: m });
    }
  }
  return tokens;
}

export function target(hit: Hit, property: string): Target {
  return { devId: hit.devId, path: hit.path, nth: hit.nth, property };
}

export function firstVar(value: string): string | null {
  return /var\(\s*(--[\w-]+)/.exec(value)?.[1] ?? null;
}

/** A short readable name for an element: tag, id or first class. */
/**
 * Does the rule name this element itself, rather than catching it in a broad net like `.prose > *`?
 * Only such a rule is the element's own place to add a style.
 */
export function namesElement(el: Element, part: string): boolean {
  const last = part.trim().split(/\s*[\s>+~]\s*/).pop() ?? "";
  if (el.id && last.includes(`#${el.id}`)) return true;
  if (Array.from(el.classList).some((c) => new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(last))) return true;
  return new RegExp(`^${el.tagName}(?![\\w-])`, "i").test(last);
}

/** A class that names the element (not one a framework generated), or null. */
export function ownClass(el: Element): string | null {
  return Array.from(el.classList).find((c) => !/^astro-|^svelte-|^data-|^is-|^has-/.test(c)) ?? null;
}

export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).find((c) => !/^astro-|^svelte-|^data-/.test(c));
  return cls ? `${tag}.${cls}` : tag;
}
