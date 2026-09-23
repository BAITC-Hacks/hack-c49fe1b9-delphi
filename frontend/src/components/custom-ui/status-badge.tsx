"use client";

import { Check, CircleDashed, FileText, LoaderCircle, Pause, TriangleAlert, XCircle, type LucideIcon } from "lucide-react";
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
  const icons: Record<AnalysisStatus, LucideIcon> = { draft: FileText, queued: CircleDashed, running: LoaderCircle, completed: Check, partial: TriangleAlert, failed: XCircle, interrupted: Pause };
  const Icon = icons[status];
  return <Badge variant={status === "failed" ? "destructive" : "outline"} className={cn(
    (status === "partial" || status === "interrupted") && "border-status-missing-fg/20 bg-status-missing-bg text-status-missing-fg",
    (status === "queued" || status === "running") && "border-primary/30 bg-accent text-accent-foreground",
    status === "completed" && "border-status-kept-fg/20 bg-status-kept-bg text-status-kept-fg",
  )}><Icon className={cn("size-3 shrink-0", status === "running" && "animate-spin")} aria-hidden="true" />{labels[status]}</Badge>;
}
