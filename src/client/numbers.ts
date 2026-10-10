/** Numbers in a CSS value, skipping digits inside names like `--space-2`. */
const NUMBER = /(?<![\w-])(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)/gi;

export interface NumberAt {
  start: number;
  end: number;
  value: number;
  unit: string;
  decimals: number;
}

export function numbers(value: string): NumberAt[] {
  const out: NumberAt[] = [];
  for (const m of value.matchAll(NUMBER)) {
    const n = m[1];
    out.push({
      start: m.index!,
      end: m.index! + n.length,
      value: parseFloat(n),
      unit: m[2].toLowerCase(),
      decimals: n.includes(".") ? n.split(".")[1].length : 0,
    });
  }
  return out;
}

/** The size of one step for a number, by unit and property: 1px, 0.05rem, 100 for a font weight. */
export function stepFor(n: NumberAt, property: string): number {
  if (property === "font-weight") return 100;
  switch (n.unit) {
    case "rem":
    case "em":
    case "s":
      return 0.05;
    case "ms":
      return 10;
    case "":
      return n.decimals || Math.abs(n.value) < 4 ? 0.05 : 1;
    default:
      return n.decimals ? 0.1 : 1;
  }
}

function format(x: number, decimals: number): string {
  return String(Number(x.toFixed(Math.min(decimals, 4))));
}

/**
 * Change the number at the caret (or the first number) by `steps` steps.
 * Returns the new value and where the changed number now sits, so the caret can stay on it.
 */
export function nudge(value: string, caret: number | null, steps: number, property: string): { value: string; start: number; end: number } | null {
  const all = numbers(value);
  if (!all.length) return null;
  const n = (caret !== null && all.find((x) => caret >= x.start && caret <= x.end + x.unit.length)) || all[0];
  const step = stepFor(n, property);
  const decimals = Math.max(n.decimals, String(step).split(".")[1]?.length ?? 0, steps % 1 ? 2 : 0);
  let next = n.value + steps * step;
  if (property === "font-weight") next = Math.min(1000, Math.max(1, next));
  const text = format(next, decimals);
  return { value: value.slice(0, n.start) + text + value.slice(n.end), start: n.start, end: n.start + text.length };
}
