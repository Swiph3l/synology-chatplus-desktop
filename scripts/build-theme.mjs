import { build } from "esbuild";
import { readFile } from "node:fs/promises";
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
