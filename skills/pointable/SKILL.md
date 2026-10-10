---
name: pointable
description: Set up Pointable in a web project, so the developer can point at elements on their local dev server and change type, colour, spacing and radius, with edits written straight back to source. Use when the user asks to install, add, set up or remove Pointable, or asks about changes recorded in `.pointable/history.jsonl`.
---

# Pointable

Pointable adds a small overlay to a project's dev server. The developer clicks an element (or presses Alt+P), changes a value, and Pointable writes the change into the stylesheet rule or design token that sets it. It runs only while serving; nothing of it reaches a production build.

## Set it up

1. **Find the dev server.** Pointable plugs into Vite, which also powers Astro, SvelteKit, Nuxt, Vue and React-with-Vite projects. Look for `vite.config.*`, `astro.config.*`, `svelte.config.*` with `vite.config.*`, or `nuxt.config.*`. If the project does not use Vite (Next.js, Rails, plain HTML), say that support is coming and stop.

2. **Install the package** as a dev dependency with the project's package manager (look for `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`):

   ```bash
   npm install -D pointable
   ```

3. **Add the plugin** to the Vite plugins, keeping everything already there:

   - **Vite, SvelteKit, Vue, React** (`vite.config.*`):

     ```js
     import pointable from "pointable/vite";

     export default defineConfig({
       plugins: [/* existing plugins */, pointable()],
     });
     ```

   - **Astro** (`astro.config.*`):

     ```js
     import pointable from "pointable/vite";

     export default defineConfig({
       vite: { plugins: [pointable()] },
     });
     ```

   - **Nuxt** (`nuxt.config.*`): `vite: { plugins: [pointable()] }`.

4. **Tell the developer how to use it:** start the dev server, press **Alt+P** (or click the Pointable pill, bottom right), click an element, then edit a value. Arrow keys nudge numbers (Shift for ×10, Alt for ×0.1), dragging a label scrubs, Enter saves, Escape reverts, Alt+Z undoes.

## What Pointable writes

- Only the stylesheet rule or the design token that sets the value. It changes the value in place and keeps the file's own formatting. If a rule does not declare the property yet, Pointable adds the declaration to the end of that rule.
- Plain CSS files and the `<style>` blocks of Astro, Vue and Svelte components. It does not edit Sass, Less or Stylus, or files in `node_modules`.
- Every change is appended to `.pointable/history.jsonl` in the project root, one JSON object per line: `file`, `line`, `selector`, `property`, `before`, `after`, and the time. Undo is recorded there too, as `{ "undo": <time of the change> }`.

## Working alongside Pointable

The changes in `.pointable/history.jsonl` are deliberate design decisions the developer made by eye. When you work on styles in a project that has this file:

- Read the recent entries (the last few days) before changing those same properties, and keep their values unless the user asks you to change them.
- They are not locks: if the user asks for a change that touches one of those values, make it.
- Do not add comments or markers to the source about Pointable edits.

## Remove it

Delete the `pointable()` line and its import from the config, then uninstall the package. `.pointable/` can be kept as a record or deleted.
