import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { resolveLink } from "@/config";

type LinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & { to: string };

/** Ordinary links keep the standalone landing independent of the demo router. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...props }, ref) {
  return <a ref={ref} href={resolveLink(to)} {...props} />;
});
