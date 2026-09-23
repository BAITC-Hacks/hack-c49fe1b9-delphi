"use client";

import { createAuthClient } from "better-auth/react";

/** Same-origin Better Auth client for browser-only forms and the user menu. */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
