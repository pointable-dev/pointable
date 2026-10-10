import { styles } from "./styles.ts";
import { collect, describe, firstVar, matching, ownClass, rootTokens, target, tokenSource, winner, type Hit, type Match } from "./cssom.ts";
import { nudge } from "./numbers.ts";
import { api } from "./api.ts";
import { BOX_ROWS, IMAGE_ROWS, TEXT_ROWS, currentOption, optionsFor, pretty, resolve, type Option, type RowSpec } from "./options.ts";
import { PROTOCOL, type Location, type NewRule, type Target, type TextCandidate, type WriteResult } from "../shared/types.ts";
import { normalizeCompiled } from "../shared/selectors.ts";

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k in el && k !== "list" && k !== "style") (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const ICONS = {
  parent: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 11V3M3.5 6.5 7 3l3.5 3.5"/></svg>',
  pick: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4"/><path d="M7 0v3M7 11v3M0 7h3M11 7h3"/></svg>',
  dock: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><path d="M8.5 2.5v9"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3.5 3.5 7 7M10.5 3.5l-7 7"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2.5 11.5 4.5 5 11H3V9z"/></svg>',
  chevron: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m2.5 4 2.5 2.5L7.5 4"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m2.5 6.5 2.5 2.5 4.5-6"/></svg>',
};
const svg = (name: keyof typeof ICONS, cls = "glyph") => {
  const s = h("span", { class: cls });
  s.innerHTML = ICONS[name];
  return s;
};
const iconButton = (name: keyof typeof ICONS, title: string, onclick: () => void) => h("button", { class: "icon", title, onclick }, svg(name));

const NAMES: Record<string, string> = {
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6",
  p: "Paragraph", a: "Link", button: "Button", img: "Image", picture: "Image", video: "Video", svg: "Graphic",
  li: "List item", ul: "List", ol: "List", span: "Text", strong: "Bold text", em: "Italic text", small: "Small text",
  section: "Section", article: "Card", header: "Header", footer: "Footer", nav: "Navigation", main: "Main",
  figure: "Figure", figcaption: "Caption", label: "Label", input: "Field", blockquote: "Quote", div: "Box", aside: "Aside",
  time: "Date", dl: "List", dt: "Term", dd: "Description", body: "Page", html: "Document",
};

const INHERITED = new Set(["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color"]);
const INLINE = /^(inline|contents)/;
const normText = (s: string) => s.replace(/\s+/g, " ").trim();
const SELECTION_KEY = "pointable:selected";

/** A declaration the panel can change: where it lives, what it was when last saved, and what it shows now. */
interface Binding {
  t: Target;
  base: string;
  value: string;
  location?: Location;
  timer?: number;
  onChange?: (value: string) => void;
}

const pathKey = (t: { devId: string; path: Target["path"]; nth: number }) =>
  `${t.devId}|${t.nth}|${t.path.map((s) => (s.kind === "at" ? `@${s.name} ${s.params}` : s.selector)).join(" { ")}`;

/** A CSS path that finds the same element again after the page reloads. */
function elementPath(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    if (n.id) {
      parts.unshift(`#${CSS.escape(n.id)}`);
      return parts.join(" > ");
    }
    const same = Array.from(n.parentElement?.children ?? []).filter((c) => c.tagName === n!.tagName);
    parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})`);
  }
  return ["body", ...parts].join(" > ");
}

/** The text position under a point, in whichever form the browser offers it. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

function toHex(color: string): string {
  const c = document.createElement("canvas").getContext("2d")!;
  c.fillStyle = "#000000";
  c.fillStyle = color;
  return /^#[0-9a-f]{6}$/i.test(c.fillStyle) ? c.fillStyle : "#000000";
}

class Pointable extends HTMLElement {
  private root = this.attachShadow({ mode: "open" });
  private hits: Hit[] | null = null;
  private picking = false;
  private selected: Element | null = null;
  private hovered: Element | null = null;
  private textEl: HTMLElement | null = null;
  private dockLeft = false;
  private stale = false;
  private projectRoot = "";
  private undoCount = 0;
  private menuClose: (() => void) | null = null;
  /** Rules added to the page's stylesheets to preview a rule that will be written on first save. */
  private previewRules = new Map<string, CSSStyleRule>();
  /** The dev server still runs an older Pointable than this overlay; saving could go wrong until it restarts. */
  private outdated = false;

  private hoverBox = h("div", { class: "box hover", hidden: true });
  private hoverTag = h("div", { class: "tag", hidden: true });
  private selBox = h("div", { class: "box selected", hidden: true });
  private launcher = h("button", { class: "launcher", title: "Point at something to change it (Alt+P)", onclick: () => this.setPicking(!this.picking) }, h("span", { class: "dot" }), "Pointable", h("kbd", { text: "⌥P" }));
  private panel = h("div", { class: "panel", hidden: true });
  private menu = h("div", { class: "menu", hidden: true });
  private toasts = h("div", { class: "toasts" });
  private undoButton = h("button", { class: "btn", text: "Undo", title: "Undo the last change (Alt+Z)", disabled: true, onclick: () => this.undo() });

  connectedCallback() {
    this.root.append(h("style", { text: styles }), this.hoverBox, this.hoverTag, this.selBox, this.launcher, this.panel, this.menu, this.toasts);
    for (const type of ["pointermove", "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) window.addEventListener(type, this.onPointer, true);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointerdown", (e) => !this.menu.hidden && !e.composedPath().includes(this.menu) && this.closeMenu(), true);
    this.root.addEventListener("focusout", () => setTimeout(() => this.stale && !this.busy() && this.refresh()));
    new MutationObserver(() => {
      this.hits = null;
      this.stale = true;
      if (!this.busy()) this.refresh();
    }).observe(document.head, { childList: true, subtree: true, characterData: true });
    api.status().then(
      (s) => {
        this.projectRoot = s.root;
        this.setUndo(s.undo);
        this.outdated = (s.protocol ?? 1) < PROTOCOL;
      },
      () => {},
    );
    this.track();
    this.restoreSelection();
  }

  private rules() {
    return (this.hits ??= collect());
  }

  /** Mid-edit: a field has focus, a menu is open, or text is being edited. Re-rendering now would get in the way. */
  private busy() {
    return this.root.activeElement instanceof HTMLInputElement || !this.menu.hidden || !!this.textEl;
  }

  private ours(e: Event) {
    return e.composedPath().includes(this);
  }

  private setUndo(n: number) {
    this.undoCount = Math.max(0, n);
    this.undoButton.disabled = !this.undoCount;
  }

  // Picking and selecting

  private setPicking(on: boolean) {
    this.picking = on;
    this.launcher.classList.toggle("on", on);
    if (!on) {
      this.hovered = null;
      this.hoverBox.hidden = this.hoverTag.hidden = true;
    }
    document.documentElement.style.cursor = on ? "crosshair" : "";
  }

  private onPointer = (e: Event) => {
    if (this.ours(e)) return;
    const pe = e as PointerEvent;
    if (this.picking) {
      if (e.type === "pointermove") {
        const el = document.elementFromPoint(pe.clientX, pe.clientY);
        if (el && el !== this && el !== this.hovered) {
          this.hovered = el;
          this.place(this.hoverBox, el, this.hoverTag);
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === "click" && this.hovered) {
        this.select(this.hovered);
        this.setPicking(false);
      }
      return;
    }
    // While something is selected, clicks on it are ours: they don't follow links, and a double-click edits its text.
    if (this.selected && !this.textEl && e.target instanceof Node && this.selected.contains(e.target)) {
      if (e.type === "click" || e.type === "dblclick") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.type === "dblclick") this.editText({ x: pe.clientX, y: pe.clientY });
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.textEl) return;
    if (e.altKey && e.code === "KeyP") {
      e.preventDefault();
      this.setPicking(!this.picking);
    } else if (e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      this.undo();
    } else if (e.altKey && e.code === "ArrowUp" && this.selected?.parentElement) {
      e.preventDefault();
      this.select(this.selected.parentElement);
    } else if (e.key === "Escape" && !(this.root.activeElement instanceof HTMLInputElement)) {
      if (!this.menu.hidden) this.closeMenu();
      else if (this.picking) this.setPicking(false);
      else if (this.selected) this.select(null);
    }
  };

  private place(box: HTMLElement, el: Element, tag?: HTMLElement) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.hidden = false;
    if (tag) {
      tag.textContent = `${NAMES[el.tagName.toLowerCase()] ?? describe(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
      Object.assign(tag.style, { left: `${Math.max(4, r.left)}px`, top: `${r.top > 24 ? r.top - 22 : r.bottom + 4}px` });
      tag.hidden = false;
    }
  }

  /** Keep the outlines on their elements through scrolling, resizing and animation. */
  private track() {
    const frame = () => {
      if (this.selected?.isConnected) this.place(this.selBox, this.selected);
      else this.selBox.hidden = true;
      if (this.picking && this.hovered?.isConnected) this.place(this.hoverBox, this.hovered, this.hoverTag);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private select(el: Element | null) {
    this.closeMenu();
    this.selected = el;
    this.panel.hidden = !el;
    this.launcher.classList.toggle("hidden", !!el);
    if (el) this.refresh();
  }

  /** Saving markup reloads the page; bring the panel back on the same element. */
  private rememberSelection() {
    try {
      if (this.selected) sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ path: elementPath(this.selected), at: Date.now(), left: this.dockLeft }));
    } catch {}
  }

  private restoreSelection() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY) ?? "null");
      sessionStorage.removeItem(SELECTION_KEY);
      if (!saved || Date.now() - saved.at > 20000) return;
      this.dockLeft = !!saved.left;
      setTimeout(() => {
        const el = document.querySelector(saved.path);
        if (el) this.select(el);
      }, 150);
    } catch {}
  }

  // The panel

  private refresh() {
    this.stale = false;
    const el = this.selected;
    if (!el) return;
    if (!el.isConnected) return this.select(null);
    const scroll = this.panel.scrollTop;
    this.panel.replaceChildren(...this.render(el));
    this.panel.classList.toggle("left", this.dockLeft);
    this.panel.scrollTop = scroll;
  }

  /** A single run of text: no blocks inside it, so editing it in place can't break the layout. */
  private isTextBlock(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return false;
    const text = normText(el.innerText ?? "");
    if (!text || text.length > 2000) return false;
    return Array.from(el.querySelectorAll("*")).every((c) => c.tagName === "BR" || INLINE.test(getComputedStyle(c).display));
  }

  private render(el: Element): Node[] {
    const hits = this.rules();
    const cache = new Map<Element, Match[]>();
    const matchesOf = (node: Element) => cache.get(node) ?? (cache.set(node, matching(node, hits)), cache.get(node)!);
    const matches = matchesOf(el);
    const cs = getComputedStyle(el);
    const tokens = rootTokens(hits);
    const own = [...matches].reverse().find((m) => m.specificity[0] + m.specificity[1] > 0) ?? (el === document.documentElement || el === document.body ? matches[matches.length - 1] : undefined);
    const fresh = own ? null : this.newRuleFor(el, matchesOf);
    const bindings: Binding[] = [];
    const tag = el.tagName.toLowerCase();
    const hasText = !!normText((el as HTMLElement).innerText ?? "");

    const head = h(
      "div",
      { class: "head" },
      h("div", { class: "title" }, h("div", { class: "name", text: NAMES[tag] ?? tag }), h("div", { class: "sub", text: describe(el) })),
      Object.assign(iconButton("parent", "Select the element around it (Alt+↑)", () => el.parentElement && this.select(el.parentElement)), { disabled: !el.parentElement || el === document.body }),
      iconButton("pick", "Pick another element (Alt+P)", () => this.setPicking(true)),
      iconButton("dock", "Move the panel to the other side", () => {
        this.dockLeft = !this.dockLeft;
        this.panel.classList.toggle("left", this.dockLeft);
      }),
      iconButton("close", "Close (Esc)", () => this.select(null)),
    );

    const parts: Node[] = [head];
    if (this.isTextBlock(el)) {
      parts.push(h("button", { class: "textbtn", onclick: () => this.editText() }, svg("edit"), h("span", { text: "Edit text" }), h("span", { class: "hint", text: "or double-click it" })));
    }

    const section = (title: string, specs: RowSpec[]) => {
      const rows = specs.filter((s) => s.prop !== "gap" || /flex|grid/.test(cs.display)).map((s) => this.row(el, s, matches, own, fresh, cs, tokens, matchesOf, bindings));
      return h("div", { class: "group" }, h("h3", { text: title }), ...rows);
    };
    if (/^(img|video|canvas|svg|picture)$/.test(tag)) parts.push(section("Image", IMAGE_ROWS));
    if (hasText) parts.push(section("Text", TEXT_ROWS));
    parts.push(section(hasText ? "Box" : "Style", BOX_ROWS));

    const where = fresh
      ? `Saves to a new rule, ${fresh.label}, for ${fresh.count === 1 ? "this element" : `these ${fresh.count} elements`}`
      : own ? `Saves to ${normalizeCompiled(own.rule.selectorText).replace(/([>+~,])/g, " $1 ").replace(/\s+/g, " ")}` : "Nothing styles this element directly yet. Select the element around it.";
    parts.push(h("div", { class: "foot" }, h("span", { class: "where", text: where, title: where }), this.undoButton));

    this.locate(bindings);
    return parts;
  }

  private row(
    el: Element,
    spec: RowSpec,
    matches: Match[],
    own: Match | undefined,
    fresh: { outer: Match; create: NewRule } | null,
    cs: CSSStyleDeclaration,
    tokens: Map<string, { value: string; match: Match }>,
    matchesOf: (n: Element) => Match[],
    bindings: Binding[],
  ): HTMLElement {
    const { prop, kind } = spec;
    const w = winner(matches, prop);
    const specified = w ? w.rule.style.getPropertyValue(prop).trim() : "";
    const computed = cs.getPropertyValue(prop).trim();
    const writeTo = w ?? own;
    const row = h("div", { class: "row" }, h("span", { class: "label", text: spec.label }));

    if (!writeTo && !fresh) {
      row.append(h("div", { class: "ctl" }, h("button", { class: "pick", disabled: true, title: "Nothing styles this element directly. Select the element around it." }, h("span", { class: "val", text: computed }))));
      return row;
    }

    let note = "";
    if (!w && INHERITED.has(prop)) {
      for (let p = el.parentElement; p; p = p.parentElement)
        if (winner(matchesOf(p), prop)) {
          note = `Inherited from ${(NAMES[p.tagName.toLowerCase()] ?? describe(p)).toLowerCase()}; a change applies here only`;
          break;
        }
    }

    const options = optionsFor(prop, kind, specified || computed, tokens);
    const b: Binding = { t: writeTo ? target(writeTo, prop) : { ...target(fresh!.outer, prop), create: fresh!.create }, base: specified, value: specified || computed };
    bindings.push(b);

    // The token behind the value, if any: the dropdown can change it everywhere.
    const name = firstVar(specified);
    const src = name ? tokenSource(el, name, this.rules()) : null;
    let tb: Binding | null = null;
    if (name && src) {
      const value = src.match.rule.style.getPropertyValue(name).trim();
      tb = { t: target(src.match, name), base: value, value };
      bindings.push(tb);
    }

    const pick = h("button", { class: "pick" });
    const show = (value: string) => {
      const opt = currentOption(prop, kind, options, value, value === specified ? computed : resolve(prop, value));
      pick.replaceChildren();
      if (kind === "color") pick.append(h("span", { class: "swatch", style: `background:${resolve("color", value) || value}` }));
      const text = opt ? opt.label : value.length > 28 ? value.slice(0, 26) + "…" : value;
      pick.append(h("span", { class: "val", text, style: opt?.style ?? (kind === "font" ? `font-family:${value}` : "") }));
      if (opt?.hint) pick.append(h("span", { class: "hint", text: opt.hint }));
      pick.append(svg("chevron", "chev"));
      pick.title = `${prop}: ${value}`;
    };
    b.onChange = show;
    show(b.value);
    pick.addEventListener("click", () => this.openMenu(pick, spec, b, tb, options, computed));

    const ctl = h("div", { class: "ctl" }, pick);
    if (kind === "scale" || kind === "weight") {
      ctl.append(
        h("button", { class: "step", title: "Smaller", text: "−", onclick: () => this.step(b, spec, options, -1) }),
        h("button", { class: "step", title: "Larger", text: "+", onclick: () => this.step(b, spec, options, 1) }),
      );
    }
    row.append(ctl);
    if (note) row.append(h("div", { class: "note", text: note }));
    return row;
  }

  /** −/+ : move to the neighbouring token or preset, or nudge a number that isn't one. */
  private step(b: Binding, spec: RowSpec, options: Option[], dir: 1 | -1) {
    const current = currentOption(spec.prop, spec.kind, options, b.value, resolve(spec.prop, b.value));
    const sized = (o: Option) => o.size !== undefined && !Number.isNaN(o.size);
    if (current && sized(current)) {
      const scale = options.filter((o) => o.group === current.group && sized(o)).sort((a, c) => a.size! - c.size!);
      const next = scale[scale.indexOf(current) + dir];
      if (next) this.set(b, next.value, "later");
      return;
    }
    let value = b.value;
    if (value === "normal") value = spec.prop === "letter-spacing" ? "0em" : spec.prop === "line-height" ? "1.2" : value;
    const n = nudge(value, null, dir, spec.prop);
    if (n) this.set(b, n.value, "later");
  }

  /** Show a value now; save it now, after a short pause (so repeated clicks make one save), or not yet. */
  private set(b: Binding, value: string, save: "now" | "later" | "no") {
    b.value = value;
    this.preview(b.t, value);
    b.onChange?.(value);
    clearTimeout(b.timer);
    if (save === "now") this.commit(b, value);
    else if (save === "later") b.timer = window.setTimeout(() => this.commit(b, b.value), 600);
  }

  // Dropdown menus

  private closeMenu() {
    if (this.menu.hidden) return;
    const close = this.menuClose;
    this.menuClose = null;
    this.menu.hidden = true;
    this.menu.replaceChildren();
    close?.();
    if (this.stale) setTimeout(() => !this.busy() && this.refresh());
  }

  private showMenu(anchor: Element, content: Node[], onClose?: () => void) {
    this.closeMenu();
    this.menu.replaceChildren(...content);
    this.menu.hidden = false;
    this.menuClose = onClose ?? null;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 240), innerWidth - 16);
    this.menu.style.width = `${width}px`;
    this.menu.style.left = `${Math.min(Math.max(8, r.left), innerWidth - width - 8)}px`;
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= Math.min(this.menu.scrollHeight, 300) || below >= above) {
      Object.assign(this.menu.style, { top: `${r.bottom + 4}px`, bottom: "", maxHeight: `${Math.min(below, 460)}px` });
    } else {
      Object.assign(this.menu.style, { top: "", bottom: `${innerHeight - r.top + 4}px`, maxHeight: `${Math.min(above, 460)}px` });
    }
    this.menu.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest" });
  }

  private openMenu(anchor: HTMLElement, spec: RowSpec, b: Binding, tb: Binding | null, options: Option[], computed: string) {
    const { prop, kind } = spec;
    // Hovering an option previews it; leaving the menu puts the current value back.
    const hover = (value: string) => this.preview(b.t, value);
    const restore = () => this.preview(b.t, b.value);
    const choose = (value: string) => {
      this.closeMenu();
      this.set(b, value, "now");
    };
    const current = currentOption(prop, kind, options, b.value, computed);
    const content: Node[] = [];

    if (kind === "color") {
      const swatches = options.filter((o) => o.group === "Tokens");
      if (swatches.length) {
        const grid = h("div", { class: "swatches" });
        for (const o of swatches) {
          grid.append(
            h(
              "button",
              { class: `sw${o === current ? " on" : ""}`, title: o.label, onclick: () => choose(o.value), onpointerenter: () => hover(o.value), onpointerleave: restore },
              h("span", { class: "swatch", style: `background:${o.color}` }),
              h("span", { class: "sw-label", text: o.label }),
            ),
          );
        }
        content.push(h("div", { class: "grp", text: "Colors" }), grid);
      }
      const custom = h("input", { type: "color", value: toHex(resolve("color", b.value) || computed) });
      custom.addEventListener("input", () => hover(custom.value));
      custom.addEventListener("change", () => choose(custom.value));
      content.push(h("label", { class: "opt" }, h("span", { class: "swatch picker" }, custom), h("span", { class: "val", text: "Pick any color…" })));
      for (const o of options.filter((o) => o.group !== "Tokens")) content.push(this.option(o, o === current, choose, hover, restore));
    } else {
      let group = "";
      const groups = new Set(options.map((o) => o.group));
      for (const o of options) {
        if (groups.size > 1 && o.group !== group) {
          group = o.group;
          content.push(h("div", { class: "grp", text: group === "Values" && kind === "font" ? "Generic" : group }));
        }
        content.push(this.option(o, o === current, choose, hover, restore));
      }
      // Typing is there when wanted, never required.
      const input = h("input", { value: b.value, spellcheck: false, placeholder: "Custom value" });
      input.addEventListener("input", () => hover(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") choose(input.value.trim() || b.value);
        else if (e.key === "Escape") this.closeMenu();
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const n = nudge(input.value, input.selectionStart, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1), prop);
          if (n) {
            input.value = n.value;
            input.setSelectionRange(n.start, n.end);
            hover(n.value);
          }
        }
      });
      content.push(h("div", { class: "custom" }, input));
    }

    // The token itself, changed everywhere it is used.
    if (tb) {
      const token = tb;
      const box = h("div", { class: "everywhere" }, h("div", { class: "grp", text: `Change “${pretty(token.t.property)}” everywhere` }));
      if (kind === "color") {
        const picker = h("input", { type: "color", value: toHex(token.value) });
        const swatch = h("span", { class: "swatch picker", style: `background:${token.value}` }, picker);
        picker.addEventListener("input", () => {
          swatch.style.background = picker.value;
          this.set(token, picker.value, "no");
        });
        picker.addEventListener("change", () => this.set(token, picker.value, "now"));
        box.append(h("label", { class: "opt" }, swatch, h("span", { class: "val", text: token.t.property }), h("span", { class: "hint", text: token.value })));
      } else {
        const value = h("span", { class: "tval", text: token.value, title: token.value });
        token.onChange = (v) => (value.textContent = v);
        const bump = (dir: 1 | -1) => {
          const n = nudge(token.value, null, dir, prop);
          if (n) this.set(token, n.value, "later");
        };
        box.append(h("div", { class: "tokenrow" }, h("button", { class: "step", text: "−", title: "Smaller everywhere", onclick: () => bump(-1) }), value, h("button", { class: "step", text: "+", title: "Larger everywhere", onclick: () => bump(1) })));
      }
      content.push(box);
    }

    if (b.location?.ok) {
      const loc = b.location;
      content.push(h("button", { class: "source", text: `${this.relative(loc.file)}:${loc.line}  ↗`, title: "Open in your editor", onclick: () => api.open(loc.file, loc.line) }));
    } else if (b.location && !b.location.ok) {
      content.push(h("div", { class: "source warn", text: `Can't save this one: ${b.location.reason}` }));
    }

    this.menu.onpointerleave = restore;
    this.showMenu(anchor, content, restore);
  }

  private option(o: Option, on: boolean, choose: (v: string) => void, hover: (v: string) => void, restore: () => void) {
    const el = h(
      "button",
      { class: `opt${on ? " on" : ""}`, onclick: () => choose(o.value), onpointerenter: () => hover(o.value), onpointerleave: restore },
      on ? svg("check", "tick") : h("span", { class: "tick" }),
      h("span", { class: "val", text: o.label, style: o.style ?? "" }),
    );
    if (o.hint) el.append(h("span", { class: "hint", text: o.hint }));
    return el;
  }

  // Text

  private editText(at?: { x: number; y: number }) {
    const el = this.selected;
    if (!el || !this.isTextBlock(el)) return this.toast("Select a single block of text to edit it", [], true);
    this.closeMenu();
    const html = el.innerHTML;
    const before = normText(el.innerText);

    // Where the caret goes: where the double-click landed, else the end.
    let offset = before.length;
    const pos = at && caretAt(at.x, at.y);
    if (pos && el.contains(pos.node)) {
      const r = document.createRange();
      r.setStart(el, 0);
      r.setEnd(pos.node, pos.offset);
      offset = Math.min(before.length, r.toString().replace(/\s+/g, " ").trimStart().length);
    }

    // Edit it as plain text, so it wraps like the element itself does even when it is
    // built from styled pieces (one span per word, say). Its own styling returns once saved.
    el.textContent = before;
    this.textEl = el;
    try {
      el.contentEditable = "plaintext-only";
    } catch {
      el.contentEditable = "true";
    }
    el.focus();
    const caret = document.createRange();
    caret.setStart(el.firstChild ?? el, el.firstChild ? offset : 0);
    caret.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(caret);

    const finish = (save: boolean) => {
      el.removeEventListener("keydown", keys, true);
      el.removeEventListener("blur", blur);
      el.removeAttribute("contenteditable");
      getSelection()?.removeAllRanges();
      this.textEl = null;
      const after = normText(el.innerText);
      if (!save || !after || after === before) el.innerHTML = html;
      else this.saveText(el, html, before, after);
    };
    const keys = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    };
    // Switching to another window is not "done": keep editing until a click elsewhere on the page or in the panel.
    const blur = () => {
      if (document.hasFocus()) finish(true);
    };
    el.addEventListener("keydown", keys, true);
    el.addEventListener("blur", blur);
  }

  private async saveText(el: HTMLElement, html: string, before: string, after: string, choice?: TextCandidate): Promise<void> {
    if (this.outdated) {
      el.innerHTML = html;
      return this.toast("Pointable was updated: restart your dev server to save changes", [], true);
    }
    let r;
    try {
      r = await api.text(before, after, choice && { file: choice.file, start: choice.start });
    } catch (e) {
      el.innerHTML = html;
      return this.toast(`Not saved: ${(e as Error).message}`, [], true);
    }
    if (r.ok && r.written) {
      this.setUndo(this.undoCount + 1);
      this.rememberSelection();
      return this.toast(`Text saved  ·  ${this.short(r.written.file)}:${r.written.line}`, [["Undo", () => this.undo()]]);
    }
    if (r.candidates) {
      let picked = false;
      const list = r.candidates.map((c) =>
        h(
          "button",
          {
            class: "opt cand",
            onclick: () => {
              picked = true;
              this.closeMenu();
              this.saveText(el, html, before, after, c);
            },
          },
          h("span", { class: "val", text: `${this.relative(c.file)}:${c.line}` }),
          h("span", { class: "ctx", text: c.context }),
        ),
      );
      return this.showMenu(el, [h("div", { class: "grp", text: "This text is in more than one place. Which one?" }), ...list], () => {
        if (!picked) el.innerHTML = html;
      });
    }
    el.innerHTML = html;
    this.toast(`Not saved: ${r.reason ?? "unknown error"}`, [], true);
  }

  // Previewing and saving

  private liveRule(t: Target): CSSStyleRule | null {
    const k = pathKey(t);
    const outer = this.rules().find((hit) => pathKey(hit) === k)?.rule ?? null;
    if (!t.create || !outer) return outer;
    // A rule that isn't written yet: preview it in a rule added right after the outer one.
    const key = `${k}|${t.create.tail}`;
    const existing = this.previewRules.get(key);
    if (existing?.parentStyleSheet?.ownerNode?.isConnected) return existing;
    const sheet = outer.parentStyleSheet;
    const index = sheet ? Array.from(sheet.cssRules).indexOf(outer) : -1;
    if (!sheet || index < 0) return null;
    try {
      sheet.insertRule(`${t.create.part} ${t.create.tail} {}`, index + 1);
    } catch {
      return null;
    }
    const rule = sheet.cssRules[index + 1] as CSSStyleRule;
    this.previewRules.set(key, rule);
    return rule;
  }

  /**
   * For an element no rule targets: a new rule inside the nearest element around it that has one,
   * e.g. `.product-stage img`. Scoped component styles reach a child component's element with `:global()`/`:deep()`.
   */
  private newRuleFor(el: Element, matchesOf: (n: Element) => Match[]): { outer: Match; create: NewRule; label: string; count: number } | null {
    if (el === document.body || el === document.documentElement) return null;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const candidates = matchesOf(p).filter((m) => m.specificity[0] + m.specificity[1] > 0 && !m.path.some((s) => s.kind === "at"));
      const outer = candidates[candidates.length - 1];
      if (!outer) continue;
      const cls = ownClass(el);
      const tail = cls ? `.${CSS.escape(cls)}` : el.tagName.toLowerCase();
      let wrap: NewRule["wrap"] = null;
      const astro = /\[data-astro-cid-([\w-]+)\]/.exec(outer.part)?.[1];
      const svelte = /\.(svelte-[\w-]+)/.exec(outer.part)?.[1];
      const vue = /\[(data-v-[\w-]+)\]/.exec(outer.part)?.[1];
      if (astro && !el.hasAttribute(`data-astro-cid-${astro}`)) wrap = "global";
      else if (svelte && !el.classList.contains(svelte)) wrap = "global";
      else if (vue && !el.hasAttribute(vue)) wrap = "deep";
      let count = 1;
      try {
        count = document.querySelectorAll(`${outer.part} ${tail}`).length || 1;
      } catch {}
      return { outer, create: { part: outer.part, tail, wrap }, label: `${normalizeCompiled(outer.part)} ${tail}`, count };
    }
    return null;
  }

  private preview(t: Target, value: string) {
    const rule = this.liveRule(t);
    if (!rule) return;
    if (value.trim()) rule.style.setProperty(t.property, value.trim(), rule.style.getPropertyPriority(t.property));
    else rule.style.removeProperty(t.property);
  }

  private async commit(b: Binding, raw: string, force = false): Promise<void> {
    const value = raw.trim();
    if (!value || (value === b.base && !force)) return;
    if (this.outdated) return this.toast("Pointable was updated: restart your dev server to save changes", [], true);
    let result: WriteResult;
    try {
      result = await api.write([{ ...b.t, value, expect: b.base || undefined, force }]);
    } catch (e) {
      return this.toast(`Not saved: ${(e as Error).message}`, [], true);
    }
    if (result.ok) {
      b.base = value;
      this.setUndo(this.undoCount + 1);
      this.rememberSelection();
      const w = result.written[0];
      return this.toast(`Saved  ·  ${this.short(w.file)}:${w.line}`, [["Undo", () => this.undo()]]);
    }
    const c = result.conflicts[0];
    if (c) {
      return this.toast(`${this.short(c.file)}:${c.line} now says “${c.source}”`, [["Overwrite", () => void this.commit(b, value, true)], ["Keep", () => this.set(b, c.source, "no")]], true);
    }
    this.toast(`Not saved: ${result.errors[0]?.reason ?? "unknown error"}`, [], true);
  }

  private async undo() {
    const r = await api.undo().catch((e) => ({ ok: false, files: [] as string[], reason: (e as Error).message }));
    if (r.ok) {
      this.setUndo(this.undoCount - 1);
      this.rememberSelection();
      this.toast(`Undone in ${r.files.map((f) => this.short(f)).join(", ")}`);
    } else this.toast(`Can't undo: ${r.reason}`, [], true);
  }

  private async locate(bindings: Binding[]) {
    if (!bindings.length) return;
    try {
      const found = await api.locate(bindings.map((b) => b.t));
      found.forEach((loc, i) => (bindings[i].location = loc));
    } catch {}
  }

  private relative(file: string) {
    return this.projectRoot && file.startsWith(this.projectRoot) ? file.slice(this.projectRoot.length + 1) : file;
  }

  private short(file: string) {
    return file.split("?")[0].split("/").pop() ?? file;
  }

  private toast(message: string, actions: [string, () => void][] = [], warn = false) {
    const t = h("div", { class: `toast${warn ? " warn" : ""}` }, h("span", { class: "msg", text: message, title: message }));
    const close = () => t.remove();
    for (const [label, fn] of actions) t.append(h("button", { text: label, onclick: () => (close(), fn()) }));
    this.toasts.append(t);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild!.remove();
    setTimeout(close, actions.length > 1 ? 9000 : 4500);
  }
}

if (!customElements.get("pointable-ui")) {
  customElements.define("pointable-ui", Pointable);
  const mount = () => document.body.append(document.createElement("pointable-ui"));
  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount, { once: true });
}
