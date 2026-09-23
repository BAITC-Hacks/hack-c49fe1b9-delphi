import "server-only";

function required(name: "AUTH_DATABASE_URL" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set. Copy frontend/.env.example to frontend/.env.`);
  }
  return value;
}

const authDatabaseUrl = required("AUTH_DATABASE_URL");
const betterAuthSecret = required("BETTER_AUTH_SECRET");
const betterAuthUrl = required("BETTER_AUTH_URL");

if (!/^postgres(ql)?:\/\//.test(authDatabaseUrl)) {
  throw new Error("AUTH_DATABASE_URL must use PostgreSQL.");
}
if (betterAuthSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
}
if (!/^https?:$/.test(new URL(betterAuthUrl).protocol)) {
  throw new Error("BETTER_AUTH_URL must be an HTTP or HTTPS URL.");
}

export const env = {
  authDatabaseUrl,
  betterAuthSecret,
  betterAuthUrl,
  backendInternalUrl: process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000",
};
