import { build } from "esbuild";
import { readFile } from "node:fs/promises";
for (const name of ["webkit-bridge", "webkit-notifications", "arrow-keys"])
  await build({
    entryPoints: [`src/theme/${name}.ts`],
    bundle: true,
    format: "iife",
    target: "es2022",
    outfile: `src-tauri/${name}.js`,
  });
await build({
  entryPoints: ["src/theme/bootstrap.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "src-tauri/theme-bootstrap.js",
  plugins: [
    {
      name: "inline-css",
      setup(build) {
        build.onLoad({ filter: /\.css$/ }, async (args) => ({
          contents: await readFile(args.path.replace("?inline", ""), "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
// Swiph3l: Synology Chat and Discord need unread/focus adapters without ChatPlus CSS; keeping a separate bundle avoids changing remote provider styling.
await build({
  entryPoints: ["src/theme/unread.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "src-tauri/unread-bootstrap.js",
});
// Swiph3l: Link routing applies to every provider without injecting ChatPlus styling.
await build({
  entryPoints: ["src/theme/external-links-bootstrap.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "src-tauri/external-links-bootstrap.js",
});
