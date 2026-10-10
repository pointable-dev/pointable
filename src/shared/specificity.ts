import { splitList } from "./selectors.ts";

export type Specificity = [number, number, number];

const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

export function compare(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function max(list: string): Specificity {
  return splitList(list)
    .map(specificity)
    .reduce<Specificity>((best, s) => (compare(s, best) > 0 ? s : best), [0, 0, 0]);
}

/** Specificity of one complex selector (no top-level commas), per Selectors Level 4. */
export function specificity(selector: string): Specificity {
  const s: Specificity = [0, 0, 0];
  let i = 0;
  const ident = () => {
    const m = /^-?[_a-zA-Z -￿-][\w -￿-]*|^\\./.exec(selector.slice(i));
    i += m ? m[0].length : 1;
    return m ? m[0] : "";
  };
  const args = () => {
    let depth = 0;
    const start = i;
    for (; i < selector.length; i++) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")" && --depth === 0) break;
    }
    i++;
    return selector.slice(start + 1, i - 1);
  };
  const add = (t: Specificity) => {
    s[0] += t[0];
    s[1] += t[1];
    s[2] += t[2];
  };

  while (i < selector.length) {
    const ch = selector[i];
    if (ch === "#") {
      i++;
      ident();
      s[0]++;
    } else if (ch === ".") {
      i++;
      ident();
      s[1]++;
    } else if (ch === "[") {
      while (i < selector.length && selector[i] !== "]") i++;
      i++;
      s[1]++;
    } else if (ch === ":") {
      i++;
      if (selector[i] === ":") {
        i++;
        ident();
        if (selector[i] === "(") args();
        s[2]++;
        continue;
      }
      const name = ident().toLowerCase();
      const arg = selector[i] === "(" ? args() : null;
      if (name === "where") continue;
      if (name === "is" || name === "not" || name === "has" || name === "matches" || name === "-webkit-any") {
        if (arg !== null) add(max(arg));
      } else if ((name === "nth-child" || name === "nth-last-child") && arg && / of /.test(arg)) {
        s[1]++;
        add(max(arg.slice(arg.indexOf(" of ") + 4)));
      } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) s[2]++;
      else s[1]++;
    } else if (ch === "*" || ch === ">" || ch === "+" || ch === "~" || ch === " " || ch === "&") {
      i++;
    } else if (/[\w -￿-]/.test(ch)) {
      ident();
      s[2]++;
    } else i++;
  }
  return s;
}
