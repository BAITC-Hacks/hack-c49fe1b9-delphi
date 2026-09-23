import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Session lookup is request-specific and must never run during static build.
  await connection();
  const { auth } = await import("@/server/auth");
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      {children}
    </main>
  );
}
