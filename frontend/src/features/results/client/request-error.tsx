"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/shared/api/errors";
import { useI18n } from "@/shared/i18n";

export function RequestError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <AlertCircle
        className="size-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 break-words">
        {getErrorMessage(
          error,
          t(
            "Не удалось загрузить данные",
            "Деректерді жүктеу мүмкін болмады",
            "Unable to load data",
          ),
        )}
      </p>
      {retry ? (
        <Button size="sm" variant="outline" onClick={retry}>
          {t("Повторить", "Қайталау", "Retry")}
        </Button>
      ) : null}
    </div>
  );
}
