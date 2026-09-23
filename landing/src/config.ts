/** This standalone site presents saved examples; it does not launch a model. */
export const DEMO_ONLY = true;
export const DEMO_URL = (import.meta.env.VITE_DEMO_URL || "http://localhost:5173").replace(/\/+$/, "");

export function resolveLink(to: string): string {
  if (to === "/") return "./";
  if (to === "/history") return `${DEMO_URL}/`;
  if (to === "/new" || to.startsWith("/analyses/")) return `${DEMO_URL}${to}`;
  return to;
}
