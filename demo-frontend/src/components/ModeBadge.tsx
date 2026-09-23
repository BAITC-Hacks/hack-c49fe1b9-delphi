import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Mode } from "@/types";

interface Props {
  mode?: Mode;
  failedStage?: number;
  className?: string;
}

/** Honesty badge (DESIGN.md §4.6). Hidden for a live run. */
export function ModeBadge({ mode, failedStage, className }: Props) {
  if (!mode || mode === "live") return null;
  if (mode === "synthetic") {
    return (
      <Badge variant="outline" className={cn("whitespace-nowrap border-status-split-fg/30 bg-status-split-bg font-normal text-status-split-fg", className)}>
        Синтетика: контрольный пример, не запуск модели
      </Badge>
    );
  }
  if (mode === "cached") {
    return (
      <Badge variant="secondary" className={cn("whitespace-nowrap font-normal", className)}>
        Пример: показан сохранённый результат
      </Badge>
    );
  }
  if (mode === "partial") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "whitespace-nowrap border-status-missing-fg/30 bg-status-missing-bg font-normal text-status-missing-fg",
          className,
        )}
      >
        Частичный результат{failedStage ? `: стадия ${failedStage} не завершена` : ""}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn("whitespace-nowrap font-normal", className)}>
      Без LLM: только структурное сопоставление
    </Badge>
  );
}
