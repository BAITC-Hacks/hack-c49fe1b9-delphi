import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { authDatabase } from "@/server/db";
import { env } from "@/server/env";

export const auth = betterAuth({
  database: authDatabase,
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  plugins: [nextCookies()],
});
