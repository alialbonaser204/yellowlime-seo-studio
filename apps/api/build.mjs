import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

// esbuild-plugin-pino resolves its dependencies with `require`.
globalThis.require = createRequire(import.meta.url);

const appDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(appDir, "dist");

await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(appDir, "src/index.ts")],
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outdir: distDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  // Native addons cannot be bundled; `pg` only loads pg-native when installed.
  external: ["*.node", "pg-native"],
  sourcemap: "linked",
  // pino logs through worker threads; the plugin emits those as separate files.
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  // Lets bundled CommonJS packages (e.g. express) use require/__dirname in ESM output.
  banner: {
    js: `import { createRequire as __createRequire } from "node:module";
import __path from "node:path";
import __url from "node:url";
globalThis.require = __createRequire(import.meta.url);
globalThis.__filename = __url.fileURLToPath(import.meta.url);
globalThis.__dirname = __path.dirname(globalThis.__filename);`,
  },
});
