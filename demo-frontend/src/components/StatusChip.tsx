import { cn } from "@/lib/utils";
import { metaFor } from "@/lib/status";

interface Props {
  status: string;
  kind?: "function" | "unit" | "risk";
  size?: "sm" | "md";
  className?: string;
}

/** Status pill. Always icon + text: color is never the only signal (DESIGN.md §2). */
export function StatusChip({ status, kind = "function", size = "sm", className }: Props) {
  const meta = metaFor(kind, status);
  if (!meta) {
    return (
      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs", className)}>
        {status}
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 max-w-full whitespace-normal text-left rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        meta.className,
        className,
      )}
      title={meta.hint}
    >
      <Icon className={size === "sm" ? "size-3.5 shrink-0" : "size-4 shrink-0"} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
