export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function getErrorMessage(error: unknown, fallback = "Unable to complete the request."): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function unwrap<T>(result: { data?: T; error?: unknown; response?: Response }): T {
  if (result.error !== undefined || !result.response?.ok) {
    const code = typeof result.error === "object" && result.error !== null && "code" in result.error
      ? String(result.error.code) : undefined;
    throw new ApiError(getErrorMessage(result.error), result.response?.status, code);
  }
  return result.data as T;
}
