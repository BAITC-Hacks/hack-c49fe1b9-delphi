import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  // The auth database is consulted only for an incoming request, not at build time.
  await connection();
  const { auth } = await import("@/server/auth");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <WorkspaceShell user={{ name: session.user.name, email: session.user.email }}>{children}</WorkspaceShell>
  );
}
