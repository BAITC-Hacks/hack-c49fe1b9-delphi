import { Pool } from "pg";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in frontend/.env.`);
  return value;
}

const connectionString = required("AUTH_DATABASE_URL");
if (!/^postgres(ql)?:\/\//.test(connectionString)) {
  throw new Error("AUTH_DATABASE_URL must use PostgreSQL.");
}

export const database = new Pool({ connectionString, connectionTimeoutMillis: 5_000 });
export const authOptions = {
  database,
  baseURL: required("BETTER_AUTH_URL"),
  secret: required("BETTER_AUTH_SECRET"),
  emailAndPassword: { enabled: true, autoSignIn: false },
};
