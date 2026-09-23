import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const frontendDir = fileURLToPath(new URL("../", import.meta.url));
const cli = require.resolve("@playwright/test/cli");
const args = process.argv.slice(2).filter((argument) => argument !== "--");

if (args.some((argument) => argument === "--reporter" || argument.startsWith("--reporter="))) {
  console.error("Keep the configured reporters to generate docs/report/latest.md. Run Playwright directly to override reporters.");
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [cli, "test", ...args], {
    cwd: frontendDir,
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`Could not start Playwright: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}
