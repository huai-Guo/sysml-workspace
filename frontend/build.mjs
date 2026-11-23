import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: "../backend/src/sysml_workspace/server/static/dist/workbench.js",
  legalComments: "linked",
});
