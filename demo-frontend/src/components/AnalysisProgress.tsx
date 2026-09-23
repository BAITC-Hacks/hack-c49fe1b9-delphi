import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { counterLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StageState } from "@/types";

export const STAGES = [
  "Извлечение пунктов",
  "Подразделения и обязанности",
  "Сопоставление функций",
  "Проверка пробелов и пересечений",
  "Заключение",
] as const;

interface Props {
  stage: number; // 1..5
  stageState: StageState;
  counters?: Record<string, number>;
  onCancel(): void;
  onRetryStage?(): void;
}

export function AnalysisProgress({ stage, stageState, counters = {}, onCancel, onRetryStage }: Props) {
  const failed = stageState === "failed" || stageState === "interrupted";
  const done = stageState === "done" ? stage : stage - 1;
  const value = Math.min(100, Math.round(((done + (stageState === "running" ? 0.5 : 0)) / STAGES.length) * 100));
  const statusText =
    stageState === "interrupted"
      ? `Анализ прерван на стадии ${stage} «${STAGES[stage - 1]}» (сервер перезапускался). Повторите стадию`
      : stageState === "failed"
        ? `Стадия ${stage} «${STAGES[stage - 1]}» не завершена`
        : `Стадия ${stage} из ${STAGES.length}: ${STAGES[stage - 1]}`;

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">Анализ комплектов</CardTitle>
        <p className="text-sm text-muted-foreground">Обычно 2–4 минуты. Можно оставить вкладку открытой.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-col gap-3">
          {STAGES.map((label, i) => {
            const n = i + 1;
            const isDone = n < stage || (n === stage && stageState === "done");
            const isActive = n === stage && stageState === "running";
            const isFailed = n === stage && failed;
            return (
              <li key={label} className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    isDone && "border-status-new-fg/30 bg-status-new-bg text-status-new-fg",
                    isActive && "border-primary text-primary",
                    isFailed && "border-status-missing-fg/40 bg-status-missing-bg text-status-missing-fg",
                    !isDone && !isActive && !isFailed && "text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {isDone ? (
                    <Check className="size-3.5 animate-in fade-in zoom-in-95 duration-200" />
                  ) : isActive ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : isFailed ? (
                    <AlertTriangle className="size-3.5" />
                  ) : (
                    n
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", isActive && "font-medium", !isDone && !isActive && !isFailed && "text-muted-foreground")}>
                    {label}
                  </p>
                  {isActive && Object.keys(counters).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(counters)
                        .map(([k, v]) => `${counterLabel(k)}: ${v}`)
                        .join(" · ")}
                    </p>
                  )}
                  {isFailed && onRetryStage && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={onRetryStage}>
                      Повторить стадию
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-2">
          <Progress value={value} aria-label="Общий прогресс анализа" />
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {statusText}
          </p>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Отменить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
