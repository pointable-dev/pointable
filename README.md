# Pointable

A small tool to help edit your localhost website via WYSIWYG. Free.

Point at anything on your local site and change it. Click an element and pick a new font, size, weight, spacing, colour or corner radius from a dropdown, or double-click it and edit its text. Each change is written straight back into your source: the stylesheet rule, the design token, or the file the text lives in.

- **Picking, not typing.** Every value is a dropdown of your own design tokens and sensible presets, with − / + to step through them. Hover an option to preview it on the page.
- **Text in place.** Double-click a heading or paragraph and type. Pointable finds where that text is written, whether in a template, a component or a data file, and asks you to pick when it's written in more than one place.
- **Tokens or rules.** If a value comes from a token like `--type-body`, you can switch the element to another token, or change the token everywhere.
- **Writes to source, in place.** It changes just the value and keeps your formatting. It never adds comments or markers.
- **Undo.** Alt+Z takes the last change back out of the file. Pointable won't overwrite anything that has changed since.
- **Dev only.** Nothing of it ships in a build.
- **Works with any Vite-based setup:** Vite, Astro, SvelteKit, Nuxt, Vue and React. Styles in plain CSS and in the `<style>` blocks of Astro, Vue and Svelte components.

## Install

Download for Claude Code or Codex through their official plugin store, then ask it to set Pointable up in your project.

Or add it by hand:

```bash
npm install -D pointable
```

```js
// vite.config.js
import pointable from "pointable/vite";

export default defineConfig({ plugins: [pointable()] });
```

```js
// astro.config.mjs
import pointable from "pointable/vite";

export default defineConfig({ vite: { plugins: [pointable()] } });
```

## Use

| | |
|---|---|
| **Alt+P** | Pick an element (or click the pill, bottom right) |
| **Double-click** | Edit the selected element's text. Enter saves, Esc cancels |
| **Dropdowns** | Choose a token or preset. Hover to preview |
| **− / +** | Step to the next smaller or larger value |
| **Alt+↑** | Select the element around it |
| **Alt+Z** | Undo the last change |

Every change is appended to `.pointable/history.jsonl`, so you, and any coding agent you work with, can see which values were set by eye.

## Develop

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

`npm run playground` starts a plain Vite page to try it on.

## License

MIT
