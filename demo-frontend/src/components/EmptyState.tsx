import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "amber";
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, tone = "neutral", className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center",
        tone === "amber" && "border-status-missing-fg/30 bg-status-missing-bg/60 text-status-missing-fg",
        className,
      )}
    >
      <Icon className="size-6 opacity-70" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
