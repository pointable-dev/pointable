import type { Plugin } from "vite";

export interface PointableOptions {
  /** Folder for the edit history, relative to the project root. Default ".pointable". */
  dir?: string;
}

/**
 * Pointable for any Vite-based dev server: Vite itself, Astro, SvelteKit, Nuxt, Vue, React.
 * Only active while serving (`apply: "serve"`), so nothing of it reaches a build.
 */
export default function pointable(options: PointableOptions = {}): Plugin {
  return {
    name: "pointable",
    apply: "serve",
    async configureServer(server) {
      // Loaded fresh on every server start, so an updated Pointable takes effect when Vite restarts.
      const url = new URL(`./server.js?t=${Date.now()}`, import.meta.url).href;
      const { middleware } = (await import(/* @vite-ignore */ url)) as typeof import("./server/middleware.ts");
      server.middlewares.use(
        middleware({
          root: server.config.root,
          base: server.config.base,
          dir: options.dir ?? ".pointable",
          clientUrl: new URL("./client.js", import.meta.url),
        }),
      );
    },
  };
}
