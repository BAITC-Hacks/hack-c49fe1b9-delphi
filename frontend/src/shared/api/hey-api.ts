/**
 * HeyAPI imports this function during generation. It remains independent from
 * generated files so regeneration never overwrites the browser base URL.
 */
export function createClientConfig<T extends { baseUrl?: string }>(config: T): T & { baseUrl: string } {
  return { ...config, baseUrl: "/backend", credentials: "same-origin", cache: "no-store" };
}
