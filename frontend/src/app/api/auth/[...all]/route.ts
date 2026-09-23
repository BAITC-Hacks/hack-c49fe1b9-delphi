import type { NextRequest } from "next/server";

async function handler(request: NextRequest) {
  // Keep database-backed auth initialization out of static build evaluation.
  const [{ toNextJsHandler }, { auth }] = await Promise.all([
    import("better-auth/next-js"),
    import("@/server/auth"),
  ]);
  return request.method === "GET" ? toNextJsHandler(auth).GET(request) : toNextJsHandler(auth).POST(request);
}

export const GET = handler;
export const POST = handler;
