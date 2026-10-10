import * as esbuild from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const builds = [
  // The overlay, served to the browser by the dev server.
  { entryPoints: ["src/client/index.ts"], outfile: "dist/client.js", platform: "browser", format: "esm", target: "es2022" },
  // The Vite plugin and the write-back server, run by Node.
  { entryPoints: ["src/vite.ts"], outfile: "dist/vite.js", platform: "node", format: "esm", target: "node18", packages: "external" },
  // The write-back server, loaded by the plugin each time the dev server starts.
  { entryPoints: ["src/server/middleware.ts"], outfile: "dist/server.js", platform: "node", format: "esm", target: "node18", packages: "external" },
];

await mkdir("dist", { recursive: true });
await writeFile(
  "dist/vite.d.ts",
  `import type { Plugin } from "vite";\nexport interface PointableOptions {\n  /** Folder for the edit history, relative to the project root. Default ".pointable". */\n  dir?: string;\n}\nexport default function pointable(options?: PointableOptions): Plugin;\n`,
);

for (const options of builds) {
  const config = { bundle: true, sourcemap: "linked", logLevel: "info", ...options };
  if (watch) await (await esbuild.context(config)).watch();
  else await esbuild.build(config);
}
