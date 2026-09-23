// Use the project's TypeScript compiler and Node test runner; no additional test dependency.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  let source = fs.readFileSync(file, "utf8");
  // Browser build-time configuration is empty in these isolated tests.
  source = source.replaceAll("import.meta.env", "({})");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} }; cache.set(file, module);
  const resolve = (name) => {
    if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
    const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(file), name);
    return load([base, base + ".ts", base + ".tsx"].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
  };
  new Function("require", "module", "exports", output)(resolve, module, module.exports);
  return module.exports;
}
for (const name of fs.readdirSync(path.join(root, "tests")).filter((name) => name.endsWith(".test.ts")).sort()) {
  load(path.join(root, "tests", name));
}
