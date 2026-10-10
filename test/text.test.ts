import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/store.ts";
import { escapeFor } from "../src/server/text.ts";

async function project(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "pointable-text-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), text);
  }
  return { root, store: new Store(root, ".pointable"), read: (name: string) => readFile(path.join(root, name), "utf8") };
}

test("edits text in markup that is wrapped across lines", async () => {
  const { store, read } = await project({ "src/pages/index.astro": "---\n---\n<p class=\"lead\">\n  Making complex\n  information useful.\n</p>\n" });
  const r = await store.text("Making complex information useful.", "Making hard things clear.");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await read("src/pages/index.astro"), "---\n---\n<p class=\"lead\">\n  Making hard things clear.\n</p>\n");
});

test("edits a string in a data file and escapes its quote", async () => {
  const { store, read } = await project({ "src/data/work.ts": "export const work = [{ title: 'FLYR', blurb: 'A body of work on pricing.' }];\n" });
  const r = await store.text("A body of work on pricing.", "Aleks's work on pricing.");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await read("src/data/work.ts"), "export const work = [{ title: 'FLYR', blurb: 'Aleks\\'s work on pricing.' }];\n");
});

test("matches typographic quotes and entities in source", async () => {
  const { store, read } = await project({ "src/a.html": "<p>Don&rsquo;t stop &amp; go</p>\n" });
  const r = await store.text("Don’t stop & go", "Keep going");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await read("src/a.html"), "<p>Keep going</p>\n");
});

test("asks which one when the text is written in several places, then writes the chosen one", async () => {
  const { store, read } = await project({ "src/a.astro": "<h2>Read more</h2>\n", "src/b.astro": "<a>Read more</a>\n" });
  const r = await store.text("Read more", "Continue");
  assert.equal(r.ok, false);
  assert.equal(r.candidates?.length, 2);
  const pick = r.candidates!.find((c) => c.file.endsWith("b.astro"))!;
  const w = await store.text("Read more", "Continue", { file: pick.file, start: pick.start });
  assert.equal(w.ok, true);
  assert.equal(await read("src/a.astro"), "<h2>Read more</h2>\n");
  assert.equal(await read("src/b.astro"), "<a>Continue</a>\n");
});

test("does not match inside longer words, or in node_modules", async () => {
  const { store } = await project({ "src/a.astro": "<p>misinformation</p>\n", "node_modules/x/index.html": "<p>information</p>\n" });
  const r = await store.text("information", "facts");
  assert.equal(r.ok, false);
  assert.match(r.reason!, /isn't written/);
});

test("text edits can be undone", async () => {
  const { store, read } = await project({ "src/a.astro": "<p>Hello there</p>\n" });
  await store.text("Hello there", "Hi");
  assert.equal(await read("src/a.astro"), "<p>Hi</p>\n");
  assert.equal((await store.undo()).ok, true);
  assert.equal(await read("src/a.astro"), "<p>Hello there</p>\n");
});

test("escapes for markup, attributes and frontmatter", () => {
  assert.equal(escapeFor("a.astro", "<p>x</p>", 3, "a < b {c}"), "a &lt; b &#123;c&#125;");
  assert.equal(escapeFor("a.astro", '<img alt="x">', 10, 'say "hi"'), "say &quot;hi&quot;");
  assert.equal(escapeFor("a.astro", '---\nconst t = "x";\n---\n', 15, 'a "b"'), 'a \\"b\\"');
  assert.equal(escapeFor("a.json", '{"t": "x"}', 7, 'a "b"'), 'a \\"b\\"');
});

test("edits one part of text that is put together from two props", async () => {
  const page = '<PageIntro title="I want to design what I use every day" copy="I am very particular in what I like and use." />\n';
  const { store, read } = await project({ "src/pages/make.astro": page });
  const visible = "I want to design what I use every day. I am very particular in what I like and use.";
  const r = await store.text(visible, "I want to design what I use every day. I am very picky about what I like and use.");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await read("src/pages/make.astro"), page.replace("very particular in what", "very picky about what"));
});

test("leaves out closing punctuation the template adds", async () => {
  const page = '<PageIntro title="I want to design what I use every day" copy="Ideas and materials." />\n';
  const { store, read } = await project({ "src/pages/make.astro": page });
  const r = await store.text("I want to design what I use every day. Ideas and materials.", "I want to design what I use daily. Ideas and materials.");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await read("src/pages/make.astro"), page.replace("what I use every day", "what I use daily"));
});
