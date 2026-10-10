import { firstVar } from "./cssom.ts";
import { sameValue } from "../shared/selectors.ts";

/** A choice in a dropdown: a token or a preset value. */
export interface Option {
  label: string;
  value: string;
  /** Short resolved value shown beside the label, like "16.8px". */
  hint?: string;
  /** A colour to show as a swatch. */
  color?: string;
  /** CSS to render the label in, so a font or weight shows itself. */
  style?: string;
  /** Sorts options on one scale; options without it keep their order. */
  size?: number;
  group: "Tokens" | "Values" | "Fonts";
}

export type Kind = "scale" | "color" | "font" | "weight" | "choice";

export interface RowSpec {
  prop: string;
  label: string;
  kind: Kind;
}

export const TEXT_ROWS: RowSpec[] = [
  { prop: "font-family", label: "Font", kind: "font" },
  { prop: "font-size", label: "Size", kind: "scale" },
  { prop: "font-weight", label: "Weight", kind: "weight" },
  { prop: "line-height", label: "Line spacing", kind: "scale" },
  { prop: "letter-spacing", label: "Letter spacing", kind: "scale" },
  { prop: "color", label: "Color", kind: "color" },
];

export const BOX_ROWS: RowSpec[] = [
  { prop: "background-color", label: "Background", kind: "color" },
  { prop: "border-radius", label: "Corners", kind: "scale" },
  { prop: "padding", label: "Inner space", kind: "scale" },
  { prop: "margin", label: "Outer space", kind: "scale" },
  { prop: "gap", label: "Gap", kind: "scale" },
];

export const IMAGE_ROWS: RowSpec[] = [
  { prop: "aspect-ratio", label: "Shape", kind: "choice" },
  { prop: "object-fit", label: "Fit", kind: "choice" },
  { prop: "object-position", label: "Focus", kind: "choice" },
];

/** Fixed choices, for properties without a scale. */
const CHOICES: Record<string, [string, string][]> = {
  "aspect-ratio": [
    ["Original", "auto"],
    ["Square", "1 / 1"],
    ["Landscape 4:3", "4 / 3"],
    ["Landscape 3:2", "3 / 2"],
    ["Wide 16:9", "16 / 9"],
    ["Portrait 3:4", "3 / 4"],
    ["Portrait 2:3", "2 / 3"],
  ],
  "object-fit": [
    ["Fill the frame (crop)", "cover"],
    ["Show it all", "contain"],
    ["Stretch", "fill"],
    ["Actual size", "none"],
  ],
  "object-position": [
    ["Center", "50% 50%"],
    ["Top", "50% 0%"],
    ["Bottom", "50% 100%"],
    ["Left", "0% 50%"],
    ["Right", "100% 50%"],
  ],
};

const WEIGHTS: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };

/** Which tokens suit a property, by name. Colours are recognised by value instead. */
const TOKEN_NAMES: Record<string, RegExp> = {
  "font-size": /type|font-size|text|size|fs/i,
  "line-height": /leading|line-height|lh/i,
  "letter-spacing": /tracking|letter/i,
  "font-weight": /weight/i,
  padding: /space|spacing|gap|gutter|pad/i,
  margin: /space|spacing|gap|gutter|margin/i,
  gap: /space|spacing|gap|gutter/i,
  "border-radius": /radius|round|corner/i,
};

