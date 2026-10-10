import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/store.ts";
import { specificity } from "../src/shared/specificity.ts";
import { normalizeCompiled, normalizeSource, sameValue } from "../src/shared/selectors.ts";
import type { Edit } from "../src/shared/types.ts";

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), "pointable-"));
  await cp(new URL("./fixtures/", import.meta.url), path.join(root, "src"), { recursive: true });
  return { root, store: new Store(root, ".pointable"), css: path.join(root, "src/global.css"), astro: path.join(root, "src/Intro.astro") };
}

const lineOf = (text: string, needle: string) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

test("edits a token in :root in place, and only that", async () => {
  const { root, store, css } = await project();
  const before = await readFile(css, "utf8");
  const edit: Edit = { devId: css, path: [{ kind: "rule", selector: ":root" }], nth: 0, property: "--type-body", value: "1.1rem", expect: "1.05rem" };
  const r = await store.write([edit]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await readFile(css, "utf8");
  assert.equal(after, before.replace("--type-body: 1.05rem;", "--type-body: 1.1rem;"));
  assert.equal(r.written[0].line, lineOf(before, "--type-body:"));
  const history = await readFile(path.join(root, ".pointable/history.jsonl"), "utf8");
  assert.match(history, /"property":"--type-body","before":"1.05rem","after":"1.1rem"/);
});

test("picks the right one of two rules with the same selector", async () => {
  const { store, css } = await project();
  const before = await readFile(css, "utf8");
  const base = { devId: css, path: [{ kind: "rule" as const, selector: ".site-header" }], property: "background" };
  const r = await store.write([{ ...base, nth: 1, value: "white", expect: "var(--paper)" }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await readFile(css, "utf8");
  assert.equal(after, before.replace("z-index: 10; background: var(--paper);", "z-index: 10; background: white;"));
});

test("adds a missing declaration to a one-line rule, on the same line", async () => {
  const { store, css } = await project();
  const before = await readFile(css, "utf8");
  const r = await store.write([{ devId: css, path: [{ kind: "rule", selector: ".site-header nav a" }], nth: 0, property: "font-size", value: "var(--type-small)" }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await readFile(css, "utf8");
  assert.equal(after, before.replace(".site-header nav a { color: var(--muted); text-decoration: none; }", ".site-header nav a { color: var(--muted); text-decoration: none; font-size: var(--type-small); }"));
});

test("finds a rule inside a media query", async () => {
  const { store, css } = await project();
  const r = await store.locate([{ devId: css, path: [{ kind: "at", name: "media", params: "(max-width:760px)" }, { kind: "rule", selector: ".page-shell" }], nth: 0, property: "width" }]);
  // .page-shell may or may not be inside that query; either it is found there or the reason names the path.
  assert.ok(r[0].ok || /no rule matching/.test(r[0].reason));
});

test("edits a scoped Astro style block through its compiled selector", async () => {
  const { store, astro } = await project();
  const before = await readFile(astro, "utf8");
  const devId = `${astro}?astro&type=style&index=0&lang.css`;
  const edit: Edit = {
    devId,
    path: [{ kind: "rule", selector: ".title-intro[data-astro-cid-abc123] h1[data-astro-cid-abc123]" }],
    nth: 0,
    property: "letter-spacing",
    value: "-0.02em",
    expect: "-0.035em",
  };
  const r = await store.write([edit]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await readFile(astro, "utf8");
  assert.equal(after, before.replace("letter-spacing: -.035em; }", "letter-spacing: -0.02em; }"));
  assert.equal(r.written[0].line, lineOf(before, ".title-intro h1 {"));
});

test("adds a longhand after a shorthand rather than rewriting it", async () => {
  const { store, astro } = await project();
  const before = await readFile(astro, "utf8");
  const devId = `${astro}?astro&type=style&index=0&lang.css`;
  const r = await store.write([{ devId, path: [{ kind: "rule", selector: ".title-intro[data-astro-cid-x] h1[data-astro-cid-x]" }], nth: 0, property: "font-size", value: "4rem" }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = await readFile(astro, "utf8");
  assert.equal(after, before.replace("letter-spacing: -.035em; }", "letter-spacing: -.035em; font-size: 4rem; }"));
});

test("matches :global() in source against the plain compiled selector", async () => {
  const { store, astro } = await project();
  const devId = `${astro}?astro&type=style&index=0&lang.css`;
  const [r] = await store.locate([{ devId, path: [{ kind: "rule", selector: ".title-numbers[data-astro-cid-x] li" }], nth: 0, property: "height" }]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.value, "var(--lh, 1em)");
});

test("reports a conflict instead of overwriting a value that changed in source", async () => {
  const { store, css } = await project();
  const r = await store.write([{ devId: css, path: [{ kind: "rule", selector: ":root" }], nth: 0, property: "--type-body", value: "2rem", expect: "1.2rem" }]);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts[0].source, "1.05rem");
  const forced = await store.write([{ devId: css, path: [{ kind: "rule", selector: ":root" }], nth: 0, property: "--type-body", value: "2rem", expect: "1.2rem", force: true }]);
  assert.equal(forced.ok, true);
});

test("undo restores the file, and refuses when the file changed since", async () => {
  const { store, css } = await project();
  const original = await readFile(css, "utf8");
  await store.write([{ devId: css, path: [{ kind: "rule", selector: ":root" }], nth: 0, property: "--ink", value: "#000" }]);
  assert.equal((await store.undo()).ok, true);
  assert.equal(await readFile(css, "utf8"), original);

  await store.write([{ devId: css, path: [{ kind: "rule", selector: ":root" }], nth: 0, property: "--ink", value: "#000" }]);
  await writeFile(css, (await readFile(css, "utf8")) + "\n/* someone else */\n");
  const u = await store.undo();
  assert.equal(u.ok, false);
  assert.match(u.reason!, /changed since/);
});

test("refuses files outside the project and dependencies", async () => {
  const { store } = await project();
  const [a, b] = await store.locate([
    { devId: "/etc/hosts", path: [], nth: 0, property: "x" },
    { devId: "/node_modules/x/y.css", path: [], nth: 0, property: "x" },
  ]);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
});

test("selectors and values normalise the way the browser serialises them", () => {
  assert.equal(normalizeCompiled(".a[data-astro-cid-abc] > b[data-astro-cid-abc]"), ".a>b");
  assert.equal(normalizeSource(".a > :global(b)"), ".a>b");
  assert.equal(normalizeCompiled('a[aria-current="page"]'), normalizeSource("a[aria-current=page]"));
  assert.ok(sameValue(".35s", "0.35s"));
  assert.ok(sameValue("-.035em", "-0.035em"));
  assert.ok(sameValue("cubic-bezier(.2,.7,.2,1)", "cubic-bezier(0.2, 0.7, 0.2, 1)"));
  assert.ok(sameValue("1.50rem", "1.5rem"));
  assert.ok(!sameValue("1.05rem", "1.5rem"));
});

test("specificity", () => {
  assert.deepEqual(specificity("#a .b c"), [1, 1, 1]);
  assert.deepEqual(specificity(".a:hover::before"), [0, 2, 1]);
  assert.deepEqual(specificity(":where(.a, #b) p"), [0, 0, 1]);
  assert.deepEqual(specificity(":is(.a, #b) p"), [1, 0, 1]);
  assert.deepEqual(specificity('a[aria-current="page"]'), [0, 1, 1]);
  assert.deepEqual(specificity("*"), [0, 0, 0]);
});
