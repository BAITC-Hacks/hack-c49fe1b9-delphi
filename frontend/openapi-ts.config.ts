import { defineConfig } from "@hey-api/openapi-ts";

/**
 * The FastAPI contract is exported offline by backend/scripts/export_openapi.py.
 * Generated output is deliberately absent until `npm run api:generate` is run.
 */
export default defineConfig({
  input: "../backend/openapi.json",
  output: "src/shared/api/generated",
  plugins: [
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "./src/shared/api/hey-api.ts",
    },
    {
      name: "@hey-api/sdk",
      operations: { strategy: "flat" },
    },
  ],
});
