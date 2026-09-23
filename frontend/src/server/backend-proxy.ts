import "server-only";

import { env } from "@/server/env";

const REQUEST_HEADERS = ["accept", "content-type", "accept-language"];
const RESPONSE_HEADERS = [
  "content-type", "content-disposition", "etag", "last-modified", "retry-after",
  "content-security-policy", "x-content-type-options", "x-delphi-review-revision",
];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxyError(status: number, code: string, message: string) {
  return Response.json({ code, message, details: [] }, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function isApiPath(path: string[]) {
  return path.length > 1 && path[0] === "api" && path.every((part) =>
    /^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..",
  );
}

export function isAllowedMutation(request: Request) {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin || origin === new URL(env.betterAuthUrl).origin;
}

export async function forwardBackend(request: Request, path: string[]) {
  const upstream = new URL(env.backendInternalUrl);
  upstream.pathname = `/${path.map(encodeURIComponent).join("/")}`;
  upstream.search = new URL(request.url).search;
  upstream.hash = "";

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const timeout = AbortSignal.timeout(180_000);
  const options: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    duplex: "half",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.any([request.signal, timeout]),
  };

  try {
    const response = await fetch(upstream, options);
    const responseHeaders = new Headers({ "cache-control": "private, no-store" });
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    const location = response.headers.get("location");
    if (location) {
      const redirect = new URL(location, upstream);
      if (redirect.origin !== upstream.origin || !isApiPath(redirect.pathname.slice(1).split("/"))) {
        await response.body?.cancel();
        return proxyError(502, "backend_redirect", "The Delphi API returned an unsupported redirect.");
      }
      responseHeaders.set("location", `/backend${redirect.pathname}${redirect.search}`);
    }

    return new Response(
      request.method === "HEAD" || [204, 205, 304].includes(response.status) ? null : response.body,
      { status: response.status, headers: responseHeaders },
    );
  } catch {
    if (timeout.aborted) {
      return proxyError(504, "backend_timeout", "The Delphi API did not respond in time.");
    }
    return proxyError(502, "backend_unavailable", "The Delphi API is unavailable.");
  }
}
