import "server-only";

import { Pool } from "pg";
import { env } from "@/server/env";

const globalForDatabase = globalThis as typeof globalThis & {
  delphiAuthPool?: Pool;
};

export const authDatabase =
  globalForDatabase.delphiAuthPool ?? new Pool({
    connectionString: env.authDatabaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.delphiAuthPool = authDatabase;
}