/** Preset values when a project has no tokens for a property, or as well as them. */
function presets(prop: string, rem: boolean): Option[] {
  const px = (n: number) => (rem ? `${Number((n / 16).toFixed(4))}rem` : `${n}px`);
  const list = (values: (number | string)[], label = (v: number | string) => String(v)) =>
    values.map((v) => ({ label: label(v), value: typeof v === "number" ? px(v) : v, group: "Values" as const }));
  switch (prop) {
    case "font-size":
      return list([12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80], (v) => `${v}px`);
    case "line-height":
      return ["1", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.8", "2"].map((v) => ({ label: v, value: v, group: "Values" as const }));
    case "letter-spacing":
      return [
        ["Tighter", "-0.04em"],
        ["Tight", "-0.02em"],
        ["Snug", "-0.01em"],
        ["Normal", "normal"],
        ["Wide", "0.02em"],
        ["Wider", "0.05em"],
        ["Widest", "0.1em"],
      ].map(([label, value]) => ({ label, value, hint: value === "normal" ? undefined : value, group: "Values" as const }));
    case "border-radius":
      return [
        ["Square", "0"],
        ["2px", "2px"],
        ["4px", "4px"],
        ["6px", "6px"],
        ["8px", "8px"],
        ["12px", "12px"],
        ["16px", "16px"],
        ["24px", "24px"],
        ["Pill", "999px"],
      ].map(([label, value]) => ({ label, value, group: "Values" as const }));
    case "padding":
    case "margin":
    case "gap":
      return list([0, 4, 8, 12, 16, 24, 32, 48, 64, 96], (v) => (v === 0 ? "None" : `${v}px`));
    default:
      return [];
  }
}

let probe: HTMLElement | null = null;
/** What a value comes to on this page, e.g. `var(--type-body)` → "16.8px". */
export function resolve(prop: string, value: string): string {
  if (!probe || !probe.isConnected) {
    probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:100px;";
    document.body.append(probe);
  }
  probe.style.removeProperty(prop);
  probe.style.setProperty(prop, value);
  return getComputedStyle(probe).getPropertyValue(prop).trim();
}

const px = (s: string) => (/^-?[\d.]+px$/.test(s) ? parseFloat(s) : NaN);
const roundPx = (s: string) => (Number.isNaN(px(s)) ? s : `${Math.round(px(s) * 10) / 10}px`);

/** "--type-body" → "Body", "--space-2" → "2". */
export function pretty(token: string): string {
  const name = token.replace(/^--/, "").replace(/^(type|font-size|font|text|fs|space|spacing|gap|color|colour|radius|rounded|leading|tracking|weight|size)-/i, "");
  return (name || token.replace(/^--/, "")).replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function isColor(value: string) {
  return !value.includes("var(") && CSS.supports("color", value);
}

/** The dropdown's choices for a property: matching tokens first, then presets. */
export function optionsFor(prop: string, kind: Kind, current: string, tokens: Map<string, { value: string }>): Option[] {
  if (kind === "font") return fonts(current);
  if (kind === "choice") return (CHOICES[prop] ?? []).map(([label, value]) => ({ label, value, group: "Values" as const }));
  if (kind === "weight") return weights(current);

  const out: Option[] = [];
  for (const [name, { value }] of tokens) {
    if (kind === "color" ? !isColor(value) : isColor(value) || !TOKEN_NAMES[prop]?.test(name)) continue;
    const resolved = resolve(prop, `var(${name})`);
    out.push({ label: pretty(name), value: `var(${name})`, hint: kind === "color" ? undefined : roundPx(resolved), color: kind === "color" ? value : undefined, size: px(resolved), group: "Tokens" });
  }
  if (kind !== "color") out.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  if (prop === "background-color") out.push({ label: "None", value: "transparent", group: "Values" });
  if (kind === "scale") {
    const rem = /rem\b/.test(current) || out.some((o) => /rem/.test(tokens.get(firstVar(o.value) ?? "")?.value ?? ""));
    for (const p of presets(prop, rem)) {
      const resolved = resolve(prop, p.value);
      out.push({ ...p, size: px(resolved), hint: p.hint ?? (/rem$/.test(p.value) ? roundPx(resolved) : undefined) });
    }
  }
  return out;
}

function fonts(current: string): Option[] {
  const families = new Set<string>();
  document.fonts.forEach((f) => families.add(f.family.replace(/^["']|["']$/g, "")));
  const first = current.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (first) families.add(first);
  const rest = current.split(",").slice(1).join(",").trim();
  const out: Option[] = [];
  for (const f of families) {
    const name = /\s/.test(f) ? `"${f}"` : f;
    out.push({ label: f, value: rest ? `${name}, ${rest}` : name, style: `font-family:${name}`, group: "Fonts" });
  }
  for (const [label, stack] of [
    ["System", "system-ui, sans-serif"],
    ["Serif", "Georgia, serif"],
    ["Mono", "ui-monospace, monospace"],
  ]) out.push({ label, value: stack, style: `font-family:${stack}`, group: "Values" });
  return out;
}

function weights(family: string): Option[] {
  const name = family.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  const available = new Set<number>();
  document.fonts.forEach((f) => {
    if (f.family.replace(/^["']|["']$/g, "") !== name) return;
    const [lo, hi = lo] = f.weight.split(/\s+/).map((w) => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
    for (let w = 100; w <= 900; w += 100) if (w >= lo && w <= hi) available.add(w);
  });
  const list = available.size ? [...available].sort((a, b) => a - b) : [300, 400, 500, 600, 700, 800];
  return list.map((w) => ({ label: WEIGHTS[w], value: String(w), hint: String(w), style: `font-weight:${w}`, size: w, group: "Values" }));
}

/** The option the current value corresponds to, if any. */
export function currentOption(prop: string, kind: Kind, options: Option[], specified: string, computed: string): Option | undefined {
  const token = firstVar(specified);
  if (token) return options.find((o) => o.value === `var(${token})`);
  if (kind === "font") {
    const first = (s: string) => s.split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
    return options.find((o) => first(o.value) === first(specified || computed));
  }
  let value = specified || computed;
  // An image's computed shape is "auto 1600 / 870": its own proportions.
  if (prop === "aspect-ratio" && /^auto\b/.test(value)) value = "auto";
  const resolved = resolve(prop, value);
  return options.find((o) => sameValue(o.value, value)) ?? options.find((o) => resolve(prop, o.value) === resolved);
}
