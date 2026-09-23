import type { NextRequest } from "next/server";
import { forwardBackend, isAllowedMutation, isApiPath, proxyError } from "@/server/backend-proxy";

type Context = { params: Promise<{ path: string[] }> };
export const runtime = "nodejs";

async function forward(request: NextRequest, { params }: Context) {
  const { path } = await params;
  if (!isApiPath(path)) {
    return proxyError(404, "not_found", "This API path is not available.");
  }
  if (!isAllowedMutation(request)) {
    return proxyError(403, "invalid_origin", "This request origin is not allowed.");
  }

  try {
    const { auth } = await import("@/server/auth");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return proxyError(401, "unauthorized", "Sign in to use the Delphi API.");
    }
  } catch {
    return proxyError(503, "authentication_unavailable", "The sign-in service is unavailable.");
  }

  return forwardBackend(request, path);
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
