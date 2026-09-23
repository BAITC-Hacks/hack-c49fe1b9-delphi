"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/lib/utils";

type AnalysisStatus = "draft" | "queued" | "running" | "completed" | "partial" | "failed" | "interrupted";

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const { t } = useI18n();
  const labels: Record<AnalysisStatus, string> = {
    draft: t("Черновик", "Жоба", "Draft"),
    queued: t("В очереди", "Кезекте", "Queued"),
    running: t("Выполняется", "Орындалуда", "Running"),
    completed: t("Завершён", "Аяқталды", "Completed"),
    partial: t("Есть ограничения", "Шектеулер бар", "Has limitations"),
    failed: t("Ошибка", "Қате", "Failed"),
    interrupted: t("Прерван", "Үзілді", "Interrupted"),
  };
  return <Badge variant={status === "failed" ? "destructive" : "outline"} className={cn(
    (status === "partial" || status === "interrupted") && "border-amber-300 bg-amber-50 text-amber-900",
    (status === "queued" || status === "running") && "border-primary/30 bg-accent text-accent-foreground",
    status === "completed" && "bg-secondary text-secondary-foreground",
  )}>{labels[status]}</Badge>;
}
